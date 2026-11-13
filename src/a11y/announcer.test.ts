// Spec 014 R5 / T4: what the screen-reader layer says and how it throttles.
import { describe, expect, it } from "vitest";
import { createMatchState } from "../sim/state";
import type { SimEvent, SimState } from "../sim/types";
import { Announcer, canvasLabel, eventMessages, GAP_MS, MAX_QUEUE, playerWords, sceneMessage } from "./announcer";

const NAMES = ["Julien H.", "Felicia G."] as const;

function match(): SimState {
  return createMatchState(1, "julien-hovan", "felicia-gorgacheva");
}

function fakeTimers() {
  let now = 0;
  const due: { at: number; fn: () => void }[] = [];
  return {
    timers: { now: () => now, later: (fn: () => void, ms: number) => due.push({ at: now + ms, fn }) },
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        due.sort((a, b) => a.at - b.at);
        const next = due[0];
        if (!next || next.at > end) break;
        due.shift();
        now = next.at;
        next.fn();
      }
      now = end;
    },
  };
}

function setup() {
  const labels: string[] = [];
  const said: string[] = [];
  const t = fakeTimers();
  const a = new Announcer({ label: (s) => labels.push(s), say: (s) => said.push(s) }, t.timers);
  return { a, labels, said, t };
}

describe("canvas label (R5)", () => {
  it("names the game and the screen", () => {
    expect(canvasLabel("title", null)).toBe("Compass: Cardinal Clash, title screen");
    expect(canvasLabel("select", "cpu")).toBe("Compass: Cardinal Clash, VS CPU character select");
    expect(canvasLabel("fight", "versus", "Julien H. versus Felicia G.")).toBe("Compass: Cardinal Clash, fight: Julien H. versus Felicia G.");
    expect(canvasLabel("pause", "versus", "Julien H. versus Felicia G.")).toBe("Compass: Cardinal Clash, paused: Julien H. versus Felicia G.");
  });

  it("changes at once with every scene, without waiting for the throttle", () => {
    const { a, labels } = setup();
    a.scene("title", null);
    a.scene("select", "versus");
    a.scene("versus", "versus", "Julien H. versus Felicia G.");
    a.scene("fight", "versus", "Julien H. versus Felicia G.");
    expect(labels).toEqual([
      "Compass: Cardinal Clash, title screen",
      "Compass: Cardinal Clash, VS player character select",
      "Compass: Cardinal Clash, versus: Julien H. versus Felicia G.",
      "Compass: Cardinal Clash, fight: Julien H. versus Felicia G.",
    ]);
  });
});

