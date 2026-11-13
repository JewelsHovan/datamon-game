// Combat (spec 003): starting moves from buffered input, move timelines,
// projectiles, throws, hit detection for both fighters at once, and applying
// hits (damage, hit-stop, stun, pushback, knockdown, K.O.).
import { COMBAT, KNOCKDOWN, MOVES_V2, PROJECTILE } from "../data/combat";
import { fighterInfo } from "../data/fighters";
import {
  moveHitbox,
  moveHurt,
  overlapCenter,
  poseHurt,
  rectsOverlap,
  toRect,
  type BoxPx,
  type Rect,
} from "../data/fighterBoxes";
import { MOVEMENT } from "../data/movement";
import {
  firstActiveTick,
  KNOCKDOWN_SEGMENTS,
  moveDuration,
  MOVES,
  segmentAt,
  type MoveDef,
  type MoveId,
  type Segment,
} from "../data/moves";
import { BUTTON_KICK, BUTTON_LEFT, BUTTON_PUNCH, BUTTON_RIGHT, BUTTON_SPECIAL, DIR_BACK, DIR_DOWN, DIR_FORWARD } from "./inputBits";
import { inputAt, toFacingRelative, wasPressed } from "./inputHistory";
import type { FighterState, PlayerIndex, Projectile, SimEvent, SimState } from "./types";

const HALF_GRAVITY = MOVEMENT.gravity >> 1;
// Same walls as physics.ts (not imported, to keep physics -> fighter -> combat free of cycles).
const WALL_LEFT = MOVEMENT.screenMargin;
const WALL_RIGHT = MOVEMENT.stageWidth - MOVEMENT.screenMargin;

// ---------------------------------------------------------------- input ----

/** Frame of the most recent unconsumed press of `bit` inside the buffer, or -1. */
export function bufferedPress(f: FighterState, bit: number, now: number, span: number = COMBAT.bufferFrames): number {
  for (let age = 0; age < span; age++) {
    if (wasPressed(f.input, bit, age) && now - age > f.consumedFrame) return now - age;
  }
  return -1;
}

function heldDirs(f: FighterState): number {
  return toFacingRelative(inputAt(f.input, 0), f.facing);
}

function ownsProjectile(state: SimState, player: PlayerIndex): boolean {
  return state.projectiles.some((p) => p.owner === player);
}

/**
 * The button scheme (spec 005, R1): which grounded normal a Punch or Kick press
 * starts with the directions held. Punch = light_punch, forward+Punch =
 * heavy_punch; Kick = light_kick, forward+Kick = heavy_kick; down+either =
 * crouch_attack. Punch+Kick (throw), Special and air attacks are picked by the callers.
 */
export function normalFor(button: typeof BUTTON_PUNCH | typeof BUTTON_KICK, dirs: number): MoveId {
  const kick = button === BUTTON_KICK;
  if ((dirs & DIR_DOWN) !== 0) return "crouch_attack";
  if ((dirs & DIR_FORWARD) !== 0) return kick ? "heavy_kick" : "heavy_punch";
  return kick ? "light_kick" : "light_punch";
}

/** Picks a grounded move from buffered presses, or null. Throws win over everything. */
function chooseGroundMove(f: FighterState, player: PlayerIndex, state: SimState): { id: MoveId; press: number } | null {
  const now = state.frame;
  const p = bufferedPress(f, BUTTON_PUNCH, now);
  const k = bufferedPress(f, BUTTON_KICK, now);
  const s = bufferedPress(f, BUTTON_SPECIAL, now);
  if (p >= 0 && k >= 0 && Math.abs(p - k) <= COMBAT.throwChordFrames) return { id: "throw", press: Math.max(p, k) };
  if (s >= 0 && !ownsProjectile(state, player)) return { id: "special", press: s };
  const press = Math.max(p, k);
  if (press < 0) return null;
  // The newer press wins when both are buffered but too far apart for a throw.
  return { id: normalFor(k >= p ? BUTTON_KICK : BUTTON_PUNCH, heldDirs(f)), press };
}

