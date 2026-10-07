import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'abs-transport-'));
const psQuote = (s) => "'" + s.replaceAll("'", "''") + "'";
try {
  const receiver = path.join(work, 'receive.mjs');
  fs.writeFileSync(receiver, "const chunks=[]; for await(const chunk of process.stdin) chunks.push(chunk); const bytes=Buffer.concat(chunks); console.log(JSON.stringify({hex:bytes.toString('hex'),text:bytes.toString('utf8')}));");
  const script = `. ${psQuote(path.resolve('scripts/deploy-transport.ps1'))}; $text = [string][char]0xFEFF + \"root='/example/public_html'\r\nmain\r\n\"; $result = Invoke-DeployProcessInput -Executable ${psQuote(process.execPath)} -Arguments @(${psQuote(receiver)}) -InputText $text; if($result.ExitCode -ne 0){exit 1}; Write-Output $result.Output`;
  const tested = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', timeout: 30000 });
  assert.equal(tested.status, 0, tested.error?.message || tested.stderr);
  const received = JSON.parse(tested.stdout.trim());
  assert.equal(received.text, "root='/example/public_html'\nmain\n");
  assert.ok(!received.hex.startsWith('efbbbf'), 'BOM was sent to sh');
  assert.ok(!received.text.includes('\r'), 'CRLF was sent to sh');
  console.log('Windows PowerShell transport: exact UTF-8, no BOM, LF only.');
  const shell = path.join(process.env.ProgramFiles || 'C:/Program Files', 'Git/bin/bash.exe');
  assert.ok(fs.existsSync(shell), 'Existing Git Bash required for the full transport test');
  const relay = path.join(work, 'relay.mjs');
  fs.writeFileSync(relay, `import {spawnSync} from 'node:child_process'; const chunks=[]; for await(const c of process.stdin) chunks.push(c); const data=Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.concat(chunks),Buffer.from('\\r\\n')]); const result=spawnSync(process.argv[2],['-c',process.argv[3]],{input:data,encoding:'utf8'}); process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || ''); process.exit(result.status ?? 1);`);
  const source = path.join(work, 'source.sh');
  fs.writeFileSync(source, "root='/example/public_html'\r\nset -eu\r\nprintf 'ROOT=%s\\n' \"$root\"\r\n");
  const pipeline = `. ${psQuote(path.resolve('scripts/deploy-transport.ps1'))}; $text = Get-Content -LiteralPath ${psQuote(source)} -Raw -Encoding UTF8; $encoded = ConvertTo-DeployShellTransport $text; $result = Invoke-DeployProcessInput -Executable ${psQuote(process.execPath)} -Arguments @(${psQuote(relay)},${psQuote(shell)},$encoded.Command) -InputText $encoded.InputText; if($result.ExitCode -ne 0){exit $result.ExitCode}; Write-Output $result.Output`;
  const full = spawnSync('powershell.exe', ['-NoProfile', '-Command', pipeline], { encoding: 'utf8', timeout: 30000 });
  assert.equal(full.status, 0, full.error?.message || full.stderr);
  assert.equal(full.stdout.trim(), 'ROOT=/example/public_html');
  console.log('Full PowerShell → encoded transport → Unix decoder → sh: passed, including injected BOM/CRLF.');
} finally { fs.rmSync(work, { recursive: true, force: true }); }
