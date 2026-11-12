import { describe, expect, it } from "vitest";
import { DEFAULT_P1, DEFAULT_P2, DEFAULT_SEED, pickFighters } from "./sandbox";

describe("sandbox URL params (R7)", () => {
  it("defaults to julien-hovan vs felicia-gorgacheva", () => {
    const warnings: string[] = [];
    const pick = pickFighters("", (m) => warnings.push(m));
    expect([pick.p1.slug, pick.p2.slug]).toEqual([DEFAULT_P1, DEFAULT_P2]);
    expect(DEFAULT_P1).toBe("julien-hovan");
    expect(DEFAULT_P2).toBe("felicia-gorgacheva");
    expect(pick.seed).toBe(DEFAULT_SEED);
    expect(warnings).toEqual([]);
  });

  it("?p1 and ?p2 pick the fighters", () => {
    const pick = pickFighters("?p1=jewoo-lee&p2=veronica-marallag", () => {});
    expect([pick.p1.slug, pick.p2.slug]).toEqual(["jewoo-lee", "veronica-marallag"]);
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
});
