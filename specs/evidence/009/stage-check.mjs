// Browser check for spec 009 (A2, A3, A4) over the Chrome DevTools
// Protocol, with a private headless Chrome (no shared browser, no extra deps).
//
// Usage (dev server running, e.g. `npx vite --port 5199 --strictPort`):
//   node specs/evidence/001/browser-check.mjs http://127.0.0.1:5199/ specs/evidence/001
// Writes screenshots and results.json into the output directory and exits 0
// only when every check passes.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://127.0.0.1:5199/";
const OUT = process.argv[3] ?? "specs/evidence/001";
const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = {};
let failures = 0;
function record(id, pass, detail) {
  results[id] = { pass, ...detail };
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"} ${id} ${JSON.stringify(detail)}`);
}

// --- Chrome + CDP plumbing ------------------------------------------------
const profile = mkdtempSync(join(tmpdir(), "datamon-cdp-"));
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--user-data-dir=${profile}`,
    "--remote-debugging-port=0",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--window-size=1440,900",
    "about:blank",
  ],
  { stdio: "ignore" },
);

async function devtoolsPort() {
  const file = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 100; i++) {
    if (existsSync(file)) {
      const [port] = readFileSync(file, "utf8").split("\n");
      if (port) return port;
    }
    await sleep(100);
  }
  throw new Error("Chrome did not start");
}

const port = await devtoolsPort();
const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let nextId = 1;
const pending = new Map();
const listeners = [];
ws.onmessage = (msg) => {
  const data = JSON.parse(msg.data);
  if (data.id && pending.has(data.id)) {
    const { resolve, reject } = pending.get(data.id);
    pending.delete(data.id);
    if (data.error) reject(new Error(`${data.error.message}`));
    else resolve(data.result);
  } else if (data.method) {
    for (const l of listeners) l(data);
  }
};
function send(method, params = {}, sessionId) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
const page = (method, params) => send(method, params, sessionId);
await page("Page.enable");
await page("Runtime.enable");

const consoleMessages = [];
listeners.push((evt) => {
  if (evt.sessionId === sessionId && evt.method === "Runtime.consoleAPICalled") {
    consoleMessages.push({
      type: evt.params.type,
      text: evt.params.args.map((a) => a.value ?? a.description ?? "").join(" "),
    });
  }
});

async function evaluate(expression) {
  const res = await page("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
  return res.result.value;
}

async function viewport(width, height) {
  await page("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
}

// ---------------------------------------------------------------------------
// Spec 003/004 fight checks: play the real game with keyboard events and
// screenshot the moments that matter. Usage as spec 001's browser-check.mjs:
//   node specs/evidence/003/fight-check.mjs http://127.0.0.1:5199/ specs/evidence/003
// Spec 005: buttons are Punch / Kick / Special (P1 F G H, P2 L ; '); forward+Kick
// (D + G) is the heavy kick. The page now opens on the title screen, so the
// check goes straight to the fight with the ?p1=&p2= shortcut.
const FIGHT_URL = "?p1=julien-hovan&p2=julien-hovan";
async function open(query = "") {
  await page("Page.navigate", { url: BASE + query });
  for (let i = 0; i < 150; i++) {
    const ready = await evaluate("!!(window.__game && window.__game.simFrame > 2)").catch(() => false);
    if (ready) return;
    await sleep(100);
  }
  throw new Error(`game did not start for ${query}`);
}
async function shot(name) {
  const { data } = await page("Page.captureScreenshot", { format: "png" });
  const path = join(OUT, `${name}.png`);
  writeFileSync(path, Buffer.from(data, "base64"));
  return path;
}
const KEYS = { KeyD: "d", KeyA: "a", KeyS: "s", KeyW: "w", KeyF: "f", KeyG: "g", KeyH: "h", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight", ArrowDown: "ArrowDown", KeyL: "l", Semicolon: ";", Quote: "'", F2: "F2" };
async function key(type, code) {
  await page("Input.dispatchKeyEvent", { type, code, key: KEYS[code] ?? code, windowsVirtualKeyCode: 0 });
}
const down = (code) => key("keyDown", code);
const up = (code) => key("keyUp", code);
async function tap(code, ms = 50) {
  await down(code);
  await sleep(ms);
  await up(code);
}
const snap = () => evaluate("window.__game.snapshot()");
const events = () => evaluate("window.__game.events()");
async function waitFor(pred, timeoutMs = 8000, everyMs = 30) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const s = await snap();
    if (pred(s)) return s;
    await sleep(everyMs);
  }
  return null;
}
async function waitEvent(type, since, timeoutMs = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const evs = await events();
    const e = evs.slice(since).find((x) => x.type === type);
    if (e) return e;
    await sleep(15);
  }
  return null;
}
const gapPx = (s) => Math.abs(s.fighters[1].x - s.fighters[0].x) / 100;
async function approach(maxGap = 62) {
  await down("KeyD");
  await waitFor((s) => gapPx(s) <= maxGap, 6000, 15);
  await up("KeyD");
  await waitFor((s) => s.fighters[0].state === "idle", 2000);
}

// ---------------------------------------------------------------------------
// Spec 009: the living stage.
//   node specs/evidence/009/stage-check.mjs http://127.0.0.1:5199/ specs/evidence/009
// A2: screenshots at three camera positions (left wall, center, right wall) with the layer
//     offsets the renderer used; parallax.py then measures each band's shift from the screenshots:
//     uv run --with pillow --with numpy python -I specs/evidence/009/parallax.py specs/evidence/009
// A3: walkers mid-walk, then walkers that stopped to watch a K.O. (a VS match, heavy kicks).
// A4: render fps sampled every half second through both parts.
const stageOf = () => evaluate("window.__game.info().stage");
const fpsSamples = [];
let sampling = true;
(async () => {
  while (sampling) {
    const info = await evaluate("window.__game?.info?.()").catch(() => null);
    if (info && info.stage?.loaded && info.stats.frames > 120) fpsSamples.push(info.stats.fps);
    await sleep(500);
  }
})();

async function waitStage(pred, timeoutMs = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const s = await stageOf();
    if (s && pred(s)) return s;
    await sleep(30);
  }
  return null;
}
const positions = {};
async function cameraShot(name, holdP1, holdP2, pred) {
  if (holdP1) await down(holdP1);
  if (holdP2) await down(holdP2);
  const st = await waitStage(pred, 15000);
  if (holdP1) await up(holdP1);
  if (holdP2) await up(holdP2);
  await sleep(250);
  const s = await stageOf();
  positions[name] = { cameraX: s.cameraX, layerOffsets: s.layerOffsets, fighters: (await snap()).fighters.map((f) => Math.round(f.x / 100)) };
  record(`A2 camera ${name}`, !!st, { ...positions[name], screenshot: await shot(`0${Object.keys(positions).length}-camera-${name}`) });
}

try {
  await viewport(1280, 720);
  await open("?mode=training&p1=julien-hovan&p2=felicia-gorgacheva");
  record("stage loaded", !!(await waitStage((s) => s.loaded, 8000)), {});

  // A2: three camera positions.
  await cameraShot("center", null, null, (s) => s.cameraX === 320);
  await cameraShot("left", "KeyA", "ArrowLeft", (s) => s.cameraX === 0);
  await cameraShot("right", "KeyD", "ArrowRight", (s) => s.cameraX === 640);
  const [c, l, r] = [positions.center, positions.left, positions.right];
  const shifts = c.layerOffsets.map((_, i) => r.layerOffsets[i] - l.layerOffsets[i]);
  const distinct = shifts.every((v, i) => i === 0 || v > shifts[i - 1]);
  record("A2 parallax: each layer shifts by its own amount (far < mid < floor)", distinct, { shiftsLeftToRight: shifts });
  writeFileSync(join(OUT, "positions.json"), JSON.stringify(positions, null, 2));

  // A3: a walker on screen mid-walk.
  const walking = await waitStage((s) => s.walkers.some((w) => !w.watching && w.screenX > 80 && w.screenX < 560), 30000);
  record("A3 walkers mid-walk", !!walking, { walkers: walking?.walkers, screenshot: await shot("04-walkers-walking") });

  // A3: a K.O. in a VS match; walkers stop and face the fight.
  await open("?p1=julien-hovan&p2=julien-hovan");
  await waitFor((s) => s.round.phase === "fight", 8000);
  let ko = null;
  for (let i = 0; i < 40 && !ko; i++) {
    const s = await snap();
    if (s.round.phase !== "fight") break;
    // Save the finishing kick for a moment when a coworker is walking past in view.
    if (s.fighters[1].health <= 130) await waitStage((st) => st.walkers.some((w) => !w.watching && w.screenX > 80 && w.screenX < 560), 30000);
    await approach();
    const n = (await events()).length;
    await down("KeyD");
    await tap("KeyG");
    await up("KeyD");
    ko = await waitEvent("ko", n, 1500);
  }
  await sleep(700);
  const watching = await waitStage((s) => s.walkers.some((w) => w.watching), 3000);
  const inView = watching ? watching.walkers.filter((w) => w.onScreen && w.watching).length : 0;
  record("A3 walkers watch the K.O.", !!ko && inView > 0, {
    ko: !!ko,
    walkers: watching?.walkers,
    onScreenWatching: inView,
    screenshot: await shot("05-walkers-watch-ko"),
  });

  sampling = false;
  await sleep(600);
  const min = Math.min(...fpsSamples);
  const avg = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
  // The loop measures fps over half a second, so a steady 60 Hz reads 59.x-60.x.
  record("A4 render fps", fpsSamples.length >= 20 && min >= 59, { samples: fpsSamples.length, min: Number(min.toFixed(1)), avg: Number(avg.toFixed(1)) });

  const errors = consoleMessages.filter((m) => m.type === "error");
  record("no console errors", errors.length === 0, { errors });
} catch (err) {
  record("script", false, { error: String(err) });
} finally {
  sampling = false;
  writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
  ws.close();
  chrome.kill();
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {}
}
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
