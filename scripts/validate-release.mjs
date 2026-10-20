import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(repo, process.argv[2] || 'dist');
const origin = 'https://release.invalid';
const manifest = 'release-manifest.sha256';
const failures = [];
const files = [];
function walk(folder) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = resolve(folder, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlink not allowed: ${path}`);
    if (entry.isDirectory() && !['_prototype', 'var'].includes(relative(root, path))) walk(path);
    else if (entry.isFile() && entry.name !== '.gitkeep' && relative(root, path) !== manifest) files.push(path);
  }
}
walk(root);
for (const path of files.filter(path => path.endsWith('.html'))) {
  const html = readFileSync(path, 'utf8');
  const page = relative(root, path).replaceAll('\\', '/');
  const documentUrl = new URL(page, origin);
  const baseMatch = html.match(/<base\b[^>]*\bhref=["']([^"']+)["']/i);
  const base = baseMatch ? new URL(baseMatch[1], documentUrl) : documentUrl;
  for (const match of html.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)) {
    const url = new URL(match[1].replaceAll('&amp;', '&'), base);
    if (url.origin !== origin || !/\.(css|js|png|jpe?g|webp|svg|gif|pdf|mp4|woff2?)$/i.test(url.pathname)) continue;
    if (!existsSync(resolve(root, `.${decodeURIComponent(url.pathname)}`))) {
      failures.push(`${page}: missing ${url.pathname}`);
    }
  }
}
if (failures.length) throw new Error(failures.join('\n'));
const entries = files.sort().map(path => {
  const name = relative(root, path).replaceAll('\\', '/');
  if (/[\r\n\\]/.test(name)) throw new Error(`Unsupported manifest filename: ${name}`);
  return `${createHash('sha256').update(readFileSync(path)).digest('hex')}  ./${name}`;
});
writeFileSync(resolve(root, manifest), entries.join('\n') + '\n');
console.log(`Release validated: ${files.length} files; resource links checked; SHA-256 manifest written.`);
