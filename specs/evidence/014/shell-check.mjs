// Browser checks for spec 014 (A4, A5, A6, A7 and the no-errors half of A8)
// over the Chrome DevTools Protocol, with a private headless Chrome.
//
// Usage (dev server running, e.g. `./dm dev`):
//   node specs/evidence/014/shell-check.mjs http://127.0.0.1:5177/ specs/evidence/014
// Writes screenshots and shell-results.json into the output directory and
// exits 0 only when every check passes. A2 (installability) is install-check.mjs,
// run against a production build.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchChrome, openPage, recorder, sleep } from "./cdp.mjs";

const BASE = process.argv[2] ?? "http://127.0.0.1:5173/";
const OUT = process.argv[3] ?? "specs/evidence/014";
mkdirSync(OUT, { recursive: true });
const rec = recorder();
const { results, record } = rec;
const browser = await launchChrome();

const isHidden = "document.getElementById('failure').hidden";

async function waitScene(p, name, timeoutMs = 15000) {
  return p.waitUntil(`window.__game?.scene === ${JSON.stringify(name)}`, timeoutMs);
}
async function menu(p) {
  return p.evaluate("window.__game.menu()");
}
/** Moves the menu cursor down (or up) until `item` is selected. */
async function menuTo(p, item, key = "KeyS") {
  for (let i = 0; i < 8; i++) {
    if ((await menu(p))?.item === item) return true;
    await p.tap(key);
  }
  return (await menu(p))?.item === item;
}
const snap = (p) => p.evaluate("window.__game.snapshot()");
async function waitFor(p, pred, timeoutMs = 8000, everyMs = 30) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const s = await snap(p);
    if (s && pred(s)) return s;
    await sleep(everyMs);
  }
  return null;
}
const gapPx = (s) => Math.abs(s.fighters[1].x - s.fighters[0].x) / 100;
/** P1 walks in and heavy-kicks (D + G) until a K.O. or the round ends. */
async function knockOut(p) {
  for (let k = 0; k < 24; k++) {
    const ready = await waitFor(p, (s) => s.round.phase !== "fight" || (s.fighters[1].state === "idle" && s.fighters[0].state === "idle"), 5000);
    if (!ready || ready.round.phase !== "fight") return ready;
    await p.down("KeyD");
    await waitFor(p, (s) => gapPx(s) <= 62 || s.round.phase !== "fight", 6000, 15);
    await p.up("KeyD");
    await waitFor(p, (s) => s.fighters[0].state === "idle" || s.round.phase !== "fight", 2000);
    await p.down("KeyD");
    await p.tap("KeyG");
    await p.up("KeyD");
    const after = await waitFor(p, (s) => s.round.phase !== "fight" || s.fighters[1].state === "knockdown" || s.fighters[1].state === "hitstun", 1500);
    if (after && after.round.phase !== "fight") return after;
  }
  return snap(p);
}

