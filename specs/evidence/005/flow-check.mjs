// Spec 005 browser checks (A2, A3, A5, A6, and the VS CPU shortcut) over the
// Chrome DevTools Protocol, with a private headless Chrome (no shared browser,
// no extra deps). Plays the real game with key events and screenshots each screen.
//
// Usage (dev server running, e.g. `npx vite --port 5301 --strictPort`):
//   node specs/evidence/005/flow-check.mjs http://127.0.0.1:5301/ specs/evidence/005
// Writes screenshots and results.json into the output directory and exits 0
// only when every check passes. Waits poll game state (scene, sim frame), not wall time.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://127.0.0.1:5301/";
const OUT = process.argv[3] ?? "specs/evidence/005";
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = {};
let failures = 0;
function record(id, pass, detail) {
  results[id] = { pass, ...detail };
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"} ${id} ${JSON.stringify(detail)}`);
}

// --- Chrome + CDP plumbing (as in specs/evidence/003/fight-check.mjs) ------
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
    consoleMessages.push({ type: evt.params.type, text: evt.params.args.map((a) => a.value ?? a.description ?? "").join(" ") });
  }
});

async function evaluate(expression) {
  const res = await page("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
  return res.result.value;
}

// --- game helpers ---------------------------------------------------------
async function open(query = "") {
  await page("Page.navigate", { url: BASE + query });
  for (let i = 0; i < 300; i++) {
    const ready = await evaluate("!!(window.__game && window.__game.frame > 2)").catch(() => false);
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
// code -> [key, keyCode, text]
const KEYS = {
  KeyW: ["w", 87, "w"], KeyA: ["a", 65, "a"], KeyS: ["s", 83, "s"], KeyD: ["d", 68, "d"],
  KeyF: ["f", 70, "f"], KeyG: ["g", 71, "g"], KeyH: ["h", 72, "h"],
  KeyL: ["l", 76, "l"], Semicolon: [";", 186, ";"], Quote: ["'", 222, "'"], Slash: ["/", 191, "/"],
  ArrowUp: ["ArrowUp", 38], ArrowDown: ["ArrowDown", 40], ArrowLeft: ["ArrowLeft", 37], ArrowRight: ["ArrowRight", 39],
  Enter: ["Enter", 13, "\r"], Escape: ["Escape", 27],
};
async function key(type, code) {
  const [k, vk, text] = KEYS[code];
  const params = { type, code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
  if (type === "keyDown" && text) params.text = text;
  await page("Input.dispatchKeyEvent", params);
}
const down = (code) => key("keyDown", code);
const up = (code) => key("keyUp", code);
/** Press for a few sim steps (the tap latch would also catch a shorter one). */
async function tap(code) {
  await down(code);
  await waitFrames(3);
  await up(code);
  await waitFrames(2);
}
const frame = () => evaluate("window.__game.frame");
async function waitFrames(n) {
  const start = await frame();
  for (let i = 0; i < 400; i++) {
    if ((await frame()) >= start + n) return;
    await sleep(10);
  }
  throw new Error(`stalled waiting ${n} frames`);
}
const menu = () => evaluate("window.__game.menu()");
const scene = () => evaluate("window.__game.scene");
const snap = () => evaluate("window.__game.snapshot()");
const events = () => evaluate("window.__game.events()");
async function waitUntil(expr, timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await evaluate(expr).catch(() => null);
    if (v) return v;
    await sleep(25);
  }
  return null;
}
const waitScene = (name, timeoutMs) => waitUntil(`window.__game.scene === ${JSON.stringify(name)}`, timeoutMs);
async function waitEvent(pred, since, timeoutMs = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const evs = await events();
    const e = evs.slice(since).find(pred);
    if (e) return e;
    await sleep(15);
  }
  return null;
}
async function waitSim(pred, timeoutMs = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const s = await snap();
    if (s && pred(s)) return s;
    await sleep(25);
  }
  return null;
}
const gapPx = (s) => Math.abs(s.fighters[1].x - s.fighters[0].x) / 100;

try {
  await page("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });

  // --- A2: P2's L ; ' start moves; ' and / never reach the browser ----------
  await open("?p1=julien-hovan&p2=julien-hovan&mode=training");
  await waitUntil("window.__game.simFrame > 10");
  await evaluate(`(() => {
    window.__keylog = [];
    for (const type of ["keydown", "keypress"]) {
      window.addEventListener(type, (e) => window.__keylog.push({ type, code: e.code, prevented: e.defaultPrevented }));
    }
    return true;
  })()`);
  const p2Moves = {};
  for (const [code, move] of [["KeyL", "light_punch"], ["Semicolon", "light_kick"], ["Quote", "special"]]) {
    await waitSim((s) => s.fighters[1].state === "idle" && s.projectiles.length === 0, 6000);
    const n = (await events()).length;
    await tap(code);
    const e = await waitEvent((x) => x.type === "attack" && x.player === 1, n);
    p2Moves[code] = e?.move ?? null;
    record(`A2 P2 ${code} starts ${move}`, e?.move === move, { event: e });
  }
  await waitSim((s) => s.fighters[1].state === "idle", 6000);
  await evaluate("window.__keylog.length = 0");
  await tap("Quote");
  await tap("Slash");
  const focus = await evaluate(`({ active: document.activeElement === document.body ? "body" : String(document.activeElement && document.activeElement.tagName), hasFocus: document.hasFocus(), log: window.__keylog })`);
  const downs = focus.log.filter((e) => e.type === "keydown");
  const presses = focus.log.filter((e) => e.type === "keypress");
  record(
    "A2 ' and / prevented",
    downs.length === 2 && downs.every((e) => e.prevented) && presses.length === 0 && focus.active === "body",
    { ...focus, screenshot: await shot("a2-p2-keys") },
  );

  // --- A5 + A6: title -> select -> versus -> fight -> results -> rematch -----
  await evaluate("localStorage.clear(), true");
  await open("");
  await waitFrames(20);
  record("A5 title", (await scene()) === "title", { menu: await menu(), screenshot: await shot("a5-01-title") });
  await tap("KeyS"); // VS PLAYER
  await tap("KeyF");
  await waitScene("select");
  await waitUntil("window.__game.menu().playable.includes('julien-hovan')");
  await waitFrames(30);
  record("A5 select", (await scene()) === "select", { menu: await menu(), screenshot: await shot("a5-02-select") });

  // A dimmed "coming soon" tile cannot be confirmed: step right until P1 is on one
  // (several fighters are playable now, so it is not simply the tile next to Julien).
  const playable = (await menu()).playable;
  let steps = 0;
  while (steps < 12 && playable.includes((await menu()).under[0])) {
    await tap("KeyD");
    steps++;
  }
  await tap("KeyF");
  const refused = await menu();
  record("A5 coming soon cannot be picked", !playable.includes(refused.under[0]) && refused.under[0] !== "random" && refused.locked[0] === null, {
    under: refused.under,
    locked: refused.locked,
    playable,
    screenshot: await shot("a5-03-coming-soon"),
  });
  for (let k = 0; k < steps; k++) await tap("KeyA");
  await tap("KeyF"); // P1 picks Julien
  // P2 walks to the random tile (the last tile of the 8-column grid): down to its row, then across.
  {
    const m0 = await menu();
    const target = m0.tiles.length - 1;
    for (let k = 0; k < 10 && Math.floor((await menu()).cursors[1] / 8) !== Math.floor(target / 8); k++) await tap("ArrowDown");
    for (let k = 0; k < 10 && (await menu()).cursors[1] !== target; k++) {
      await tap((await menu()).cursors[1] < target ? "ArrowRight" : "ArrowLeft");
    }
  }
  const beforeRandom = await menu();
  await tap("KeyL"); // P2 picks the random tile
  const picked = await menu();
  record("A5 picks", picked.locked[0] === "julien-hovan" && beforeRandom.under[1] === "random" && playable.includes(picked.locked[1]), {
    locked: picked.locked,
    p2Under: beforeRandom.under[1],
    screenshot: await shot("a5-04-select-ready"),
  });
  await waitScene("versus");
  await waitFrames(40);
  record("A5 versus", (await scene()) === "versus", { menu: await menu(), screenshot: await shot("a5-05-versus") });

  await waitScene("fight", 20000);
  await waitUntil("window.__game.simFrame > 20");
  const intro = await menu();
  const legendsOk =
    JSON.stringify(intro.legends) ===
    JSON.stringify([["F PUNCH  G KICK  H SPECIAL", "WASD MOVE  F+G THROW"], ["L PUNCH  ; KICK  ' SPECIAL", "ARROWS MOVE  L+; THROW"]]);
  record("A6 round 1 intro legends", intro.phase === "intro" && intro.round === 1 && legendsOk, {
    legends: intro.legends,
    screenshot: await shot("a6-round1-intro-legends"),
  });

  // Fight to the results with heavy kicks (forward + Kick).
  await waitSim((s) => s.round.phase === "fight", 10000);
  const fightStart = Date.now();
  while (Date.now() - fightStart < 240000) {
    const sc = await scene();
    if (sc !== "fight") break;
    const s = await snap();
    if (s.round.phase !== "fight" || s.fighters[1].state !== "idle" || s.fighters[0].state !== "idle") {
      await sleep(60);
      continue;
    }
    if (gapPx(s) > 62) {
      await down("KeyD");
      await waitSim((x) => gapPx(x) <= 62 || x.round.phase !== "fight", 6000);
      await up("KeyD");
      continue;
    }
    await down("KeyD");
    await tap("KeyG");
    await up("KeyD");
    await waitFrames(20);
  }
  const results = await waitScene("results", 30000);
  await waitFrames(30);
  const res = await menu();
  record("A5 results", !!results && res.winner === 0, { menu: res, screenshot: await shot("a5-06-results") });

  await tap("KeyF"); // REMATCH
  await waitScene("fight");
  await waitUntil("window.__game.simFrame > 5");
  const rematch = await snap();
  record("A5 rematch", rematch.round.number === 1 && rematch.round.phase === "intro" && rematch.round.wins.join() === "0,0", {
    round: rematch.round,
    screenshot: await shot("a5-07-rematch"),
  });

  await waitFrames(130);
  await tap("Escape");
  await waitScene("pause");
  await waitFrames(5);
  record("A5 pause (legends showing)", (await scene()) === "pause", { menu: await menu(), screenshot: await shot("a5-08-pause") });
  await tap("KeyS");
  await tap("KeyS");
  await tap("KeyF"); // QUIT TO SELECT
  await waitScene("select");
  await waitFrames(20);
  const back = await menu();
  record("A5 quit to select", back.mode === "versus" && back.locked.join() === ",", { menu: back, screenshot: await shot("a5-09-back-to-select") });

  // --- A3: controls screen: swap, persistence, restore defaults, key test --
  await tap("Escape"); // select -> title
  await waitScene("title");
  for (let i = 0; i < 3; i++) await tap("KeyS"); // CONTROLS
  await tap("Enter");
  await waitScene("controls");
  for (let i = 0; i < 4; i++) await tap("KeyS"); // P1 PUNCH row
  await tap("Enter");
  const capturing = (await menu()).capturing;
  await tap("KeyL");
  await waitFrames(5);
  const swapped = await menu();
  record(
    "A3 rebind P1 Punch to L swaps with P2",
    capturing?.action === "punch" && swapped.bindings[0].punch[0] === "KeyL" && swapped.bindings[1].punch[0] === "KeyF",
    { capturing, status: swapped.status, p1: swapped.bindings[0].punch, p2: swapped.bindings[1].punch, screenshot: await shot("a3-01-controls-swap") },
  );
  const stored = await evaluate("localStorage.getItem('datamon.controls.v1')");
  await open("");
  await waitFrames(5);
  for (let i = 0; i < 3; i++) await tap("KeyS");
  await tap("Enter");
  await waitScene("controls");
  await waitFrames(5);
  const reloaded = await menu();
  record("A3 bindings survive a reload", reloaded.bindings[0].punch[0] === "KeyL" && reloaded.bindings[1].punch[0] === "KeyF", {
    stored,
    p1: reloaded.bindings[0].punch,
    p2: reloaded.bindings[1].punch,
    screenshot: await shot("a3-02-after-reload"),
  });
  await tap("KeyW"); // wraps to BACK
  await tap("KeyW"); // RESTORE DEFAULTS
  await tap("Enter");
  await waitFrames(5);
  const restored = await menu();
  const storedAfter = await evaluate("JSON.parse(localStorage.getItem('datamon.controls.v1')).players[0].punch[0]");
  record("A3 restore defaults", restored.bindings[0].punch[0] === "KeyF" && restored.bindings[1].punch[0] === "KeyL" && storedAfter === "KeyF", {
    status: restored.status,
    p1: restored.bindings[0].punch,
    p2: restored.bindings[1].punch,
    storedAfter,
    screenshot: await shot("a3-03-defaults-restored"),
  });
  const six = ["KeyF", "KeyG", "KeyH", "KeyL", "Semicolon", "Quote"];
  for (const c of six) await down(c);
  await waitFrames(4);
  const lit = (await menu()).lit;
  const allLit = ["punch", "kick", "special"].every((a) => lit[0].includes(a) && lit[1].includes(a));
  record("A3 key test lights F G H L ; ' together", allLit, { lit, screenshot: await shot("a3-04-key-test-six-held") });
  for (const c of six) await up(c);

  // --- VS CPU: the select steps and the ?cpu= shortcut ----------------------
  await tap("Escape");
  await waitScene("title");
  for (let i = 0; i < 3; i++) await tap("KeyW"); // CONTROLS -> VS CPU
  await tap("KeyF");
  await waitScene("select");
  await tap("KeyF"); // P1's fighter
  await tap("KeyF"); // the CPU's fighter (random tile)
  await tap("KeyD"); // HARD
  await waitFrames(10);
  const level = await menu();
  record("CPU select: fighter, CPU fighter, level", level.mode === "cpu" && level.stage === "level" && level.level === "hard", {
    menu: { stage: level.stage, level: level.level, locked: level.locked },
    screenshot: await shot("cpu-01-select-level"),
  });
  await tap("KeyF");
  await waitScene("fight", 20000);
  const cpuFight = await menu();
  record("CPU fight from the flow", cpuFight.mode === "cpu" && cpuFight.cpu[1] === "hard", { menu: cpuFight });

  await open("?cpu=easy");
  await waitUntil("window.__game.simFrame > 20");
  const shortcut = await menu();
  record("?cpu=easy shortcut", shortcut.mode === "cpu" && shortcut.cpu.join() === ",easy", { menu: shortcut, screenshot: await shot("cpu-02-shortcut-intro") });

  const errors = consoleMessages.filter((m) => m.type === "error");
  record("no console errors", errors.length === 0, { errors });
} catch (err) {
  record("script", false, { error: String(err) });
} finally {
  writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2) + "\n");
  ws.close();
  chrome.kill();
  await sleep(300);
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); // Chrome may still be exiting
  } catch {}
}
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
