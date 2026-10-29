import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import https from "node:https";

const root = fileURLToPath(new URL("../", import.meta.url));

// Pass a public origin to verify the actual hosting rule after deployment.
export const testUtm = async (publicOrigin) => {
  const base = publicOrigin || "http://127.0.0.1:4177";
  const server = publicOrigin ? null : spawn("php", [
    "-S", "127.0.0.1:4177", "-t", path.join(root, "dist"), path.join(root, "scripts/router.php"),
  ], { stdio: "ignore", env: { ...process.env, ABS_FORM_TRANSPORT: "file" } });
  const request = (value, options = {}) => new Promise((resolve, reject) => {
    const url = new URL(value, base);
    const transport = url.protocol === "https:" ? https : http;
    const req = transport.request(url, options, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("error", reject);
      response.on("end", () => resolve({
        status: response.statusCode,
        ok: response.statusCode === 200,
        headers: { get: name => response.headers[name.toLowerCase()] || null },
        text: async () => Buffer.concat(chunks).toString("utf8"),
      }));
    });
    req.setTimeout(15000, () => req.destroy(new Error(`Request timed out: ${url}`)));
    req.on("error", reject);
    req.end();
  });
  try {
    if (server) {
      let ready = false;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        try { ready = (await request("/sitemap.xml")).ok; } catch { /* Starting PHP. */ }
        if (ready) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.ok(ready, "UTM test server did not start");
      assert.equal(await readFile(path.join(root, "dist/.htaccess"), "utf8"),
        await readFile(path.join(root, "src/seo/.htaccess"), "utf8"), "Hosting rule missing from build");
    }
    const sitemap = await (await request("/sitemap.xml")).text();
    const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => new URL(match[1]));
    assert.ok(urls.length, "Empty sitemap");
    for (const url of urls) {
      const clean = await request(url.pathname);
      assert.equal(clean.status, 200, url.pathname);
      assert.ok(!/noindex/i.test(clean.headers.get("x-robots-tag") || ""), `Main URL blocked: ${url.pathname}`);
      const html = await clean.text();
      const tagged = await request(`${url.pathname}?utm_source=seo-test&utm_campaign=check`);
      assert.equal(tagged.status, 200, url.pathname);
      assert.match(tagged.headers.get("x-robots-tag") || "", /noindex/i, `UTM variant open: ${url.pathname}`);
      assert.equal(await tagged.text(), html, `UTM changed content or canonical: ${url.pathname}`);
      assert.ok(html.includes(`rel="canonical" href="${url.href}"`), `Canonical missing: ${url.pathname}`);
    }
    for (const query of ["utm_source=test", "other=1&utm_medium=cpc", "UTM_CAMPAIGN=test",
      "utm_custom=test&other=1", "utm_content=", "utm_term", "utm_id=123"]) {
      const response = await request(`/?${query}`, { method: "HEAD" });
      assert.equal(response.status, 200, query);
      assert.match(response.headers.get("x-robots-tag") || "", /noindex/i, query);
    }
    for (const query of ["", "?other=utm_source", "?not_utm_source=test", "?utm=test", "?gclid=test"]) {
      const response = await request(`/${query}`);
      assert.equal(response.status, 200, query);
      assert.ok(!/noindex/i.test(response.headers.get("x-robots-tag") || ""), `False UTM match: ${query}`);
    }
    return { pages: urls.length };
  } finally {
    if (server && server.exitCode === null) {
      const stopped = new Promise(resolve => server.once("exit", resolve));
      server.kill();
      await stopped;
    }
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await testUtm(process.argv[2]);
  process.stdout.write(`UTM indexing checks passed: ${result.pages} sitemap pages; parameter order, HEAD, canonical and content verified.\n`);
}
