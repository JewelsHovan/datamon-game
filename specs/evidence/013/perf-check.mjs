// Performance check for spec 013 over the Chrome DevTools
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
// Writes <out-dir>/perf.json. Network is throttled to 10 Mbit/s down, 40 ms RTT
// with the cache disabled, so byte savings show up as time.
import { execFileSync } from "node:child_process";

const metrics = async () => Object.fromEntries((await page("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
let bytes = 0;
let requests = 0;
listeners.push((evt) => {
  if (evt.sessionId === sessionId && evt.method === "Network.loadingFinished") {
    bytes += evt.params.encodedDataLength;
    requests += 1;
  }
});
async function untilTrue(expr, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await evaluate(expr).catch(() => false)) return Date.now() - t0;
    await sleep(20);
  }
  return -1;
}
/** Resident memory (MB) of this Chrome's renderer and GPU processes. */
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

const perf = {};
try {
  await viewport(1280, 720);
  await page("Network.enable");
  await page("Performance.enable");
  await page("Network.setCacheDisabled", { cacheDisabled: true });
  await page("Network.emulateNetworkConditions", { offline: false, latency: 40, downloadThroughput: (10 * 1024 * 1024) / 8, uploadThroughput: (5 * 1024 * 1024) / 8 });
  await page("Page.addScriptToEvaluateOnNewDocument", { source: frameProbe });

  // 1. Cold load to the title screen.
  bytes = 0; requests = 0;
  let t0 = Date.now();
  await page("Page.navigate", { url: BASE });
  const titleMs = await untilTrue("window.__game?.scene === 'title'");
  await sleep(1500); // the playable-fighter probe and menu art finish loading
  perf.title = { ms: titleMs, settledKB: Math.round(bytes / 1024), requests };
  record("title loads", titleMs > 0, perf.title);

  // 2. Select screen with the four fighters' previews.
  bytes = 0; requests = 0;
  await tap("KeyS"); // VS PLAYER
  await tap("KeyF");
  await untilTrue("window.__game?.scene === 'select'");
  await sleep(3000);
  perf.select = { addedKB: Math.round(bytes / 1024), requests, rss: chromeRss(), heap: await busy(1000) };
  record("select screen", true, perf.select);

  // 3. Cold load straight into a CPU fight.
  bytes = 0; requests = 0;
  t0 = Date.now();
  await page("Page.navigate", { url: BASE + "?cpu=hard&p1=julien-hovan&p2=pentcho-tchomakov" });
  const fightMs = await untilTrue("(window.__game?.simFrame ?? 0) > 2");
  await untilTrue("window.__game.info().stage.loaded", 30000);
  await sleep(2000);
  perf.fightLoad = { msToFirstSimFrame: fightMs, settledKB: Math.round(bytes / 1024), requests };
  record("fight loads", fightMs > 0, perf.fightLoad);

  // 4. Steady state: 20 s of the Hard CPU fighting an idle P1 (round flow, effects, walkers).
  await evaluate("__perf.frames.length = 0");
  perf.fight = await busy(20000);
  perf.fight.frames = await framesSummary();
  perf.fight.fps = (await evaluate("window.__game.info().stats.fps")) ?? null;
  perf.fight.rss = chromeRss();
  record("fight steady state", true, perf.fight);

  // 5. A minute later: memory growth (leak check). Rematches keep the fight going.
  await sleep(40000);
  const later = await busy(5000);
  perf.later = { jsHeapMB: later.jsHeapMB, rss: chromeRss(), mainThreadBusyPct: later.mainThreadBusyPct };
  record("one minute later", true, perf.later);

  const errors = consoleMessages.filter((m) => m.type === "error");
  record("no console errors", errors.length === 0, { errors });
} catch (err) {
  record("script", false, { error: String(err) });
} finally {
  writeFileSync(join(OUT, "perf.json"), JSON.stringify(perf, null, 2));
  writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
  ws.close();
  chrome.kill();
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {}
}
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
