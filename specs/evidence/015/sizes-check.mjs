// Spec 015 A6 (R5) and the safe-area part of R3: the game at every R5 size.
// Phones and tablets are emulated as touch devices (mobile, touch, device
// scale 3 or 2), desktops without touch at device scale 1. At each size the
// check measures the canvas (whole, inside the viewport, 16:9, filling one
// side, integer scale on desktops, pixelated), the controls (shown only on
// touch sizes, never over the health bars) and the rotate screen (portrait),
// and screenshots the title and a fight. Then an iPhone-style notch (safe-area
// insets 47/47 left and right, 21 bottom) keeps the canvas and controls inside.
//
// Usage (dev server running, e.g. `./dm dev`):
//   node specs/evidence/015/sizes-check.mjs http://127.0.0.1:5173/ specs/evidence/015
// Writes screenshots and sizes-results.json into the output directory and exits 0
// only when every check passes.
import { launchChrome, openPage, recorder, sleep } from "./cdp.mjs";

const BASE = process.argv[2] ?? "http://127.0.0.1:5173/";
const OUT = process.argv[3] ?? "specs/evidence/015";
const { record, finish } = recorder(OUT, "sizes-results.json");
const browser = await launchChrome();
const p = await openPage(browser, OUT);
const { evaluate, shot } = p;

// [width, height, kind]
const SIZES = [
  [375, 667, "portrait phone"],
  [390, 844, "portrait phone"],
  [667, 375, "phone"],
  [844, 390, "phone"],
  [932, 430, "phone"],
  [1024, 768, "tablet"],
  [1180, 820, "tablet"],
  [1366, 768, "desktop"],
  [1920, 1080, "desktop"],
  [2560, 1440, "desktop"],
];
// The HUD's health bars, portraits and pips in canvas pixels (src/input/touch.ts HUD_BARS).
const HUD_BARS = [
  { x: 14, y: 14, w: 290, h: 34 },
  { x: 336, y: 14, w: 290, h: 34 },
];

/** Canvas, controls and rotate screen as laid out in the page. */
const measure = () =>
  evaluate(`(() => {
    const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return r.width && r.height ? { x: r.left, y: r.top, w: r.width, h: r.height } : null; };
    const c = document.getElementById("game");
    const controls = [...document.querySelectorAll("#touch-controls [data-control]")].map((el) => ({ name: el.dataset.control, box: box(el) }));
    return {
      vw: innerWidth, vh: innerHeight,
      canvas: { ...box(c), width: c.width, height: c.height, imageRendering: getComputedStyle(c).imageRendering },
      controlsShown: getComputedStyle(document.getElementById("touch-controls")).display !== "none",
      controls,
      rotateShown: getComputedStyle(document.getElementById("rotate-screen")).display !== "none",
      screen: window.__game.info().screen,
    };
  })()`);

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const near = (a, b, eps = 0.6) => Math.abs(a - b) <= eps;

function canvasOk(m, kind) {
  const c = m.canvas;
  const inside = c.x >= -0.5 && c.y >= -0.5 && c.x + c.w <= m.vw + 0.5 && c.y + c.h <= m.vh + 0.5;
  const ratio = near(c.w / c.h, 16 / 9, 0.01);
  const fillsOneSide = near(c.w, m.vw, 1) || near(c.h, m.vh, 1);
  const k = m.screen.fit.scale;
  const integer = Number.isInteger(k) && near(c.w, 640 * k) && near(c.h, 360 * k);
  const crisp = c.width === 640 && c.height === 360 && c.imageRendering === "pixelated";
  const scaleOk = kind === "desktop" ? integer : fillsOneSide;
  return { pass: inside && ratio && scaleOk && crisp, inside, ratio, scaleOk, crisp, scale: k };
}

/** `inFight`: the d-pad, four buttons and Pause (6); on menus Pause is hidden (5). Tablets also check Pause sits in the top letterbox (QA 2026-11-12 F2). */
function controlsOk(m, kind, inFight) {
  if (kind === "desktop") return { pass: !m.controlsShown, shown: m.controlsShown };
  if (kind === "portrait phone") return { pass: m.rotateShown, rotateShown: m.rotateShown };
  const fit = m.screen.fit;
  const bars = HUD_BARS.map((r) => ({ x: fit.left + r.x * fit.scale, y: fit.top + r.y * fit.scale, w: r.w * fit.scale, h: r.h * fit.scale }));
  const boxes = m.controls.filter((c) => c.box);
  const overBars = boxes.filter((c) => bars.some((b) => overlaps(c.box, b))).map((c) => c.name);
  const outside = boxes.filter((c) => c.box.x < 0 || c.box.y < 0 || c.box.x + c.box.w > m.vw + 0.5 || c.box.y + c.box.h > m.vh + 0.5).map((c) => c.name);
  const expected = inFight ? 6 : 5;
  const pauseOk = boxes.some((c) => c.name === "pause") === inFight;
  const pass = m.controlsShown && !m.rotateShown && boxes.length === expected && pauseOk && overBars.length === 0 && outside.length === 0;
  return { pass, shown: m.controlsShown, count: boxes.length, overBars, outside };
}

