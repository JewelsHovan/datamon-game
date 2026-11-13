// Failure screen (spec 014, R6): when the game cannot load what it needs (a
// fighter's atlas, the effects, the font) or throws while starting, the page
// shows a readable message in the menus' style with a Reload button instead of
// a black or half-drawn canvas. The markup lives in index.html (#failure), so
// the small inline script there can show it too when the game's own script
// never loads.

/** A load failure with words for the player, e.g. new AssetLoadError("Julien H.'s fighter art", err). */
export class AssetLoadError extends Error {
  constructor(
    readonly what: string,
    cause?: unknown,
  ) {
    super(`could not load ${what}`, { cause });
    this.name = "AssetLoadError";
  }
}

/** The detail line under the title: what failed, when known, and what to do. */
export function failureDetail(err: unknown): string {
  const what = err instanceof AssetLoadError ? `${err.what} did not load` : "Something it needs did not load";
  return `${what.charAt(0).toUpperCase()}${what.slice(1)}. Check your connection, then reload.`;
}

/** Shows the failure screen (once) and moves focus to its Reload button. Returns false without the markup. */
export function showFailure(doc: Document, err: unknown): boolean {
  const screen = doc.getElementById("failure");
  if (!screen) return false;
  if (!screen.hidden) return true;
  const detail = doc.getElementById("failure-detail");
  if (detail) detail.textContent = failureDetail(err);
  screen.hidden = false;
  // The canvas behind is covered; keep assistive tech on the message.
  doc.getElementById("game")?.setAttribute("aria-hidden", "true");
  doc.getElementById("failure-reload")?.focus();
  return true;
}
