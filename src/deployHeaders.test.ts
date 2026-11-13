// Spec 013 A4: public/_headers (Cloudflare Workers static assets) parses, gives hashed build
// assets a one-year immutable cache and the art folders a short cache with revalidation, and
// never sets Cache-Control twice for one path (Cloudflare joins matching rules' values).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface Rule {
  pattern: string;
  headers: [string, string][];
}

/** The _headers format: a URL pattern at column 0, indented `Name: value` lines, `#` comments. */
function parseHeaders(text: string): Rule[] {
  const rules: Rule[] = [];
  text.split("\n").forEach((line, i) => {
    if (line.length > 2000) throw new Error(`line ${i + 1} is over 2000 characters`);
    if (line.trim() === "" || line.trim().startsWith("#")) return;
    if (!/^\s/.test(line)) {
      rules.push({ pattern: line.trim(), headers: [] });
      return;
    }
    const m = /^\s+(!\s)?([A-Za-z0-9-]+):\s*(.+)$/.exec(line);
    const rule = rules[rules.length - 1];
    if (!m || !rule) throw new Error(`line ${i + 1} is not a header of a rule: ${line}`);
    rule.headers.push([m[2]!.toLowerCase(), m[3]!.trim()]);
  });
  return rules;
}

function matches(pattern: string, path: string): boolean {
  const re = new RegExp(`^${pattern.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
  return re.test(path);
}

/** Every Cache-Control value that applies to a path. */
function cacheControl(rules: Rule[], path: string): string[] {
  return rules.filter((r) => matches(r.pattern, path)).flatMap((r) => r.headers.filter(([n]) => n === "cache-control").map(([, v]) => v));
}

function maxAge(value: string): number {
  const m = /max-age=(\d+)/.exec(value);
  return m ? Number(m[1]) : -1;
}

const rules = parseHeaders(readFileSync(resolve(import.meta.dirname, "../public/_headers"), "utf8"));

describe("public/_headers (spec 013 R5)", () => {
  it("parses into rules with URL patterns and headers, within Cloudflare's limits", () => {
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.length).toBeLessThanOrEqual(100);
    for (const r of rules) {
      expect(r.pattern.startsWith("/")).toBe(true);
      expect(r.pattern.split("*").length - 1).toBeLessThanOrEqual(1);
      expect(r.headers.length).toBeGreaterThan(0);
    }
  });

  it("hashed build assets are cached for a year and immutable", () => {
    const [value, ...more] = cacheControl(rules, "/assets/index-DDgHB7Yw.js");
    expect(more).toEqual([]);
    expect(maxAge(value!)).toBeGreaterThanOrEqual(31536000);
    expect(value).toContain("immutable");
    expect(value).toContain("public");
  });

  it.each([
    "/fighters/julien-hovan/atlas.webp",
    "/fighters/julien-hovan/manifest.json",
    "/effects/atlas.webp",
    "/stages/office/walkers.webp",
    "/datamon/portraits/julien-hovan.webp",
  ])("art %s is cached for at most an hour, then revalidated", (path) => {
    const values = cacheControl(rules, path);
    expect(values).toHaveLength(1);
    expect(maxAge(values[0]!)).toBeGreaterThan(0);
    expect(maxAge(values[0]!)).toBeLessThanOrEqual(3600);
    expect(values[0]).toContain("must-revalidate");
    expect(values[0]).not.toContain("immutable");
  });

  it("leaves the page itself to Cloudflare's default (always revalidated)", () => {
    expect(cacheControl(rules, "/")).toEqual([]);
    expect(cacheControl(rules, "/index.html")).toEqual([]);
  });
});
