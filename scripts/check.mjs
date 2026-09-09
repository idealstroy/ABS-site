import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), "..");
const dist = path.join(root, "dist");

const listFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(fullPath));
    else files.push(fullPath);
  }
  return files;
};

const assert = (condition, message, errors) => {
  if (!condition) errors.push(message);
};

const internalTarget = (url) => {
  const clean = url.split("#")[0].split("?")[0];
  if (!clean || !clean.startsWith("/")) return null;
  if (clean.endsWith("/")) return path.join(dist, clean.slice(1), "index.html");
  return path.join(dist, clean.slice(1));
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isTechnicalPage = (page) => page.path === "/404.html"
  || page.path === "/request/"
  || page.path === "/thanks/"
  || page.path.startsWith("/_prototype/");

const robotsFor = (page) => isTechnicalPage(page) || page.status !== "ready"
  ? "noindex, nofollow"
  : "index, follow";

const parseSchemaTypes = (html, relative, errors) => {
  const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)];
  const types = [];
  for (const script of scripts) {
    try {
      const schema = JSON.parse(script[1]);
      const collectTypes = (value) => {
        if (Array.isArray(value)) return value.forEach(collectTypes);
        if (!value || typeof value !== "object") return;
        if (value["@type"]) {
          if (Array.isArray(value["@type"])) types.push(...value["@type"]);
          else types.push(value["@type"]);
        }
        Object.values(value).forEach(collectTypes);
      };
      collectTypes(schema);
    } catch {
      errors.push(`${relative}: invalid JSON-LD`);
    }
  }
  return types;
};

