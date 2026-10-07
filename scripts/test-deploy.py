"""Offline failure-injection tests. ACL/ownership backend is simulated, not Beget."""
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('deploy_remote', Path(__file__).with_name('deploy-remote.py'))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class SafeDeployTests(unittest.TestCase):
    def setUp(self):
        self.workspace = tempfile.TemporaryDirectory(prefix='abs-deploy-test-')
        self.addCleanup(self.workspace.cleanup)
        self.root = Path(self.workspace.name) / 'public_html'
        self.root.mkdir()
        self.state = self.root.parent / '.abs-deploy'
        self.run = '1' * 32
        self.stage = self.state / self.run
        self.write('index.html', b'old home')
        self.write('assets/css/site.css', b'same css')
        self.write('skills/private.txt', b'protected work')
        self.policy = json.loads(Path(__file__).with_name('deploy-policy.json').read_text())
        self.req = {'action': 'stage', 'root': str(self.root), 'run': self.run,
                    'manifest': {'commit': 'a' * 40, 'policy': self.policy,
                                 'files': [self.entry('index.html', b'new home'),
                                           self.entry('assets/css/site.css', b'same css'),
                                           self.entry('kontakty/index.html', b'new page')]}}
        self.req['plan'] = deploy.plan(self.req, self.root)
        self.meta_by_inode = {}

    def write(self, name, data):
        file = self.root / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(data)

    @staticmethod
    def entry(name, data):
        return {'path': name, 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()}

    def metadata(self, file):
        return copy.deepcopy(self.meta_by_inode.setdefault(file.stat().st_ino,
                           {'uid': 1000, 'gid': 1001, 'mode': 0o755 if file.is_dir() else 0o600,
                            'acl': 'simulated inherited ACL'}))

    def apply(self, file, saved):
        self.meta_by_inode[file.stat().st_ino] = copy.deepcopy(saved)

    def fake_backup(self, root, stage, journal):
        restore = stage / 'restore'
        restore.mkdir()
        archive = root.parent / ('backup-served-test-' + self.run + '.tgz')
        with tarfile.open(archive, 'w:gz') as output:
            for entry in journal['changes']:
                if not entry['previous']:
                    continue
                source = root / entry['path']
                journal['metadata'][entry['path']] = self.metadata(source)
                destination = restore / entry['path']
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, destination)
                self.apply(destination, journal['metadata'][entry['path']])
                output.add(source, arcname=entry['path'])
        journal['backup'] = str(archive)
        journal['phase'] = 'backed_up'
        deploy.save(stage, journal)

    def payload(self, bad=False):
        deploy.stage_upload(self.req, self.root, self.state, self.stage)
        with tarfile.open(self.stage / 'payload.tar', 'w:') as archive:
            for entry in self.req['plan']['changes']:
                data = b'new home' if entry['path'] == 'index.html' else b'new page'
                if bad:
                    data = b'x' * len(data)
                member = tarfile.TarInfo(entry['path'])
                member.size = len(data)
                archive.addfile(member, io.BytesIO(data))

    def execute(self, failure=None, permission_failure=False):
        base = 'user::rwx\ngroup::rwx\nother::---'
        def acl(file, default=False):
            return '\n'.join('default:' + line for line in base.splitlines()) if default else base
        def apply(file, saved):
            if permission_failure and 'prepared' in file.parts:
                raise PermissionError('Cannot preserve owner')
            self.apply(file, saved)
        with patch.object(deploy, 'metadata', self.metadata), patch.object(deploy, 'acl', acl), \
             patch.object(deploy, 'apply_metadata', apply), patch.object(deploy, 'inherit_file', lambda f, p: self.apply(f, self.metadata(p))), \
             patch.object(deploy, 'backup', self.fake_backup), patch.object(deploy, 'smoke', side_effect=failure):
            return deploy.publish(self.req, self.root, self.state, self.stage)

    def assert_old(self):
        self.assertEqual((self.root / 'index.html').read_bytes(), b'old home')
        self.assertEqual((self.root / 'skills/private.txt').read_bytes(), b'protected work')
        self.assertFalse((self.root / 'kontakty/index.html').exists())

    def test_plan_excludes_unchanged_and_never_deletes(self):
        self.assertEqual([e['path'] for e in self.req['plan']['changes']], ['index.html', 'kontakty/index.html'])
        self.assertEqual(self.req['plan']['deletions'], [])

    def test_preview_does_not_create_server_state(self):
        deploy.plan(self.req, self.root)
        self.assertFalse(self.state.exists())
        self.assert_old()

    def test_interrupted_upload_does_not_change_site(self):
        deploy.stage_upload(self.req, self.root, self.state, self.stage)
        self.assert_old()
        self.assertTrue((self.state / 'lock').exists())

    def test_lock_blocks_second_run(self):
        deploy.stage_upload(self.req, self.root, self.state, self.stage)
        other = dict(self.req, run='2' * 32)
        with self.assertRaises(FileExistsError):
            deploy.stage_upload(other, self.root, self.state, self.state / other['run'])
        self.assert_old()

    def test_changed_since_preview_stops_staging(self):
        self.write('index.html', b'another release')
        with self.assertRaisesRegex(RuntimeError, 'changed since preview'):
            deploy.stage_upload(self.req, self.root, self.state, self.stage)
        self.assertFalse((self.state / 'lock').exists())

    def test_publish_preserves_protected_files_and_directory_metadata(self):
        self.payload()
        original = self.metadata(self.root)
        result = self.execute()
        self.assertEqual(result['status'], 'complete')
        self.assertEqual((self.root / 'index.html').read_bytes(), b'new home')
        self.assertEqual((self.root / 'kontakty/index.html').read_bytes(), b'new page')
        self.assertEqual((self.root / 'skills/private.txt').read_bytes(), b'protected work')
        self.assertEqual(self.metadata(self.root), original)
        self.assertFalse((self.state / 'lock').exists())

    def test_http_failure_restores_files_and_removes_only_new_additions(self):
        self.payload()
        with self.assertRaisesRegex(RuntimeError, 'previous version restored'):
            self.execute(RuntimeError('HTTP mismatch'))
        self.assert_old()
        self.assertFalse((self.root / 'kontakty').exists())
        self.assertEqual(json.loads((self.stage / 'journal.json').read_text())['phase'], 'rolled_back')

    def test_permission_failure_before_first_replacement(self):
        self.payload()
        with self.assertRaisesRegex(RuntimeError, 'Cannot preserve owner'):
            self.execute(permission_failure=True)
        self.assert_old()

    def test_second_replacement_failure_rolls_back_first(self):
        self.payload()
        original_replace = deploy.os.replace
        def interrupted(source, target):
            if Path(target) == self.root / 'kontakty/index.html':
                raise OSError('Injected replacement failure')
            return original_replace(source, target)
        with patch.object(deploy.os, 'replace', side_effect=interrupted):
            with self.assertRaisesRegex(RuntimeError, 'previous version restored'):
                self.execute()
        self.assert_old()
        self.assertFalse((self.state / 'lock').exists())

    def test_foreign_change_prevents_destructive_rollback(self):
        self.payload()
        def external_change(*args):
            self.write('index.html', b'foreign write after publish')
            raise RuntimeError('Smoke failed')
        with self.assertRaisesRegex(RuntimeError, 'manual recovery'):
            self.execute(external_change)
        self.assertEqual((self.root / 'index.html').read_bytes(), b'foreign write after publish')
        self.assertTrue((self.state / 'lock').exists())
        self.assertEqual(json.loads((self.stage / 'journal.json').read_text())['phase'], 'rollback_failed')

    def test_corrupt_upload_before_first_replacement(self):
        self.payload(bad=True)
        with self.assertRaisesRegex(RuntimeError, 'SHA-256 mismatch'):
            self.execute()
        self.assert_old()

    def test_concurrent_change_not_overwritten(self):
        self.payload()
        self.write('index.html', b'concurrent change')
        with self.assertRaisesRegex(RuntimeError, 'Concurrent modification'):
            self.execute()
        self.assertEqual((self.root / 'index.html').read_bytes(), b'concurrent change')

    def test_unsafe_paths_and_protected_files(self):
        for name in ('../index.html', '/index.html', 'assets//a.css', 'assets/../index.html'):
            with self.assertRaises(ValueError):
                deploy.safe_path(self.root, name)
        for name in ('skills/a.css', '.htaccess', 'assets/uploads/a.jpg', '_prototype/index.html', 'actions/secret.php'):
            self.assertFalse(deploy.allowed(name, self.policy))

    def test_tar_rejects_unplanned_file(self):
        self.payload()
        with tarfile.open(self.stage / 'payload.tar', 'a:') as archive:
            member = tarfile.TarInfo('skills/private.txt')
            member.size = 1
            archive.addfile(member, io.BytesIO(b'x'))
        with self.assertRaisesRegex(RuntimeError, 'differs'):
            deploy.unpack(self.stage, self.req['plan']['changes'])
        self.assert_old()

    def test_tar_rejects_symlink(self):
        self.payload()
        with tarfile.open(self.stage / 'payload.tar', 'w:') as archive:
            for entry in self.req['plan']['changes']:
                member = tarfile.TarInfo(entry['path'])
                member.type = tarfile.SYMTYPE
                member.linkname = '../outside'
                archive.addfile(member)
        with self.assertRaisesRegex(RuntimeError, 'special file'):
            deploy.unpack(self.stage, self.req['plan']['changes'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
