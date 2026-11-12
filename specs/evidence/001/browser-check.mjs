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

async function open(query = "") {
  consoleMessages.length = 0;
  // Spec 003 made the default a timed match; spec 001 checks run in free training mode.
  await page("Page.navigate", { url: BASE + (query ? query + "&" : "?") + "mode=training" });
  for (let i = 0; i < 100; i++) {
    const ready = await evaluate("!!(window.__game && window.__game.simFrame > 10)").catch(
      () => false,
    );
    if (ready) return;
    await sleep(100);
  }
  throw new Error(`game did not start for ${query}`);
}

async function screenshot(name) {
  const { data } = await page("Page.captureScreenshot", { format: "png" });
  const path = join(OUT, `${name}.png`);
  writeFileSync(path, Buffer.from(data, "base64"));
  return path;
}

const KEYS = {
  KeyW: ["w", 87],
  KeyA: ["a", 65],
  KeyS: ["s", 83],
  KeyD: ["d", 68],
  ArrowUp: ["ArrowUp", 38],
  ArrowDown: ["ArrowDown", 40],
  ArrowLeft: ["ArrowLeft", 37],
  ArrowRight: ["ArrowRight", 39],
  F1: ["F1", 112],
};
async function key(type, code) {
  const [k, vk] = KEYS[code];
  await page("Input.dispatchKeyEvent", {
    type,
    code,
    key: k,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
  });
}
const down = (code) => key("keyDown", code);
const up = (code) => key("keyUp", code);

const fighters = () =>
  evaluate(
    "window.__game.snapshot().fighters.map(f => ({slug: f.slug, state: f.state, stateFrame: f.stateFrame, x: f.x, y: f.y, facing: f.facing}))",
  );
const walkFrame = (f) => Math.floor(f.stateFrame / 8) % 4;

