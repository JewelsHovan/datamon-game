// Performance check for spec 013 over the Chrome DevTools
// Protocol, with a private headless Chrome (no shared browser, no extra deps).
//
// Usage, against a production build (never the dev server):
//   npx vite build --outDir <tmp>/dist --emptyOutDir
//   npx vite preview --outDir <tmp>/dist --host 127.0.0.1 --port <port> --strictPort
//   node specs/evidence/013/perf-check.mjs http://127.0.0.1:<port>/ specs/evidence/013
// Writes perf.json, requests.json, results.json and a screenshot into the output
// directory and exits 0 only when every budget (spec 013 R3, R4, R6) is met.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://127.0.0.1:5199/";
const OUT = process.argv[3] ?? "specs/evidence/013";
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
    "--enable-precise-memory-info",
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
// Spec 013: load size and time, CPU and memory, measured against a production
// build (`vite build` then `vite preview`), never the dev server.
//   node specs/evidence/013/perf-check.mjs http://127.0.0.1:<port>/ <out-dir>
// Network is throttled to 10 Mbit/s down, 40 ms RTT with the cache disabled, so
// byte savings show up as time. Times run from the navigation request.
import { execFileSync } from "node:child_process";

/** Spec 013 budgets (R3 load, R4 runtime). A miss fails the run (R6). */
const BUDGET = Object.freeze({
  titleMs: 1000,
  fightFirstSimFrameMs: 1200,
  fightSettledKB: 1600, // 1.6 MB, 1 KB = 1024 bytes
  mainThreadBusyPct: 10,
  frameP95Ms: 17.5,
  framesOver20Pct: 1,
  jsHeapMB: 10,
  pageHeldMB: 24, // decoded images + canvases the page holds, fight started from the URL
  heapGrowthMB: 1, // over 60 s of fighting, after a forced GC at both ends
});
function budget(id, value, max, detail = {}) {
  record(id, Number.isFinite(value) && value >= 0 && value <= max, { value, budget: max, ...detail });
}