try {
  for (const [w, h, kind] of SIZES) {
    const tag = `a6-${w}x${h}`;
    if (kind === "desktop") await p.desktop(w, h);
    else await p.phone(w, h, kind === "tablet" ? 2 : 3);
    const portrait = kind === "portrait phone";
    // A page opened in portrait on a phone is frozen behind the rotate screen, so only wait for the boot.
    await p.open(BASE, portrait ? "!!window.__game" : "!!window.__game && window.__game.frame > 2");
    await sleep(400);
    const title = await measure();
    const titleShot = await shot(`${tag}-title`);
    let underShot = null;
    let fightShot = null;
    let fight = null;
    if (portrait) {
      // The same page with the rotate screen lifted for the picture: the canvas fit underneath.
      await evaluate(`document.getElementById("rotate-screen").style.visibility = "hidden"; 1`);
      await sleep(100);
      underShot = await shot(`${tag}-under-rotate`);
      await evaluate(`document.getElementById("rotate-screen").style.visibility = ""; 1`);
    } else {
      await p.open(`${BASE}?cpu=easy`, "!!window.__game && window.__game.simFrame > 2");
      await sleep(700);
      fight = await measure();
      fightShot = await shot(`${tag}-fight`);
    }
    const cv = canvasOk(fight ?? title, kind);
    const ctl = controlsOk(fight ?? title, kind, !!fight);
    const ctlTitle = controlsOk(title, kind, false);
    record(`A6 ${w}x${h} (${kind})`, cv.pass && ctl.pass && ctlTitle.pass, {
      canvas: { ...(fight ?? title).canvas },
      fit: cv,
      controls: ctl,
      titleControls: ctlTitle,
      screenshots: [titleShot, underShot, fightShot].filter(Boolean),
    });
    if (fight && kind === "tablet") {
      // QA 2026-11-12 F2: a tablet's top letterbox holds Pause (at 1024x768 it used to miss by 2 px
      // and fall back over the stage, where a jumping fighter's head passes).
      const pause = fight.controls.find((c) => c.name === "pause")?.box ?? null;
      const inTop = !!pause && pause.y >= 0 && pause.y + pause.h <= fight.canvas.y + 0.5 && pause.w >= 44;
      record(`F2 ${w}x${h}: Pause sits in the top letterbox`, inTop, { pause, canvasTop: fight.canvas.y });
    }
  }

  // Crisp edges at fractional scales: zoomed crops of the title lettering.
  for (const [w, h, dpr] of [
    [844, 390, 3],
    [1024, 768, 2],
  ]) {
    await p.phone(w, h, dpr);
    await p.open(BASE);
    await sleep(400);
    const m = await measure();
    const f = m.screen.fit;
    // "COMPASS" spans canvas x 180..460, y 30..75.
    const clip = { x: f.left + 230 * f.scale, y: f.top + 34 * f.scale, width: 60 * f.scale, height: 30 * f.scale, scale: 4 };
    record(`A6 crisp crop ${w}x${h} at x${dpr}`, m.canvas.imageRendering === "pixelated", { scale: f.scale, screenshot: await shot(`a6-crisp-${w}x${h}`, clip) });
  }

  // Safe area: a notch on both sides and the home indicator at the bottom.
  const insets = { top: 0, left: 47, right: 47, bottom: 21 };
  let supported = true;
  await p.phone(844, 390);
  try {
    await p.page("Emulation.setSafeAreaInsetsOverride", { insets });
  } catch (err) {
    supported = false;
    record("R3 safe-area insets", false, { error: `Emulation.setSafeAreaInsetsOverride: ${err}` });
  }
  if (supported) {
    await p.open(`${BASE}?cpu=easy`, "!!window.__game && window.__game.simFrame > 2");
    await sleep(700);
    const m = await measure();
    const c = m.canvas;
    const canvasInside = c.x >= insets.left - 0.5 && c.x + c.w <= m.vw - insets.right + 0.5 && c.y + c.h <= m.vh - insets.bottom + 0.5;
    const boxes = m.controls.filter((x) => x.box);
    const controlsInside = boxes.length === 6 && boxes.every((x) => x.box.x >= insets.left - 0.5 && x.box.x + x.box.w <= m.vw - insets.right + 0.5 && x.box.y + x.box.h <= m.vh - insets.bottom + 0.5);
    const ctl = controlsOk(m, "phone", true);
    record("R3 safe-area insets: canvas and controls stay inside", canvasInside && controlsInside && ctl.pass, {
      insets,
      measuredInsets: await evaluate("window.__game.info().screen && (() => { const d = [...document.body.children].find((e) => e.style.cssText.includes('safe-area')); const cs = getComputedStyle(d); return [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft]; })()"),
      canvas: c,
      controls: ctl,
      screenshot: await shot("a6-844x390-notch"),
    });
    await p.page("Emulation.setSafeAreaInsetsOverride", { insets: {} }).catch(() => {});
  }
  const errors = p.consoleMessages.filter((m) => m.type === "error");
  record("A6 no console errors", errors.length === 0, { errors });
} catch (err) {
  record("script", false, { error: String(err?.stack ?? err) });
} finally {
  browser.close();
}
process.exit(finish());
