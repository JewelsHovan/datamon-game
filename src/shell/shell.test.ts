// Spec 014: the fullscreen toggle (R4) and the failure screen (R6), against small fake documents.
import { describe, expect, it } from "vitest";
import { AssetLoadError, failureDetail, showFailure } from "./failure";
import { createFullscreen } from "./fullscreen";

function fakeFullscreenDoc(enabled: boolean | undefined) {
  const calls: string[] = [];
  const root = {
    requestFullscreen: async () => {
      calls.push("request");
      doc.fullscreenElement = root;
    },
  };
  const doc = {
    fullscreenEnabled: enabled,
    fullscreenElement: null as unknown,
    documentElement: root,
    exitFullscreen: async () => {
      calls.push("exit");
      doc.fullscreenElement = null;
    },
  };
  return { doc: doc as unknown as Document, calls };
}

describe("fullscreen (R4)", () => {
  it("toggles the page in and out of fullscreen", async () => {
    const { doc, calls } = fakeFullscreenDoc(true);
    const fs = createFullscreen(doc);
    expect(fs.enabled).toBe(true);
    expect(await fs.toggle()).toBe(true);
    expect(fs.active).toBe(true);
    expect(await fs.toggle()).toBe(false);
    expect(calls).toEqual(["request", "exit"]);
  });

  it("is disabled, and does nothing, where the API is missing or not allowed", async () => {
    for (const enabled of [false, undefined]) {
      const { doc, calls } = fakeFullscreenDoc(enabled);
      const fs = createFullscreen(doc);
      expect(fs.enabled).toBe(false);
      expect(await fs.toggle()).toBe(false);
      expect(calls).toEqual([]);
    }
  });

  it("a refused request (no user gesture) resolves instead of throwing", async () => {
    const { doc } = fakeFullscreenDoc(true);
    (doc.documentElement as unknown as { requestFullscreen: () => Promise<void> }).requestFullscreen = () => Promise.reject(new TypeError("Permissions check failed"));
    const warn = console.warn;
    console.warn = () => {};
    try {
      expect(await createFullscreen(doc).toggle()).toBe(false);
    } finally {
      console.warn = warn;
    }
  });
});

function fakeFailureDoc() {
  const el = (id: string) => ({ id, hidden: id === "failure", textContent: "", focused: false, attrs: {} as Record<string, string>, focus() { this.focused = true; }, setAttribute(k: string, v: string) { this.attrs[k] = v; } });
  const nodes = Object.fromEntries(["failure", "failure-detail", "failure-reload", "game"].map((id) => [id, el(id)]));
  return { doc: { getElementById: (id: string) => nodes[id] ?? null } as unknown as Document, nodes };
}

describe("failure screen (R6)", () => {
  it("says what did not load when it knows", () => {
    expect(failureDetail(new AssetLoadError("Julien H.'s fighter art"))).toBe("Julien H.'s fighter art did not load. Check your connection, then reload.");
    expect(failureDetail(new AssetLoadError("the effects"))).toBe("The effects did not load. Check your connection, then reload.");
    expect(failureDetail(new TypeError("x is undefined"))).toBe("Something it needs did not load. Check your connection, then reload.");
  });

  it("shows the screen, fills the detail and focuses Reload", () => {
    const { doc, nodes } = fakeFailureDoc();
    expect(showFailure(doc, new AssetLoadError("the pixel font"))).toBe(true);
    expect(nodes.failure!.hidden).toBe(false);
    expect(nodes["failure-detail"]!.textContent).toBe("The pixel font did not load. Check your connection, then reload.");
    expect(nodes["failure-reload"]!.focused).toBe(true);
    expect(nodes.game!.attrs["aria-hidden"]).toBe("true");
  });

  it("returns false without the markup", () => {
    expect(showFailure({ getElementById: () => null } as unknown as Document, null)).toBe(false);
  });
});
