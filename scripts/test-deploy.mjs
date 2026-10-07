import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createManifest, packageChanges } from './deploy-prepare.mjs';

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'abs-deploy-unit-'));
try {
  fs.mkdirSync(path.join(work, 'scripts'));
  const policy = JSON.parse(fs.readFileSync('scripts/deploy-policy.json', 'utf8'));
  fs.writeFileSync(path.join(work, 'scripts/deploy-policy.json'), JSON.stringify(policy));
  const dist = path.join(work, 'dist');
  for (const name of [...policy.rootFiles, ...policy.actionFiles, 'assets/css/site.css', 'assets/js/site.js', 'assets/images/.gitkeep', '_prototype/home/index.html', 'var/submissions.log']) {
    const target = path.join(dist, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'fixture ' + name);
  }
  const manifest = createManifest(work, 'a'.repeat(40));
  assert.equal(manifest.files.length, 8);
  assert.ok(!manifest.files.some((e) => e.path.startsWith('var/') || e.path.startsWith('_prototype/')));
  fs.writeFileSync(path.join(dist, 'unapproved.txt'), 'must not upload');
  assert.throws(() => createManifest(work, 'a'.repeat(40)), /Unapproved/);
  fs.unlinkSync(path.join(dist, 'unapproved.txt'));
  const plan = { changes: [manifest.files.find((e) => e.path === 'index.html')] };
  const archive = path.join(work, 'delta.tar');
  packageChanges(dist, plan, manifest, archive);
  const listing = spawnSync('tar', ['-tf', archive], { encoding: 'utf8' });
  assert.equal(listing.status, 0, listing.stderr);
  assert.equal(listing.stdout.trim(), 'index.html');
  assert.throws(() => packageChanges(dist, { changes: [{ ...plan.changes[0], path: '../index.html' }] }, manifest, archive), /Invalid/);
  fs.appendFileSync(path.join(dist, 'index.html'), 'changed');
  assert.throws(() => packageChanges(dist, plan, manifest, archive), /Build changed/);
  console.log('Local manifest/delta tests: passed.');
  if (fs.existsSync('dist/index.html')) {
    const current = createManifest(process.cwd(), '0'.repeat(40));
    console.log(`Current build allowlist: ${current.files.length} approved files; prototype/logs excluded.`);
  }
  if (process.platform === 'win32') {
    const parse = spawnSync('powershell', ['-NoProfile', '-Command', "$tokens = $null; $errors = $null; $null = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path (Get-Location) 'scripts/deploy-ssh.ps1'), [ref]$tokens, [ref]$errors); if ($errors.Count) { $errors | ForEach-Object { Write-Error $_.Message }; exit 1 }; Write-Output 'PowerShell syntax: passed.'"], { encoding: 'utf8', timeout: 30000 });
    assert.equal(parse.status, 0, parse.error?.message || parse.stderr);
    console.log(parse.stdout.trim());
  }
  let python;
  for (const executable of ['python', 'python3']) {
    const version = spawnSync(executable, ['--version'], { encoding: 'utf8' });
    if (!version.error && version.status === 0) { python = executable; break; }
  }
  assert.ok(python, 'Python is required for deployment tests');
  const result = spawnSync(python, ['-B', 'scripts/test-deploy.py'], { stdio: 'inherit' });
  assert.equal(result.status, 0, 'Remote failure-injection tests failed');
} finally {
  fs.rmSync(work, { recursive: true, force: true }); // Only our mkdtemp test fixture.
}