describe("messages (R5)", () => {
  it("screen changes: pause and resume, rematch, nothing extra when a fight starts", () => {
    expect(sceneMessage("title", null, null)).toBe("Title screen.");
    expect(sceneMessage("select", "title", "cpu")).toBe("VS CPU: character select.");
    expect(sceneMessage("versus", "select", "versus", "Julien H. versus Felicia G.")).toBe("Julien H. versus Felicia G.");
    expect(sceneMessage("fight", "versus", "versus", "x")).toBeNull();
    expect(sceneMessage("pause", "fight", "versus", "x")).toBe("Paused.");
    expect(sceneMessage("fight", "pause", "versus", "x")).toBe("Resumed.");
    expect(sceneMessage("pause", "controls", "versus", "x")).toBeNull();
    expect(sceneMessage("fight", "results", "versus", "x")).toBe("Rematch.");
    expect(sceneMessage("results", "fight", "versus", "player 1, Julien H., wins 2 to 0")).toBe("Results: player 1, Julien H., wins 2 to 0.");
  });

  it("fight moments: round, Fight, K.O., the round and match winners; hits are not announced", () => {
    const s = match();
    const say = (events: SimEvent[]) => eventMessages(events, s, NAMES, false);
    expect(say([{ type: "round_start", round: 1 }])).toEqual(["Round 1."]);
    expect(say([{ type: "fight" }])).toEqual(["Fight!"]);
    expect(
      say([
        { type: "hit", player: 0, target: 1, move: "light_punch", strength: "light", x: 0, y: 0, damage: 30, combo: 1 },
        { type: "block", player: 1, target: 0, move: "light_punch", strength: "light", x: 0, y: 0 },
        { type: "jump", player: 0, dir: 1 },
      ] as SimEvent[]),
    ).toEqual([]);
    expect(say([{ type: "ko", player: 1, x: 0, y: 0 }, { type: "round_end", winner: 0, reason: "ko" }])).toEqual(["K.O.!", "Julien H. wins round 1."]);
    s.round.number = 2;
    expect(say([{ type: "round_end", winner: 1, reason: "time" }])).toEqual(["Time! Felicia G. wins round 2."]);
    expect(say([{ type: "round_end", winner: 2, reason: "time" }])).toEqual(["Time! Round 2 is a draw."]);
    s.round.wins = [1, 2];
    expect(say([{ type: "match_end", winner: 1 }])).toEqual(["Felicia G. wins the match, 2 to 1!"]);
  });

  it("names players by side in a mirror match, and the CPU as the CPU", () => {
    expect(playerWords(0, NAMES, true)).toBe("Julien H.");
    expect(playerWords(1, ["Julien H.", "Julien H."], false)).toBe("player 2");
    expect(playerWords(1, ["Julien H.", "Julien H."], true)).toBe("the CPU");
    const s = createMatchState(1, "julien-hovan", "julien-hovan");
    expect(eventMessages([{ type: "match_end", winner: 1 }], s, ["Julien H.", "Julien H."], true)[0]).toMatch(/^The CPU wins the match/);
  });
});

describe("throttle (R5)", () => {
  it("says the first message at once and spaces the rest GAP_MS apart", () => {
    const { a, said, t } = setup();
    a.scene("versus", "versus", "Julien H. versus Felicia G.");
    a.scene("fight", "versus", "Julien H. versus Felicia G.");
    const s = match();
    a.simEvents([{ type: "round_start", round: 1 }], s);
    expect(said).toEqual(["Julien H. versus Felicia G."]);
    t.advance(GAP_MS - 1);
    expect(said).toHaveLength(1);
    t.advance(1);
    expect(said).toEqual(["Julien H. versus Felicia G.", "Round 1."]);
    a.simEvents([{ type: "fight" }], s);
    t.advance(GAP_MS);
    expect(said.at(-1)).toBe("Fight!");
  });

  it("never floods: a burst keeps only the newest MAX_QUEUE messages, and repeats collapse", () => {
    const { a, said, t } = setup();
    a.push("first");
    for (let i = 0; i < 20; i++) a.push(`burst ${i}`);
    a.push("burst 19");
    expect(a.pending).toHaveLength(MAX_QUEUE);
    t.advance(GAP_MS * 30);
    expect(said).toEqual(["first", "burst 16", "burst 17", "burst 18", "burst 19"]);
  });

  it("fast pause and resume toggles say only the newest screen", () => {
    const { a, said, t } = setup();
    a.push("Round 1.");
    a.scene("fight", "versus", "x"); // from nothing: silent
    a.scene("pause", "versus", "x");
    a.scene("fight", "versus", "x");
    a.scene("pause", "versus", "x");
    a.scene("fight", "versus", "x");
    t.advance(GAP_MS * 10);
    expect(said).toEqual(["Round 1.", "Resumed."]);
  });

  it("feeds sim events through the hooks with the fighters' names", () => {
    const { a, said } = setup();
    a.scene("fight", "versus", "Julien H. versus Felicia G.");
    a.simEvents([], match()); // most steps: nothing
    a.simEvents([{ type: "round_end", winner: 1, reason: "ko" }], match());
    expect(said).toEqual(["Felicia G. wins round 1."]);
  });
});
