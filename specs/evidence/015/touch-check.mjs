// Spec 015 browser checks A2 to A5 (and the landscape lock of R3) over the
// Chrome DevTools Protocol, with a private headless Chrome:
//   A3  a desktop page used with the keyboard hides the controls; the first touch shows them
//   A5  touch-action, overscroll-behavior, user-select and the viewport meta; no pinch zoom
//   A2  a phone (844x390, device scale 3, mobile, touch) plays from the title to the
//       results by touch only: VS CPU, a fighter and a level, walk, jump, punch,
//       special, throw (d-pad held with one finger while another taps), pause, resume
//   A4  portrait shows the rotate screen and freezes the match; landscape continues it
//   R3  entering fullscreen asks for a landscape lock
//
// Usage (dev server running, e.g. `./dm dev`):
//   node specs/evidence/015/touch-check.mjs http://127.0.0.1:5173/ specs/evidence/015
// Writes screenshots and touch-results.json into the output directory and exits 0
// only when every check passes.
import { launchChrome, openPage, recorder, sleep } from "./cdp.mjs";

const BASE = process.argv[2] ?? "http://127.0.0.1:5173/";
const OUT = process.argv[3] ?? "specs/evidence/015";
const { record, finish } = recorder(OUT, "touch-results.json");
const browser = await launchChrome();
const p = await openPage(browser, OUT);
const { evaluate, shot } = p;

