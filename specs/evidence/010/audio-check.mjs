// Browser checks for spec 010 (A4, A5) over the Chrome DevTools Protocol, with
// a private headless Chrome (no shared browser, no extra deps). Headless Chrome
// cannot judge how anything sounds: this checks that the AudioContext starts on
// a real click, that every button schedules voices, that the music scheduler
// keeps time through a stall, mute, persistence, and that nothing logs an error.
//
// Usage (dev server running, e.g. `npx vite --port 5302 --strictPort`):
//   node specs/evidence/010/audio-check.mjs http://127.0.0.1:5302/ specs/evidence/010
// Writes a screenshot and results.json into the output directory and exits 0
// only when every check passes.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://127.0.0.1:5302/";
const OUT = process.argv[3] ?? "specs/evidence/010";
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

// --- Chrome + CDP plumbing (from specs/evidence/001 and 003) ----------------
const profile = mkdtempSync(join(tmpdir(), "datamon-audio-cdp-"));
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
await page("Log.enable");

const consoleMessages = [];
listeners.push((evt) => {
  if (evt.sessionId !== sessionId) return;
  if (evt.method === "Runtime.consoleAPICalled") {
    consoleMessages.push({
      type: evt.params.type,
      text: evt.params.args.map((a) => a.value ?? a.description ?? "").join(" "),
    });
  } else if (evt.method === "Runtime.exceptionThrown") {
    consoleMessages.push({ type: "error", text: evt.params.exceptionDetails?.exception?.description ?? "exception" });
  } else if (evt.method === "Log.entryAdded") {
    consoleMessages.push({ type: evt.params.entry.level === "error" ? "error" : evt.params.entry.level, text: evt.params.entry.text, url: evt.params.entry.url, source: "log" });
  }
});