export const check = async () => {
  await access(dist);
  const files = await listFiles(dist);
  const htmlFiles = files.filter((file) => file.endsWith(".html"));
  const errors = [];
  const pageDataFiles = (await readdir(path.join(root, "src", "data", "pages"))).filter((file) => file.endsWith(".json"));
  const pageModels = await Promise.all(pageDataFiles.map(async (file) => JSON.parse(await readFile(path.join(root, "src", "data", "pages", file), "utf8"))));
  const pageByOutput = new Map(pageModels.map((page) => [page.output.replaceAll("/", path.sep), page]));
  const indexableCanonicals = new Set(pageModels.filter((page) => robotsFor(page) === "index, follow").map((page) => page.seo.canonical));
  assert(htmlFiles.length === pageDataFiles.length, `Expected ${pageDataFiles.length} HTML pages, found ${htmlFiles.length}`, errors);

  for (const file of htmlFiles) {
    const relative = path.relative(dist, file);
    const html = await readFile(file, "utf8");
    const page = pageByOutput.get(relative);
    assert(Boolean(page), `${relative}: no source page model`, errors);
    if (!page) continue;
    assert(/^<!doctype html>/i.test(html), `${relative}: missing doctype`, errors);
    assert(/<html lang="ru">/.test(html), `${relative}: missing Russian lang`, errors);
    assert(/<meta charset="utf-8"/.test(html), `${relative}: missing UTF-8 charset`, errors);
    assert(/name="viewport"/.test(html), `${relative}: missing viewport`, errors);
    assert(/bootstrap@5\.3\.3/.test(html), `${relative}: Bootstrap 5.3.3 is not connected`, errors);
    assert(/class="skip-link"/.test(html), `${relative}: missing skip link`, errors);
    assert(/<header[\s>]/.test(html), `${relative}: missing header`, errors);
    assert(/<nav[\s>]/.test(html), `${relative}: missing nav`, errors);
    assert(/<main id="main-content">/.test(html), `${relative}: missing main`, errors);
    assert(/<footer[\s>]/.test(html), `${relative}: missing footer`, errors);
    assert((html.match(/<h1[\s>]/g) || []).length === 1, `${relative}: expected exactly one H1`, errors);
    assert(/class="container/.test(html) && /class="row/.test(html) && /class="col-/.test(html), `${relative}: Bootstrap grid is incomplete`, errors);
    const expectedRobots = robotsFor(page);
    assert(html.includes(`name="robots" content="${expectedRobots}"`), `${relative}: robots must be ${expectedRobots}`, errors);
    if (expectedRobots === "index, follow") {
      assert(html.includes(`<link rel="canonical" href="${page.seo.canonical}" />`), `${relative}: missing canonical`, errors);
      const schemaTypes = parseSchemaTypes(html, relative, errors);
      assert(schemaTypes.includes("WebPage"), `${relative}: missing automatic WebPage JSON-LD`, errors);
      assert(schemaTypes.includes("BreadcrumbList"), `${relative}: missing BreadcrumbList JSON-LD`, errors);
      if (page.faq.length) assert(schemaTypes.includes("FAQPage"), `${relative}: missing FAQPage JSON-LD`, errors);
      assert(/property="og:image" content="https:\/\/abs-engineer\.ru\/assets\/images\//.test(html), `${relative}: missing absolute og:image`, errors);
      assert(/name="twitter:card" content="summary_large_image"/.test(html), `${relative}: missing Twitter image card`, errors);
    }

    for (const match of html.matchAll(/<img\b[^>]*>/g)) {
      assert(/\balt="[^"]*"/.test(match[0]), `${relative}: image without alt`, errors);
      assert(/\bwidth="\d+"/.test(match[0]) && /\bheight="\d+"/.test(match[0]), `${relative}: image without intrinsic dimensions`, errors);
    }

    for (const match of html.matchAll(/(?:href|src|action)="([^"]+)"/g)) {
      const url = match[1];
      if (/^(?:https?:|mailto:|tel:|#)/.test(url)) continue;
      const target = internalTarget(url);
      if (!target) continue;
      try {
        await access(target);
      } catch {
        errors.push(`${relative}: missing internal target ${url}`);
      }
    }

    if (html.includes("data-request-form")) {
      const visibleControls = [...html.matchAll(/<(input|textarea)\b([^>]*)>/g)]
        .filter((match) => !/type="hidden"/.test(match[2]) && !/name="company_site"/.test(match[2]));
      for (const control of visibleControls) {
        const id = control[2].match(/id="([^"]+)"/)?.[1];
        assert(Boolean(id) && html.includes(`for="${id}"`), `${relative}: form control without label`, errors);
      }
    }
  }

  for (const file of htmlFiles) {
    const html = await readFile(file, "utf8");
    const dropdowns = html.match(/<ul class="dropdown-menu[\s\S]*?<\/ul>/gi) || [];
    assert(dropdowns.every((dropdown) => !/data-route-status="planned"/.test(dropdown)), `${path.relative(dist, file)}: header popup contains a planned route`, errors);
    assert(!/data-route-status="planned"/.test(html), `${path.relative(dist, file)}: planned route must not be linked`, errors);
  }

  const cssFiles = files.filter((file) => file.endsWith(".css"));
  const allowedColors = new Set(["#e03b32", "#777777", "#f6f7f8", "#ffffff", "#3d4a61", "#27ae37", "#333333"]);
  for (const file of cssFiles) {
    const relative = path.relative(dist, file);
    const css = await readFile(file, "utf8");
    for (const color of css.match(/#[0-9a-f]{3,8}/gi) || []) {
      assert(allowedColors.has(color.toLowerCase()), `${relative}: unapproved color ${color}`, errors);
    }
    assert(!/display\s*:\s*grid/i.test(css), `${relative}: custom grid is prohibited`, errors);
    for (const declaration of css.matchAll(/font-family\s*:\s*([^;]+);/gi)) {
      assert(declaration[1].includes("Open Sans"), `${relative}: font family must be Open Sans`, errors);
    }
  }

  const robots = await readFile(path.join(dist, "robots.txt"), "utf8");
  assert(!/^Disallow:\s*\/\s*$/m.test(robots), "robots.txt must not block the public site", errors);
  ["/_prototype/", "/request/", "/thanks/", "/404.html"].forEach((route) => {
    assert(robots.includes(`Disallow: ${route}`), `robots.txt must block technical route ${route}`, errors);
  });
  assert(/Sitemap:\s+https:\/\/abs-engineer\.ru\/sitemap\.xml/.test(robots), "robots.txt must declare sitemap", errors);
  const sitemap = await readFile(path.join(dist, "sitemap.xml"), "utf8");
  const sitemapCanonicals = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]));
  assert(sitemapCanonicals.size === indexableCanonicals.size, "sitemap.xml must contain every and only indexable canonical URL", errors);
  for (const canonical of indexableCanonicals) assert(sitemapCanonicals.has(canonical), `sitemap.xml missing ${canonical}`, errors);

  if (errors.length) {
    throw new Error(`Technical checks failed:\n- ${errors.join("\n- ")}`);
  }

  return { html: htmlFiles.length, files: files.length };
};

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const result = await check();
  process.stdout.write(`Checked ${result.html} HTML pages and ${result.files} build files\n`);
}
