import { describe, expect, it } from "vitest";
import { DEFAULT_P1, DEFAULT_P2, DEFAULT_SEED, matchFromPick, pickFighters } from "./fight";

describe("fight URL params (spec 001 R7, spec 005 shortcuts)", () => {
  it("defaults to a julien-hovan mirror match, and no URL means no direct fight", () => {
    const warnings: string[] = [];
    const pick = pickFighters("", (m) => warnings.push(m));
    expect([pick.p1.slug, pick.p2.slug]).toEqual([DEFAULT_P1, DEFAULT_P2]);
    expect(DEFAULT_P1).toBe("julien-hovan");
    expect(DEFAULT_P2).toBe("julien-hovan");
    expect(pick.seed).toBe(DEFAULT_SEED);
    expect(pick.direct).toBe(false);
    expect(warnings).toEqual([]);
  });

  it("?p1 and ?p2 pick the fighters and start a versus fight directly", () => {
    const pick = pickFighters("?p1=jewoo-lee&p2=veronica-marallag", () => {});
    expect([pick.p1.slug, pick.p2.slug]).toEqual(["jewoo-lee", "veronica-marallag"]);
    expect(pick.direct).toBe(true);
    expect(matchFromPick(pick).mode).toBe("versus");
  });

  it("an unknown slug falls back to the default with a warning", () => {
    const warnings: string[] = [];
    const pick = pickFighters("?p1=nobody&p2=classic-cyan", (m) => warnings.push(m));
    expect([pick.p1.slug, pick.p2.slug]).toEqual([DEFAULT_P1, DEFAULT_P2]);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("nobody");
  });

  it("?seed sets the sim seed", () => {
    expect(pickFighters("?seed=42", () => {}).seed).toBe(42);
  });

  it("?mode=training starts training directly", () => {
    const pick = pickFighters("?mode=training", () => {});
    expect(pick.direct).toBe(true);
    expect(matchFromPick(pick)).toMatchObject({ mode: "training", cpuLevel: null });
  });

  it("?cpu=easy|normal|hard starts a VS CPU fight with P2 as the CPU", () => {
    for (const level of ["easy", "normal", "hard"] as const) {
      const pick = pickFighters(`?cpu=${level}`, () => {});
      expect(pick.direct).toBe(true);
      expect(matchFromPick(pick)).toMatchObject({ mode: "cpu", cpuLevel: level });
    }
    const warnings: string[] = [];
    const odd = pickFighters("?cpu=nightmare", (m) => warnings.push(m));
    expect(odd.cpu).toBe("normal");
    expect(warnings[0]).toContain("nightmare");
  });
});
