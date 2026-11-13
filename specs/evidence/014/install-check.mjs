// Spec 014 A2 (and A3 on the served page): on a production build, Chrome
// reads the web app manifest with no errors and reports no installability
// errors, and the favicon, every icon and the share image answer 200.
//
// Usage (a production build served, e.g. `npx vite build --outDir <tmp>/dist`
// then `npx vite preview --outDir <tmp>/dist --host 127.0.0.1 --port <free> --strictPort`):
//   node specs/evidence/014/install-check.mjs http://127.0.0.1:<port>/ specs/evidence/014
// Writes install-results.json (and a screenshot) into the output directory and
// exits 0 only when every check passes.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchChrome, openPage, recorder, sleep } from "./cdp.mjs";

const BASE = process.argv[2] ?? "http://127.0.0.1:4173/";
const OUT = process.argv[3] ?? "specs/evidence/014";
mkdirSync(OUT, { recursive: true });
const rec = recorder();
const { results, record } = rec;
const browser = await launchChrome();

try {
  const p = await openPage(browser);
  const mark = p.mark();
  await p.navigate(BASE);
  await p.waitUntil("window.__game?.scene === 'title'", 20000);
  await sleep(1000);

  const manifest = await p.cmd("Page.getAppManifest");
  const data = JSON.parse(manifest.data || "{}");
  record("A2 Chrome reads the manifest with no errors", !!manifest.url && manifest.errors.length === 0 && data.name === "Compass: Cardinal Clash", {
    url: manifest.url,
    errors: manifest.errors,
    name: data.name,
    short_name: data.short_name,
    display: data.display,
    display_override: data.display_override,
    orientation: data.orientation,
    start_url: data.start_url,
    icons: data.icons,
  });

  const { installabilityErrors } = await p.cmd("Page.getInstallabilityErrors");
  record("A2 no installability errors", installabilityErrors.length === 0, { installabilityErrors });

  // Every icon the page and the manifest name, the favicon.ico browsers ask for anyway, and the share image.
  const head = await p.evaluate(`(() => {
    const abs = (h) => new URL(h, document.baseURI).href;
    const meta = (k) => document.querySelector('meta[name="' + k + '"], meta[property="' + k + '"]')?.content ?? null;
    return {
      links: [...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="manifest"]')].map((l) => ({ rel: l.rel, sizes: l.getAttribute('sizes'), href: abs(l.getAttribute('href')) })),
      meta: Object.fromEntries(['description', 'theme-color', 'og:title', 'og:description', 'og:image', 'twitter:card'].map((k) => [k, meta(k)])),
    };
  })()`);
  const manifestBase = manifest.url || BASE;
  const urls = new Set([
    ...head.links.map((l) => l.href),
    ...(data.icons ?? []).map((i) => new URL(i.src, manifestBase).href),
    new URL("favicon.ico", BASE).href,
    new URL("share.png", BASE).href,
  ]);
  const answers = [];
  for (const url of urls) {
    const res = await fetch(url);
    answers.push({ url, status: res.status, type: res.headers.get("content-type") });
  }
  record("A2 the favicon and every icon URL answer 200", answers.every((a) => a.status === 200), { answers });
  record("A3 the served page has the description, theme color and share tags", !!head.meta.description && /^#/.test(head.meta["theme-color"] ?? "") && head.meta["og:image"] === "https://datamon-game.julienh15.workers.dev/share.png" && head.meta["twitter:card"] === "summary_large_image", {
    meta: head.meta,
  });

  const problems = p.problemsSince(mark);
  record("A8 no console errors and no 404s on the production title screen", problems.errors.length === 0 && problems.bad.length === 0, {
    ...problems,
    screenshot: await p.shot(OUT, "a2-01-production-title"),
  });
} catch (err) {
  record("script", false, { error: String(err?.stack ?? err) });
} finally {
  writeFileSync(join(OUT, "install-results.json"), JSON.stringify(results, null, 2));
  await browser.close();
}
console.log(rec.failures === 0 ? "ALL PASS" : `${rec.failures} FAILED`);
process.exit(rec.failures === 0 ? 0 : 1);
