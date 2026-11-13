// The 640x360 internal canvas, scaled to fit the window and letterboxed.
// Desktop: the largest integer factor that fits (fractional only below
// 640x360). Touch devices (spec 015): a fractional scale that fills the safe
// area, so a phone in landscape uses its whole height. The canvas always stays
// inside the safe area (notches, the home indicator). In portrait on a touch
// device a "rotate your device" screen covers the game.

export const VIEW_WIDTH = 640;
export const VIEW_HEIGHT = 360;

export interface ScreenFit {
  scale: number;
  cssWidth: number;
  cssHeight: number;
  left: number;
  top: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: Insets = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

export interface FitOptions {
  /** Fill the safe area with a fractional scale (touch devices); otherwise whole-number scales. */
  fractional?: boolean;
  /** Safe-area insets the canvas stays inside. */
  insets?: Insets;
}

export function fitScreen(windowWidth: number, windowHeight: number, options: FitOptions = {}): ScreenFit {
  const ins = options.insets ?? NO_INSETS;
  const width = Math.max(1, windowWidth - ins.left - ins.right);
  const height = Math.max(1, windowHeight - ins.top - ins.bottom);
  const fit = Math.min(width / VIEW_WIDTH, height / VIEW_HEIGHT);
  const scale = fit >= 1 && !options.fractional ? Math.floor(fit) : fit;
  const cssWidth = VIEW_WIDTH * scale;
  const cssHeight = VIEW_HEIGHT * scale;
  return {
    scale,
    cssWidth,
    cssHeight,
    left: ins.left + Math.floor((width - cssWidth) / 2),
    top: ins.top + Math.floor((height - cssHeight) / 2),
  };
}

/** The rotate screen shows on touch devices held in portrait. */
export function needsRotate(width: number, height: number, touch: boolean): boolean {
  return touch && height > width;
}

/** The page's size and safe-area insets at the last fit. */
export interface ViewInfo {
  width: number;
  height: number;
  insets: Insets;
}

export interface ScreenOptions {
  /** True on a touch device: fractional fill, and the rotate screen in portrait. */
  touch?: () => boolean;
  /** The "rotate your device" element. */
  rotateScreen?: HTMLElement | null;
  /** Runs after every fit (the touch controls lay out here). */
  onFit?(fit: ScreenFit, view: ViewInfo): void;
  /** The rotate screen appeared (true) or went away (false). */
  onRotate?(showing: boolean): void;
}

export interface Screen {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  fit: ScreenFit;
  view: ViewInfo;
  /** The rotate screen is showing. */
  rotating: boolean;
  /** Fits again (the window, the insets or the touch state changed). */
  refit(): void;
  dispose(): void;
}

/** Reads env(safe-area-inset-*) through a hidden probe element. */
function insetReader(doc: Document): () => Insets {
  const probe = doc.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText =
    "position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;" +
    "padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)";
  doc.body.appendChild(probe);
  const view = doc.defaultView;
  return () => {
    const cs = view?.getComputedStyle(probe);
    if (!cs) return NO_INSETS;
    const px = (v: string) => Math.max(0, parseFloat(v) || 0);
    return { top: px(cs.paddingTop), right: px(cs.paddingRight), bottom: px(cs.paddingBottom), left: px(cs.paddingLeft) };
  };
}

export function createScreen(canvas: HTMLCanvasElement, win: Window = window, options: ScreenOptions = {}): Screen {
  canvas.width = VIEW_WIDTH;
  canvas.height = VIEW_HEIGHT;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.imageSmoothingEnabled = false;
  const insets = insetReader(win.document);
  const touch = options.touch ?? (() => false);

  const screen: Screen = {
    canvas,
    ctx,
    fit: fitScreen(win.innerWidth, win.innerHeight),
    view: { width: win.innerWidth, height: win.innerHeight, insets: NO_INSETS },
    rotating: false,
    refit: apply,
    dispose: () => {
      win.removeEventListener("resize", apply);
      win.removeEventListener("orientationchange", apply);
    },
  };

  function apply(): void {
    const view: ViewInfo = { width: win.innerWidth, height: win.innerHeight, insets: insets() };
    const fit = fitScreen(view.width, view.height, { fractional: touch(), insets: view.insets });
    screen.fit = fit;
    screen.view = view;
    canvas.style.width = `${fit.cssWidth}px`;
    canvas.style.height = `${fit.cssHeight}px`;
    canvas.style.left = `${fit.left}px`;
    canvas.style.top = `${fit.top}px`;
    // Resizing can reset context state in some browsers.
    ctx!.imageSmoothingEnabled = false;
    options.onFit?.(fit, view);
    const rotating = needsRotate(view.width, view.height, touch());
    if (options.rotateScreen) options.rotateScreen.hidden = !rotating;
    if (rotating !== screen.rotating) {
      screen.rotating = rotating;
      options.onRotate?.(rotating);
    }
  }

  apply();
  win.addEventListener("resize", apply);
  // iOS can report the old size on orientationchange; the resize that follows fits again.
  win.addEventListener("orientationchange", apply);
  return screen;
}

type LockableOrientation = ScreenOrientation & { lock?: (orientation: string) => Promise<void> };

/**
 * Going fullscreen also locks landscape where the browser allows it (Android
 * Chrome). Listens for fullscreenchange, so it works whichever code requests
 * fullscreen. Browsers without the lock (desktop, iOS) reject quietly.
 */
export function lockLandscapeOnFullscreen(doc: Document = document): () => void {
  const onChange = () => {
    if (!doc.fullscreenElement) return;
    const orientation = doc.defaultView?.screen?.orientation as LockableOrientation | undefined;
    if (typeof orientation?.lock !== "function") return;
    try {
      orientation.lock("landscape").catch(() => {});
    } catch {
      // Some browsers throw synchronously instead of rejecting.
    }
  };
  doc.addEventListener("fullscreenchange", onChange);
  return () => doc.removeEventListener("fullscreenchange", onChange);
}