export function startMove(f: FighterState, player: PlayerIndex, id: MoveId, press: number, events: SimEvent[]): void {
  // The Special button starts the fighter's own signature special (spec 006).
  if (id === "special") id = fighterInfo(f.slug).specialMove;
  f.move = { id, tick: 0, connected: false, grabbed: false, hitSeg: -1, armorUsed: false };
  f.consumedFrame = Math.max(f.consumedFrame, press);
  if (!MOVES[id].air) {
    f.state = "attack";
    f.stateFrame = 0;
  }
  f.vx = 0;
  events.push({ type: "attack", player, move: id });
}

/** Grounded fighters that can act: start a move if one is buffered. Returns true if one started. */
export function tryGroundMove(f: FighterState, player: PlayerIndex, state: SimState): boolean {
  const pick = chooseGroundMove(f, player, state);
  if (!pick) return false;
  startMove(f, player, pick.id, pick.press, state.events);
  return true;
}

/** Airborne fighters: Punch or Kick starts the air attack, one per jump. */
export function tryAirMove(f: FighterState, player: PlayerIndex, state: SimState): boolean {
  if (f.move) return false;
  const press = Math.max(bufferedPress(f, BUTTON_PUNCH, state.frame), bufferedPress(f, BUTTON_KICK, state.frame));
  if (press < 0) return false;
  startMove(f, player, "air_attack", press, state.events);
  return true;
}

function cancelWindowOpen(move: MoveDef, tick: number): boolean {
  const start = firstActiveTick(move);
  let activeTicks = 0;
  for (const s of move.segments) if (s.active) activeTicks += s.ticks;
  return tick >= start && tick < start + activeTicks + 8;
}

/** The chord partner of the button that started a grounded normal (0 when either can be). */
function chordPartner(id: MoveId): number {
  switch (id) {
    case "light_punch":
    case "heavy_punch":
      return BUTTON_KICK;
    case "light_kick":
    case "heavy_kick":
      return BUTTON_PUNCH;
    default:
      return 0;
  }
}

/**
 * A Punch or Kick normal whose chord partner arrives within the chord window
 * becomes a throw. The starting press is already consumed, so for a crouch
 * attack (started by either button) any fresh Punch or Kick press is the partner.
 */
function tryThrowConversion(f: FighterState, player: PlayerIndex, state: SimState): boolean {
  const m = f.move;
  if (!m || m.tick > COMBAT.throwChordFrames) return false;
  const partner = chordPartner(m.id);
  if (partner === 0 && m.id !== "crouch_attack") return false;
  const press =
    partner !== 0
      ? bufferedPress(f, partner, state.frame)
      : Math.max(bufferedPress(f, BUTTON_PUNCH, state.frame), bufferedPress(f, BUTTON_KICK, state.frame));
  if (press < 0) return false;
  startMove(f, player, "throw", press, state.events);
  return true;
}

/**
 * Cancels from a connected move. The press maps to a move with the same
 * scheme as from neutral (normalFor, Special); the move's cancel list decides
 * whether it may follow: light_punch into forward+Punch, forward+Kick or
 * Special; light_kick into forward+Kick or Special; heavy_punch into Special.
 */
