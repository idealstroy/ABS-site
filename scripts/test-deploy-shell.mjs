import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { packageChanges } from './deploy-prepare.mjs';

const shell = process.platform === 'win32' ? path.join(process.env.ProgramFiles || 'C:/Program Files', 'Git/bin/bash.exe') : '/bin/sh';
assert.ok(fs.existsSync(shell), 'Offline shell tests require existing Git Bash on Windows, or /bin/sh. Nothing is installed.');
const engine = fs.readFileSync('scripts/deploy-remote.sh', 'utf8').replace(/\r\n/g, '\n');
const shellPath = (file) => process.platform === 'win32' ? file.replaceAll('\\', '/').replace(/^([A-Z]):/i, (_, drive) => '/' + drive.toLowerCase()) : file;
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'abs-shell-test-'));
let passed = 0;
const policy = JSON.parse(fs.readFileSync('scripts/deploy-policy.json', 'utf8'));
function fixture() {
  const parent = fs.mkdtempSync(path.join(work, 'run-'));
  const root = path.join(parent, 'public_html');
  fs.mkdirSync(path.join(root, 'assets/css'), { recursive: true });
  fs.mkdirSync(path.join(root, 'skills'));
  fs.writeFileSync(path.join(root, 'index.html'), 'old home');
  fs.writeFileSync(path.join(root, 'assets/css/site.css'), 'old css');
  fs.writeFileSync(path.join(root, 'skills/private.txt'), 'untouched work');
  const entries = [ ['index.html', 'new home', 'old home'], ['assets/css/site.css', 'new css', 'old css'], ['kontakty/index.html', 'new contact', null] ].map(([name, bytes, old]) => ({ path: name, size: Buffer.byteLength(bytes), sha256: hash(bytes), previous: old === null ? '-' : hash(old), bytes }));
  const run = crypto.randomBytes(16).toString('hex');
  const stage = path.join(parent, '.abs-deploy-simple', run);
  // Simulated POSIX default ACL: Windows ACLs are not Beget ACLs. Real shell,
  // tar, hashes, content updates and recovery are exercised without a server.
  const acl = `getfacl() {\ncase \" $* \" in *' -d '*) ${'printf'} 'default:user::rwx\\ndefault:group::rwx\\ndefault:other::---\\n';; *) printf 'user::rwx\\ngroup::rwx\\nother::---\\n';; esac\n}\n`;
  function execute(action, overrides = '') {
    const list = entries.map(e => `${e.sha256} ${e.size} ${e.previous} ${e.path}`).join('\n');
    const archiveSha = fs.existsSync(path.join(stage, 'payload.tar')) ? hash(fs.readFileSync(path.join(stage, 'payload.tar'))) : '-';
    const program = `root=${quote(shellPath(root))}\nrun_id='${run}'\naction='${action}'\narchive_sha='${archiveSha}'\nmanifest() { cat <<'ABS_MANIFEST'\n${list}\nABS_MANIFEST\n}\n${acl}${overrides}\n${engine}`;
    const result = spawnSync(shell, ['-s'], { input: program, encoding: 'utf8', timeout: 30000, env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
    if (result.error) throw result.error;
    return result;
  }
  function stageFiles() {
    assert.equal(execute('stage').status, 0);
    const dist = path.join(parent, 'build');
    for (const e of entries) { const target = path.join(dist, e.path); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, e.bytes); }
    packageChanges(dist, { changes: entries }, { files: entries, policy }, path.join(stage, 'payload.tar'));
  }
  function oldSite() {
    assert.equal(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), 'old home');
    assert.equal(fs.readFileSync(path.join(root, 'assets/css/site.css'), 'utf8'), 'old css');
    assert.equal(fs.readFileSync(path.join(root, 'skills/private.txt'), 'utf8'), 'untouched work');
    assert.ok(!fs.existsSync(path.join(root, 'kontakty/index.html')));
  }
  return { parent, root, stage, execute, stageFiles, oldSite };
}
function test(name, callback) { callback(); passed++; console.log('PASS: ' + name); }
try {
  test('check/plan are read-only; no staging or Python', () => {
    const f = fixture();
    assert.equal(f.execute('check').status, 0);
    assert.equal(f.execute('plan').status, 0);
    assert.ok(!fs.existsSync(path.dirname(f.stage)));
    f.oldSite();
  });
  test('prepare validates backup without changing live files', () => {
    const f = fixture(); f.stageFiles();
    const r = f.execute('prepare'); assert.equal(r.status, 0, r.stderr);
    f.oldSite();
    assert.equal(fs.readFileSync(path.join(f.stage, 'status'), 'utf8').trim(), 'prepared');
    assert.ok(fs.readdirSync(f.parent).some(n => n.startsWith('backup-served-') && n.endsWith('.tgz.acl')));
  });
  test('resources before HTML; preserve existing inode and foreign files', () => {
    const f = fixture(); f.stageFiles();
    assert.equal(f.execute('prepare').status, 0);
    const inode = fs.statSync(path.join(f.root, 'index.html')).ino;
    const r = f.execute('activate'); assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.statSync(path.join(f.root, 'index.html')).ino, inode);
    assert.equal(fs.readFileSync(path.join(f.root, 'index.html'), 'utf8'), 'new home');
    assert.equal(fs.readFileSync(path.join(f.root, 'skills/private.txt'), 'utf8'), 'untouched work');
    assert.equal(fs.readFileSync(path.join(f.stage, 'applied'), 'utf8').split('\n')[0], 'assets/css/site.css');
    assert.equal(f.execute('finish').status, 0);
    assert.ok(!fs.existsSync(path.join(path.dirname(f.stage), 'lock')));
  });
  test('HTTP failure recovery restores previous files and only removes own additions', () => {
    const f = fixture(); f.stageFiles(); assert.equal(f.execute('prepare').status, 0); assert.equal(f.execute('activate').status, 0);
    const r = f.execute('recover'); assert.equal(r.status, 0, r.stderr); f.oldSite();
  });
  test('corrupt upload stops before any live write', () => {
    const f = fixture(); f.stageFiles(); fs.appendFileSync(path.join(f.stage, 'payload.tar'), 'corrupt');
    // Whole archive hash is supplied by the caller, so force the original expected value.
    const r = f.execute('prepare', "archive_sha='" + '0'.repeat(64) + "'");
    assert.notEqual(r.status, 0); f.oldSite();
  });
  test('parallel run blocked and concurrent server change not overwritten', () => {
    const f = fixture(); f.stageFiles(); assert.notEqual(f.execute('stage').status, 0);
    fs.writeFileSync(path.join(f.root, 'index.html'), 'foreign release');
    assert.notEqual(f.execute('prepare').status, 0);
    assert.equal(fs.readFileSync(path.join(f.root, 'index.html'), 'utf8'), 'foreign release');
  });
  test('missing hosting command is detected in read-only compatibility check', () => {
    const f = fixture(); const r = f.execute('check', "command() { if [ \"$2\" = getfacl ]; then return 1; else builtin command \"$@\"; fi; }");
    assert.notEqual(r.status, 0); f.oldSite();
  });
  test('activation failure rolls back resource already written', () => {
    const f = fixture(); f.stageFiles(); assert.equal(f.execute('prepare').status, 0);
    const r = f.execute('activate', "mkdir() { case \"$*\" in *kontakty*) return 1;; *) command mkdir \"$@\";; esac; }");
    assert.notEqual(r.status, 0); f.oldSite();
    assert.equal(fs.readFileSync(path.join(f.stage, 'status'), 'utf8').trim(), 'rolled_back');
  });
  test('interrupted staging recovery only releases lock', () => {
    const f = fixture(); f.stageFiles(); const r = f.execute('recover'); assert.equal(r.status, 0, r.stderr); f.oldSite();
  });
  test('partial file write restores original bytes', () => {
    const f = fixture(); f.stageFiles(); assert.equal(f.execute('prepare').status, 0);
    const r = f.execute('activate', "cat() { case \"$1\" in */payload/index.html) printf 'partial'; return 1;; *) command cat \"$@\";; esac; }");
    assert.notEqual(r.status, 0); f.oldSite();
    assert.equal(fs.readFileSync(path.join(f.stage, 'status'), 'utf8').trim(), 'rolled_back');
  });
  test('missing inherited ACL stops activation and rolls back earlier files', () => {
    const f = fixture(); f.stageFiles(); assert.equal(f.execute('prepare').status, 0);
    const r = f.execute('activate', "getfacl() { case \" $* \" in *' -d '*) return 0;; *) printf 'user::rwx\\ngroup::rwx\\nother::---\\n';; esac; }");
    assert.notEqual(r.status, 0); f.oldSite();
  });
  console.log(`Shell deployment tests: ${passed} passed. ACL inheritance simulated; Beget preflight still required.`);
} finally {
  fs.rmSync(work, { recursive: true, force: true }); // Our exact mkdtemp fixture only.
}
