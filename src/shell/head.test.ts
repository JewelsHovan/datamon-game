// Spec 014 A3 (and the static half of A2): the built index.html carries the
// description, theme color, Open Graph and Twitter tags, the icons and the
// manifest link; the manifest says what R2 asks and every icon it names exists
// at its stated size. The page is built in memory with the project's own Vite config.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { build, type Rollup } from "vite";
import { beforeAll, describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const PUBLIC = join(ROOT, "public");
const LIVE = "https://datamon-game.julienh15.workers.dev/";

type Attrs = Record<string, string>;

function tags(html: string, name: string): Attrs[] {
  const out: Attrs[] = [];
  for (const m of html.matchAll(new RegExp(`<${name}\\s([^>]*?)\\/?>`, "g"))) {
    const attrs: Attrs = {};
    for (const a of m[1]!.matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[a[1]!] = a[2]!;
    out.push(attrs);
  }
  return out;
}

function meta(html: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const t of tags(html, "meta")) {
    const key = t.name ?? t.property;
    if (key && t.content !== undefined) map.set(key, t.content);
  }
  return map;
}

/** Width and height from a PNG's IHDR chunk. */
function pngSize(path: string): [number, number] {
  const b = readFileSync(path);
  expect(b.subarray(1, 4).toString("latin1")).toBe("PNG");
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

/** A URL from the built page, relative to the site root, as a path under public/. */
function publicFile(href: string): string {
  return join(PUBLIC, href.replace(/^\.?\//, ""));
}

async function builtIndexHtml(): Promise<string> {
  const result = await build({
    root: ROOT,
    configFile: join(ROOT, "vite.config.ts"),
    logLevel: "silent",
    build: { write: false, outDir: join(ROOT, "node_modules/.tmp-head-test") },
  });
  const outputs = (Array.isArray(result) ? result : [result]) as Rollup.RollupOutput[];
  for (const o of outputs) {
    for (const chunk of o.output) if (chunk.type === "asset" && chunk.fileName === "index.html") return String(chunk.source);
  }
  throw new Error("the build has no index.html");
}

describe("built index.html head (A3)", () => {
  let html = "";
  let m = new Map<string, string>();
  beforeAll(async () => {
    html = await builtIndexHtml();
    m = meta(html);
  }, 60_000);

  it("has a description and a theme color", () => {
    expect(m.get("description")?.length ?? 0).toBeGreaterThan(40);
    expect(m.get("theme-color")).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("has Open Graph tags with an absolute image URL on the live site", () => {
    expect(m.get("og:title")).toBe("Compass: Cardinal Clash");
    expect(m.get("og:description")?.length ?? 0).toBeGreaterThan(40);
    expect(m.get("og:image")).toBe(`${LIVE}share.png`);
    expect(new URL(m.get("og:image")!).protocol).toBe("https:");
    expect([m.get("og:image:width"), m.get("og:image:height")]).toEqual(["1200", "630"]);
    expect(pngSize(join(PUBLIC, "share.png"))).toEqual([1200, 630]);
  });

  it("has a large-image Twitter card", () => {
    expect(m.get("twitter:card")).toBe("summary_large_image");
    expect(m.get("twitter:image")).toBe(`${LIVE}share.png`);
  });

  it("links the favicons, the Apple touch icon and the manifest, all present in public/", () => {
    const links = tags(html, "link");
    const icons = links.filter((l) => l.rel === "icon");
    expect(icons.map((l) => l.sizes).sort()).toEqual(["16x16", "32x32"]);
    for (const l of icons) {
      const n = Number(l.sizes!.split("x")[0]);
      expect(pngSize(publicFile(l.href!))).toEqual([n, n]);
    }
    const apple = links.find((l) => l.rel === "apple-touch-icon");
    expect(pngSize(publicFile(apple!.href!))).toEqual([180, 180]);
    const manifest = links.find((l) => l.rel === "manifest");
    expect(manifest?.href).toBe("./manifest.webmanifest");
  });

  it("keeps the font stylesheet non-blocking and has the noscript and failure screens", () => {
    const font = tags(html, "link").find((l) => l.href?.includes("Press+Start+2P") && l.rel === "stylesheet" && l.media);
    expect(font?.media).toBe("print");
    expect(html).toMatch(/<noscript>[\s\S]*needs JavaScript[\s\S]*<\/noscript>/);
    expect(html).toMatch(/<div class="shell-screen" id="failure" role="alert"[^>]*hidden>/);
    expect(html).toMatch(/<button type="button" id="failure-reload"[^>]*>RELOAD<\/button>/);
  });
});

describe("web app manifest (R2)", () => {
  const manifest = JSON.parse(readFileSync(join(PUBLIC, "manifest.webmanifest"), "utf8")) as {
    name: string;
    short_name: string;
    display: string;
    display_override?: string[];
    orientation: string;
    start_url: string;
    theme_color: string;
    background_color: string;
    icons: { src: string; sizes: string; type: string; purpose?: string }[];
  };

  it("names the game, opens fullscreen (standalone as the fallback), in landscape, from ./", () => {
    expect(manifest.name).toBe("Compass: Cardinal Clash");
    expect(manifest.short_name).toBe("Cardinal Clash");
    expect(manifest.display).toBe("fullscreen");
    expect(manifest.display_override).toEqual(["fullscreen", "standalone"]);
    expect(manifest.orientation).toBe("landscape");
    expect(manifest.start_url).toBe("./");
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("lists 192 and 512 icons and a maskable one, each at its stated size", () => {
    const sizes = manifest.icons.map((i) => `${i.sizes} ${i.purpose ?? "any"}`).sort();
    expect(sizes).toEqual(["192x192 any", "512x512 any", "512x512 maskable"]);
    for (const icon of manifest.icons) {
      const n = Number(icon.sizes.split("x")[0]);
      expect(icon.type).toBe("image/png");
      expect(pngSize(publicFile(icon.src))).toEqual([n, n]);
    }
  });
});
