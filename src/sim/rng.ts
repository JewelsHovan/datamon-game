// Seeded PRNG (mulberry32): integer-only, state is a single uint32 kept in SimState.

export interface RngHolder {
  rng: number;
}

/** Normalizes any integer seed to a uint32 PRNG state. */
export function seedRng(seed: number): number {
  return seed >>> 0;
}

/** Advances the holder's PRNG and returns the next uint32. */
export function nextU32(holder: RngHolder): number {
  const a = (holder.rng + 0x6d2b79f5) | 0;
  holder.rng = a >>> 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return (t ^ (t >>> 14)) >>> 0;
}

/** Uniform integer in [0, n) for 0 < n <= 2^32 (modulo bias is negligible for small n). */
export function nextInt(holder: RngHolder, n: number): number {
  return nextU32(holder) % n;
}
