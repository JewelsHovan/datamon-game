// A6: src/sim must stay a pure, deterministic simulation. This scans every
// non-test .ts file under src/sim for clock, DOM, randomness and
// transcendental Math use, and for imports from outside src/sim and src/data.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SIM_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(SIM_DIR, "..");
const DATA_DIR = join(SRC_DIR, "data");

const BANNED: readonly { name: string; pattern: RegExp }[] = [
  { name: "Math.random", pattern: /\bMath\s*\.\s*random\b/ },
  {
    name: "transcendental Math",
    pattern:
      /\bMath\s*\.\s*(?:sin|cos|tan|asin|acos|atan|atan2|exp|expm1|log|log1p|log2|log10|pow|sqrt|cbrt|hypot|sinh|cosh|tanh|asinh|acosh|atanh)\b/,
  },
  { name: "Date", pattern: /\bDate\b/ },
  { name: "performance", pattern: /\bperformance\b/ },
  { name: "window", pattern: /\bwindow\b/ },
  { name: "document", pattern: /\bdocument\b/ },
  { name: "navigator", pattern: /\bnavigator\b/ },
  { name: "globalThis", pattern: /\bglobalThis\b/ },
  { name: "timers", pattern: /\b(?:setTimeout|setInterval|requestAnimationFrame)\b/ },
  { name: "crypto", pattern: /\bcrypto\b/ },
];

/** Removes comments, keeping string and template literals intact. */
export function stripComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      out += " ";
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < source.length && source[j] !== c) j += source[j] === "\\" ? 2 : 1;
      out += source.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const IMPORT_PATTERNS: readonly RegExp[] = [
  /\bimport\s+(?:type\s+)?[\w*{}\s,$]*?\bfrom\s*["']([^"']+)["']/g,
  /\bexport\s+(?:type\s+)?[\w*{}\s,$]*?\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
];

function isInside(dir: string, target: string): boolean {
  const rel = relative(dir, target);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep) && rel !== "..");
}

/** Every purity violation in one sim source file. */
export function findPurityViolations(source: string, filePath: string): string[] {
  const code = stripComments(source);
  const problems: string[] = [];
  for (const { name, pattern } of BANNED) {
    if (pattern.test(code)) problems.push(`uses ${name}`);
  }
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of code.matchAll(pattern)) {
      const spec = match[1] ?? "";
      if (!spec.startsWith(".")) {
        problems.push(`imports package "${spec}"`);
        continue;
      }
      const target = resolve(dirname(filePath), spec);
      if (!isInside(SIM_DIR, target) && !isInside(DATA_DIR, target)) {
        problems.push(`imports "${spec}" from outside src/sim and src/data`);
      }
    }
  }
  if (/\bimport\s*\(\s*[^"'\s]/.test(code)) problems.push("uses a non-literal dynamic import");
  return problems;
}

function simSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...simSourceFiles(full));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push(full);
  }
  return files.sort();
}

describe("sim purity (A6)", () => {
  const files = simSourceFiles(SIM_DIR);

  it("finds the sim sources", () => {
    const names = files.map((f) => relative(SIM_DIR, f));
    expect(names).toContain("step.ts");
    expect(names).toContain("physics.ts");
    expect(names).toContain("fighter.ts");
  });

  it.each(files.map((f) => [relative(SRC_DIR, f), f] as const))(
    "%s has no clock, DOM, randomness, transcendental Math or outside imports",
    (_name, file) => {
      expect(findPurityViolations(readFileSync(file, "utf8"), file)).toEqual([]);
    },
  );

  describe("the checker itself", () => {
    const file = join(SIM_DIR, "example.ts");
    it.each([
      ["const r = Math.random();", "uses Math.random"],
      ["const a = Math.sqrt(2);", "uses transcendental Math"],
      ["const a = Math.atan2(1, 2);", "uses transcendental Math"],
      ["const t = Date.now();", "uses Date"],
      ["const t = performance.now();", "uses performance"],
      ["const w = window.innerWidth;", "uses window"],
      ["document.body;", "uses document"],
      ['import { x } from "../render/camera";', 'imports "../render/camera" from outside src/sim and src/data'],
      ['import type { Y } from "../input/keymap";', 'imports "../input/keymap" from outside src/sim and src/data'],
      ['export { z } from "../engine/loop";', 'imports "../engine/loop" from outside src/sim and src/data'],
      ['import fs from "node:fs";', 'imports package "node:fs"'],
    ])("flags %s", (source, expected) => {
      expect(findPurityViolations(source, file)).toContain(expected);
    });

    it("allows sim and data imports, integer Math and words inside comments", () => {
      const source = [
        'import { MOVEMENT } from "../data/movement";',
        'import type { SimState } from "./types";',
        'export { step } from "./step";',
        "// Math.random() and window are fine in a comment",
        "/* performance, document, Date */",
        "const x = Math.floor(Math.abs(-3) / Math.max(1, 2)) + Math.imul(3, 5) + Math.trunc(1);",
      ].join("\n");
      expect(findPurityViolations(source, file)).toEqual([]);
    });
  });
});