try {
  // ------------------------------------------------------------------------
  // A5 + A7 + A8: title -> select -> fight to the results, reading the
  // accessibility tree; blur mid-fight; every console error and 404 recorded.
  // ------------------------------------------------------------------------
  const p = await openPage(browser);
  const flowMark = p.mark();
  await p.navigate(BASE);
  await waitScene(p, "title");
  await sleep(400);
  const axTitle = await p.axSummary();
  record("A5 canvas is an image labelled with the title screen", axTitle.canvas?.role === "image" && /title screen/.test(axTitle.canvas?.name), {
    ax: axTitle,
    screenshot: await p.shot(OUT, "a5-01-title"),
  });
  record("A5 live region is polite (role status)", axTitle.live?.role === "status", { live: axTitle.live });

  await menuTo(p, "VS PLAYER");
  await p.tap("KeyF");
  await waitScene(p, "select");
  await sleep(400);
  const axSelect = await p.axSummary();
  record("A5 canvas label changes on select", /character select/.test(axSelect.canvas?.name) && axSelect.canvas?.name !== axTitle.canvas?.name, {
    ax: axSelect,
    screenshot: await p.shot(OUT, "a5-02-select"),
  });

  // Collect every text the live region shows while the match runs.
  const liveTexts = [];
  let polling = true;
  const poller = (async () => {
    while (polling) {
      const live = await p.axSummary().then((a) => a.live?.text ?? "", () => "");
      if (live && liveTexts.at(-1) !== live) liveTexts.push(live);
      await sleep(150);
    }
  })();

  await p.tap("KeyF"); // P1 locks
  await p.tap("KeyL"); // P2 locks
  await waitScene(p, "fight", 20000);
  const fighting = await waitFor(p, (s) => s.round.phase === "fight", 8000);
  const axFight = await p.axSummary();
  record("A5 canvas label changes on fight", /, fight: /.test(axFight.canvas?.name ?? ""), { ax: axFight, phase: fighting?.round.phase });

  const r1 = await knockOut(p);
  record("round 1 K.O.", r1?.round.phase === "ko" || (r1?.round.wins ?? [0, 0])[0] >= 1, { round: r1?.round });

  // A7: round 2 under way, the window loses focus (another tab comes to the front).
  await waitFor(p, (s) => s.round.number === 2 && s.round.phase === "fight", 15000);
  await sleep(300);
  const other = await openPage(browser);
  await browser.send("Target.activateTarget", { targetId: other.targetId });
  const paused = await waitScene(p, "pause", 3000);
  const focus = await p.evaluate("document.hasFocus()");
  await browser.send("Target.activateTarget", { targetId: p.targetId });
  await p.cmd("Page.bringToFront");
  await browser.send("Target.closeTarget", { targetId: other.targetId });
  await sleep(400);
  const pauseMenu = await menu(p);
  record("A7 blurring the window mid-fight opens the pause screen", paused, { hasFocusWhileOtherTab: focus, scene: await p.evaluate("window.__game.scene") });
  record("A7 the pause screen shows the mute key", /M: MUTE/.test(pauseMenu?.hint ?? ""), { menu: pauseMenu, screenshot: await p.shot(OUT, "a7-01-blur-paused") });
  await p.tap("KeyM");
  await sleep(100);
  const mutedHint = (await menu(p))?.hint;
  record("A7 the mute key's line follows the mute state", /M: UNMUTE/.test(mutedHint ?? ""), { hint: mutedHint, screenshot: await p.shot(OUT, "a7-02-muted") });
  await p.tap("KeyM");
  await p.tap("Escape");
  await waitScene(p, "fight", 3000);

  const r2 = await knockOut(p);
  await waitScene(p, "results", 20000);
  await sleep(1500);
  polling = false;
  await poller;
  const axResults = await p.axSummary();
  record("A5 live region during the match says Round 1, Fight and K.O.", ["Round 1", "Fight", "K.O."].every((w) => liveTexts.some((t) => t.includes(w))), {
    liveTexts,
  });
  record("A5 live region announces pause, resume and the winner", ["Paused", "Resumed", "wins the match"].every((w) => liveTexts.some((t) => t.includes(w))), {
    round2: r2?.round,
    results: axResults,
    screenshot: await p.shot(OUT, "a5-03-results"),
  });

  // The rest of the screens for A8: select (from results), title, controls.
  await menuTo(p, "CHARACTER SELECT");
  await p.tap("KeyF");
  await waitScene(p, "select");
  await p.tap("Escape");
  await waitScene(p, "title");
  await menuTo(p, "CONTROLS");
  await p.tap("Enter");
  await waitScene(p, "controls");
  await sleep(500);
  const flow = p.problemsSince(flowMark);
  record("A8 no console errors on title, select, versus, fight, pause, results, controls", flow.errors.length === 0, { errors: flow.errors });
  record("A8 no 404s (or other 4xx/5xx) on any screen", flow.bad.length === 0, {
    bad: flow.bad,
    requests: p.log.network.length,
    icons: p.log.network.filter((n) => /icons|manifest\.webmanifest|favicon/.test(n.url)),
  });

  // ------------------------------------------------------------------------
  // A4: FULLSCREEN on the title menu enters; the pause menu's item leaves.
  // Input.dispatchKeyEvent sends trusted keys, so the request has a user gesture.
  // ------------------------------------------------------------------------
  const fsElement = "document.fullscreenElement ? document.fullscreenElement.tagName : null";
  await p.navigate(BASE);
  await waitScene(p, "title");
  await sleep(300);
  const fsEnabled = await p.evaluate("document.fullscreenEnabled");
  const onItem = await menuTo(p, "FULLSCREEN");
  await p.tap("Enter");
  await p.waitUntil("document.fullscreenElement !== null", 3000);
  const entered = await p.evaluate(fsElement);
  record("A4 FULLSCREEN on the title menu enters fullscreen", fsEnabled && onItem && entered === "HTML", {
    fullscreenEnabled: fsEnabled,
    fullscreenElement: entered,
    menu: await menu(p),
    screenshot: await p.shot(OUT, "a4-01-title-fullscreen"),
  });
  await menuTo(p, "VS PLAYER", "KeyW");
  await p.tap("Enter");
  await waitScene(p, "select");
  await p.tap("KeyF");
  await p.tap("KeyL");
  await waitScene(p, "fight", 20000);
  await waitFor(p, (s) => s.round.phase === "fight", 8000);
  await p.tap("Enter"); // Start pauses (Esc would leave fullscreen in the browser itself)
  await waitScene(p, "pause", 3000);
  const stillFs = await p.evaluate(fsElement);
  await menuTo(p, "FULLSCREEN");
  const pauseItems = await menu(p);
  const pauseShot = await p.shot(OUT, "a4-02-pause-fullscreen-item");
  await p.tap("Enter");
  await p.waitUntil("document.fullscreenElement === null", 3000);
  const left = await p.evaluate(fsElement);
  record("A4 the pause menu's FULLSCREEN leaves fullscreen", stillFs === "HTML" && left === null, {
    beforeItem: stillFs,
    after: left,
    menu: pauseItems,
    screenshot: pauseShot,
  });

  // Double-click on the canvas toggles it too.
  await p.tap("Escape"); // resume
  const box = await p.evaluate("(() => { const r = document.getElementById('game').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()");
  await p.doubleClick(box.x, box.y);
  await p.waitUntil("document.fullscreenElement !== null", 3000);
  const dblIn = await p.evaluate(fsElement);
  await sleep(300);
  await p.doubleClick(box.x, box.y);
  await p.waitUntil("document.fullscreenElement === null", 3000);
  const dblOut = await p.evaluate(fsElement);
  record("A4 double-clicking the canvas toggles fullscreen", dblIn === "HTML" && dblOut === null, { dblIn, dblOut });

  // Without the Fullscreen API the item is not there.
  const { identifier } = await p.cmd("Page.addScriptToEvaluateOnNewDocument", {
    source: "Object.defineProperty(Document.prototype, 'fullscreenEnabled', { get() { return false; }, configurable: true });",
  });
  await p.navigate(BASE);
  await waitScene(p, "title");
  await sleep(300);
  const noFsTitle = await menu(p);
  await p.navigate(`${BASE}?p1=julien-hovan&p2=felicia-gorgacheva`);
  await waitScene(p, "fight", 20000);
  await waitFor(p, (s) => s.round.phase === "fight", 8000);
  await p.tap("Enter");
  await waitScene(p, "pause", 3000);
  const noFsPause = await menu(p);
  record("A4 FULLSCREEN is hidden when document.fullscreenEnabled is false", !noFsTitle.items.includes("FULLSCREEN") && !noFsPause.items.includes("FULLSCREEN"), {
    fullscreenEnabled: await p.evaluate("document.fullscreenEnabled"),
    title: noFsTitle.items,
    pause: noFsPause.items,
    screenshot: await p.shot(OUT, "a4-03-no-fullscreen-api-pause"),
  });
  await p.cmd("Page.removeScriptToEvaluateOnNewDocument", { identifier });

  // ------------------------------------------------------------------------
  // A6: block what the game needs; the failure screen shows with Reload.
  // ------------------------------------------------------------------------
  let blocked = [];
  browser.listeners.push((evt) => {
    if (evt.sessionId === p.sessionId && evt.method === "Fetch.requestPaused") {
      blocked.push(evt.params.request.url);
      void p.cmd("Fetch.failRequest", { requestId: evt.params.requestId, errorReason: "BlockedByClient" });
    }
  });
  async function failureCase(id, pattern, url, expectDetail, shotName) {
    blocked = [];
    // No cache: a stylesheet or image served from the memory cache would never reach the block.
    await p.cmd("Network.setCacheDisabled", { cacheDisabled: true });
    await p.cmd("Fetch.enable", { patterns: [{ urlPattern: pattern }] });
    await p.navigate(url);
    const shown = await p.waitUntil(`!${isHidden}`, 15000);
    await sleep(300);
    const state = await p.evaluate(`({
      detail: document.getElementById('failure-detail').textContent,
      title: document.getElementById('failure-title').textContent,
      focused: document.activeElement && document.activeElement.id,
      button: document.getElementById('failure-reload').textContent,
      canvasHidden: document.getElementById('game').getAttribute('aria-hidden'),
    })`);
    const text = await p.axText();
    record(id, shown && expectDetail.test(state.detail) && state.button === "RELOAD" && state.focused === "failure-reload", {
      blocked: [...new Set(blocked)],
      ...state,
      axText: text,
      screenshot: await p.shot(OUT, shotName),
    });
    await p.cmd("Fetch.disable");
    await p.cmd("Network.setCacheDisabled", { cacheDisabled: false });
  }

  await failureCase("A6 blocking a fighter's atlas shows the failure screen with Reload", "*/fighters/*/atlas*", `${BASE}?p1=julien-hovan&p2=felicia-gorgacheva`, /fighter art did not load/, "a6-01-atlas-blocked");
  // Reload is focused and the game released the keyboard: Enter reloads, and with the block gone the fight starts.
  await p.tap("Enter");
  const recovered = await waitScene(p, "fight", 20000);
  record("A6 Reload (Enter on the focused button) brings the game back", recovered && (await p.evaluate(isHidden)), { scene: await p.evaluate("window.__game?.scene") });

  await failureCase("A6 blocking the effects atlas shows the failure screen", "*/effects/atlas*", `${BASE}?p1=julien-hovan&p2=felicia-gorgacheva`, /effects did not load/, "a6-02-effects-blocked");
  // The pixel font is not fatal (lead session, after the 013-015 merge): with it blocked the
  // game still starts, in the fallback font, and the failure screen stays hidden.
  await p.cmd("Network.setCacheDisabled", { cacheDisabled: true });
  await p.cmd("Fetch.enable", { patterns: [{ urlPattern: "*fonts.googleapis.com*" }] });
  await p.navigate(BASE);
  const fontlessTitle = await waitScene(p, "title", 15000);
  record("A6 blocking the pixel font: the game still starts in the fallback font, no failure screen", fontlessTitle && (await p.evaluate(isHidden)), {
    scene: await p.evaluate("window.__game?.scene"),
    screenshot: await p.shot(OUT, "a6-03-font-blocked-fallback"),
  });
  await p.cmd("Fetch.disable");
  await p.cmd("Network.setCacheDisabled", { cacheDisabled: false });
  await failureCase("A6 a game script that fails to load shows the failure screen (inline handler)", "*/src/main.ts*", BASE, /did not load/, "a6-04-script-blocked");
  // Starting from the select screen: the preview of a fighter whose atlas is blocked stops the game too (no endless retries).
  blocked = [];
  await p.cmd("Network.setCacheDisabled", { cacheDisabled: true });
  await p.cmd("Fetch.enable", { patterns: [{ urlPattern: "*/fighters/*/atlas*" }] });
  await p.navigate(BASE);
  await waitScene(p, "title");
  await menuTo(p, "VS PLAYER");
  await p.tap("KeyF");
  const fromSelect = await p.waitUntil(`!${isHidden}`, 15000);
  await sleep(1500);
  record("A6 a preview atlas failing on the select screen shows the failure screen, without retrying", fromSelect && new Set(blocked).size === blocked.length, {
    blockedRequests: blocked.length,
    detail: await p.evaluate("document.getElementById('failure-detail').textContent"),
  });
  await p.cmd("Fetch.disable");
  await p.cmd("Network.setCacheDisabled", { cacheDisabled: false });

  // No JavaScript: the noscript message.
  await p.cmd("Emulation.setScriptExecutionDisabled", { value: true });
  await p.navigate(BASE);
  await sleep(2500);
  const noJs = await p.axText();
  record("A6 with JavaScript disabled the noscript message shows", /needs JavaScript/.test(noJs) && !/could not start/.test(noJs), {
    axText: noJs,
    screenshot: await p.shot(OUT, "a6-05-noscript"),
  });
  await p.cmd("Emulation.setScriptExecutionDisabled", { value: false });
} catch (err) {
  record("script", false, { error: String(err?.stack ?? err) });
} finally {
  writeFileSync(join(OUT, "shell-results.json"), JSON.stringify(results, null, 2));
  await browser.close();
}
console.log(rec.failures === 0 ? "ALL PASS" : `${rec.failures} FAILED`);
process.exit(rec.failures === 0 ? 0 : 1);