function tryCancel(f: FighterState, player: PlayerIndex, state: SimState): boolean {
  const m = f.move;
  if (!m || !m.connected) return false;
  const def = MOVES[m.id];
  if (!def.cancels || !cancelWindowOpen(def, m.tick)) return false;
  const now = state.frame;
  const dirs = heldDirs(f);
  const s = bufferedPress(f, BUTTON_SPECIAL, now);
  const p = bufferedPress(f, BUTTON_PUNCH, now);
  const k = bufferedPress(f, BUTTON_KICK, now);
  const candidates: { id: MoveId; press: number }[] = [];
  if (s >= 0 && !ownsProjectile(state, player)) candidates.push({ id: "special", press: s });
  // Newer press first, so the button pressed last decides when both are buffered.
  const normals = [
    { button: BUTTON_PUNCH, press: p },
    { button: BUTTON_KICK, press: k },
  ].sort((a, b) => b.press - a.press);
  for (const n of normals) {
    if (n.press >= 0) candidates.push({ id: normalFor(n.button, dirs), press: n.press });
  }
  for (const c of candidates) {
    if (def.cancels.includes(c.id)) {
      startMove(f, player, c.id, c.press, state.events);
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------- moves ----

/**
 * Advances a ground move by one tick (called for fighters in the "attack" state).
 * Returns true when the move ended this tick.
 */
export function tickGroundMove(f: FighterState, player: PlayerIndex, state: SimState): boolean {
  const m = f.move;
  if (!m) return true;
  m.tick += 1;
  if (tryThrowConversion(f, player, state) || tryCancel(f, player, state)) return false;
  const def = MOVES[m.id];
  if (def.projectileTick !== undefined && m.tick === def.projectileTick && !ownsProjectile(state, player)) {
    spawnProjectile(f, player, state);
  }
  if (def.vanishTick !== undefined && m.tick === def.vanishTick) {
    state.events.push({ type: "teleport", player, phase: "out", x: f.x });
  }
  if (def.reappearTick !== undefined && m.tick === def.reappearTick) reappear(f, player, state);
  if (def.id === "throw") return tickThrow(f, player, state);
  if (m.tick >= moveDuration(def)) {
    f.move = null;
    return true;
  }
  return false;
}

/** Throws: the grab is checked in detectHits on grabTick; a whiff recovers, a grab tosses on tossTick. */
function tickThrow(f: FighterState, player: PlayerIndex, state: SimState): boolean {
  const m = f.move!;
  const def = MOVES.throw;
  const victim = state.fighters[player === 0 ? 1 : 0];
  if (!m.grabbed && m.tick > def.grabTick!) {
    if (m.tick >= def.grabTick! + def.whiffRecovery!) {
      f.move = null;
      return true;
    }
    return false;
  }
  if (m.grabbed && victim.state === "held") {
    // Hold the victim just in front of the thrower until the toss.
    victim.x = clampWall(f.x + f.facing * 5200);
    victim.y = MOVEMENT.floorY;
    if (m.tick === def.tossTick) {
      victim.x = clampWall(f.x + f.facing * 6000);
      const dealt = applyDamage(victim, def.damage, state);
      state.events.push({ type: "hit", player, target: (player === 0 ? 1 : 0) as PlayerIndex, move: "throw", strength: "heavy", x: victim.x, y: victim.y - 9000, damage: dealt, combo: 1 });
      knockDown(victim, (player === 0 ? 1 : 0) as PlayerIndex, state, def.launch ?? 0);
      f.hitstop = def.hitstop;
      victim.hitstop = def.hitstop;
    }
  }
  if (m.tick >= moveDuration(def)) {
    f.move = null;
    return true;
  }
  return false;
}

/** Context Switch: reappear behind the opponent, or in front of them when they are cornered. */
function reappear(f: FighterState, player: PlayerIndex, state: SimState): void {
  const opp = state.fighters[player === 0 ? 1 : 0];
  const gap = 5600;
  let x = opp.x - opp.facing * gap;
  if (x < WALL_LEFT || x > WALL_RIGHT) x = opp.x + opp.facing * gap;
  f.x = clampWall(x);
  f.facing = opp.x >= f.x ? 1 : -1;
  state.events.push({ type: "teleport", player, phase: "in", x: f.x });
}

function clampWall(x: number): number {
  return x < WALL_LEFT ? WALL_LEFT : x > WALL_RIGHT ? WALL_RIGHT : x;
}

function spawnProjectile(f: FighterState, player: PlayerIndex, state: SimState): void {
  const p: Projectile = {
    owner: player,
    x: f.x + f.facing * PROJECTILE.spawnX,
    y: f.y + PROJECTILE.spawnY,
    vx: f.facing * PROJECTILE.speed,
  };
  state.projectiles.push(p);
  state.events.push({ type: "projectile", player, x: p.x, y: p.y });
}

/**
 * Left edge of the view, as the camera computes it: centered on the fighters' midpoint and
 * clamped to the stage. Kept in the sim so projectiles leave play when they leave the screen.
 */
export function viewLeft(state: SimState): number {
  const mid = Math.floor((state.fighters[0].x + state.fighters[1].x) / 2);
  const left = mid - (MOVEMENT.screenWidth >> 1);
  return Math.max(0, Math.min(MOVEMENT.stageWidth - MOVEMENT.screenWidth, left));
}

/** Moves projectiles and drops the ones that left the screen. */
export function advanceProjectiles(state: SimState): void {
  for (const p of state.projectiles) p.x += p.vx;
  const left = viewLeft(state);
  const right = left + MOVEMENT.screenWidth;
  state.projectiles = state.projectiles.filter((p) => p.x > left - PROJECTILE.halfW && p.x < right + PROJECTILE.halfW);
}

function projectileRect(p: Projectile): Rect {
  return { left: p.x - PROJECTILE.halfW, right: p.x + PROJECTILE.halfW, top: p.y - PROJECTILE.halfH, bottom: p.y + PROJECTILE.halfH };
}

// ------------------------------------------------------- knockdown, K.O. ----

export function knockDown(f: FighterState, player: PlayerIndex, state: SimState, launch = 0, tumble = false): void {
  if (f.state !== "knockdown") {
    f.juggle = 0;
    f.tumble = false;
  }
  if (tumble) f.tumble = true;
  f.move = null;
  f.stun = 0;
  f.pushLeft = 0;
  f.pushFrames = 0;
  f.vx = 0;
  f.slideDir = (-f.facing) as -1 | 1;
  f.rollFrom = -1;
  if (launch > 0) f.vy = capRise(f, -launch);
  else if (f.y < MOVEMENT.floorY && f.vy < 0) f.vy = 0;
  if (f.health <= 0 && !state.round.training) {
    f.state = "ko";
    state.events.push({ type: "ko", player, x: f.x, y: f.y });
  } else {
    f.state = "knockdown";
  }
  f.stateFrame = 0;
}

/** Integer square root (floor), without Math.sqrt (the sim stays free of float math). */
function isqrt(n: number): number {
  if (n < 2) return Math.max(0, n);
  let x = n;
  let y = Math.floor((x + 1) / 2);
  while (y < x) {
    x = y;
    y = Math.floor((x + Math.floor(n / x)) / 2);
  }
  return x;
}

/**
 * Caps an upward speed so the fighter peaks at most MOVES_V2.maxLaunchHeight above the floor.
 * A speed v rises about v*v / (2g) more, so v is kept within sqrt(2g * room left).
 */
function capRise(f: FighterState, vy: number): number {
  if (vy >= 0) return vy;
  const room = MOVES_V2.maxLaunchHeight - (MOVEMENT.floorY - f.y);
  if (room <= 0) return 0;
  return Math.max(vy, -isqrt(2 * MOVEMENT.gravity * room));
}

function getUp(f: FighterState, state: SimState): void {
  if (state.round.training && f.health <= 0) f.health = f.maxHealth;
  f.state = "idle";
  f.stateFrame = 0;
  f.comboHits = 0;
  f.juggle = 0;
  f.wallBounced = false;
  f.rollFrom = -1;
  f.tumble = false;
}

/**
 * Knockdown and K.O. motion. Launched fighters fly (held on the flying frames until they land),
 * may bounce off a wall once per combo, then slide, lie, and get up or roll away (holding back).
 */
export function advanceDowned(f: FighterState, player: PlayerIndex, state: SimState): void {
  if (f.rollFrom >= 0) {
    f.vx = -f.facing * MOVES_V2.rollSpeed;
    if (f.stateFrame - f.rollFrom >= MOVES_V2.rollFrames) getUp(f, state);
    return;
  }
  const airborne = f.y < MOVEMENT.floorY || f.vy < 0;
  f.vx = airborne ? f.slideDir * MOVES_V2.airDrift : f.stateFrame <= KNOCKDOWN.slideFrames ? f.slideDir * KNOCKDOWN.slideSpeed : 0;
  if (airborne) {
    f.y += f.vy + HALF_GRAVITY;
    f.vy += MOVEMENT.gravity;
    const atWall = (f.slideDir < 0 && f.x <= WALL_LEFT + 600) || (f.slideDir > 0 && f.x >= WALL_RIGHT - 600);
    if (atWall && !f.wallBounced) {
      f.wallBounced = true;
      f.tumble = true;
      f.slideDir = (-f.slideDir) as -1 | 1;
      f.vy = capRise(f, Math.min(f.vy, -MOVES_V2.wallBouncePop));
      f.hitstop = 6;
      state.events.push({ type: "wall_bounce", player, x: f.x, y: f.y - 6000 });
    }
    if (f.y >= MOVEMENT.floorY) {
      f.y = MOVEMENT.floorY;
      f.vy = 0;
      f.stateFrame = KNOCKDOWN.impactFrame;
      state.events.push({ type: "knockdown", player, x: f.x, y: MOVEMENT.floorY });
    } else if (f.stateFrame >= KNOCKDOWN.impactFrame) {
      f.stateFrame = KNOCKDOWN.impactFrame - 1;
    }
    return;
  }
  if (f.stateFrame === KNOCKDOWN.impactFrame) state.events.push({ type: "knockdown", player, x: f.x, y: MOVEMENT.floorY });
  if (f.state !== "knockdown") return;
  const lying = f.stateFrame >= KNOCKDOWN.koHoldFrame && f.stateFrame < KNOCKDOWN.koHoldFrame + 16;
  if (lying && (heldDirs(f) & DIR_BACK) !== 0) {
    f.rollFrom = f.stateFrame;
    state.events.push({ type: "roll", player });
    return;
  }
  if (f.stateFrame >= KNOCKDOWN.totalFrames) getUp(f, state);
}

/** Which knockdown-clip frame a downed fighter shows (K.O. stays on the lying frame). */
export function downedFrame(f: FighterState): number {
  const tick = f.state === "ko" ? Math.min(f.stateFrame, KNOCKDOWN.koHoldFrame) : f.stateFrame;
  return segmentAt(KNOCKDOWN_SEGMENTS, tick).segment.frame;
}

// --------------------------------------------------------------- boxes ----

function poseOf(f: FighterState): "stand" | "crouch" | "air" {
  if (f.y < MOVEMENT.floorY || f.state === "airborne") return "air";
  if (f.state === "crouch" || ((f.state === "blockstun" || f.state === "hitstun") && f.stunLow)) return "crouch";
  return "stand";
}

/** World-space hurtboxes; downed, held and celebrating fighters have none. */
export function hurtRects(f: FighterState): Rect[] {
  if (f.state === "knockdown" || f.state === "ko") {
    // A launched fighter can be juggled a couple of times before falling out of reach.
    const juggleable = f.state === "knockdown" && f.rollFrom < 0 && f.y < MOVEMENT.floorY - 1000 && f.juggle < MOVES_V2.maxJuggle;
    return juggleable ? poseHurt(f.slug, "air").map((b) => toRect(b, f.x, f.y, f.facing)) : [];
  }
  if (f.state === "held" || f.state === "victory") return [];
  if (f.state === "dash_back" && f.stateFrame < MOVES_V2.dashBackInvuln) return [];
  let boxes: readonly BoxPx[];
  if (f.move) {
    const def = MOVES[f.move.id];
    const seg = segmentAt(def.segments, f.move.tick).segment;
    if (seg.hidden || seg.invuln) return [];
    boxes = moveHurt(f.slug, def, seg.frame);
  } else {
    boxes = poseHurt(f.slug, poseOf(f));
  }
  return boxes.map((b) => toRect(b, f.x, f.y, f.facing));
}

/** World-space hitbox of the fighter's active move frame, or null. */
export function hitRect(f: FighterState): Rect | null {
  const m = f.move;
  if (!m || m.id === "throw" || m.id === "special") return null;
  const def = MOVES[m.id];
  const at = segmentAt(def.segments, m.tick);
  const seg = at.segment;
  if (!seg.active) return null;
  if (def.multiHit ? m.hitSeg === at.index : m.connected) return null;
  const box = moveHitbox(f.slug, def, seg.frame, seg.reach);
  return box ? toRect(box, f.x, f.y, f.facing) : null;
}

// -------------------------------------------------------- hit detection ----

export type PendingHit =
  | { kind: "strike"; attacker: PlayerIndex; target: PlayerIndex; move: MoveId; x: number; y: number }
  | { kind: "projectile"; owner: PlayerIndex; target: PlayerIndex; x: number; y: number }
  | { kind: "grab"; attacker: PlayerIndex; target: PlayerIndex };

function firstOverlap(hit: Rect, hurts: readonly Rect[]): Rect | null {
  for (const h of hurts) if (rectsOverlap(hit, h)) return h;
  return null;
}

function throwable(f: FighterState): boolean {
  if (f.y < MOVEMENT.floorY) return false;
  return f.state === "idle" || f.state === "walk_forward" || f.state === "walk_back" || f.state === "crouch" || f.state === "landing" || f.state === "attack";
}

/** Finds every hit this step before any is applied, so simultaneous hits trade. */
export function detectHits(state: SimState): PendingHit[] {
  const hits: PendingHit[] = [];
  const fighters = state.fighters;
  const hurts = [hurtRects(fighters[0]), hurtRects(fighters[1])] as const;
  const grabbing: boolean[] = [false, false];
  for (const i of [0, 1] as const) {
    const f = fighters[i];
    const j = (1 - i) as PlayerIndex;
    const m = f.move;
    if (m && m.id === "throw" && !m.grabbed && m.tick === MOVES.throw.grabTick && f.hitstop === 0) {
      const target = fighters[j];
      if (throwable(target) && Math.abs(target.x - f.x) <= COMBAT.throwRange) grabbing[i] = true;
      continue;
    }
    const hit = hitRect(f);
    if (!hit) continue;
    const hurt = firstOverlap(hit, hurts[j]);
    if (!hurt) continue;
    const c = overlapCenter(hit, hurt);
    hits.push({ kind: "strike", attacker: i, target: j, move: m!.id, x: c.x, y: c.y });
  }
  if (grabbing[0] && grabbing[1]) {
    // Both throw on the same frame: a tech. Both throws whiff.
    const x = Math.floor((fighters[0].x + fighters[1].x) / 2);
    state.events.push({ type: "tech", x, y: MOVEMENT.floorY - 9000 });
  } else {
    for (const i of [0, 1] as const) if (grabbing[i]) hits.push({ kind: "grab", attacker: i, target: (1 - i) as PlayerIndex });
  }

  // Projectiles: clash with each other first, then hit fighters.
  const ps = state.projectiles;
  const dead = new Set<number>();
  for (let a = 0; a < ps.length; a++) {
    for (let b = a + 1; b < ps.length; b++) {
      if (ps[a]!.owner === ps[b]!.owner || dead.has(a) || dead.has(b)) continue;
      const ra = projectileRect(ps[a]!);
      const rb = projectileRect(ps[b]!);
      if (rectsOverlap(ra, rb)) {
        dead.add(a);
        dead.add(b);
        const c = overlapCenter(ra, rb);
        state.events.push({ type: "clash", x: c.x, y: c.y });
      }
    }
  }
  for (let k = 0; k < ps.length; k++) {
    if (dead.has(k)) continue;
    const p = ps[k]!;
    const target = (1 - p.owner) as PlayerIndex;
    const pr = projectileRect(p);
    const hurt = firstOverlap(pr, hurts[target]);
    if (!hurt) continue;
    const c = overlapCenter(pr, hurt);
    hits.push({ kind: "projectile", owner: p.owner, target, x: c.x, y: c.y });
    dead.add(k);
  }
  // Clashed and spent projectiles leave the field now; their hits carry the owner.
  state.projectiles = ps.filter((_, k) => !dead.has(k));
  return hits;
}

// ------------------------------------------------------------ hit apply ----

/** Can `f` block a hit of this height right now? Holding back blocks; down-back blocks low. */
export function blocks(f: FighterState, height: MoveDef["height"]): boolean {
  if (f.y < MOVEMENT.floorY) return false;
  const ok = f.state === "idle" || f.state === "walk_back" || f.state === "walk_forward" || f.state === "crouch" || f.state === "blockstun" || f.state === "landing";
  if (!ok) return false;
  const dirs = heldDirs(f);
  if ((dirs & DIR_BACK) === 0) return false;
  const crouching = (dirs & DIR_DOWN) !== 0;
  if (height === "low") return crouching;
  if (height === "overhead") return !crouching;
  return true;
}

function applyDamage(f: FighterState, base: number, _state: SimState): number {
  const pct = Math.max(COMBAT.comboScaleFloor, 100 - COMBAT.comboScalePerHit * f.comboHits);
  const dealt = Math.max(1, Math.floor((base * pct) / 100));
  f.health = Math.max(0, f.health - dealt);
  f.comboHits += 1;
  return dealt;
}

/** Pushes the defender away from `fromX`; whatever the wall stops goes to the attacker instead. */
function applyPush(defender: FighterState, attacker: FighterState | null, push: number): void {
  if (push <= 0) return;
  const dir = defender.x >= (attacker ? attacker.x : defender.x - defender.facing) ? 1 : -1;
  const room = dir === 1 ? WALL_RIGHT - defender.x : defender.x - WALL_LEFT;
  const own = Math.min(push, Math.max(0, room));
  defender.pushLeft = dir * own;
  defender.pushFrames = COMBAT.pushFrames;
  if (attacker && own < push && attacker.y >= MOVEMENT.floorY) {
    attacker.pushLeft = -dir * (push - own);
    attacker.pushFrames = COMBAT.pushFrames;
  }
}

function strike(state: SimState, def: MoveDef, attacker: FighterState | null, attackerIdx: PlayerIndex, target: PlayerIndex, x: number, y: number, seg?: Segment): void {
  const d = state.fighters[target];
  const hitstop = seg?.hitstop ?? def.hitstop;
  if (blocks(d, def.height)) {
    const crouching = (heldDirs(d) & DIR_DOWN) !== 0;
    d.state = "blockstun";
    d.stateFrame = 0;
    d.stun = def.blockstun;
    d.stunLow = crouching;
    d.move = null;
    if (def.chip) d.health = Math.max(d.health > 1 ? 1 : 0, d.health - def.chip);
    d.hitstop = Math.max(0, hitstop - COMBAT.blockHitstopReduction);
    if (attacker) attacker.hitstop = d.hitstop;
    applyPush(d, attacker, def.push);
    state.events.push({ type: "block", player: attackerIdx, target, move: def.id, strength: def.strength, x, y });
    return;
  }
  const scale = fighterInfo(state.fighters[attackerIdx].slug).damagePct;
  const base = Math.max(1, Math.floor(((seg?.damage ?? def.damage) * scale) / 100));
  const knocks = seg?.knockdown ?? def.knockdown ?? false;
  const launch = seg?.launch ?? def.launch ?? 0;
  // Armor: an armored segment takes the damage but keeps going (once per move).
  if (d.move && !d.move.armorUsed && segmentAt(MOVES[d.move.id].segments, d.move.tick).segment.armor) {
    d.move.armorUsed = true;
    const dealt = applyDamage(d, base, state);
    state.events.push({ type: "armor", player: target, x, y });
    state.events.push({ type: "hit", player: attackerIdx, target, move: def.id, strength: def.strength, x, y, damage: dealt, combo: d.comboHits });
    d.hitstop = 6;
    if (attacker) attacker.hitstop = 6;
    if (d.health <= 0) knockDown(d, target, state, launch);
    return;
  }
  const crouching = d.state === "crouch" || (d.state === "attack" && d.move?.id === "crouch_attack");
  const dealt = applyDamage(d, base, state);
  state.events.push({ type: "hit", player: attackerIdx, target, move: def.id, strength: def.strength, x, y, damage: dealt, combo: d.comboHits });
  d.hitstop = hitstop;
  if (attacker) attacker.hitstop = hitstop;
  if (d.state === "knockdown") {
    // A juggle: pop the falling fighter back up.
    d.juggle += 1;
    knockDown(d, target, state, Math.max(launch, MOVES_V2.jugglePop), true);
    return;
  }
  const airborne = d.y < MOVEMENT.floorY;
  if (d.health <= 0 || knocks || airborne) {
    knockDown(d, target, state, airborne ? Math.max(launch, 300) : launch, airborne);
    return;
  }
  d.state = "hitstun";
  d.stateFrame = 0;
  d.stun = def.hitstun + (crouching ? COMBAT.crouchHitstunBonus : 0);
  d.stunLow = crouching || def.height === "low";
  d.move = null;
  applyPush(d, attacker, def.push);
}

/** Applies every detected hit. Two fighter strikes in one step is a trade. */
export function applyHits(state: SimState, hits: readonly PendingHit[]): void {
  const strikes = hits.filter((h) => h.kind === "strike");
  if (strikes.length === 2) {
    const a = strikes[0]!;
    state.events.push({ type: "trade", x: Math.floor((a.x + strikes[1]!.x) / 2), y: Math.floor((a.y + strikes[1]!.y) / 2) });
  }
  // Grabs resolve last, and only for a thrower still in the throw: a thrower struck on the
  // same step (by a jab or a projectile) loses the grab instead of leaving a victim held by nobody.
  const ordered = [...hits.filter((h) => h.kind !== "grab"), ...hits.filter((h) => h.kind === "grab")];
  for (const h of ordered) {
    if (h.kind === "strike") {
      const attacker = state.fighters[h.attacker];
      const def = MOVES[h.move];
      let seg: Segment | undefined;
      if (attacker.move) {
        const at = segmentAt(def.segments, attacker.move.tick);
        seg = at.segment;
        attacker.move.connected = true;
        attacker.move.hitSeg = at.index;
      }
      strike(state, def, attacker, h.attacker, h.target, h.x, h.y, seg);
    } else if (h.kind === "projectile") {
      strike(state, MOVES.special, null, h.owner, h.target, h.x, h.y);
    } else {
      const thrower = state.fighters[h.attacker];
      const victim = state.fighters[h.target];
      if (thrower.move?.id !== "throw" || thrower.state !== "attack") continue;
      if (victim.state === "hitstun" || victim.state === "knockdown" || victim.state === "ko") continue;
      thrower.move.grabbed = true;
      thrower.move.connected = true;
      victim.state = "held";
      victim.stateFrame = 0;
      victim.move = null;
      victim.stun = 0;
      state.events.push({ type: "throw", player: h.attacker, target: h.target });
    }
  }
}

/** Pushback, applied a little each frame. */
export function advancePush(f: FighterState): void {
  if (f.pushFrames <= 0) return;
  const delta = Math.trunc(f.pushLeft / f.pushFrames);
  f.x = clampWall(f.x + delta);
  f.pushLeft -= delta;
  f.pushFrames -= 1;
}

// ------------------------------------------------- spec 012 input helpers ----

/** A double tap of forward (1) or back (-1) within the dash window, or 0. */
export function dashInput(f: FighterState): 1 | -1 | 0 {
  const forwardBit = f.facing === 1 ? BUTTON_RIGHT : BUTTON_LEFT;
  const backBit = f.facing === 1 ? BUTTON_LEFT : BUTTON_RIGHT;
  for (const [dir, bit] of [[1, forwardBit], [-1, backBit]] as const) {
    if (!wasPressed(f.input, bit, 0)) continue;
    for (let age = 2; age <= MOVES_V2.dashWindow; age++) {
      if (wasPressed(f.input, bit, age)) return dir;
    }
  }
  return 0;
}

/** Down+Special taunts (vulnerable). */
export function tryTaunt(f: FighterState, player: PlayerIndex, state: SimState): boolean {
  const s = bufferedPress(f, BUTTON_SPECIAL, state.frame);
  if (s < 0 || (heldDirs(f) & DIR_DOWN) === 0) return false;
  f.consumedFrame = Math.max(f.consumedFrame, s);
  f.state = "taunt";
  f.stateFrame = 0;
  f.move = null;
  state.events.push({ type: "taunt", player });
  return true;
}

/**
 * Punch+Kick in blockstun shoves the attacker away. The press may come during the
 * block's hit-stop, so the window covers the hit-stop as well as the usual buffer.
 */
export function tryBlockPush(f: FighterState, player: PlayerIndex, state: SimState): boolean {
  const span = COMBAT.bufferFrames + MOVES_V2.blockPushHitstopGrace;
  const p = bufferedPress(f, BUTTON_PUNCH, state.frame, span);
  const k = bufferedPress(f, BUTTON_KICK, state.frame, span);
  if (p < 0 || k < 0 || Math.abs(p - k) > COMBAT.throwChordFrames) return false;
  f.consumedFrame = Math.max(f.consumedFrame, p, k);
  f.state = "block_push";
  f.stateFrame = 0;
  f.stun = 0;
  const opp = state.fighters[player === 0 ? 1 : 0];
  const dir = opp.x >= f.x ? 1 : -1;
  opp.pushLeft = dir * MOVES_V2.blockPushDistance;
  opp.pushFrames = 10;
  state.events.push({ type: "block_push", player, target: (player === 0 ? 1 : 0) as PlayerIndex, x: Math.floor((f.x + opp.x) / 2), y: f.y - 9000 });
  return true;
}
