// A scripted 600-frame input sequence for determinism and movement tests:
// walking both ways, crouching, neutral / forward / back jumps, walking into
// the opponent and a forward jump over the opponent. Pure data, no DOM.
import {
  BUTTON_DOWN as D,
  BUTTON_LEFT as L,
  BUTTON_RIGHT as R,
  BUTTON_UP as U,
} from "../inputBits";
import type { InputPair } from "../types";

/** [frames, p1 bits, p2 bits] */
type Segment = readonly [number, number, number];

// P1 starts on the left facing right, P2 on the right facing left, 200 px apart.
const SEGMENTS: readonly Segment[] = [
  [30, R, 0], // P1 walks forward
  [20, L, L], // P1 walks back, P2 walks forward
  [30, D, D], // both crouch
  [40, R, 0], // P1 walks into P2 and pushes them
  [15, L, 0], // P1 backs off to jump-over spacing
  [4, U | R, 0], // P1 forward jump over P2: sides swap on landing
  [50, 0, 0],
  [4, U, 0], // P1 neutral jump (now facing left)
  [46, 0, 0],
  [4, U | R, U], // P1 back jump, P2 neutral jump
  [46, 0, 0],
  [4, 0, U | R], // P2 forward jump (now facing right)
  [46, 0, 0],
  [4, 0, U | L], // P2 back jump
  [46, 0, 0],
  [40, L | R, U | D], // SOCD: both resolve to neutral
  [40, D | R, L], // P1 crouches (down + back), P2 walks back
  [60, L, R], // both walk forward into each other
  [71, 0, 0],
];

function expand(segments: readonly Segment[]): InputPair[] {
  const out: InputPair[] = [];
  for (const [frames, p1, p2] of segments) {
    for (let i = 0; i < frames; i++) out.push([p1, p2]);
  }
  return out;
}

export const SANDBOX_SCRIPT: readonly InputPair[] = expand(SEGMENTS);
export const SANDBOX_SCRIPT_SEED = 0xc0ffee;
export const SANDBOX_P1 = "julien-hovan";
export const SANDBOX_P2 = "felicia-gorgacheva";
