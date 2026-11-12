// Types for the generated datamonCatalog.js (kept as-is, not converted to TS).

/** Per-frame walk metrics: [frameWidth, bodyX, footY], anchored at feet-center within the cell. */
export type RawFrameMetrics = readonly [number, number, number];

export interface RawVoxelModel {
  readonly id: number;
  readonly slug: string;
  readonly name: string;
  readonly shortName: string;
  readonly kind: "voxel";
  readonly category: "voxel";
  readonly color: string;
}

export interface RawPersonModel {
  readonly id: number;
  readonly slug: string;
  readonly name: string;
  readonly shortName: string;
  readonly kind: "datamon_person";
  readonly category: "people";
  readonly color: string;
  readonly portraitUrl: string;
  readonly sheetUrl: string;
  readonly cellW: number;
  readonly cellH: number;
  readonly frames: {
    readonly down: readonly RawFrameMetrics[];
    readonly up: readonly RawFrameMetrics[];
    readonly left: readonly RawFrameMetrics[];
    readonly right: readonly RawFrameMetrics[];
  };
}

export interface RawCreatureModel {
  readonly id: number;
  readonly slug: string;
  readonly name: string;
  readonly shortName: string;
  readonly domain: "AGENT" | "CONFIG" | "CONTEXT" | "MCP" | "PROMPT";
  readonly kind: "datamon_creature";
  readonly category: "creatures";
  readonly color: string;
  readonly portraitUrl: string;
  readonly sheetUrl: string;
  readonly cellW: number;
  readonly cellH: number;
  readonly bodyX: number;
  readonly footY: number;
  readonly visH: number;
}

export type RawCharacterModel = RawVoxelModel | RawPersonModel | RawCreatureModel;

export declare const STANDING_WALK_FRAME: Readonly<{
  down: number;
  up: number;
  left: number;
  right: number;
}>;

export declare const CHARACTER_MODELS: readonly RawCharacterModel[];
export declare const TOTAL_CHARACTER_MODELS: number;
export declare function normalizeSkinId(value: unknown): number;
export declare function getCharacterModel(skinId: unknown): RawCharacterModel;
