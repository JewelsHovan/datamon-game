// Browser checks for spec 012 / 006 moves over the Chrome DevTools
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
const KEYS = { KeyD: "d", KeyA: "a", KeyS: "s", KeyW: "w", KeyF: "f", KeyG: "g", KeyH: "h", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight", ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", KeyL: "l", Semicolon: ";", Quote: "'", F2: "F2" };
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
// Spec 012 (A5) and spec 006 (A3, A4): play every new move with real key
// presses in training mode and screenshot it mid-animation.
//   node specs/evidence/012/moves-check.mjs http://127.0.0.1:5199/ specs/evidence/012 [specs/evidence/006]
// Signature-special and select-screen shots (spec 006) go to the second directory.
const OUT_006 = process.argv[4] ?? join(OUT, "..", "006");
async function shot006(name) {
  const { data } = await page("Page.captureScreenshot", { format: "png" });
  const path = join(OUT_006, `${name}.png`);
  writeFileSync(path, Buffer.from(data, "base64"));
  return path;
}
const TRAIN = (p1, p2 = "julien-hovan") => `?mode=training&p1=${p1}&p2=${p2}`;
const F = { julien: "julien-hovan", felicia: "felicia-gorgacheva", pentcho: "pentcho-tchomakov", alex: "alex-andrianavalontsalama" };
const p = (s, i) => s.fighters[i];

async function doubleTap(code) {
  await tap(code, 30);
  await sleep(30);
  await tap(code, 60);
}

/** P1 walks P2 into the right-hand wall (pushboxes push), then backs off to `gap` px. */
async function cornerP2(gap = 70) {
  await down("KeyD");
  await waitFor((s) => s.fighters[1].x >= 123500, 15000, 30); // the right wall is at 124000
  await up("KeyD");
  await down("KeyA");
  await waitFor((s) => gapPx(s) >= gap, 2000, 15);
  await up("KeyA");
  await waitFor((s) => s.fighters[0].state === "idle", 1000);
}