mkdirSync(OUT, { recursive: true });
const metrics = async () => Object.fromEntries((await page("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));

// Request log: every request with its phase, URL (same-origin ones as paths), type, HTTP status,
// encoded size and start/end in ms from the phase's navigation (a waterfall).
const ORIGIN = new URL(BASE).origin + "/";
let phase = "boot";
let phaseStart = 0; // CDP monotonic seconds of the phase's first request
let bytes = 0;
let requests = 0;
const log = [];
const byId = new Map();
listeners.push((evt) => {
  if (evt.sessionId !== sessionId) return;
  const p = evt.params;
  if (evt.method === "Network.requestWillBeSent") {
    if (!phaseStart) phaseStart = p.timestamp;
    const entry = { phase, url: p.request.url.replace(ORIGIN, "/"), type: p.type ?? "", status: 0, kb: 0, startMs: Math.round((p.timestamp - phaseStart) * 1000), endMs: -1 };
    byId.set(p.requestId, entry);
    log.push(entry);
  } else if (evt.method === "Network.responseReceived") {
    const entry = byId.get(p.requestId);
    if (entry) entry.status = p.response.status;
  } else if (evt.method === "Network.loadingFinished") {
    bytes += p.encodedDataLength;
    requests += 1;
    const entry = byId.get(p.requestId);
    if (entry) Object.assign(entry, { kb: +(p.encodedDataLength / 1024).toFixed(1), endMs: Math.round((p.timestamp - phaseStart) * 1000) });
  } else if (evt.method === "Network.loadingFailed") {
    const entry = byId.get(p.requestId);
    if (entry) entry.failed = p.errorText;
  }
});
function startPhase(name) {
  phase = name;
  phaseStart = 0;
  bytes = 0;
  requests = 0;
}
const pathOf = (url) => url.replace(/[?#].*$/, "");
const ART = /^\/(fighters|effects|stages|datamon)\//;
const pngArt = (entries) => entries.filter((e) => ART.test(e.url) && /\.png$/i.test(pathOf(e.url))).map((e) => e.url);
const walkSheets = (entries) => entries.filter((e) => pathOf(e.url).includes("/datamon/walk/")).map((e) => e.url);
// The favicon is spec 014's (R1); until it lands, its 404 is known and reported on its own.
const KNOWN_404 = new Set(["/favicon.ico"]);
const failedRequests = (entries) => entries.filter((e) => e.status >= 400 && !KNOWN_404.has(pathOf(e.url))).map((e) => `${e.status} ${e.url}`);

async function untilTrue(expr, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await evaluate(expr).catch(() => false)) return Date.now() - t0;
    await sleep(20);
  }
  return -1;
}
/** Navigates and returns ms from the navigation request until `expr` holds (-1 on timeout). */
async function navigateUntil(url, expr, timeoutMs = 30000) {
  const t0 = Date.now();
  await page("Page.navigate", { url });
  const waited = await untilTrue(expr, timeoutMs);
  return waited < 0 ? -1 : Date.now() - t0;
}
/** Resident memory (MB) of this Chrome's renderer and GPU processes: recorded, not budgeted (spec 013 Decisions). */
function chromeRss() {
  const out = execFileSync("ps", ["-axo", "pid=,ppid=,rss=,command="], { encoding: "utf8" });
  const rows = out.split("\n").map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean);
  const mine = rows.filter((r) => r[4].includes(profile));
  const pick = (type) => mine.filter((r) => r[4].includes(`--type=${type}`)).reduce((a, r) => a + Number(r[3]), 0) / 1024;
  return { renderer: Math.round(pick("renderer")), gpu: Math.round(pick("gpu-process")) };
}
const frameProbe = `window.__perf = { frames: [] }; (function tick(last) { requestAnimationFrame((t) => { if (last) { __perf.frames.push(t - last); if (__perf.frames.length > 3000) __perf.frames.shift(); } tick(t); }); })();`;
async function framesSummary() {
  return evaluate(`(() => { const f = [...__perf.frames].sort((a, b) => a - b); const q = (p) => f[Math.min(f.length - 1, Math.floor(f.length * p))] || 0; return { n: f.length, p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), p99: +q(0.99).toFixed(1), over20: f.filter((x) => x > 20).length }; })()`);
}
async function busy(ms) {
  const a = await metrics();
  const t0 = Date.now();
  await sleep(ms);
  const b = await metrics();
  const wall = (Date.now() - t0) / 1000;
  return {
    mainThreadBusyPct: +((100 * (b.TaskDuration - a.TaskDuration)) / wall).toFixed(1),
    scriptPct: +((100 * (b.ScriptDuration - a.ScriptDuration)) / wall).toFixed(1),
    jsHeapMB: +(b.JSHeapUsedSize / 1048576).toFixed(1),
    jsHeapTotalMB: +(b.JSHeapTotalSize / 1048576).toFixed(1),
  };
}
/** JS heap in use after a full garbage collection (what the page retains). */
async function retainedHeapMB() {
  await page("HeapProfiler.collectGarbage");
  await sleep(200);
  return +((await metrics()).JSHeapUsedSize / 1048576).toFixed(2);
}

// Page-held images and canvases: wrap Image and document.createElement before the page's own
// scripts run, then sum decoded sizes (width x height x 4) of everything still alive and sized.
const inventoryProbe = `
window.__inv = { canvases: [], images: [] };
const ce = Document.prototype.createElement;
Document.prototype.createElement = function (tag, ...rest) {
  const el = ce.call(this, tag, ...rest);
  const t = String(tag).toLowerCase();
  if (t === 'canvas') __inv.canvases.push({ el, stack: (new Error().stack || '').split('\\n').slice(2, 4).map((s) => s.trim()).join(' < ') });
  if (t === 'img') __inv.images.push(el);
  return el;
};
const RealImage = window.Image;
window.Image = function (...a) { const img = new RealImage(...a); __inv.images.push(img); return img; };
window.Image.prototype = RealImage.prototype;
`;
const inventory = `(() => {
  const groups = {};
  const seen = new Set();
  let canvasMB = 0;
  const addCanvas = (el, key) => { if (seen.has(el)) return; seen.add(el); const mb = el.width * el.height * 4 / 1048576; canvasMB += mb; const k = key.replace(/https?:[^ )]*\\//g, '').slice(0, 120); const g = groups[k] = groups[k] || { n: 0, mb: 0, sizes: [] }; g.n++; g.mb += mb; if (g.sizes.length < 4) g.sizes.push(el.width + 'x' + el.height); };
  for (const c of __inv.canvases) addCanvas(c.el, c.stack);
  for (const el of document.querySelectorAll('canvas')) addCanvas(el, 'in the page: #' + el.id);
  const imgs = {};
  let imageMB = 0;
  for (const i of __inv.images) { if (!i.naturalWidth) continue; const mb = i.naturalWidth * i.naturalHeight * 4 / 1048576; imageMB += mb; const k = (i.currentSrc || i.src).replace(/^.*?\\/\\/[^/]+\\//, '').replace(/\\?.*$/, ''); const g = imgs[k] = imgs[k] || { n: 0, mb: 0, size: i.naturalWidth + 'x' + i.naturalHeight }; g.n++; g.mb += mb; }
  for (const g of Object.values(groups)) g.mb = +g.mb.toFixed(2);
  for (const g of Object.values(imgs)) g.mb = +g.mb.toFixed(2);
  return { totalMB: +(canvasMB + imageMB).toFixed(1), canvasMB: +canvasMB.toFixed(1), imageMB: +imageMB.toFixed(1), canvases: groups, images: imgs };
})()`;

const perf = { budget: BUDGET };
try {
  await viewport(1280, 720);
  await page("Network.enable");
  await page("Performance.enable");
  await page("Network.setCacheDisabled", { cacheDisabled: true });
  await page("Network.emulateNetworkConditions", { offline: false, latency: 40, downloadThroughput: (10 * 1024 * 1024) / 8, uploadThroughput: (5 * 1024 * 1024) / 8 });
  await page("Page.addScriptToEvaluateOnNewDocument", { source: frameProbe });
  await page("Page.addScriptToEvaluateOnNewDocument", { source: inventoryProbe });

  // 1. Cold load to the title screen.
  startPhase("title");
  const titleMs = await navigateUntil(BASE, "window.__game?.scene === 'title'");
  await sleep(1500); // the playable-fighter probe and menu art finish loading
  perf.title = { ms: titleMs, settledKB: Math.round(bytes / 1024), requests };
  budget("R3 title screen (ms)", titleMs, BUDGET.titleMs, perf.title);

  // 2. Select screen with the four fighters' previews (recorded, not budgeted).
  startPhase("select");
  await tap("KeyS"); // VS PLAYER
  await tap("KeyF");
  await untilTrue("window.__game?.scene === 'select'");
  await sleep(3000);
  perf.select = { addedKB: Math.round(bytes / 1024), requests, rss: chromeRss(), heap: await busy(1000), held: await evaluate(inventory) };
  record("select screen", true, { addedKB: perf.select.addedKB, heldMB: perf.select.held.totalMB });

  // 3. Cold load straight into a Hard CPU fight.
  startPhase("fight");
  const fightMs = await navigateUntil(BASE + "?cpu=hard&p1=julien-hovan&p2=pentcho-tchomakov", "(window.__game?.simFrame ?? 0) > 2");
  const stageMs = await untilTrue("window.__game.info().stage.loaded", 30000);
  await sleep(2000);
  perf.fightLoad = { msToFirstSimFrame: fightMs, settledKB: Math.round(bytes / 1024), requests, stageLoadedAfterMs: stageMs };
  budget("R3 fight: first sim frame (ms)", fightMs, BUDGET.fightFirstSimFrameMs, perf.fightLoad);
  budget("R3 fight: settled download (KB)", perf.fightLoad.settledKB, BUDGET.fightSettledKB);

  // 4. Steady state: 20 s of the Hard CPU fighting an idle P1 (round flow, effects, walkers).
  const heapStart = await retainedHeapMB();
  const t60 = Date.now();
  await evaluate("__perf.frames.length = 0");
  perf.fight = await busy(20000);
  perf.fight.frames = await framesSummary();
  perf.fight.framesOver20Pct = +((100 * perf.fight.frames.over20) / Math.max(1, perf.fight.frames.n)).toFixed(2);
  perf.fight.fps = (await evaluate("window.__game.info().stats.fps")) ?? null;
  perf.fight.rss = chromeRss();
  perf.fight.held = await evaluate(inventory);
  budget("R4 fight: main thread busy (%)", perf.fight.mainThreadBusyPct, BUDGET.mainThreadBusyPct);
  budget("R4 fight: frame p95 (ms)", perf.fight.frames.p95, BUDGET.frameP95Ms, { frames: perf.fight.frames });
  budget("R4 fight: frames over 20 ms (%)", perf.fight.framesOver20Pct, BUDGET.framesOver20Pct);
  budget("R4 fight: JS heap (MB)", perf.fight.jsHeapMB, BUDGET.jsHeapMB);
  budget("R4 fight: page-held images and canvases (MB)", perf.fight.held.totalMB, BUDGET.pageHeldMB, { canvasMB: perf.fight.held.canvasMB, imageMB: perf.fight.held.imageMB });

  // 5. Sixty seconds into the fight: retained heap growth (leak check). Rematches keep it going.
  await sleep(Math.max(0, 60000 - (Date.now() - t60)));
  const heapEnd = await retainedHeapMB();
  const later = await busy(3000);
  perf.later = { afterS: Math.round((Date.now() - t60) / 1000), retainedHeapStartMB: heapStart, retainedHeapEndMB: heapEnd, growthMB: +(heapEnd - heapStart).toFixed(2), jsHeapMB: later.jsHeapMB, rss: chromeRss(), mainThreadBusyPct: later.mainThreadBusyPct };
  budget("R4 fight: JS heap growth over 60 s (MB)", perf.later.growthMB, BUDGET.heapGrowthMB, { from: heapStart, to: heapEnd });

  // A2: the fight loaded no .png art and no walk sheet, and the walkers still draw.
  const fightRequests = log.filter((e) => e.phase === "fight");
  record("A2 fight requests no .png art", fightRequests.length > 0 && pngArt(fightRequests).length === 0, { requests: fightRequests.length, png: pngArt(fightRequests) });
  record("A2 fight requests no datamon/walk sheet", walkSheets(fightRequests).length === 0, { walk: walkSheets(fightRequests) });
  const walking = await untilTrue("window.__game.info().stage.walkers.some((w) => !w.watching && w.screenX > 80 && w.screenX < 560)", 30000);
  const walkers = await evaluate("window.__game.info().stage.walkers");
  const { data } = await page("Page.captureScreenshot", { format: "png" });
  const screenshot = join(OUT, "fight-walkers.png");
  writeFileSync(screenshot, Buffer.from(data, "base64"));
  record("A2 walkers draw in the fight", walking >= 0, { walkers, screenshot });

  // QA 2026-11-12 F3: no request answers 404 (or any error) on the title, select or fight loads.
  for (const ph of ["title", "select", "fight"]) {
    const entries = log.filter((e) => e.phase === ph);
    const known = entries.filter((e) => e.status >= 400 && KNOWN_404.has(pathOf(e.url))).map((e) => `${e.status} ${e.url}`);
    record(`no 404s: ${ph}`, entries.length > 0 && failedRequests(entries).length === 0, { requests: entries.length, failed: failedRequests(entries), knownSpec014: known });
  }

  const errors = consoleMessages.filter((m) => m.type === "error");
  record("no console errors", errors.length === 0, { errors });
} catch (err) {
  record("script", false, { error: String(err) });
} finally {
  writeFileSync(join(OUT, "perf.json"), JSON.stringify(perf, null, 2));
  writeFileSync(join(OUT, "requests.json"), JSON.stringify(log, null, 1));
  writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
  ws.close();
  chrome.kill();
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {}
}
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
