// Browser checks for spec 001 (A4, A9, A10, A11) over the Chrome DevTools
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

try {
  await viewport(1280, 720);
  await open(FIGHT_URL);
  await sleep(300);
  record("intro", true, { screenshot: await shot("01-intro-round1") });
  const fighting = await waitFor((s) => s.round.phase === "fight", 6000);
  record("fight phase", !!fighting, { phase: fighting?.round.phase });
  const info = await evaluate("window.__game.info()");
  record("real clips", info.clipSources[0] === "manifest" && info.clipSources[1] === "manifest", info);

  // Light punch at point blank: a hit, a spark, hit-stop.
  await approach();
  let n = (await events()).length;
  await tap("KeyF");
  const hit = await waitEvent("hit", n);
  await sleep(40);
  record("light punch hits", hit?.move === "light_punch", { hit, screenshot: await shot("02-light-punch-spark") });

  // Heavy kick knocks down and raises dust.
  await sleep(600);
  await approach();
  n = (await events()).length;
  await down("KeyD");
  await tap("KeyG");
  await up("KeyD");
  const kd = await waitEvent("knockdown", n, 3000);
  await sleep(30);
  record("heavy kick knockdown + dust", !!kd, { kd, screenshot: await shot("03-knockdown-dust") });

  // P2 blocks a punch while holding back (right).
  await waitFor((s) => s.fighters[1].state === "idle", 4000);
  await approach();
  await down("ArrowRight");
  await sleep(80);
  n = (await events()).length;
  await tap("KeyF");
  const blk = await waitEvent("block", n, 2000);
  await sleep(30);
  record("block flash", !!blk, { blk, screenshot: await shot("04-block-flash") });
  await up("ArrowRight");

  // Special from range: projectile in flight, F2 boxes.
  await sleep(500);
  await down("KeyA");
  await waitFor((s) => gapPx(s) >= 250, 4000, 15);
  await up("KeyA");
  n = (await events()).length;
  await tap("F2");
  await tap("KeyH");
  const proj = await waitEvent("projectile", n, 2000);
  await sleep(250);
  const boxes = await evaluate("window.__game.info().boxes");
  record("projectile + box overlay", !!proj && boxes, { proj, screenshot: await shot("05-projectile-boxes") });
  await waitEvent("hit", n, 3000);
  await tap("F2");

  // Fight to a K.O. with heavy kicks.
  let ko = null;
  for (let k = 0; k < 18 && !ko; k++) {
    await waitFor((s) => s.fighters[1].state === "idle" || s.round.phase !== "fight", 4000);
    const s = await snap();
    if (s.round.phase !== "fight") break;
    await approach();
    n = (await events()).length;
    await down("KeyD");
    await tap("KeyG");
    await up("KeyD");
    ko = await waitEvent("ko", n, 1500);
  }
  await sleep(120);
  record("K.O.", !!ko, { ko, screenshot: await shot("06-ko-slowmo") });
  const won = await waitFor((s) => s.fighters[0].state === "victory", 8000);
  await sleep(200);
  record("victory pose + round win", !!won && won.round.wins[0] === 1, { wins: won?.round.wins, screenshot: await shot("07-victory") });
  const r2 = await waitFor((s) => s.round.number === 2 && s.round.phase === "intro", 8000);
  record("round 2 starts", !!r2, { round: r2?.round, screenshot: await shot("08-round2") });
  const errors = consoleMessages.filter((m) => m.type === "error");
  record("no console errors", errors.length === 0, { errors });
} catch (err) {
  record("script", false, { error: String(err) });
} finally {
  writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
  ws.close();
  chrome.kill();
  rmSync(profile, { recursive: true, force: true });
}
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
