import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const command = (exe, args, cwd = root) => {
  const r = spawnSync(exe, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.error || r.status !== 0) throw new Error(r.error?.message || r.stderr || r.stdout || `${exe} failed`);
  return r.stdout.trim();
};
const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(directory, entry.name);
  if (fs.lstatSync(full).isSymbolicLink()) throw new Error(`Symlink prohibited: ${full}`);
  return entry.isDirectory() ? walk(full) : [full];
});
const allowed = (relative, policy) => {
  if (!/^[a-zA-Z0-9_./-]+$/.test(relative) || relative.split('/').some((p) => !p || p === '.' || p === '..' || policy.protectedNames.includes(p))) return false;
  if (policy.rootFiles.includes(relative) || policy.actionFiles.includes(relative)) return true;
  if (relative.startsWith('assets/')) return policy.assetExtensions.includes(path.posix.extname(relative));
  return policy.pagePrefixes.some((p) => relative.startsWith(p)) && relative.endsWith('/index.html');
};

export function createManifest(buildRoot, commit) {
  const policy = JSON.parse(fs.readFileSync(path.join(buildRoot, 'scripts/deploy-policy.json'), 'utf8'));
  if (policy.deleteRemoteFiles !== false) throw new Error('Remote deletion must be disabled');
  const dist = path.join(buildRoot, 'dist');
  const files = [];
  for (const full of walk(dist)) {
    const relative = path.relative(dist, full).split(path.sep).join('/');
    if (relative.startsWith('_prototype/') || relative.startsWith('var/') || path.posix.basename(relative) === '.gitkeep') continue;
    if (!allowed(relative, policy)) throw new Error(`Unapproved deployment file: ${relative}`);
    const bytes = fs.readFileSync(full);
    if (!bytes.length) throw new Error(`Empty deployment file: ${relative}`);
    files.push({ path: relative, size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  for (const required of [...policy.rootFiles, ...policy.actionFiles, 'assets/css/site.css', 'assets/js/site.js']) {
    if (!files.some((file) => file.path === required)) throw new Error(`Missing required file: ${required}`);
  }
  return { version: 1, commit, policy, files };
}

export function extractSourceArchive(archive, destination) {
  // Git stores path names as UTF-8. Windows bsdtar otherwise interprets them
  // using the system code page, corrupting Cyrillic names during extraction.
  const charset = process.platform === 'win32' ? ['--options', 'hdrcharset=UTF-8'] : [];
  command('tar', [...charset, '-xf', archive, '-C', destination]);
}

export function prepare(ref = 'HEAD') {
  if (command('git', ['status', '--porcelain', '--untracked-files=normal'])) throw new Error('Working tree is not clean. Commit the intended release first; deployment cancelled.');
  const commit = command('git', ['rev-parse', '--verify', `${ref}^{commit}`]);
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error('Invalid commit SHA');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'abs-deploy-'));
  const archive = path.join(work, 'source.tar');
  const buildRoot = path.join(work, 'source');
  fs.mkdirSync(buildRoot);
  command('git', ['archive', '--format=tar', `--output=${archive}`, commit]);
  extractSourceArchive(archive, buildRoot);
  command(process.execPath, ['scripts/test.mjs'], buildRoot);
  const manifest = createManifest(buildRoot, commit);
  const manifestPath = path.join(work, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return { work, dist: path.join(buildRoot, 'dist'), manifestPath, commit, files: manifest.files.length };
}

export function packageChanges(dist, plan, manifest, archive) {
  const approved = new Map(manifest.files.map((entry) => [entry.path, entry]));
  const names = new Set();
  for (const entry of plan.changes) {
    const expected = approved.get(entry.path);
    if (!expected || !allowed(entry.path, manifest.policy) || names.has(entry.path)
      || expected.sha256 !== entry.sha256 || expected.size !== entry.size) throw new Error('Invalid change list');
    names.add(entry.path);
    const file = path.join(dist, entry.path);
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Symlink prohibited');
    const bytes = fs.readFileSync(file);
    if (bytes.length !== expected.size || crypto.createHash('sha256').update(bytes).digest('hex') !== expected.sha256) throw new Error('Build changed after preview');
  }
  if (!names.size) throw new Error('Empty change list');
  const listing = `${archive}.files.txt`;
  fs.writeFileSync(listing, [...names].join('\n') + '\n', 'ascii');
  command('tar', ['-cf', archive, '-C', dist, '-T', listing]);
  return { archive, files: names.size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const result = args[0] === '--package'
      ? packageChanges(args[1], JSON.parse(fs.readFileSync(args[2], 'utf8')), JSON.parse(fs.readFileSync(args[3], 'utf8')), args[4])
      : prepare(args[0] || 'HEAD');
    console.log(JSON.stringify(result));
  }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
