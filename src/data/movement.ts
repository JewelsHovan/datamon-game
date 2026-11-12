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
  /** Distance a fighter's center keeps from the screen edge and the stage edge: 40 px. */
  screenMargin: 4000,
  /** Starting distance between the two fighters: 200 px. */
  startSeparation: 20000,

  /** Walk forward: 2.7 px per frame. */
  walkForwardSpeed: 270,
  /** Walk back: 2.0 px per frame (slower than forward). */
  walkBackSpeed: 200,

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
