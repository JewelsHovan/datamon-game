import type { PlayerIndex, SimState } from "../sim/types";
export type CpuLevel = "easy" | "normal" | "hard";
export interface CpuController {
  readonly level: CpuLevel;
  /** Input bitmask for `player` this step, from the latest sim state only. */
  decide(state: SimState): number;
}
export function createCpu(level: CpuLevel, player: PlayerIndex, seed: number): CpuController {
  return { level, decide: () => 0 }; // placeholder, replaced by spec 008
}
