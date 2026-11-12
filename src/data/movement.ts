// Movement numbers shared by every fighter (archetypes come later).
// Pure data: src/sim reads it, so it must stay free of DOM and imports.
//
// Units: subpixels (100 per pixel at the 640x360 internal resolution) and
// sim frames (60 per second). The pixel value is in each comment.

export const MOVEMENT = Object.freeze({
  /** Floor line: fighters' feet rest at y = 320 px. */
  floorY: 32000,
  /** Stage width: 1280 px. */
  stageWidth: 128000,
  /** Screen width at the internal resolution: 640 px. */
  screenWidth: 64000,
  /**
   * Distance a fighter's center keeps from the screen edge and the stage edge: 80 px.
   * Sized to the art (spec 001 R8): the widest backward reach of any launch fighter's
   * frame is 73 px (air_hurt, heavy_kick), so a body at a wall or at max separation stays whole.
   */
  screenMargin: 8000,
  /** Starting distance between the two fighters: 200 px. */
  startSeparation: 20000,

  /** Walk forward: 1.8 px per frame. Matched to the art: a step moves the feet about 32 px per
   * 18-tick walk cycle, so the feet do not slide (spec 012; was 2.7). */
  walkForwardSpeed: 180,
  /** Walk back: 1.5 px per frame over a 20-tick cycle (slower than forward; was 2.0). */
  walkBackSpeed: 150,

  /** Frames spent in the jump squat before leaving the ground. */
  jumpsquatFrames: 4,
  /** Upward launch speed: 11.6 px per frame. */
  jumpLaunchSpeed: 1160,
  /** Gravity: 0.58 px per frame squared. Must be even (the sim integrates with gravity / 2). */
  gravity: 58,
  /** Horizontal speed of forward and back jumps: 3.3 px per frame. */
  jumpHorizontalSpeed: 330,
  /** Frames spent in the landing state after touching the floor. */
  landingFrames: 3,

  /** Pushbox width: 46 px, centered on the fighter's x. */
  pushboxWidth: 4600,
  /** Pushbox heights from the feet up: standing 80 px, crouching 56 px, airborne 64 px. */
  pushboxHeightStanding: 8000,
  pushboxHeightCrouching: 5600,
  pushboxHeightAirborne: 6400,
});

export type MovementData = typeof MOVEMENT;
