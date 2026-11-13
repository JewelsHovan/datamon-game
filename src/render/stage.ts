// The stage (spec 009): painted parallax layers generated through the art pipeline
// (public/stages/<id>/), coworkers walking past in front of the furniture (darkened, behind the fighters), a dimming
// pass that keeps fighters readable, and a code-drawn floor on the sim's floor line.
// Everything it draws is named by public/stages/<id>/manifest.json (spec 013): the layer files
// and the walker strip, whose cast and frames the art pipeline chose (art/pipeline/stage.py).
// Falls back to the original gradient until the stage has loaded. drawStage keeps its
// spec 001 signature; call stageReact("ko", x) on a K.O. so the walkers stop and watch.
import { MOVEMENT } from "../data/movement";
import { SUBPX } from "../sim/fixed";
import { STAGE_WIDTH_PX, type Camera } from "./camera";
import { artUrl, browserClipDeps, type AtlasImage, type ClipLoaderDeps } from "./clips";
import { createWalkers, stepWalkers, type WalkerState } from "./stageWalkers";
import { VIEW_HEIGHT, VIEW_WIDTH } from "./screen";

export const FLOOR_Y_PX = MOVEMENT.floorY / SUBPX;
const MARKER_SPACING = 80;
export const STAGE_ID = "office";
const WALKER_COUNT = 4;
/** Feet of the walkers in mid-layer pixels (just behind the desks' floor line). */
const WALKER_FLOOR = 308;

/** A frame in the walker strip, already at walker scale; (ax, ay) is the feet center on the floor. */
export interface WalkerFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  ax: number;
  ay: number;
}

export interface StageManifest {
  version: number;
  floorColor: string;
  layers: { id: string; file: string; w: number; factor: number; y: number }[];
  /** The walker strip: one entry per cast member, four right-facing walk frames each; `stand` is the standing frame. */
  walkers: { file: string; stand: number; cast: { slug: string; frames: WalkerFrame[] }[] } | null;
}

interface Layer {
  img: AtlasImage;
  factor: number;
  y: number;
}

export interface StageArt {
  layers: Layer[];
  floorColor: string;
  midWidth: number;
  walkers: { strip: AtlasImage; stand: number; cast: { slug: string; frames: WalkerFrame[] }[] } | null;
}

interface Stage extends StageArt {
  /** The walker strip darkened once, so background people sit behind the fighters in depth. */
  dimmed: HTMLCanvasElement | null;
  walkerState: WalkerState | null;
}

let stage: Stage | null = null;
let loading = false;
let pendingKo: number | null = null;
let sky: CanvasGradient | null = null;
let skyCtx: CanvasRenderingContext2D | null = null;
let frame = 0;

/** What the last drawn stage frame showed (browser checks read it through `window.__game.info()`). */
export interface StageInfo {
  loaded: boolean;
  cameraX: number;
  /** Layer offsets in px, far to near (parallax: each layer shifts by its own amount). */
  layerOffsets: number[];
  /** Walkers on the mid layer: screen x of their feet, and whether they stopped to watch a K.O. */
  walkers: { screenX: number; onScreen: boolean; watching: boolean }[];
}
let lastInfo: StageInfo = { loaded: false, cameraX: 0, layerOffsets: [], walkers: [] };

