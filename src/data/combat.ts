// Combat and match numbers (spec 003). Pure data: src/sim reads it.
// Units: subpixels (100 per px) and 60 Hz sim frames.

export const COMBAT = Object.freeze({
  /** Health per round. */
  maxHealth: 1000,
  /** A press counts for this many frames after it happens (input buffer). */
  bufferFrames: 4,
  /** Punch and Kick pressed within this many frames of each other start a throw. */
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
  /** Extra hitstun when hitting an opponent out of attack startup (counter-hit). */
  counterHitstunBonus: 3,
  /** Hit-stop on a blocked hit is this much shorter. */
  blockHitstopReduction: 2,
  /** Frames after a normal throw grabs during which Punch+Kick escapes into a tech. */
  throwTechFrames: 8,
});

export const SHIELD = Object.freeze({
  /** Full Cardinal Shield integrity per fighter. */
  maxGuard: 1000,
  /** Guard drained per blocked strike before fighter chipResistPct scaling. */
  drainLight: 70,
  drainHeavy: 210,
  drainSpecial: 250,
  /** Air Shield drains 1.5x Guard (projectiles and air-to-air strikes). */
  airDrainPct: 150,
  /** Guard spent by Pushblock (Punch+Kick during blockstun). */
  pushCost: 220,
  /** Frames after blocking/pushblocking before Guard begins regenerating. */
  regenDelay: 20,
  /** Guard recovered per frame once regenDelay expires outside blockstun/guard_break. */
  regenPerFrame: 6,
  /** Vulnerable stagger duration when Guard reaches 0. */
  breakStunFrames: 42,
  /** Guard restored if guard_break expires without being hit (full 1000 if punished). */
  postBreakGuard: 700,
  /** Just-Defend / Perfect Shield window: Back pressed within this many frames before impact. */
  perfectWindowFrames: 3,
  /** Guard restored on a Perfect Shield. */
  perfectGuardRestore: 160,
  /** Blockstun shaved off the defender on a Perfect Shield. */
  perfectStunReduction: 5,
});

export const MOVES_V2 = Object.freeze({
  /** A second tap of a direction within this many frames dashes (spec 012). */
  dashWindow: 10,
  dashForwardFrames: 16,
  dashBackFrames: 18,
  /** Back dash cannot be hit for its first frames. */
  dashBackInvuln: 6,
  /** Dash speeds (subpixels per frame): fast part, then the slowdown. */
  dashForwardSpeed: 550,
  dashForwardTail: 200,
  dashBackSpeed: 450,
  dashBackTail: 150,
  /** Horizontal drift of a launched fighter while airborne (subpixels per frame); the ground slide is KNOCKDOWN.slideSpeed. */
  airDrift: 150,
  /**
   * Highest a launch, juggle or wall bounce may carry a fighter (subpixels above the floor): just over
   * a jump's 116 px apex, so a launched body never leaves the top of the view or covers the HUD.
   */
  maxLaunchHeight: 12000,
  /** Hits an airborne knocked-down fighter can take before falling out of reach. */
  maxJuggle: 2,
  /** Pop of a juggle hit and of a wall bounce (subpixels per frame, upward). */
  jugglePop: 550,
  wallBouncePop: 600,
  /** Get-up roll: holding back or forward while lying rolls this far over the roll. */
  rollFrames: 36,
  rollSpeed: 250,
  /** Final frames of a get-up roll that expose standing hurtboxes so predictable rolls can be baited. */
  rollVulnTail: 5,
  /** Lying frames shaved off when holding Up on knockdown for a Quick Rise. */
  quickRiseCut: 14,
  /** Block push: Punch+Kick in blockstun; the attacker slides back this far. */
  blockPushFrames: 12,
  /** Extra input-buffer frames for the block push, so a press during the block's hit-stop counts. */
  blockPushHitstopGrace: 10,
  blockPushDistance: 6000,
  tauntFrames: 50,
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
