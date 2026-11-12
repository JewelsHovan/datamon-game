// The 640x360 internal canvas, scaled by the largest integer factor that fits
// the window and letterboxed. Fractional scaling only below 640x360.

export const VIEW_WIDTH = 640;
export const VIEW_HEIGHT = 360;

export interface ScreenFit {
  scale: number;
  cssWidth: number;
  cssHeight: number;
  left: number;
  top: number;
}

export function fitScreen(windowWidth: number, windowHeight: number): ScreenFit {
  const fit = Math.min(windowWidth / VIEW_WIDTH, windowHeight / VIEW_HEIGHT);
  const scale = fit >= 1 ? Math.floor(fit) : fit;
  const cssWidth = VIEW_WIDTH * scale;
  const cssHeight = VIEW_HEIGHT * scale;
  return {
    scale,
    cssWidth,
    cssHeight,
    left: Math.floor((windowWidth - cssWidth) / 2),
    top: Math.floor((windowHeight - cssHeight) / 2),
  };
}

export interface Screen {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  fit: ScreenFit;
  dispose(): void;
}

export function createScreen(canvas: HTMLCanvasElement, win: Window = window): Screen {
  canvas.width = VIEW_WIDTH;
  canvas.height = VIEW_HEIGHT;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.imageSmoothingEnabled = false;

  const screen: Screen = {
    canvas,
    ctx,
    fit: fitScreen(win.innerWidth, win.innerHeight),
    dispose: () => win.removeEventListener("resize", apply),
  };

  function apply(): void {
    const fit = fitScreen(win.innerWidth, win.innerHeight);
    screen.fit = fit;
    canvas.style.width = `${fit.cssWidth}px`;
    canvas.style.height = `${fit.cssHeight}px`;
    canvas.style.left = `${fit.left}px`;
    canvas.style.top = `${fit.top}px`;
    // Resizing can reset context state in some browsers.
    ctx!.imageSmoothingEnabled = false;
  }

  apply();
  win.addEventListener("resize", apply);
  return screen;
}
