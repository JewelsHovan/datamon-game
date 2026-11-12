// Typed access to the datamon catalog. Only people (fighters) and creatures
// (battlemons) are exposed; the voxel skins (ids 0..5) are ignored.
import {
  CHARACTER_MODELS,
  STANDING_WALK_FRAME as RAW_STANDING_WALK_FRAME,
  type RawCreatureModel,
  type RawFrameMetrics,
  type RawPersonModel,
} from "./datamonCatalog.js";

export type WalkDirection = "down" | "up" | "left" | "right";

export interface FrameMetrics {
  /** Visible frame width in source pixels. */
  readonly frameWidth: number;
  /** Feet-center x inside the cell, in source pixels. */
  readonly bodyX: number;
  /** Feet y inside the cell (the floor line), in source pixels. */
  readonly footY: number;
}

export interface Person {
  readonly id: number;
  readonly slug: string;
  readonly name: string;
  readonly shortName: string;
  readonly kind: "datamon_person";
  readonly color: string;
  readonly portraitUrl: string;
  readonly sheetUrl: string;
  readonly cellW: number;
  readonly cellH: number;
  readonly frames: Readonly<Record<WalkDirection, readonly FrameMetrics[]>>;
}

export type BattlemonDomain = RawCreatureModel["domain"];

export interface Creature {
  readonly id: number;
  readonly slug: string;
  readonly name: string;
  readonly shortName: string;
  readonly kind: "datamon_creature";
  readonly domain: BattlemonDomain;
  readonly color: string;
  readonly iconUrl: string;
  readonly sheetUrl: string;
  readonly cellW: number;
  readonly cellH: number;
  readonly bodyX: number;
  readonly footY: number;
  readonly visH: number;
}

/** Row order of the walk sheets: down, up, left, right. */
export const WALK_ROWS: Readonly<Record<WalkDirection, number>> = Object.freeze({
  down: 0,
  up: 1,
  left: 2,
  right: 3,
});

/** Column of the standing frame for each direction. */
export const STANDING_WALK_FRAME: Readonly<Record<WalkDirection, number>> = RAW_STANDING_WALK_FRAME;

function toMetrics(raw: readonly RawFrameMetrics[]): readonly FrameMetrics[] {
  return Object.freeze(
    raw.map(([frameWidth, bodyX, footY]) => Object.freeze({ frameWidth, bodyX, footY })),
  );
}

function toPerson(raw: RawPersonModel): Person {
  return Object.freeze({
    id: raw.id,
    slug: raw.slug,
    name: raw.name,
    shortName: raw.shortName,
    kind: raw.kind,
    color: raw.color,
    portraitUrl: raw.portraitUrl,
    sheetUrl: raw.sheetUrl,
    cellW: raw.cellW,
    cellH: raw.cellH,
    frames: Object.freeze({
      down: toMetrics(raw.frames.down),
      up: toMetrics(raw.frames.up),
      left: toMetrics(raw.frames.left),
      right: toMetrics(raw.frames.right),
    }),
  });
}

function toCreature(raw: RawCreatureModel): Creature {
  return Object.freeze({
    id: raw.id,
    slug: raw.slug,
    name: raw.name,
    shortName: raw.shortName,
    kind: raw.kind,
    domain: raw.domain,
    color: raw.color,
    iconUrl: raw.portraitUrl,
    sheetUrl: raw.sheetUrl,
    cellW: raw.cellW,
    cellH: raw.cellH,
    bodyX: raw.bodyX,
    footY: raw.footY,
    visH: raw.visH,
  });
}

const PEOPLE: readonly Person[] = Object.freeze(
  CHARACTER_MODELS.filter((m): m is RawPersonModel => m.kind === "datamon_person").map(toPerson),
);

const CREATURES: readonly Creature[] = Object.freeze(
  CHARACTER_MODELS.filter((m): m is RawCreatureModel => m.kind === "datamon_creature").map(
    toCreature,
  ),
);

const PEOPLE_BY_SLUG: ReadonlyMap<string, Person> = new Map(PEOPLE.map((p) => [p.slug, p]));

export function getPeople(): readonly Person[] {
  return PEOPLE;
}

export function getPerson(slug: string): Person | undefined {
  return PEOPLE_BY_SLUG.get(slug);
}

export function getCreatures(): readonly Creature[] {
  return CREATURES;
}
