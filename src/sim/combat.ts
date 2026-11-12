// Combat (spec 003): starting moves from buffered input, move timelines,
// projectiles, throws, hit detection for both fighters at once, and applying
// hits (damage, hit-stop, stun, pushback, knockdown, K.O.).
import { COMBAT, KNOCKDOWN, PROJECTILE } from "../data/combat";
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
} from "../data/moves";
import { BUTTON_HEAVY, BUTTON_LIGHT, BUTTON_SPECIAL, DIR_BACK, DIR_DOWN, DIR_FORWARD } from "./inputBits";
import { inputAt, toFacingRelative, wasPressed } from "./inputHistory";
import type { FighterState, PlayerIndex, Projectile, SimEvent, SimState } from "./types";

const HALF_GRAVITY = MOVEMENT.gravity >> 1;
// Same walls as physics.ts (not imported, to keep physics -> fighter -> combat free of cycles).
const WALL_LEFT = MOVEMENT.screenMargin;
const WALL_RIGHT = MOVEMENT.stageWidth - MOVEMENT.screenMargin;

// ---------------------------------------------------------------- input ----

/** Frame of the most recent unconsumed press of `bit` inside the buffer, or -1. */
export function bufferedPress(f: FighterState, bit: number, now: number): number {
  for (let age = 0; age < COMBAT.bufferFrames; age++) {
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

/** Picks a grounded move from buffered presses, or null. Throws win over everything. */
function chooseGroundMove(f: FighterState, player: PlayerIndex, state: SimState): { id: MoveId; press: number } | null {
  const now = state.frame;
  const l = bufferedPress(f, BUTTON_LIGHT, now);
  const h = bufferedPress(f, BUTTON_HEAVY, now);
  const s = bufferedPress(f, BUTTON_SPECIAL, now);
  if (l >= 0 && h >= 0 && Math.abs(l - h) <= COMBAT.throwChordFrames) return { id: "throw", press: Math.max(l, h) };
  if (s >= 0 && !ownsProjectile(state, player)) return { id: "special", press: s };
  const dirs = heldDirs(f);
  const press = Math.max(l, h);
  if (press < 0) return null;
  const heavy = h >= l;
  if ((dirs & DIR_DOWN) !== 0) return { id: "crouch_attack", press };
  if ((dirs & DIR_FORWARD) !== 0) return { id: heavy ? "heavy_kick" : "light_kick", press };
  return { id: heavy ? "heavy_punch" : "light_punch", press };
}

export function startMove(f: FighterState, player: PlayerIndex, id: MoveId, press: number, events: SimEvent[]): void {
  f.move = { id, tick: 0, connected: false, grabbed: false };
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

/** Airborne fighters: one air attack per jump. */
export function tryAirMove(f: FighterState, player: PlayerIndex, state: SimState): boolean {
  if (f.move) return false;
  const press = Math.max(bufferedPress(f, BUTTON_LIGHT, state.frame), bufferedPress(f, BUTTON_HEAVY, state.frame));
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

/** A light or heavy punch whose chord partner arrives within the chord window becomes a throw. */
function tryThrowConversion(f: FighterState, player: PlayerIndex, state: SimState): boolean {
  const m = f.move;
  if (!m || (m.id !== "light_punch" && m.id !== "heavy_punch") || m.tick > COMBAT.throwChordFrames) return false;
  const other = m.id === "light_punch" ? BUTTON_HEAVY : BUTTON_LIGHT;
  const press = bufferedPress(f, other, state.frame);
  if (press < 0) return false;
  startMove(f, player, "throw", press, state.events);
  return true;
}

function tryCancel(f: FighterState, player: PlayerIndex, state: SimState): boolean {
  const m = f.move;
  if (!m || !m.connected) return false;
  const def = MOVES[m.id];
  if (!def.cancels || !cancelWindowOpen(def, m.tick)) return false;
  const now = state.frame;
  const dirs = heldDirs(f);
  const s = bufferedPress(f, BUTTON_SPECIAL, now);
  const h = bufferedPress(f, BUTTON_HEAVY, now);
  const candidates: { id: MoveId; press: number }[] = [];
  if (s >= 0 && !ownsProjectile(state, player)) candidates.push({ id: "special", press: s });
  if (h >= 0) candidates.push({ id: (dirs & DIR_FORWARD) !== 0 ? "heavy_kick" : "heavy_punch", press: h });
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
      knockDown(victim, (player === 0 ? 1 : 0) as PlayerIndex, state);
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

/** Moves projectiles and drops the ones that left the stage. */
export function advanceProjectiles(state: SimState): void {
  for (const p of state.projectiles) p.x += p.vx;
  state.projectiles = state.projectiles.filter((p) => p.x > -PROJECTILE.halfW && p.x < MOVEMENT.stageWidth + PROJECTILE.halfW);
}

function projectileRect(p: Projectile): Rect {
  return { left: p.x - PROJECTILE.halfW, right: p.x + PROJECTILE.halfW, top: p.y - PROJECTILE.halfH, bottom: p.y + PROJECTILE.halfH };
}

// ------------------------------------------------------- knockdown, K.O. ----

export function knockDown(f: FighterState, player: PlayerIndex, state: SimState): void {
  f.move = null;
  f.stun = 0;
  f.pushLeft = 0;
  f.pushFrames = 0;
  f.vx = 0;
  if (f.y < MOVEMENT.floorY && f.vy < 0) f.vy = 0;
  if (f.health <= 0 && !state.round.training) {
    f.state = "ko";
    state.events.push({ type: "ko", player, x: f.x, y: f.y });
  } else {
    f.state = "knockdown";
  }
  f.stateFrame = 0;
}

/** Knockdown and K.O. motion: slide back, fall if launched in the air, get up (knockdown only). */
export function advanceDowned(f: FighterState, player: PlayerIndex, state: SimState): void {
  f.vx = f.stateFrame <= KNOCKDOWN.slideFrames ? -f.facing * KNOCKDOWN.slideSpeed : 0;
  if (f.y < MOVEMENT.floorY) {
    f.y += f.vy + HALF_GRAVITY;
    f.vy += MOVEMENT.gravity;
    if (f.y >= MOVEMENT.floorY) {
      f.y = MOVEMENT.floorY;
      f.vy = 0;
    }
  }
  if (f.stateFrame === KNOCKDOWN.impactFrame) state.events.push({ type: "knockdown", player, x: f.x, y: MOVEMENT.floorY });
  if (f.state === "knockdown" && f.stateFrame >= KNOCKDOWN.totalFrames) {
    if (state.round.training && f.health <= 0) f.health = COMBAT.maxHealth;
    f.state = "idle";
    f.stateFrame = 0;
    f.comboHits = 0;
  }
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
  if (f.state === "knockdown" || f.state === "ko" || f.state === "held" || f.state === "victory") return [];
  let boxes: readonly BoxPx[];
  if (f.move) {
    const def = MOVES[f.move.id];
    boxes = moveHurt(f.slug, def, segmentAt(def.segments, f.move.tick).segment.frame);
  } else {
    boxes = poseHurt(f.slug, poseOf(f));
  }
  return boxes.map((b) => toRect(b, f.x, f.y, f.facing));
}

/** World-space hitbox of the fighter's active move frame, or null. */
export function hitRect(f: FighterState): Rect | null {
  const m = f.move;
  if (!m || m.connected || m.id === "throw" || m.id === "special") return null;
  const def = MOVES[m.id];
  const seg = segmentAt(def.segments, m.tick).segment;
  if (!seg.active) return null;
  const box = moveHitbox(f.slug, def, seg.frame);
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

function strike(state: SimState, def: MoveDef, attacker: FighterState | null, attackerIdx: PlayerIndex, target: PlayerIndex, x: number, y: number): void {
  const d = state.fighters[target];
  if (blocks(d, def.height)) {
    const crouching = (heldDirs(d) & DIR_DOWN) !== 0;
    d.state = "blockstun";
    d.stateFrame = 0;
    d.stun = def.blockstun;
    d.stunLow = crouching;
    d.move = null;
    if (def.chip) d.health = Math.max(d.health > 1 ? 1 : 0, d.health - def.chip);
    d.hitstop = Math.max(0, def.hitstop - COMBAT.blockHitstopReduction);
    if (attacker) attacker.hitstop = d.hitstop;
    applyPush(d, attacker, def.push);
    state.events.push({ type: "block", player: attackerIdx, target, move: def.id, strength: def.strength, x, y });
    return;
  }
  const crouching = d.state === "crouch" || (d.state === "attack" && d.move?.id === "crouch_attack");
  const dealt = applyDamage(d, def.damage, state);
  state.events.push({ type: "hit", player: attackerIdx, target, move: def.id, strength: def.strength, x, y, damage: dealt, combo: d.comboHits });
  d.hitstop = def.hitstop;
  if (attacker) attacker.hitstop = def.hitstop;
  const airborne = d.y < MOVEMENT.floorY;
  if (d.health <= 0 || def.knockdown || airborne) {
    knockDown(d, target, state);
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
  for (const h of hits) {
    if (h.kind === "strike") {
      const attacker = state.fighters[h.attacker];
      if (attacker.move) attacker.move.connected = true;
      strike(state, MOVES[h.move], attacker, h.attacker, h.target, h.x, h.y);
    } else if (h.kind === "projectile") {
      strike(state, MOVES.special, null, h.owner, h.target, h.x, h.y);
    } else {
      const thrower = state.fighters[h.attacker];
      const victim = state.fighters[h.target];
      if (thrower.move) {
        thrower.move.grabbed = true;
        thrower.move.connected = true;
      }
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