export function stageInfo(): StageInfo {
  return { ...lastInfo, layerOffsets: [...lastInfo.layerOffsets], walkers: lastInfo.walkers.map((w) => ({ ...w })) };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isFile = (v: unknown): v is string => typeof v === "string" && /^[\w.-]+$/.test(v);

function parseWalkerFrame(f: unknown): WalkerFrame | null {
  if (!isRecord(f)) return null;
  const { x, y, w, h, ax, ay } = f;
  if (![x, y, w, h, ax, ay].every(isNum) || (w as number) <= 0 || (h as number) <= 0) return null;
  return { x, y, w, h, ax, ay } as WalkerFrame;
}

/** Validates the stage manifest the art pipeline writes; null when it is unusable. A bad walkers block only drops the walkers. */
export function parseStageManifest(data: unknown): StageManifest | null {
  if (!isRecord(data) || !Array.isArray(data.layers) || typeof data.floorColor !== "string") return null;
  const layers: StageManifest["layers"] = [];
  for (const l of data.layers) {
    if (!isRecord(l) || typeof l.id !== "string" || !isFile(l.file) || !isNum(l.w) || !isNum(l.factor) || !isNum(l.y)) return null;
    layers.push({ id: l.id, file: l.file, w: l.w, factor: l.factor, y: l.y });
  }
  if (layers.length === 0) return null;
  let walkers: StageManifest["walkers"] = null;
  const wk = data.walkers;
  if (isRecord(wk) && isFile(wk.file) && Array.isArray(wk.cast)) {
    const cast: { slug: string; frames: WalkerFrame[] }[] = [];
    for (const c of wk.cast) {
      if (!isRecord(c) || typeof c.slug !== "string" || !Array.isArray(c.frames)) continue;
      const frames = c.frames.map(parseWalkerFrame);
      if (frames.length > 0 && frames.every((f) => f !== null)) cast.push({ slug: c.slug, frames: frames as WalkerFrame[] });
    }
    if (cast.length > 0) walkers = { file: wk.file, stand: isNum(wk.stand) ? wk.stand : 0, cast };
  }
  return { version: isNum(data.version) ? data.version : 0, floorColor: data.floorColor, layers, walkers };
}

/** Loads the stage's layers and walker strip, every file named by the stage manifest. */
export async function loadStageArt(
  deps: Pick<ClipLoaderDeps, "fetchJson" | "loadImage"> = browserClipDeps(),
  id = STAGE_ID,
): Promise<StageArt | null> {
  const dir = `./stages/${id}`;
  const m = parseStageManifest(await deps.fetchJson(`${dir}/manifest.json`));
  if (!m) return null;
  const url = (file: string) => artUrl(dir, file, m.version);
  const [layers, strip] = await Promise.all([
    Promise.all(m.layers.map(async (l) => ({ img: await deps.loadImage(url(l.file)), factor: l.factor, y: l.y }))),
    m.walkers ? deps.loadImage(url(m.walkers.file)).catch(() => null) : Promise.resolve(null),
  ]);
  const mid = m.layers.find((l) => l.factor > 0.5) ?? m.layers[m.layers.length - 1]!;
  return {
    layers,
    floorColor: m.floorColor,
    midWidth: mid.w,
    walkers: m.walkers && strip ? { strip, stand: m.walkers.stand, cast: m.walkers.cast } : null,
  };
}

async function load(): Promise<void> {
  const art = await loadStageArt();
  if (!art) return;
  const castSize = art.walkers?.cast.length ?? 0;
  stage = {
    ...art,
    dimmed: null,
    walkerState: castSize ? createWalkers(20261112, WALKER_COUNT, art.midWidth, castSize) : null,
  };
}

/** Lets walkers react: on a K.O. at stage x (subpixels) they stop and face the fight. */
export function stageReact(kind: "ko", xSubpx: number): void {
  if (kind === "ko") pendingKo = xSubpx;
}

/** The walker strip darkened once (made on first draw), so background people sit behind the fighters in depth. */
function dimmedStrip(s: Stage, strip: AtlasImage): HTMLCanvasElement {
  if (!s.dimmed) {
    const c = document.createElement("canvas");
    c.width = strip.width;
    c.height = strip.height;
    const g = c.getContext("2d")!;
    g.drawImage(strip, 0, 0);
    g.globalCompositeOperation = "source-atop";
    g.fillStyle = "rgba(24, 18, 48, 0.5)";
    g.fillRect(0, 0, c.width, c.height);
    s.dimmed = c;
  }
  return s.dimmed;
}

/** Resolves a walker's cast index, stepping past any slug in `activeFighters` so fighters never appear in the background; returns -1 if every cast member is excluded. */
export function resolveWalkerCastIndex(
  who: number,
  cast: readonly { slug: string }[],
  activeFighters?: readonly string[],
): number {
  const n = cast.length;
  if (n === 0) return -1;
  const base = ((who % n) + n) % n;
  if (!activeFighters || activeFighters.length === 0) return base;
  for (let offset = 0; offset < n; offset++) {
    const idx = (base + offset) % n;
    if (!activeFighters.includes(cast[idx]!.slug)) return idx;
  }
  return -1;
}

function drawWalkers(ctx: CanvasRenderingContext2D, camera: Camera, mid: Layer, activeFighters?: readonly string[]): void {
  const s = stage!;
  const art = s.walkers;
  if (!s.walkerState || !art) return;
  const ko = pendingKo === null ? null : (pendingKo / SUBPX) * mid.factor;
  pendingKo = null;
  stepWalkers(s.walkerState, art.cast.length, ko);
  const offset = Math.round(camera.x * mid.factor);
  const sheet = dimmedStrip(s, art.strip);
  lastInfo.walkers = [];
  for (const w of s.walkerState.walkers) {
    if (w.wait > 0) continue;
    const castIdx = resolveWalkerCastIndex(w.who, art.cast, activeFighters);
    if (castIdx < 0) continue;
    const feetX = Math.round(w.x) - offset;
    lastInfo.walkers.push({ screenX: feetX, onScreen: feetX > -20 && feetX < VIEW_WIDTH + 20, watching: w.watching > 0 });
    const frames = art.cast[castIdx]!.frames;
    const walking = w.watching === 0;
    // Walking cycles the four frames; watching a K.O. shows the standing frame.
    const fr = frames[walking ? Math.floor(w.steps / 9) % frames.length : Math.min(art.stand, frames.length - 1)]!;
    const faceRight = (walking ? w.dir : w.watchDir) === 1;
    const sy = WALKER_FLOOR + mid.y - camera.y;
    ctx.save();
    ctx.translate(feetX, sy);
    if (!faceRight) ctx.scale(-1, 1); // the strip's frames face right
    ctx.drawImage(sheet, fr.x, fr.y, fr.w, fr.h, -fr.ax, -fr.ay, fr.w, fr.h);
    ctx.restore();
  }
}

/** Little lit windows in the skyline that blink on and off (render-time ambience). */
function drawCityLights(ctx: CanvasRenderingContext2D, camera: Camera, far: Layer): void {
  const offset = Math.round(camera.x * far.factor);
  for (let i = 0; i < 26; i++) {
    const seed = Math.imul(i + 1, 2654435761) >>> 0;
    const x = (seed % 860) - offset;
    const y = 120 + ((seed >>> 10) % 110);
    const period = 90 + ((seed >>> 4) % 200);
    if ((frame + (seed % period)) % period < period * 0.55) {
      ctx.fillStyle = (seed & 1) === 0 ? "rgba(255, 214, 140, 0.85)" : "rgba(255, 240, 200, 0.7)";
      ctx.fillRect(x, y - camera.y, 1, 1);
    }
  }
}

function drawFloor(ctx: CanvasRenderingContext2D, camera: Camera, color: string): void {
  const y = FLOOR_Y_PX - camera.y;
  ctx.fillStyle = color;
  ctx.fillRect(0, y, VIEW_WIDTH, VIEW_HEIGHT - y + 8);
  // Polished boards: lines that scroll with the camera, a warm reflection near the edge.
  ctx.fillStyle = "rgba(255, 196, 140, 0.18)";
  ctx.fillRect(0, y, VIEW_WIDTH, 1);
  ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
  const first = Math.floor(camera.x / 64) * 64;
  for (let x = first; x <= camera.x + VIEW_WIDTH + 64; x += 64) ctx.fillRect(x - camera.x, y + 1, 1, VIEW_HEIGHT - y);
  ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
  ctx.fillRect(0, y + 14, VIEW_WIDTH, 1);
  ctx.fillRect(0, y + 28, VIEW_WIDTH, 1);
}

function drawFallback(ctx: CanvasRenderingContext2D, camera: Camera): void {
  if (sky === null || skyCtx !== ctx) {
    sky = ctx.createLinearGradient(0, 0, 0, FLOOR_Y_PX);
    sky.addColorStop(0, "#1b2a4a");
    sky.addColorStop(0.6, "#3d5a8a");
    sky.addColorStop(1, "#9fb8d8");
    skyCtx = ctx;
  }
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, VIEW_WIDTH, FLOOR_Y_PX);
  ctx.fillStyle = "#3a3346";
  ctx.fillRect(0, FLOOR_Y_PX, VIEW_WIDTH, VIEW_HEIGHT - FLOOR_Y_PX);
  ctx.fillStyle = "#e8e0c8";
  ctx.fillRect(0, FLOOR_Y_PX, VIEW_WIDTH, 1);
  ctx.fillStyle = "#5c5470";
  const first = Math.ceil(camera.x / MARKER_SPACING) * MARKER_SPACING;
  for (let x = first; x <= camera.x + VIEW_WIDTH; x += MARKER_SPACING) {
    const sx = x - camera.x;
    const tall = x === STAGE_WIDTH_PX / 2;
    ctx.fillRect(sx, FLOOR_Y_PX + 2, 1, tall ? 12 : 6);
  }
}