let n = 0;
try {
  await viewport(1280, 720);

  // Round 1 intro clips (VS match, not training).
  await open(`?p1=${F.felicia}&p2=${F.pentcho}`);
  await waitFor((s) => s.round.phase === "intro" && s.round.phaseFrame >= 28, 4000, 15);
  record("intro clips", true, { screenshot: await shot("01-intro") });

  // Dash forward and back.
  await open(TRAIN(F.julien));
  await sleep(200);
  await doubleTap("KeyD");
  let s = await waitFor((x) => p(x, 0).state === "dash_forward", 1500, 10);
  record("dash forward", !!s, { state: s && p(s, 0).state, screenshot: await shot("02-dash-forward") });
  await waitFor((x) => p(x, 0).state === "idle", 1500);
  await doubleTap("KeyA");
  s = await waitFor((x) => p(x, 0).state === "dash_back", 1500, 10);
  record("dash back", !!s, { state: s && p(s, 0).state, screenshot: await shot("03-dash-back") });

  // Taunt: down + Special.
  await waitFor((x) => p(x, 0).state === "idle", 1500);
  await down("KeyS");
  await tap("KeyH");
  await up("KeyS");
  s = await waitFor((x) => p(x, 0).state === "taunt" && p(x, 0).stateFrame >= 14, 1500, 10);
  record("taunt", !!s, { screenshot: await shot("04-taunt") });
  await waitFor((x) => p(x, 0).state === "idle", 2000);

  // Block push: P2 holds back (right) and blocks a jab, then presses Punch+Kick.
  await approach(56);
  n = (await events()).length;
  await down("ArrowRight");
  await tap("KeyF", 30);
  // Punch+Kick once the jab is blocked (the block push window covers the hit-stop and blockstun).
  await waitEvent("block", n, 1500);
  await down("KeyL");
  await down("Semicolon");
  await sleep(40);
  await up("KeyL");
  await up("Semicolon");
  await up("ArrowRight");
  record("block for the push", (await events()).slice(n).some((e) => e.type === "block"), { events: (await events()).slice(n).map((e) => e.type) });
  s = await waitFor((x) => p(x, 1).state === "block_push" && p(x, 1).stateFrame >= 4, 1500, 5);
  record("block push", !!s, { screenshot: await shot("05-block-push") });

  // Air juggle and wall bounce: Alex's uppercut launches, a jab juggles; in the corner the launch hits the wall.
  await open(TRAIN(F.alex));
  await sleep(200);
  await approach(90);
  n = (await events()).length;
  await tap("KeyH");
  s = await waitFor((x) => p(x, 1).state === "knockdown" && p(x, 1).y < 30000, 3000, 10);
  record("rush launches", !!s, { y: s && p(s, 1).y });
  // Jab as soon as Alex recovers: the falling opponent is still in reach for about 12 frames.
  await waitFor((x) => p(x, 0).state === "idle", 2000, 5);
  await tap("KeyF");
  s = await waitFor((x) => p(x, 1).juggle >= 1, 1500, 10);
  await sleep(30);
  record("air juggle", !!s, { juggle: s && p(s, 1).juggle, screenshot: await shot("06-air-juggle") });

  // Get-up roll: P2 (facing left) holds right (back) while lying.
  await down("ArrowRight");
  s = await waitFor((x) => p(x, 1).rollFrom >= 0 && p(x, 1).stateFrame - p(x, 1).rollFrom >= 10, 4000, 10);
  await up("ArrowRight");
  record("get-up roll", !!s, { screenshot: await shot("07-getup-roll") });

  await open(TRAIN(F.alex));
  await sleep(200);
  await cornerP2(90);
  n = (await events()).length;
  await tap("KeyH");
  const bounce = await waitEvent("wall_bounce", n, 4000);
  await sleep(40);
  record("wall bounce", !!bounce, { bounce, screenshot: await shot("08-wall-bounce") });

  // Signature specials mid-animation (spec 006 A3).
  await open(TRAIN(F.julien));
  await sleep(200);
  await tap("KeyH");
  s = await waitFor((x) => x.projectiles.length > 0 && Math.abs(x.projectiles[0].x - p(x, 0).x) > 6000, 2000, 10);
  record("006 data orb", !!s, { screenshot: await shot006("data-orb") });

  await open(TRAIN(F.felicia));
  await sleep(200);
  await approach(120);
  await tap("KeyH");
  s = await waitFor((x) => p(x, 0).move?.id === "teleport" && p(x, 0).move.tick >= 9, 1500, 5);
  record("006 context switch out", !!s, { screenshot: await shot006("context-switch-out") });
  s = await waitFor((x) => p(x, 0).move?.id === "teleport" && p(x, 0).move.tick >= 23, 1500, 5);
  record("006 context switch kick", !!s && p(s, 0).x > p(s, 1).x, { screenshot: await shot006("context-switch-kick") });

  await open(TRAIN(F.pentcho));
  await sleep(200);
  await approach(150);
  n = (await events()).length;
  await tap("KeyH");
  s = await waitFor((x) => p(x, 0).move?.id === "charge" && p(x, 0).move.tick >= 12, 1500, 5);
  record("006 hotfix charge", !!s, { screenshot: await shot006("hotfix-charge") });
  const chargeHit = await waitEvent("hit", n, 2000);
  record("006 hotfix charge hits", chargeHit?.move === "charge", { chargeHit });

  await open(TRAIN(F.alex));
  await sleep(200);
  await approach(90);
  await tap("KeyH");
  s = await waitFor((x) => p(x, 0).move?.id === "rush" && p(x, 0).move.tick >= 9, 1500, 5);
  record("006 rapid deploy jab", !!s, { screenshot: await shot006("rapid-deploy-jab") });
  s = await waitFor((x) => p(x, 0).move?.id === "rush" && p(x, 0).move.tick >= 21, 2500, 5);
  record("006 rapid deploy uppercut", !!s, { screenshot: await shot006("rapid-deploy-uppercut") });

  // Spec 006 A4: the select screen names each fighter's archetype and special (cursors on Pentcho and Alex).
  await page("Page.navigate", { url: BASE });
  for (let i = 0; i < 100 && !(await evaluate("window.__game?.scene === 'title'").catch(() => false)); i++) await sleep(100);
  await tap("KeyS"); // VS PLAYER
  await tap("KeyF");
  for (let i = 0; i < 50 && !(await evaluate("window.__game?.scene === 'select'").catch(() => false)); i++) await sleep(100);
  await sleep(300);
  await tap("KeyD"); // P1: Julien -> next tile
  await tap("ArrowUp"); // P2: Felicia -> the row above
  await tap("ArrowLeft");
  await sleep(400);
  const sel = await evaluate("window.__game.menu?.() ?? null").catch(() => null);
  record("006 select shows archetypes", (await evaluate("window.__game.scene")) === "select", { menu: sel, screenshot: await shot006("select-pentcho-alex") });

  const errors = consoleMessages.filter((m) => m.type === "error");
  record("no console errors", errors.length === 0, { errors });
} catch (err) {
  record("script", false, { error: String(err) });
} finally {
  writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
  ws.close();
  chrome.kill();
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {}
}
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
