// Who can be picked, and what the select screen says about them.
// Playable = the fighter has generated clips (public/fighters/<slug>/manifest.json),
// detected at runtime so new fighters appear as soon as their art lands: the art pipeline
// lists them in public/fighters/index.json (spec 013), read once instead of probing a
// manifest per person (a 404 for everyone without art).
// Archetype and special names come from the fighter table (src/data/fighters.ts,
// spec 006) when it exists; until then a small fallback covers Julien.
import type { Person } from "../data/catalog";
import { loadFighterIndex, manifestUrl, parseManifest, type ClipLoaderDeps } from "../render/clips";

export interface FighterInfo {
  archetype: string | null;
  special: string | null;
}

/**
 * The people the fighter index lists. Without an index (an older build), fetches every
 * person's manifest and keeps the slugs whose manifest parses.
 */
export async function detectPlayable(
  people: readonly Person[],
  deps: Pick<ClipLoaderDeps, "fetchJson">,
  onFound: (slug: string) => void = () => {},
): Promise<Set<string>> {
  const found = new Set<string>();
  const index = await loadFighterIndex(deps);
  if (index !== null) {
    for (const p of people) {
      if (!index.has(p.slug)) continue;
      found.add(p.slug);
      onFound(p.slug);
    }
    return found;
  }
  await Promise.all(
    people.map(async (p) => {
      try {
        const json = await deps.fetchJson(manifestUrl(p.slug));
        if (json === null || json === undefined) return;
        parseManifest(json);
        found.add(p.slug);
        onFound(p.slug);
      } catch {
        // Missing or broken manifest: not playable.
      }
    }),
  );
  return found;
}

const FALLBACK: Readonly<Record<string, FighterInfo>> = {
  "julien-hovan": { archetype: "All-rounder", special: "Data Orb" },
};

const ARCHETYPE_NAMES: Readonly<Record<string, string>> = {
  allrounder: "All-rounder",
  rusher: "Rusher",
  bruiser: "Bruiser",
  zoner: "Zoner",
  trickster: "Trickster",
};

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function prettyArchetype(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  return ARCHETYPE_NAMES[s.toLowerCase().replace(/[^a-z]/g, "")] ?? s;
}

function entryInfo(entry: Record<string, unknown>): FighterInfo | null {
  if (!("archetype" in entry)) return null;
  const special = entry.special;
  const specialObj = typeof special === "object" && special !== null ? (special as Record<string, unknown>) : null;
  return {
    archetype: prettyArchetype(entry.archetype),
    special:
      str(entry.specialName) ??
      str(entry.specialDisplayName) ??
      str(entry.specialLabel) ??
      str(specialObj?.name) ??
      str(specialObj?.displayName) ??
      null,
  };
}

/**
 * Finds a fighter's entry in a module's exports, whatever the table's shape:
 * a record keyed by slug, or an array of entries with a `slug` field. An entry
 * needs an `archetype`; the special's display name is read from `specialName`
 * (or `specialDisplayName`, `specialLabel`, `special.name`).
 */
export function infoFromModule(mod: Readonly<Record<string, unknown>>, slug: string): FighterInfo | null {
  for (const value of Object.values(mod)) {
    if (typeof value !== "object" || value === null) continue;
    let entry: unknown;
    if (Array.isArray(value)) entry = value.find((e) => typeof e === "object" && e !== null && (e as { slug?: unknown }).slug === slug);
    else if (value instanceof Map) entry = value.get(slug);
    else entry = (value as Record<string, unknown>)[slug];
    if (typeof entry === "object" && entry !== null) {
      const info = entryInfo(entry as Record<string, unknown>);
      if (info) return info;
    }
  }
  return null;
}

// Optional: an empty object until src/data/fighters.ts exists (no build error either way).
const TABLES = Object.values(import.meta.glob("../data/fighters.ts", { eager: true })) as Record<string, unknown>[];

export function fighterInfo(slug: string, tables: readonly Record<string, unknown>[] = TABLES): FighterInfo {
  for (const mod of tables) {
    const info = infoFromModule(mod, slug);
    if (info) return info;
  }
  return FALLBACK[slug] ?? { archetype: null, special: null };
}