async function evaluate(expression) {
  const res = await page("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: false });
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
  return res.result.value;
}

async function shot(name) {
  const { data } = await page("Page.captureScreenshot", { format: "png" });
  const path = join(OUT, `${name}.png`);
  writeFileSync(path, Buffer.from(data, "base64"));
  return path;
}

async function open() {
  await page("Page.navigate", { url: new URL("audio-test.html", BASE).href });
  for (let i = 0; i < 100; i++) {
    const ready = await evaluate("!!window.__audioTest").catch(() => false);
    if (ready) return;
    await sleep(100);
  }
  throw new Error("audio test page did not load");
}

/** A real mouse click (a user gesture) at the centre of a button. */
async function clickButton(action) {
  const rect = await evaluate(`(() => { const r = document.querySelector('[data-action="${action}"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await page("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
  await page("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
}
async function pressKey(code, key) {
  await page("Input.dispatchKeyEvent", { type: "keyDown", code, key, windowsVirtualKeyCode: 0 });
  await page("Input.dispatchKeyEvent", { type: "keyUp", code, key, windowsVirtualKeyCode: 0 });
}
const stats = () => evaluate("window.__audioTest.audio.stats()");
/** Clicks a button (DOM click) and returns how many voices it started right away. */
const voicesFor = (action) =>
  evaluate(`(() => { const a = window.__audioTest.audio; const b = a.stats().started; document.querySelector('[data-action="${action}"]').click(); return a.stats().started - b; })()`);

const IMMEDIATE = [
  "swing-light", "swing-heavy", "swing-special", "swing-throw",
  "hit-light", "hit-heavy", "hit-special",
  "block-light", "block-heavy", "block-special",
  "grab", "toss", "knockdown", "tech", "jump", "land",
  "projectile", "clash", "trade",
  "ko", "round-1", "round-3", "fight", "round-win", "time-win", "draw", "match-win",
  "ui-move", "ui-confirm", "ui-back", "stack",
];

try {
  await page("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await open();
  await evaluate("localStorage.removeItem('datamon.audio')");
  await open();

  const before = await stats();
  record("lazy: no context before input", before.status === "idle", { status: before.status });

  await clickButton("start");
  let s = before;
  for (let i = 0; i < 30 && s.status !== "running"; i++) {
    await sleep(100);
    s = await stats();
  }
  // The audio clock runs at wall-clock speed once started (measured over 1.5 s).
  await sleep(300);
  const c0 = await evaluate("({ audio: window.__audioTest.audio.stats().time, wall: performance.now() / 1000 })");
  await sleep(1500);
  const c1 = await evaluate("({ audio: window.__audioTest.audio.stats().time, wall: performance.now() / 1000 })");
  const rate = (c1.audio - c0.audio) / (c1.wall - c0.wall);
  record("click resumes a running AudioContext", s.status === "running" && rate > 0.9 && rate < 1.1, {
    status: s.status,
    clockRate: +rate.toFixed(3),
  });

  const perButton = {};
  for (const action of IMMEDIATE) {
    perButton[action] = await voicesFor(action);
    await sleep(action === "ko" || action === "match-win" || action === "stack" ? 600 : 120);
  }
  const silent = Object.entries(perButton).filter(([, n]) => n <= 0).map(([k]) => k);
  const afterButtons = await stats();
  record("every effect, stinger and menu button schedules voices", silent.length === 0 && afterButtons.dropped === 0, { perButton, silent, dropped: afterButtons.dropped });

  // Timed sequences: combo, timer countdown, full round.
  let b = (await stats()).started;
  await evaluate(`document.querySelector('[data-action="hit-combo"]').click()`);
  await sleep(700);
  const combo = (await stats()).started - b;
  b = (await stats()).started;
  await evaluate(`document.querySelector('[data-action="countdown"]').click()`);
  await sleep(11600);
  const countdown = (await stats()).started - b;
  record("combo and timer countdown schedule over time", combo >= 4 * 3 && countdown >= 10 * 2, { comboVoices: combo, countdownVoices: countdown });

  // Music: fight loop keeps time and survives a 400 ms main-thread stall.
  await evaluate(`document.querySelector('[data-action="music-fight"]').click()`);
  await sleep(2000);
  const m1 = await stats();
  const stepsPerSec = m1.musicSteps / 2;
  record("fight loop plays at 150 BPM (10 steps/s)", m1.track === "fight" && stepsPerSec > 9 && stepsPerSec < 12.5 && m1.late === 0, {
    track: m1.track, steps: m1.musicSteps, late: m1.late, musicVoices: m1.voices.music,
  });
  await shot("01-audio-test-fight-loop");
  await evaluate("(() => { const t = performance.now(); while (performance.now() - t < 400) {} return true; })()");
  await sleep(1000);
  const m2 = await stats();
  record("a 400 ms stall resyncs without late notes", m2.late === 0 && m2.resyncs >= 1 && m2.musicSteps > m1.musicSteps, {
    late: m2.late, resyncs: m2.resyncs, steps: m2.musicSteps,
  });

  const r0 = await stats();
  await evaluate(`document.querySelector('[data-action="full-round"]').click()`);
  await sleep(8500);
  const round = await stats();
  record("full round sequence with music under it", round.started - r0.started > 40 && round.late === 0 && round.dropped === r0.dropped, {
    voices: round.started - r0.started, late: round.late, droppedDuringRound: round.dropped - r0.dropped,
  });

  await evaluate(`document.querySelector('[data-action="music-select"]').click()`);
  await sleep(1500);
  const sel = await stats();
  record("select loop", sel.track === "select" && sel.late === 0, { track: sel.track, steps: sel.musicSteps });
  await shot("02-audio-test-select-loop");

  // M mutes: no voices while muted, back on M again.
  await pressKey("KeyM", "m");
  const muted = await stats();
  const whileMuted = await voicesFor("hit-heavy");
  await pressKey("KeyM", "m");
  const unmuted = await stats();
  const afterUnmute = await voicesFor("hit-heavy");
  record("M toggles mute; muted schedules nothing", muted.muted && whileMuted === 0 && !unmuted.muted && afterUnmute > 0, {
    whileMuted, afterUnmute,
  });

  await evaluate(`document.querySelector('[data-action="music-stop"]').click()`);
  await sleep(300);
  const stopped = await stats();
  record("music stops", stopped.track === null, { track: stopped.track });

  // Volumes persist in localStorage across a reload.
  await evaluate("window.__audioTest.audio.setVolume('music', 0.35)");
  await open();
  const persisted = await evaluate("window.__audioTest.audio.getVolume('music')");
  record("volume persists across reload", persisted === 0.35, { music: persisted });
  await evaluate("localStorage.removeItem('datamon.audio')");

  const errors = consoleMessages.filter((m) => m.type === "error");
  const warnings = consoleMessages.filter((m) => m.type === "warning" || m.type === "warn");
  record("no console errors", errors.length === 0, { errors, warnings });
} catch (err) {
  record("script", false, { error: String(err) });
} finally {
  writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
  ws.close();
  // Wait for Chrome to exit before removing its profile (it writes its cache while shutting down).
  const exited = new Promise((resolve) => chrome.once("exit", resolve));
  chrome.kill();
  await Promise.race([exited, sleep(5000)]);
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (err) {
    console.log(`note: could not remove ${profile}: ${err.code ?? err}`);
  }
}
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
