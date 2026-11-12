// Combat and match numbers (spec 003). Pure data: src/sim reads it.
// Units: subpixels (100 per px) and 60 Hz sim frames.

export const COMBAT = Object.freeze({
  /** Health per round. */
  maxHealth: 1000,
  /** A press counts for this many frames after it happens (input buffer). */
  bufferFrames: 4,
  /** Light and heavy pressed within this many frames of each other start a throw. */
  throwChordFrames: 2,
  /** Throw reach: center-to-center distance, 72 px. */
  throwRange: 7200,
  /** Frames over which pushback is applied. */
  pushFrames: 8,
  /** Hits taken in one combo scale damage down by 10% each, to at most 50%. */
  comboScalePerHit: 10,
  comboScaleFloor: 50,
  /** Extra hitstun when the defender is crouching. */
  crouchHitstunBonus: 2,
  /** Hit-stop on a blocked hit is this much shorter. */
  blockHitstopReduction: 2,
});

export const KNOCKDOWN = Object.freeze({
  /** Backward slide speed while launched: 3 px per frame. */
  slideSpeed: 300,
  /** Frames of backward slide. */
  slideFrames: 22,
  /** Total frames from launch to standing (the knockdown timeline in moves.ts adds up to this). */
  totalFrames: 74,
  /** Frame on which the body hits the floor (dust event). */
  impactFrame: 16,
  /** Frame on which a K.O.'d fighter stays down (lying frame). */
  koHoldFrame: 24,
});

export const PROJECTILE = Object.freeze({
  /** Horizontal speed: 6 px per frame. */
  speed: 600,
  /** Spawn offset from the thrower's position: 64 px forward, 92 px up (chest height). */
  spawnX: 6400,
  spawnY: -9200,
  /** Hitbox half-size: 14 x 13 px. Low and tall enough that crouching does not dodge it (QA F4). */
  halfW: 1400,
  halfH: 1300,
});

export const ROUND = Object.freeze({
  /** "ROUND N" then "FIGHT!" before control starts. */
  introFrames: 100,
  /** Round timer: 99 seconds. */
  timerFrames: 99 * 60,
  /** After a K.O. or time-out: the winner celebrates, then the next round. */
  koFrames: 180,
  /** Frame (into the K.O. phase) at which the winner starts the victory pose. */
  victoryDelay: 70,
  /** Rounds needed to win the match. */
  roundsToWin: 2,
  /** Match-over screen before the match restarts. */
  matchOverFrames: 300,
});
