import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createManifest, packageChanges, extractSourceArchive, createSourceArchive } from './deploy-prepare.mjs';

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'abs-deploy-unit-'));
try {
  const sourceArchive = path.join(work, 'source.tar');
  const extractedSource = path.join(work, 'source');
  fs.mkdirSync(extractedSource);
  createSourceArchive(sourceArchive, 'HEAD');
  extractSourceArchive(sourceArchive, extractedSource);
  const names = spawnSync('git', ['ls-tree', '-r', '--name-only', '-z', 'HEAD'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  assert.equal(names.status, 0, names.stderr);
  const trackedNames = names.stdout.split('\0').filter(Boolean);
  for (const name of trackedNames) assert.ok(fs.existsSync(path.join(extractedSource, name)), `Git path corrupted during extraction: ${name}`);
  for (const name of ['Template libraries/иконки/Логотип полный.svg', 'Template libraries/иконки/Графический логотип.svg']) {
    const charset = process.platform === 'win32' ? ['--options', 'hdrcharset=UTF-8'] : [];
    const original = spawnSync('tar', [...charset, '-xOf', sourceArchive, name], { maxBuffer: 1024 * 1024 });
    assert.equal(original.status, 0, original.stderr?.toString());
    assert.deepEqual(fs.readFileSync(path.join(extractedSource, name)), original.stdout);
    const committed = spawnSync('git', ['show', `HEAD:${name}`], { maxBuffer: 1024 * 1024 });
    assert.equal(committed.status, 0, committed.stderr?.toString());
    assert.deepEqual(original.stdout, committed.stdout, 'Archive changed line endings of the committed logo');
  }
  console.log(`Git UTF-8 extraction: ${trackedNames.length} paths verified; Cyrillic logos match Git bytes without Windows CRLF conversion.`);
  if (process.argv.includes('--verify-build')) {
    const built = spawnSync(process.execPath, ['scripts/test.mjs'], { cwd: extractedSource, stdio: 'inherit' });
    assert.equal(built.status, 0, 'Isolated commit build failed');
    if (process.argv.includes('--verify-live')) {
      for (const name of ['assets/images/logo-full.svg', 'assets/images/logo-mark.svg', 'assets/icons/truck.svg', 'robots.txt', 'assets/js/site.js']) {
        const response = await fetch(`https://abs-engineer.ru/${name}?read_only_check=${Date.now()}`, { signal: AbortSignal.timeout(25000), headers: { 'Accept-Encoding': 'identity' } });
        assert.equal(response.status, 200, `Public read failed: ${name}`);
        const publicBytes = Buffer.from(await response.arrayBuffer());
        assert.deepEqual(fs.readFileSync(path.join(extractedSource, 'dist', name)), publicBytes, `Unchanged public file still differs: ${name}`);
        console.log('Read-only public comparison: exact match ' + name);
      }
    }
  }
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
    const transport = spawnSync(process.execPath, ['scripts/test-deploy-transport.mjs'], { stdio: 'inherit' });
    assert.equal(transport.status, 0, 'PowerShell stdin transport test failed');
  }
  const result = spawnSync(process.execPath, ['scripts/test-deploy-shell.mjs'], { stdio: 'inherit' });
  assert.equal(result.status, 0, 'Remote failure-injection tests failed');
} finally {
  fs.rmSync(work, { recursive: true, force: true }); // Only our mkdtemp test fixture.
}