const info = () => evaluate("window.__game.info().screen");
const scene = () => evaluate("window.__game.scene");
const menu = () => evaluate("window.__game.menu()");
const snap = () => evaluate("window.__game.snapshot()");
const events = () => evaluate("window.__game.events()");
const display = (sel) => evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(sel)})).display`);

async function until(pred, timeoutMs = 8000, everyMs = 30) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await pred();
    if (v) return v;
    await sleep(everyMs);
  }
  return null;
}
const waitScene = (name, timeoutMs = 10000) => until(async () => ((await scene()) === name ? name : null), timeoutMs);
async function waitEvent(match, since, timeoutMs = 3000) {
  return until(async () => (await events()).slice(since).find(match) ?? null, timeoutMs, 15);
}

// --- touch helpers (finger ids: 1 the d-pad thumb, 2 the button thumb) -------
let pad = null;
const BTN = {};
async function measureControls() {
  pad = await p.center(".touch-dpad");
  for (const name of ["punch", "kick", "special", "throw", "pause"]) BTN[name] = await p.center(`.touch-btn-${name}`);
}
function padPoint(dir) {
  const r = pad.w * 0.36;
  const v = { right: [1, 0], left: [-1, 0], up: [0, -1], down: [0, 1], center: [0, 0], "up-right": [0.7, -0.7], "down-left": [-0.7, 0.7] }[dir];
  return { x: pad.x + v[0] * r, y: pad.y + v[1] * r };
}
async function padDown(dir) {
  const pt = padPoint(dir);
  await p.fingerDown(1, pt.x, pt.y);
}
async function padSlide(dir) {
  const pt = padPoint(dir);
  await p.fingerMove(1, pt.x, pt.y);
}
const padUp = () => p.fingerUp(1);
async function padTap(dir, ms = 60) {
  await padDown(dir);
  await sleep(ms);
  await padUp();
  await sleep(60);
}
async function press(name, ms = 60) {
  await p.tapAt(2, BTN[name].x, BTN[name].y, ms);
  await sleep(60);
}

// --- fight helpers -----------------------------------------------------------
const gapPx = (s) => Math.abs(s.fighters[1].x - s.fighters[0].x) / 100;
const toward = (s) => (s.fighters[1].x >= s.fighters[0].x ? "right" : "left");
const fighting = (s) => s && s.round.phase === "fight";
async function readyToAct(timeoutMs = 4000) {
  return until(async () => {
    const s = await snap();
    return s && fighting(s) && ["idle", "walk_forward", "walk_back", "crouch"].includes(s.fighters[0].state) ? s : null;
  }, timeoutMs, 20);
}
/** Holds the d-pad toward the CPU until close; the finger stays down when `keep`. */
async function approach(maxGap = 60, keep = false) {
  const s = await snap();
  await padDown(toward(s));
  await until(async () => {
    const t = await snap();
    return !fighting(t) || gapPx(t) <= maxGap;
  }, 5000, 15);
  if (!keep) {
    await padUp();
    await sleep(30);
  }
}

try {
  // ------------------------------------------------------------------ A3 --
  await p.desktop(1280, 720);
  await p.open(BASE);
  await sleep(300);
  await p.key("keyDown", "KeyS", "s");
  await sleep(80);
  await p.key("keyUp", "KeyS", "s");
  await sleep(80);
  const desk = await info();
  const deskDisplay = await display("#touch-controls");
  const movedByKeys = (await menu()).index === 1;
  record("A3 desktop + keyboard: controls hidden", !desk.touch.visible && deskDisplay === "none" && movedByKeys && Number.isInteger(desk.fit.scale), {
    touch: desk.touch,
    display: deskDisplay,
    menuMovedByKeyboard: movedByKeys,
    scale: desk.fit.scale,
    screenshot: await shot("a3-01-desktop-keyboard"),
  });
  await p.page("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await sleep(100);
  const beforeTouch = await info();
  await p.tapAt(9, 640, 120); // on the title art: the first touch, not on a control
  await sleep(150);
  const afterTouch = await info();
  record("A3 first touch shows the controls", !beforeTouch.touch.visible && afterTouch.touch.visible && (await display("#touch-controls")) !== "none", {
    before: beforeTouch.touch,
    after: afterTouch.touch,
    screenshot: await shot("a3-02-after-first-touch"),
  });
  // P2's keys leave them alone (P2 on a keyboard beside a touch P1); P1's keys hide them.
  await p.key("keyDown", "ArrowLeft", "ArrowLeft");
  await sleep(60);
  await p.key("keyUp", "ArrowLeft", "ArrowLeft");
  await sleep(100);
  const afterP2Key = await info();
  await p.key("keyDown", "KeyW", "w");
  await sleep(60);
  await p.key("keyUp", "KeyW", "w");
  await sleep(100);
  const afterKey = await info();
  record("A3 P2's key leaves them, P1's key press hides them again", afterP2Key.touch.visible && !afterKey.touch.visible && (await display("#touch-controls")) === "none", {
    afterP2Key: afterP2Key.touch,
    afterP1Key: afterKey.touch,
  });
  await p.page("Emulation.setTouchEmulationEnabled", { enabled: false });

  // ------------------------------------------------------------------ A5 --
  await p.phone(844, 390);
  await p.open(BASE);
  await sleep(300);
  const css = await evaluate(`(() => {
    const cs = (sel) => getComputedStyle(document.querySelector(sel));
    const us = (sel) => { const c = cs(sel); return c.userSelect || c.webkitUserSelect; };
    const sels = ["#game", "#touch-controls", ".touch-dpad", ".touch-btn-punch", ".touch-btn-kick", ".touch-btn-special", ".touch-btn-throw", ".touch-btn-pause"];
    return {
      touchAction: Object.fromEntries(["html", "body", ...sels].map((s) => [s, cs(s).touchAction])),
      overscroll: { html: cs("html").overscrollBehavior, body: cs("body").overscrollBehavior },
      userSelect: Object.fromEntries(["#touch-controls", ".touch-dpad", ".touch-btn-punch", ".touch-btn-pause"].map((s) => [s, us(s)])),
      touchCallout: cs("#touch-controls").webkitTouchCallout ?? null,
      viewport: document.querySelector('meta[name="viewport"]').content,
    };
  })()`);
  const allNone = Object.values(css.touchAction).every((v) => v === "none");
  const overscrollNone = css.overscroll.html === "none" && css.overscroll.body === "none";
  const noSelect = Object.values(css.userSelect).every((v) => v === "none");
  const vp = css.viewport.replace(/\s/g, "");
  const noZoom = vp.includes("user-scalable=no") && vp.includes("maximum-scale=1") && vp.includes("width=device-width");
  record("A5 touch-action none on the game area and controls", allNone, { touchAction: css.touchAction });
  record("A5 overscroll-behavior none", overscrollNone, { overscroll: css.overscroll });
  record("A5 user-select none on the controls", noSelect, { userSelect: css.userSelect, touchCallout: css.touchCallout });
  record("A5 viewport meta disables zoom", noZoom, { viewport: css.viewport });
  // Behavior, not only CSS: a pinch and a double tap leave the page at scale 1.
  await p.page("Input.synthesizePinchGesture", { x: 422, y: 150, scaleFactor: 2.5, gestureSourceType: "touch" });
  await sleep(200);
  const pinchScale = await evaluate("visualViewport.scale");
  await p.page("Input.synthesizeTapGesture", { x: 422, y: 150, tapCount: 2, gestureSourceType: "touch" });
  await sleep(400);
  const doubleTapScale = await evaluate("visualViewport.scale");
  const scrollY = await evaluate("window.scrollY");
  record("A5 pinch and double tap do not zoom", pinchScale === 1 && doubleTapScale === 1 && scrollY === 0, { pinchScale, doubleTapScale, scrollY });
  // No tap delay: the press registers on touchstart, before any click.
  await measureControls();
  await p.fingerDown(2, BTN.special.x, BTN.special.y);
  const heldAtOnce = (await info()).touch.held;
  await p.fingerUp(2);
  record("A5 a press registers on touch-down (no 300 ms delay)", heldAtOnce === 64, { heldRightAfterTouchStart: heldAtOnce });

  // ------------------------------------------------------------------ R3 --
  await evaluate(`window.__locks = []; screen.orientation.lock = (o) => { window.__locks.push(o); return Promise.resolve(); }; 1`);
  await evaluate("document.documentElement.requestFullscreen().then(() => true, (e) => String(e))", true);
  const locks = await until(async () => ((await evaluate("window.__locks")).length ? evaluate("window.__locks") : null), 2000);
  await evaluate("document.fullscreenElement ? document.exitFullscreen().then(() => true) : true");
  record("R3 fullscreen asks for a landscape lock", Array.isArray(locks) && locks[0] === "landscape", { locks });

  // ------------------------------------------------------------------ A2 --
  await p.open(BASE);
  await sleep(400);
  await measureControls();
  const title = await info();
  // Pause only shows in a fight (on menus Start just confirms, as Punch does).
  const titleButtons = ["punch", "kick", "special", "throw"].every((n) => BTN[n]) && BTN.pause === null;
  record("A2 phone: controls on the title (Pause hidden on menus), canvas fills the height", title.touch.visible && Math.abs(title.fit.cssHeight - 390) < 0.01 && !!pad && titleButtons, {
    fit: title.fit,
    dpad: pad,
    buttons: BTN,
    screenshot: await shot("a2-01-title-controls"),
  });

  // Title: VS CPU is selected; Punch confirms.
  await press("punch");
  record("A2 title: VS CPU by touch", (await waitScene("select")) === "select" && (await menu()).mode === "cpu", { menu: await menu() });

  // Select: walk the cursor to Julien with the d-pad, pick with Punch, Random for the CPU, then Easy.
  await until(async () => ((await menu()).playable.length >= 4 ? true : null), 5000);
  let m = await menu();
  const target = m.tiles.indexOf("julien-hovan");
  for (let i = 0; i < 12 && m.cursors[0] !== target; i++) {
    const [r0, c0] = [Math.floor(m.cursors[0] / 8), m.cursors[0] % 8];
    const [r1, c1] = [Math.floor(target / 8), target % 8];
    await padTap(r0 !== r1 ? (r1 > r0 ? "down" : "up") : c1 > c0 ? "right" : "left");
    m = await menu();
  }
  const picked = m.under[0];
  await press("punch");
  await until(async () => ((await menu()).stage === "cpu" ? true : null), 2000);
  await press("punch"); // the CPU's fighter: the random tile
  await until(async () => ((await menu()).stage === "level" ? true : null), 2000);
  await padTap("left"); // Normal -> Easy
  m = await menu();
  const levelShot = await shot("a2-02-select-level");
  await press("punch");
  m.final = await menu();
  record("A2 select: fighter and level by touch", picked === "julien-hovan" && m.final.locked[0] === "julien-hovan" && m.level === "easy" && m.final.stage === "ready", {
    picked,
    locked: m.final.locked,
    level: m.level,
    screenshot: levelShot,
  });

  await waitScene("fight", 15000);
  const live = await until(async () => {
    const s = await snap();
    return fighting(s) ? s : null;
  }, 10000);
  const fightMenu = await menu();
  await measureControls(); // Pause appears with the fight
  record("A2 VS CPU fight starts, Pause shows", !!live && fightMenu.mode === "cpu" && fightMenu.cpu[1] === "easy" && fightMenu.fighters[0] === "julien-hovan" && !!BTN.pause, {
    menu: fightMenu,
    pause: BTN.pause,
  });

  // Walk: hold the d-pad toward the CPU.
  let s = await snap();
  const x0 = s.fighters[0].x;
  await padDown(toward(s));
  await sleep(150);
  const walking = (await snap()).fighters[0].state;
  await sleep(250);
  const walkShot = await shot("a2-03-walk");
  await padUp();
  s = await snap();
  record("A2 walk by d-pad", walking === "walk_forward" && Math.abs(s.fighters[0].x - x0) > 2000, { state: walking, movedPx: Math.abs(s.fighters[0].x - x0) / 100, screenshot: walkShot });

  // Jump: flick the d-pad up.
  await readyToAct();
  let n = (await events()).length;
  await padTap("up", 70);
  const jump = await waitEvent((e) => e.type === "jump" && e.player === 0, n, 1500);
  record("A2 jump by d-pad", !!jump, { jump });
  await until(async () => ((await snap()).fighters[0].state === "idle" ? true : null), 3000);

  // Punch lands.
  let punch = null;
  for (let k = 0; k < 8 && !punch; k++) {
    await readyToAct();
    await approach(58);
    n = (await events()).length;
    await press("punch", 50);
    punch = await waitEvent((e) => e.type === "hit" && e.player === 0 && e.move.includes("punch"), n, 700);
  }
  record("A2 punch lands", !!punch, { hit: punch });

  // Pressed button: d-pad held toward the CPU (finger 1) while Kick is held (finger 2): forward + Kick.
  let heavy = null;
  let pressedShot = null;
  for (let k = 0; k < 8 && !heavy; k++) {
    await readyToAct();
    await approach(60, true); // finger 1 stays down
    n = (await events()).length;
    await p.fingerDown(2, BTN.kick.x, BTN.kick.y);
    await sleep(70);
    const both = (await info()).touch.held;
    if (!pressedShot && (both & 32) && (both & 12)) pressedShot = await shot("a2-04-pressed-button");
    await p.fingerUp(2);
    await padUp();
    heavy = await waitEvent((e) => e.type === "attack" && e.player === 0 && e.move === "heavy_kick", n, 600);
  }
  record("A2 multi-touch: d-pad held while Kick is tapped (forward + Kick)", !!heavy && !!pressedShot, { attack: heavy, screenshot: pressedShot });

  // Special lands.
  let special = null;
  for (let k = 0; k < 10 && !special; k++) {
    await readyToAct();
    s = await snap();
    if (gapPx(s) > 120) await approach(110);
    n = (await events()).length;
    await press("special", 50);
    special = await waitEvent((e) => e.type === "hit" && e.player === 0 && e.move === "special", n, 1500);
  }
  record("A2 special lands", !!special, { hit: special });

  // Throw lands.
  let thrown = null;
  for (let k = 0; k < 10 && !thrown; k++) {
    await readyToAct();
    await approach(40);
    n = (await events()).length;
    await press("throw", 50);
    thrown = await waitEvent((e) => e.type === "throw" && e.player === 0, n, 900);
  }
  record("A2 throw lands", !!thrown, { throw: thrown });

  // Pause and resume.
  await until(async () => ((await scene()) === "fight" ? true : null), 3000);
  await press("pause");
  const paused = await waitScene("pause", 2000);
  const f1 = await evaluate("window.__game.simFrame");
  await sleep(300);
  const f2 = await evaluate("window.__game.simFrame");
  const pauseShot = await shot("a2-05-pause");
  await press("punch"); // RESUME is selected
  const resumed = await waitScene("fight", 2000);
  await sleep(200);
  const f3 = await evaluate("window.__game.simFrame");
  record("A2 pause and resume by touch", paused === "pause" && f1 === f2 && resumed === "fight" && f3 > f2, { frames: [f1, f2, f3], screenshot: pauseShot });

  // Finish the match: forward + Kick until the results.
  const t0 = Date.now();
  while ((await scene()) !== "results" && Date.now() - t0 < 240000) {
    const cur = await snap();
    if (!cur || !fighting(cur) || !["idle", "walk_forward", "walk_back", "crouch"].includes(cur.fighters[0].state)) {
      await sleep(40);
      continue;
    }
    await approach(60, true);
    await p.fingerDown(2, BTN.kick.x, BTN.kick.y);
    await sleep(60);
    await p.fingerUp(2);
    await padUp();
    await sleep(80);
  }
  const results = (await scene()) === "results" ? await menu() : null;
  await sleep(600);
  record("A2 match finished: results", !!results, { results, seconds: Math.round((Date.now() - t0) / 1000), screenshot: await shot("a2-06-results") });

  // Results menu by touch: down to CHARACTER SELECT, Punch.
  await padTap("down");
  const item = (await menu())?.item;
  await press("punch");
  const back = await waitScene("select", 3000);
  record("A2 results menu by touch", item === "CHARACTER SELECT" && back === "select", { item, scene: back });
  const errors = p.consoleMessages.filter((m2) => m2.type === "error");
  record("A2 no console errors", errors.length === 0, { errors });

  // ------------------------------------------------------------------ A4 --
  await p.phone(390, 844);
  await p.open(BASE, "!!window.__game"); // frozen behind the rotate screen: no frames to wait for
  await sleep(300);
  const portraitTitle = await info();
  const frozenTitle = await evaluate("window.__game.frame");
  const rotDisplay = await display("#rotate-screen");
  record("A4 portrait: rotate screen on load", portraitTitle.rotating && rotDisplay !== "none" && frozenTitle === 0, {
    rotating: portraitTitle.rotating,
    display: rotDisplay,
    framesStepped: frozenTitle,
    screenshot: await shot("a4-01-portrait-rotate"),
  });

  await p.phone(844, 390);
  await p.open(`${BASE}?cpu=easy`, "!!window.__game && window.__game.simFrame > 2");
  await until(async () => (fighting(await snap()) ? true : null), 10000);
  await measureControls();
  await padDown("right");
  await sleep(300);
  await padUp();
  const before = await snap();
  await p.phone(390, 844); // turn to portrait mid-match
  await sleep(200);
  const turned = await info();
  const fa = await evaluate("window.__game.simFrame");
  await sleep(500);
  const fb = await evaluate("window.__game.simFrame");
  const midShot = await shot("a4-02-portrait-mid-match");
  record("A4 portrait mid-match: rotate screen, match frozen", turned.rotating && (await display("#rotate-screen")) !== "none" && fa === fb, {
    rotating: turned.rotating,
    frames: [fa, fb],
    screenshot: midShot,
  });
  await p.phone(844, 390); // back to landscape
  await sleep(100);
  const resumedAt = await evaluate("window.__game.simFrame");
  await sleep(400);
  const after = await snap();
  const back2 = await info();
  // It continues from the frozen frame (no jump ahead), in the same round of the same fight.
  record(
    "A4 landscape again: rotate screen gone, the match continues",
    !back2.rotating && (await display("#rotate-screen")) === "none" && (await scene()) === "fight" && resumedAt - fb <= 15 && after.frame > resumedAt && after.round.number === before.round.number,
    { rotating: back2.rotating, frames: { frozen: fb, at100ms: resumedAt, at500ms: after.frame }, round: after.round.number, screenshot: await shot("a4-03-landscape-continues") },
  );
} catch (err) {
  record("script", false, { error: String(err?.stack ?? err) });
} finally {
  browser.close();
}
process.exit(finish());
