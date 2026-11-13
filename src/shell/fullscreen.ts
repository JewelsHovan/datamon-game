// Fullscreen (spec 014, R4): the FULLSCREEN item on the title and pause menus
// and a double-click on the canvas toggle it through the Fullscreen API. The
// whole page goes fullscreen (not just the canvas), so anything laid over the
// canvas comes along. Where the API is missing or not allowed, `enabled` is
// false and the menus leave the item out. Safari before 16.4 only has the
// webkit-prefixed calls.

export interface FullscreenControl {
  /** The page may go fullscreen (document.fullscreenEnabled). */
  readonly enabled: boolean;
  /** The page is fullscreen right now. */
  readonly active: boolean;
  /** Enters or leaves fullscreen. Resolves to whether the page is fullscreen afterwards; never rejects. */
  toggle(): Promise<boolean>;
}

type PrefixedDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type PrefixedElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

export function createFullscreen(doc: Document, target: HTMLElement = doc.documentElement): FullscreenControl {
  const d = doc as PrefixedDocument;
  const el = target as PrefixedElement;
  const current = (): Element | null => d.fullscreenElement ?? d.webkitFullscreenElement ?? null;
  const control: FullscreenControl = {
    get enabled() {
      const allowed = d.fullscreenEnabled ?? d.webkitFullscreenEnabled ?? false;
      return allowed === true && (typeof el.requestFullscreen === "function" || typeof el.webkitRequestFullscreen === "function");
    },
    get active() {
      return current() !== null;
    },
    async toggle() {
      if (!control.enabled) return false;
      try {
        if (current()) {
          await (typeof d.exitFullscreen === "function" ? d.exitFullscreen() : d.webkitExitFullscreen?.());
        } else {
          // Must run within a user gesture's activation window: the menus step right after the key press.
          await (typeof el.requestFullscreen === "function" ? el.requestFullscreen({ navigationUI: "hide" }) : el.webkitRequestFullscreen?.());
        }
      } catch (err) {
        console.warn("Fullscreen request refused", err);
      }
      return current() !== null;
    },
  };
  return control;
}
