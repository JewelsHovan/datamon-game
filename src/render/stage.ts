// The stage (spec 009): painted parallax layers generated through the art pipeline
// (public/stages/<id>/), coworkers walking past in front of the furniture (darkened, behind the fighters), a dimming
// pass that keeps fighters readable, and a code-drawn floor on the sim's floor line.
// Falls back to the original gradient until the stage has loaded. drawStage keeps its
// spec 001 signature; call stageReact("ko", x) on a K.O. so the walkers stop and watch.
import { getPeople } from "../data/catalog";
import { MOVEMENT } from "../data/movement";
import { SUBPX } from "../sim/fixed";
import { STAGE_WIDTH_PX, type Camera } from "./camera";
import { loadClipSet, type ClipSet } from "./clips";
import { createWalkers, stepWalkers, type WalkerState } from "./stageWalkers";
import { VIEW_HEIGHT, VIEW_WIDTH } from "./screen";

export const FLOOR_Y_PX = MOVEMENT.floorY / SUBPX;
const MARKER_SPACING = 80;
const STAGE_ID = "office";
/** Fighters are never background walkers. */
const LAUNCH_FIGHTERS = new Set(["julien-hovan", "felicia-gorgacheva", "pentcho-tchomakov", "alex-andrianavalontsalama"]);
const WALKER_COUNT = 4;
const WALKER_SCALE = 0.6;
/** Feet of the walkers in mid-layer pixels (just behind the desks' floor line). */
const WALKER_FLOOR = 308;

interface Layer {
  img: HTMLImageElement;
  factor: number;
  y: number;
}

interface Stage {
  layers: Layer[];
  floorColor: string;
  cast: ClipSet[];
  dimmed: Map<string, HTMLCanvasElement>;
  walkers: WalkerState | null;
  midWidth: number;
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

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`stage image failed: ${src}`));
    img.src = src;
  });
}

async function load(): Promise<void> {
  const res = await fetch(`./stages/${STAGE_ID}/manifest.json`, { headers: { Accept: "application/json" } });
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return;
  const m = (await res.json()) as { floorColor: string; layers: { file: string; factor: number; y: number; w: number }[] };
  const layers = await Promise.all(m.layers.map(async (l) => ({ img: await loadImage(`./stages/${STAGE_ID}/${l.file}`), factor: l.factor, y: l.y })));
  const mid = m.layers.find((l) => l.factor > 0.5) ?? m.layers[m.layers.length - 1]!;
  const people = getPeople().filter((p) => !LAUNCH_FIGHTERS.has(p.slug));
  // A fixed, varied cast: every fifth coworker.
  const picks = people.filter((_, i) => i % 5 === 0).slice(0, 7);
  const cast = (await Promise.all(picks.map((p) => loadClipSet(p).catch(() => null)))).filter((c): c is ClipSet => c !== null);
  stage = {
    layers,
    floorColor: m.floorColor,
    cast,
    dimmed: new Map(),
    walkers: cast.length ? createWalkers(20261112, WALKER_COUNT, mid.w, cast.length) : null,
    midWidth: mid.w,
  };
}

/** Lets walkers react: on a K.O. at stage x (subpixels) they stop and face the fight. */
export function stageReact(kind: "ko", xSubpx: number): void {
  if (kind === "ko") pendingKo = xSubpx;
}

/** A darkened copy of a walker's atlas, so background people sit behind the fighters in depth. */
function dimmedAtlas(set: ClipSet): HTMLCanvasElement {
  const s = stage!;
  let c = s.dimmed.get(set.slug);
  if (!c) {
    c = document.createElement("canvas");
    c.width = set.atlas.width;
    c.height = set.atlas.height;
    const g = c.getContext("2d")!;
    g.drawImage(set.atlas, 0, 0);
    g.globalCompositeOperation = "source-atop";
    g.fillStyle = "rgba(24, 18, 48, 0.5)";
    g.fillRect(0, 0, c.width, c.height);
    s.dimmed.set(set.slug, c);
  }
  return c;
}

function drawWalkers(ctx: CanvasRenderingContext2D, camera: Camera, mid: Layer): void {
  const s = stage!;
  if (!s.walkers || !s.cast.length) return;
  const ko = pendingKo === null ? null : (pendingKo / SUBPX) * mid.factor + 0;
  pendingKo = null;
  stepWalkers(s.walkers, s.cast.length, ko);
  const offset = Math.round(camera.x * mid.factor);
  lastInfo.walkers = [];
  for (const w of s.walkers.walkers) {
    if (w.wait > 0) continue;
    const feetX = Math.round(w.x) - offset;
    lastInfo.walkers.push({ screenX: feetX, onScreen: feetX > -20 && feetX < VIEW_WIDTH + 20, watching: w.watching > 0 });
    const set = s.cast[w.who % s.cast.length]!;
    const walking = w.watching === 0;
    const clip = set.clips[walking ? "walk" : "idle"] ?? set.clips.idle ?? Object.values(set.clips)[0]!;
    const fr = clip.frames[walking ? Math.floor(w.steps / 9) % clip.frames.length : 0]!;
    const faceRight = (walking ? w.dir : w.watchDir) === 1;
    const sx = Math.round(w.x) - offset;
    const sy = WALKER_FLOOR + mid.y - camera.y;
    const dw = Math.round(fr.w * WALKER_SCALE);
    const dh = Math.round(fr.h * WALKER_SCALE);
    const ax = Math.round(fr.ax * WALKER_SCALE);
    const ay = Math.round(fr.ay * WALKER_SCALE);
    ctx.save();
    ctx.translate(sx, sy);
    if (faceRight !== (set.artFacing === 1)) ctx.scale(-1, 1);
    ctx.drawImage(dimmedAtlas(set), fr.x, fr.y, fr.w, fr.h, -ax, -ay, dw, dh);
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

export function drawStage(ctx: CanvasRenderingContext2D, camera: Camera): void {
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
    drawWalkers(ctx, camera, mid);
  }
  // Lower the background's contrast so fighters read first.
  ctx.fillStyle = "rgba(16, 12, 40, 0.24)";
  ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
  drawFloor(ctx, camera, stage.floorColor);
}
