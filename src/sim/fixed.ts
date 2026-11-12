// Integer subpixel helpers. 100 subpixels make one pixel at 640x360.

export const SUBPX = 100;

/** Pixels to subpixels, rounded to the nearest integer (2.7 px -> 270). */
export function px(pixels: number): number {
  return Math.round(pixels * SUBPX);
}

/** Subpixels to (fractional) pixels, for presentation only. */
export function toPx(subpx: number): number {
  return subpx / SUBPX;
}

export function clampInt(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}
