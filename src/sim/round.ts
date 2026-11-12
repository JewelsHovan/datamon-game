// Round and match flow (spec 003, R7): intro, fight with a timer, K.O. or
// time-out, the winner's celebration, the next round, and the match restart.
import { MOVES_V2, ROUND } from "../data/combat";
import { resetFighters } from "./state";
import type { PlayerIndex, SimState } from "./types";

const FIGHT_CALL_FRAME = 60;

function enterPhase(state: SimState, phase: SimState["round"]["phase"]): void {
  state.round.phase = phase;
  state.round.phaseFrame = 0;
}

function decide(state: SimState, winner: -1 | 0 | 1 | 2, reason: "ko" | "time"): void {
  const r = state.round;
  r.winner = winner;
  r.reason = reason;
  if (winner === 0 || winner === 1) r.wins[winner] += 1;
  state.projectiles = []; // nothing in flight once the round is decided
  state.events.push({ type: "round_end", winner, reason });
  enterPhase(state, "ko");
}

function startRound(state: SimState, number: number): void {
  const r = state.round;
  resetFighters(state);
  r.number = number;
  r.timer = ROUND.timerFrames;
  r.winner = -1;
  r.reason = "";
  enterPhase(state, "intro");
}

export function advanceRound(state: SimState): void {
  const r = state.round;
  if (r.training) return;
  const [a, b] = state.fighters;
  switch (r.phase) {
    case "intro":
      if (r.phaseFrame === 0) state.events.push({ type: "round_start", round: r.number });
      if (r.phaseFrame === FIGHT_CALL_FRAME) state.events.push({ type: "fight" });
      r.phaseFrame += 1;
      if (r.phaseFrame >= ROUND.introFrames) enterPhase(state, "fight");
      break;
    case "fight": {
      r.phaseFrame += 1;
      const aDown = a.state === "ko";
      const bDown = b.state === "ko";
      if (aDown || bDown) {
        decide(state, aDown && bDown ? 2 : aDown ? 1 : 0, "ko");
        break;
      }
      r.timer -= 1;
      if (r.timer <= 0) {
        r.timer = 0;
        decide(state, a.health === b.health ? 2 : a.health > b.health ? 0 : 1, "time");
      }
      break;
    }
    case "ko": {
      r.phaseFrame += 1;
      if (r.winner === 0 || r.winner === 1) {
        // The winner taunts first on rounds that do not end the match (spec 012), then poses.
        const w = state.fighters[r.winner as PlayerIndex];
        const final = r.wins[r.winner] >= ROUND.roundsToWin;
        const poseAt = ROUND.victoryDelay + (final ? 0 : MOVES_V2.tauntFrames);
        if (!final && r.phaseFrame === ROUND.victoryDelay && w.state !== "ko") {
          w.state = "taunt";
          w.stateFrame = 0;
          w.move = null;
          state.events.push({ type: "taunt", player: r.winner as PlayerIndex });
        }
        if (r.phaseFrame === poseAt && w.state !== "ko") {
          w.state = "victory";
          w.stateFrame = 0;
          w.move = null;
        }
      }
      if (r.phaseFrame >= ROUND.koFrames) {
        const champion = r.wins[0] >= ROUND.roundsToWin ? 0 : r.wins[1] >= ROUND.roundsToWin ? 1 : -1;
        if (champion >= 0) {
          enterPhase(state, "matchover");
          state.events.push({ type: "match_end", winner: champion as 0 | 1 });
        } else {
          startRound(state, r.number + 1);
        }
      }
      break;
    }
    case "matchover":
      r.phaseFrame += 1;
      if (r.phaseFrame >= ROUND.matchOverFrames) {
        r.wins = [0, 0];
        startRound(state, 1);
      }
      break;
  }
}
