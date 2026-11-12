// Launch fighters (spec 006, R2): archetype, signature special and small stat tweaks.
// Proposed in docs/game-design.md ("Launch fighters") and changeable on the HQ page.
// Pure data: the sim reads health and damage scale; menus read names.

export type Archetype = "all-rounder" | "rusher" | "bruiser" | "zoner" | "trickster";

/** The move the Special button starts for this fighter. */
export type SpecialMove = "special" | "teleport" | "charge" | "rush";

export interface FighterInfo {
  slug: string;
  archetype: Archetype;
  archetypeLabel: string;
  specialMove: SpecialMove;
  specialName: string;
  /** Health per round (all-rounder 1000). */
  health: number;
  /** Damage dealt, in percent of the move's base damage. */
  damagePct: number;
  /** Walk speed, in percent of the shared walk speeds (kept close to 100 so feet do not slide). */
  walkPct: number;
}

export const FIGHTERS: Readonly<Record<string, FighterInfo>> = Object.freeze({
  "julien-hovan": {
    slug: "julien-hovan", archetype: "all-rounder", archetypeLabel: "All-rounder",
    specialMove: "special", specialName: "Data Orb", health: 1000, damagePct: 100, walkPct: 100,
  },
  "felicia-gorgacheva": {
    slug: "felicia-gorgacheva", archetype: "trickster", archetypeLabel: "Trickster",
    specialMove: "teleport", specialName: "Context Switch", health: 950, damagePct: 100, walkPct: 104,
  },
  "pentcho-tchomakov": {
    slug: "pentcho-tchomakov", archetype: "bruiser", archetypeLabel: "Bruiser",
    specialMove: "charge", specialName: "Hotfix Charge", health: 1100, damagePct: 108, walkPct: 92,
  },
  "alex-andrianavalontsalama": {
    slug: "alex-andrianavalontsalama", archetype: "rusher", archetypeLabel: "Rusher",
    specialMove: "rush", specialName: "Rapid Deploy", health: 950, damagePct: 95, walkPct: 108,
  },
});

/** Everyone without a launch entry plays as an all-rounder with the Data Orb. */
export function fighterInfo(slug: string): FighterInfo {
  return FIGHTERS[slug] ?? {
    slug, archetype: "all-rounder", archetypeLabel: "All-rounder",
    specialMove: "special", specialName: "Data Orb", health: 1000, damagePct: 100, walkPct: 100,
  };
}