export function drawStage(ctx: CanvasRenderingContext2D, camera: Camera, activeFighters?: readonly string[]): void {
  frame += 1;
  if (!stage) {
    if (!loading && typeof document !== "undefined") {
      loading = true;
      load().catch((err: unknown) => console.warn(String(err)));
    }
    drawFallback(ctx, camera);
    return;
  }
  const [far, ...rest] = stage.layers;
  lastInfo = { loaded: true, cameraX: camera.x, layerOffsets: [...stage.layers.map((l) => Math.round(camera.x * l.factor)), camera.x], walkers: lastInfo.walkers };
  if (far) {
    ctx.drawImage(far.img, -Math.round(camera.x * far.factor), far.y - camera.y);
    drawCityLights(ctx, camera, far);
  }
  const mid = rest[rest.length - 1];
  if (mid) {
    for (const l of rest) ctx.drawImage(l.img, -Math.round(camera.x * l.factor), l.y - camera.y);
    // In front of the furniture (behind it they were hidden by desks and monitors), darkened and behind the fighters.
    drawWalkers(ctx, camera, mid, activeFighters);
  }
  // Lower the background's contrast so fighters read first.
  ctx.fillStyle = "rgba(16, 12, 40, 0.24)";
  ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
  drawFloor(ctx, camera, stage.floorColor);
}
