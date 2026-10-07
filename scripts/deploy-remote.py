"""Safe staged deployment: no directory swap and no chmod of existing directories."""
import base64
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import urllib.request
import urllib.error


def run(args, **kwargs):
    return subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs).stdout


def digest(file):
    h = hashlib.sha256()
    with open(file, 'rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def safe_path(root, relative):
    if not re.fullmatch(r'[A-Za-z0-9_./-]+', relative) or any(p in ('', '.', '..') for p in relative.split('/')):
        raise ValueError('Unsafe path: ' + relative)
    target = root / relative
    for candidate in [root] + list(reversed(target.parents)) + [target]:
        if candidate.is_symlink():
            raise ValueError('Symlink prohibited: ' + str(candidate))
    if os.path.commonpath([str(root), str(target)]) != str(root):
        raise ValueError('Path outside website')
    return target


def allowed(relative, policy):
    if any(part in policy['protectedNames'] for part in relative.split('/')):
        return False
    if relative in policy['rootFiles'] + policy['actionFiles']:
        return True
    if relative.startswith('assets/'):
        return Path(relative).suffix in policy['assetExtensions']
    return relative.endswith('/index.html') and any(relative.startswith(p) for p in policy['pagePrefixes'])


def validate(req):
    if sys.version_info < (3, 8):
        raise RuntimeError('Python 3.8+ required on hosting')
    manifest = req['manifest']
    policy = manifest['policy']
    if policy.get('deleteRemoteFiles') is not False or req['root'] != policy['remotePath']:
        raise ValueError('Unapproved remote path/policy')
    if policy['origin'] != 'https://abs-engineer.ru':
        raise ValueError('Unapproved HTTP origin')
    root = Path(req['root'])
    if not root.is_absolute() or not root.is_dir() or root.name != 'public_html':
        raise ValueError('Existing public_html required')
    safe_path(root, 'index.html')
    if not re.fullmatch(r'[a-f0-9]{40,64}', manifest['commit']):
        raise ValueError('Invalid commit')
    if not re.fullmatch(r'[a-f0-9]{32}', req['run']):
        raise ValueError('Invalid run ID')
    paths = set()
    for entry in manifest['files']:
        relative = entry['path']
        safe_path(root, relative)
        if relative in paths or not allowed(relative, policy) or not re.fullmatch(r'[a-f0-9]{64}', entry['sha256']) or entry['size'] <= 0:
            raise ValueError('Invalid manifest entry: ' + relative)
        paths.add(relative)
    for required in policy['rootFiles'] + policy['actionFiles'] + ['assets/css/site.css', 'assets/js/site.js']:
        if required not in paths:
            raise ValueError('Incomplete manifest: ' + required)
    for name in ('getfacl', 'setfacl', 'tar'):
        if not shutil.which(name):
            raise RuntimeError('Missing hosting tool: ' + name)
    help_text = run(['tar', '--help']).decode('utf-8', 'replace')
    if '--acls' not in help_text or '--xattrs' not in help_text:
        raise RuntimeError('GNU tar with ACL/xattr support required')
    state = root.parent / '.abs-deploy'
    safe_path(root.parent, '.abs-deploy/' + req['run'])
    return root, state, state / req['run']


def acl(file, default=False):
    args = ['getfacl', '-c', '-p', '-n']
    if default:
        args.append('-d')
    return run(args + [str(file)]).decode('ascii').strip()


def metadata(file):
    info = file.stat()
    return {'uid': info.st_uid, 'gid': info.st_gid, 'mode': stat.S_IMODE(info.st_mode), 'acl': acl(file)}


def apply_metadata(file, saved):
    info = file.stat()
    if (info.st_uid, info.st_gid) != (saved['uid'], saved['gid']):
        os.chown(file, saved['uid'], saved['gid'])
    run(['setfacl', '--set-file=-', str(file)], input=(saved['acl'] + '\n').encode('ascii'))
    os.chmod(file, saved['mode'])  # Only a prepared/restore file outside public_html.
    if metadata(file) != saved:
        raise RuntimeError('Cannot preserve owner/mode/ACL: ' + str(file))


def inherit_file(file, parent):
    default_acl = acl(parent, default=True)
    if not default_acl:
        raise RuntimeError('Destination has no default ACL: ' + str(parent))
    lines = []
    for line in default_acl.splitlines():
        line = line.split('#')[0].strip()
        if not line:
            continue
        if line.startswith('default:'):
            line = line[8:]
        parts = line.split(':')
        parts[-1] = parts[-1].replace('x', '-')
        lines.append(':'.join(parts))
    info = parent.stat()
    if (file.stat().st_uid, file.stat().st_gid) != (info.st_uid, info.st_gid):
        os.chown(file, info.st_uid, info.st_gid)
    run(['setfacl', '--set-file=-', str(file)], input=('\n'.join(lines) + '\n').encode('ascii'))
    if acl(file) != '\n'.join(lines):
        raise RuntimeError('New file ACL differs from destination inheritance')


def plan(req, root):
    changes = []
    for entry in req['manifest']['files']:
        file = safe_path(root, entry['path'])
        if file.exists() and not file.is_file():
            raise ValueError('Not a regular file: ' + str(file))
        previous = digest(file) if file.exists() else None
        if previous != entry['sha256']:
            changes.append(dict(entry, previous=previous, kind='replace' if previous else 'add'))
    return {'commit': req['manifest']['commit'], 'changes': changes,
            'uploadBytes': sum(e['size'] for e in changes), 'freeBytes': shutil.disk_usage(root).free,
            'quotaVerified': False, 'deletions': []}


def save(stage, journal):
    temporary = stage / 'journal.tmp'
    with open(temporary, 'w', encoding='utf-8') as stream:
        stream.write(json.dumps(journal, indent=2))
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, stage / 'journal.json')
    if os.name == 'posix':
        descriptor = os.open(str(stage), os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def own_lock(state, run_id):
    lock = state / 'lock'
    if lock.is_symlink() or not lock.is_dir() or (lock / 'run').read_text().strip() != run_id:
        raise RuntimeError('Deployment lock belongs to another run')
    return lock


def stage_upload(req, root, state, stage):
    state.mkdir(exist_ok=True)
    lock = state / 'lock'
    lock.mkdir()  # Atomic lock. Never steal or expire an existing deployment lock.
    (lock / 'run').write_text(req['run'])
    try:
        stage.mkdir()
        current = plan(req, root)
        if current['changes'] != req['plan']['changes']:
            raise RuntimeError('Website changed since preview; start a fresh plan')
        old_bytes = sum(safe_path(root, e['path']).stat().st_size for e in current['changes'] if e['previous'])
        required = current['uploadBytes'] * 3 + old_bytes * 3 + 32 * 1024 * 1024
        if shutil.disk_usage(root).free < required:
            raise RuntimeError('Insufficient filesystem space; account quota also needs checking')
        (stage / 'payload').mkdir()
        journal = {'request': req, 'changes': current['changes'], 'phase': 'uploading', 'published': [],
                   'createdDirs': [], 'directories': {}, 'metadata': {}, 'backup': None}
        save(stage, journal)
        return {'stage': str(stage), 'run': req['run']}
    except BaseException:
        (lock / 'run').unlink()
        lock.rmdir()
        raise


def check_previous(root, entries):
    for entry in entries:
        file = safe_path(root, entry['path'])
        actual = digest(file) if file.exists() else None
        if actual != entry['previous']:
            raise RuntimeError('Concurrent modification: ' + entry['path'])


def unpack(stage, entries):
    expected = {e['path']: e for e in entries}
    with tarfile.open(stage / 'payload.tar', 'r:') as archive:
        members = archive.getmembers()
        if len(members) != len(expected) or {m.name for m in members} != set(expected):
            raise RuntimeError('Payload archive differs from planned changed files')
        for member in members:
            if not member.isfile() or member.size != expected[member.name]['size']:
                raise RuntimeError('Payload contains special file or wrong size')
            output = safe_path(stage / 'payload', member.name)
            output.parent.mkdir(parents=True, exist_ok=True)
            with archive.extractfile(member) as source, open(output, 'xb') as destination:
                shutil.copyfileobj(source, destination)
            if digest(output) != expected[member.name]['sha256']:
                raise RuntimeError('Staged SHA-256 mismatch: ' + member.name)


def backup(root, stage, journal):
    existing = [e for e in journal['changes'] if e['previous']]
    for entry in existing:
        journal['metadata'][entry['path']] = metadata(safe_path(root, entry['path']))
    listing = stage / 'backup-files.txt'
    listing.write_text(''.join(e['path'] + '\n' for e in existing), encoding='ascii')
    now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S')
    archive = root.parent / ('backup-served-' + now + '-' + journal['request']['run'] + '.tgz')
    with open(archive, 'xb') as output:
        subprocess.run(['tar', '--acls', '--xattrs', '--numeric-owner', '-czf', '-', '-C', str(root), '-T', str(listing)], stdout=output, stderr=subprocess.PIPE, check=True)
    names = run(['tar', '-tzf', str(archive)]).decode('ascii').splitlines()
    if sorted(names) != sorted(e['path'] for e in existing):
        raise RuntimeError('Backup archive list differs from planned replacements')
    restore = stage / 'restore'
    restore.mkdir()
    run(['tar', '--acls', '--xattrs', '--no-same-owner', '-xzf', str(archive), '-C', str(restore)])
    for entry in existing:
        file = safe_path(restore, entry['path'])
        if digest(file) != entry['previous']:
            raise RuntimeError('Backup content check failed: ' + entry['path'])
        apply_metadata(file, journal['metadata'][entry['path']])
    journal['backup'] = str(archive)
    journal['phase'] = 'backed_up'
    save(stage, journal)
    Path(str(archive) + '.json').write_text(json.dumps(journal, indent=2), encoding='utf-8')


def ensure_parent(root, parent, stage, journal):
    if parent.exists():
        relative = '.' if parent == root else parent.relative_to(root).as_posix()
        journal['directories'].setdefault(relative, metadata(parent))
        if not acl(parent, default=True):
            raise RuntimeError('Destination directory has no default ACL: ' + relative)
        return
    ensure_parent(root, parent.parent, stage, journal)
    journal['createdDirs'].append(parent.relative_to(root).as_posix())
    save(stage, journal)
    parent.mkdir()
    inherited = acl(parent.parent, default=True).replace('default:', '')
    access = '\n'.join(line for line in acl(parent).splitlines() if not line.startswith('default:'))
    if access != inherited or acl(parent, default=True) != acl(parent.parent, default=True):
        raise RuntimeError('New directory did not inherit expected ACL')
    info = parent.parent.stat()
    if (parent.stat().st_uid, parent.stat().st_gid) != (info.st_uid, info.st_gid):
        os.chown(parent, info.st_uid, info.st_gid)


def verify_directories(root, journal):
    for relative, saved in journal['directories'].items():
        directory = root if relative == '.' else safe_path(root, relative)
        if metadata(directory) != saved:
            raise RuntimeError('Existing directory permissions changed: ' + relative)


def smoke(req, root):
    entries = {e['path']: e for e in req['manifest']['files']}
    selected = {'index.html', 'assets/css/site.css', 'assets/js/site.js'}
    selected.update(e['path'] for e in req['plan']['changes'] if e['path'].endswith('.html'))
    selected.update(e['path'] for e in req['plan']['changes'] if Path(e['path']).suffix in ('.css', '.js', '.png', '.jpg', '.jpeg', '.webp', '.avif', '.svg', '.gif', '.ico'))
    images = [name for name in entries if Path(name).suffix in ('.png', '.jpg', '.webp', '.svg')]
    if images:
        selected.add(images[0])
    for relative in sorted(selected):
        url = req['manifest']['policy']['origin'] + '/' + relative + '?deploy_check=' + req['run']
        response = urllib.request.urlopen(urllib.request.Request(url, headers={'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache'}), timeout=20)
        with response:
            if response.status != 200 or not response.geturl().startswith(req['manifest']['policy']['origin'] + '/'):
                raise RuntimeError('HTTP smoke check failed: ' + relative)
            if hashlib.sha256(response.read()).hexdigest() != entries[relative]['sha256']:
                raise RuntimeError('HTTP bytes differ from manifest: ' + relative)
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    opener = urllib.request.build_opener(NoRedirect)
    try:
        opener.open(req['manifest']['policy']['origin'] + '/actions/send-request.php', timeout=20)
        raise RuntimeError('Form handler GET must redirect without submitting a form')
    except urllib.error.HTTPError as error:
        if error.code != 303 or error.headers.get('Location') != '/request/':
            raise RuntimeError('Form handler smoke check failed')


def rollback(root, stage, journal):
    journal['phase'] = 'rolling_back'
    save(stage, journal)
    changes = {e['path']: e for e in journal['changes']}
    for relative in reversed(journal['published']):
        entry = changes[relative]
        target = safe_path(root, relative)
        actual = digest(target) if target.exists() else None
        if actual not in (entry['sha256'], entry['previous']):
            raise RuntimeError('Rollback conflict; refusing to overwrite: ' + relative)
        if entry['previous']:
            if actual == entry['previous']:
                if metadata(target) != journal['metadata'][relative]:
                    raise RuntimeError('Rollback metadata conflict: ' + relative)
                continue
            restored = safe_path(stage / 'restore', relative)
            if digest(restored) != entry['previous']:
                raise RuntimeError('Rollback backup missing or corrupt')
            apply_metadata(restored, journal['metadata'][relative])
            os.replace(restored, target)
            if digest(target) != entry['previous'] or metadata(target) != journal['metadata'][relative]:
                raise RuntimeError('Rollback verification failed')
        elif target.exists():
            target.unlink()  # Only an addition from this failed release, never an old server file.
    for relative in reversed(journal['createdDirs']):
        directory = safe_path(root, relative)
        if directory.exists():
            directory.rmdir()  # Refuse to remove any unrelated file.
    verify_directories(root, journal)
    journal['phase'] = 'rolled_back'
    save(stage, journal)


def publish(req, root, state, stage):
    own_lock(state, req['run'])
    journal = json.loads((stage / 'journal.json').read_text())
    if journal['request']['manifest'] != req['manifest'] or journal['phase'] != 'uploading':
        raise RuntimeError('Stage does not match requested release')
    try:
        check_previous(root, journal['changes'])
        unpack(stage, journal['changes'])
        backup(root, stage, journal)
        prepared = stage / 'prepared'
        prepared.mkdir()
        for entry in journal['changes']:
            target = safe_path(root, entry['path'])
            ensure_parent(root, target.parent, stage, journal)
            temp = safe_path(prepared, entry['path'])
            temp.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(stage / 'payload' / entry['path'], temp)
            if digest(temp) != entry['sha256']:
                raise RuntimeError('Prepared file SHA-256 mismatch: ' + entry['path'])
            if entry['previous']:
                apply_metadata(temp, journal['metadata'][entry['path']])
            else:
                inherit_file(temp, target.parent)
            if temp.stat().st_dev != target.parent.stat().st_dev:
                raise RuntimeError('Atomic replacement requires the same filesystem')
        check_previous(root, journal['changes'])
        journal['phase'] = 'publishing'
        save(stage, journal)
        for entry in journal['changes']:
            relative = entry['path']
            journal['published'].append(relative)
            save(stage, journal)
            os.replace(safe_path(prepared, relative), safe_path(root, relative))
        for entry in req['manifest']['files']:
            if digest(safe_path(root, entry['path'])) != entry['sha256']:
                raise RuntimeError('Final SHA-256 mismatch: ' + entry['path'])
        verify_directories(root, journal)
        smoke(req, root)
        journal['phase'] = 'complete'
        save(stage, journal)
        return {'status': 'complete', 'commit': req['manifest']['commit'], 'backup': journal['backup'], 'changed': len(journal['changes'])}
    except BaseException as error:
        try:
            rollback(root, stage, journal)
        except BaseException as recovery_error:
            journal['phase'] = 'rollback_failed'
            journal['error'] = str(error)
            journal['recoveryError'] = str(recovery_error)
            save(stage, journal)
            raise RuntimeError('Rollback needs manual recovery; lock retained. ' + str(recovery_error)) from error
        raise RuntimeError('Publication cancelled; previous version restored. ' + str(error)) from error
    finally:
        if journal['phase'] in ('complete', 'rolled_back'):
            lock = own_lock(state, req['run'])
            (lock / 'run').unlink()
            lock.rmdir()


def dispatch(req):
    root, state, stage = validate(req)
    action = req['action']
    if action == 'plan':
        return plan(req, root)
    if action == 'stage':
        return stage_upload(req, root, state, stage)
    if action == 'publish':
        return publish(req, root, state, stage)
    if action == 'status':
        journal = json.loads((stage / 'journal.json').read_text())
        if journal['request']['manifest'] != req['manifest']:
            raise RuntimeError('Status manifest differs from saved release')
        return {'status': journal['phase'], 'commit': journal['request']['manifest']['commit'],
                'backup': journal['backup'], 'published': journal['published']}
    if action == 'recover':
        own_lock(state, req['run'])
        journal = json.loads((stage / 'journal.json').read_text())
        if journal['request']['manifest'] != req['manifest']:
            raise RuntimeError('Recovery manifest differs from saved release')
        if journal['phase'] == 'complete':
            raise RuntimeError('Completed release is not an interrupted deployment')
        rollback(root, stage, journal)
        lock = own_lock(state, req['run'])
        (lock / 'run').unlink()
        lock.rmdir()
        return {'status': 'rolled_back', 'backup': journal['backup']}
    raise ValueError('Unknown deployment action')


def main(req):
    try:
        print(json.dumps({'ok': True, 'result': dispatch(req)}))
    except BaseException as error:
        print(json.dumps({'ok': False, 'error': str(error)}))
        sys.exit(1)