try {
  // --- A9: canvas size at two window sizes --------------------------------
  for (const [w, h] of [
    [1440, 900],
    [800, 600],
  ]) {
    await viewport(w, h);
    await open();
    await sleep(500);
    const canvas = await evaluate(`(() => {
      const c = document.getElementById('game');
      const cs = getComputedStyle(c);
      return { width: c.width, height: c.height, cssWidth: cs.width, cssHeight: cs.height,
               imageRendering: cs.imageRendering, innerWidth, innerHeight };
    })()`);
    const cssW = parseFloat(canvas.cssWidth);
    const cssH = parseFloat(canvas.cssHeight);
    const k = cssW / 640;
    const f = await fighters();
    const shot = await screenshot(`a9-${w}x${h}`);
    record(`A9 ${w}x${h}`, canvas.width === 640 && canvas.height === 360 && Number.isInteger(k) && k >= 1 && cssH === 360 * k && f.every((x) => x.y === 32000) && f[0].facing === 1 && f[1].facing === -1, {
      canvas,
      scale: k,
      fighters: f,
      screenshot: shot,
    });
  }

  // --- A4: 600 +/- 6 sim frames over 10 s of wall time ----------------------
  await viewport(1440, 900);
  await open();
  await sleep(1000);
  const t0 = Date.now();
  const f0 = await evaluate("window.__game.simFrame");
  await sleep(10_000);
  const f1 = await evaluate("window.__game.simFrame");
  const elapsed = Date.now() - t0;
  const advanced = f1 - f0;
  const expected = Math.round((elapsed / 1000) * 60);
  const info = await evaluate("window.__game.info()");
  record("A4", Math.abs(advanced - 600) <= 6, {
    before: f0,
    after: f1,
    advanced,
    wallMs: elapsed,
    expectedForWall: expected,
    fps: info.stats.fps,
  });

  // --- A10: walk, crouch, jump for both players; pushing --------------------
  await open();
  await down("F1");
  await up("F1");
  await sleep(300);
  const start = await fighters();

  // P1 walk (D = forward for P1 facing right)
  await down("KeyD");
  await sleep(300);
  const p1WalkA = await fighters();
  const p1WalkShot1 = await screenshot("a10-p1-walk-1");
  await sleep(150);
  const p1WalkB = await fighters();
  const p1WalkShot2 = await screenshot("a10-p1-walk-2");
  await up("KeyD");
  await sleep(200);
  // P1 crouch
  await down("KeyS");
  await sleep(300);
  const p1Crouch = await fighters();
  const p1CrouchShot = await screenshot("a10-p1-crouch");
  await up("KeyS");
  await sleep(200);
  // P1 jump
  await down("KeyW");
  await sleep(80);
  await up("KeyW");
  await sleep(300);
  const p1Jump = await fighters();
  const p1JumpShot = await screenshot("a10-p1-jump");
  await sleep(1000);

  // P2 walk (ArrowLeft = forward for P2 facing left)
  await down("ArrowLeft");
  await sleep(300);
  const p2WalkA = await fighters();
  const p2WalkShot = await screenshot("a10-p2-walk");
  await sleep(150);
  const p2WalkB = await fighters();
  await up("ArrowLeft");
  await sleep(200);
  await down("ArrowDown");
  await sleep(300);
  const p2Crouch = await fighters();
  const p2CrouchShot = await screenshot("a10-p2-crouch");
  await up("ArrowDown");
  await sleep(200);
  await down("ArrowUp");
  await sleep(80);
  await up("ArrowUp");
  await sleep(300);
  const p2Jump = await fighters();
  const p2JumpShot = await screenshot("a10-p2-jump");
  await sleep(1000);

  // Push: P1 walks into P2 for 3 s.
  const beforePush = await fighters();
  await down("KeyD");
  await sleep(3000);
  const duringPush = await fighters();
  const pushShot = await screenshot("a10-p1-pushes-p2");
  await up("KeyD");

  const walking = (f, i, state) => f[i].state === state;
  record("A10 P1 walk", walking(p1WalkA, 0, "walk_forward") && walking(p1WalkB, 0, "walk_forward") && p1WalkB[0].x > start[0].x && walkFrame(p1WalkA[0]) !== walkFrame(p1WalkB[0]), {
    a: p1WalkA[0],
    b: p1WalkB[0],
    walkFrames: [walkFrame(p1WalkA[0]), walkFrame(p1WalkB[0])],
    screenshots: [p1WalkShot1, p1WalkShot2],
  });
  record("A10 P1 crouch", p1Crouch[0].state === "crouch", { p1: p1Crouch[0], screenshot: p1CrouchShot });
  record("A10 P1 jump", p1Jump[0].state === "airborne" && p1Jump[0].y < 32000, { p1: p1Jump[0], screenshot: p1JumpShot });
  record("A10 P2 walk", walking(p2WalkA, 1, "walk_forward") && walking(p2WalkB, 1, "walk_forward") && walkFrame(p2WalkA[1]) !== walkFrame(p2WalkB[1]), {
    a: p2WalkA[1],
    b: p2WalkB[1],
    walkFrames: [walkFrame(p2WalkA[1]), walkFrame(p2WalkB[1])],
    screenshot: p2WalkShot,
  });
  record("A10 P2 crouch", p2Crouch[1].state === "crouch", { p2: p2Crouch[1], screenshot: p2CrouchShot });
  record("A10 P2 jump", p2Jump[1].state === "airborne" && p2Jump[1].y < 32000, { p2: p2Jump[1], screenshot: p2JumpShot });
  record("A10 push", duringPush[1].x > beforePush[1].x && duringPush[1].x - duringPush[0].x === 4600, {
    before: beforePush,
    during: duringPush,
    screenshot: pushShot,
  });

  // --- A11: URL params, unknown slug warning, F1 overlay ---------------------
  await open("?p1=jewoo-lee&p2=veronica-marallag");
  await sleep(300);
  const picked = await fighters();
  const pickedSources = (await evaluate("window.__game.info()")).clipSources;
  const pickedShot = await screenshot("a11-jewoo-vs-veronica");
  record("A11 params", picked[0].slug === "jewoo-lee" && picked[1].slug === "veronica-marallag", {
    slugs: picked.map((f) => f.slug),
    clipSources: pickedSources,
    screenshot: pickedShot,
  });

  await open("?p1=nobody");
  await sleep(300);
  const fallback = await fighters();
  const warnings = consoleMessages.filter((m) => m.type === "warning");
  const fallbackShot = await screenshot("a11-unknown-p1");
  record("A11 unknown slug", fallback[0].slug === "julien-hovan" && warnings.some((w) => w.text.includes("nobody")), {
    slugs: fallback.map((f) => f.slug),
    warnings,
    screenshot: fallbackShot,
  });

  const overlayState = () =>
    evaluate("(() => { const el = document.getElementById('debug-overlay'); return { hidden: el.hidden, display: getComputedStyle(el).display, text: el.textContent }; })()");
  const before = await overlayState();
  await down("F1");
  await up("F1");
  await sleep(300);
  const shown = await overlayState();
  const shownShot = await screenshot("a11-overlay-on");
  await down("F1");
  await up("F1");
  await sleep(300);
  const hidden = await overlayState();
  const hiddenShot = await screenshot("a11-overlay-off");
  const fields = ["sim frame", "render fps", "steps/frame", "P1 state", "P2 state"];
  record("A11 F1 overlay", before.hidden && !shown.hidden && shown.display !== "none" && fields.every((f) => shown.text.includes(f)) && hidden.hidden && hidden.display === "none", {
    before,
    shown,
    hidden,
    screenshots: [shownShot, hiddenShot],
  });
} catch (err) {
  record("script", false, { error: String(err) });
} finally {
  writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2) + "\n");
  ws.close();
  chrome.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
