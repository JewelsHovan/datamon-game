// Chrome DevTools Protocol plumbing for the spec 015 checks: a private headless
// Chrome (no shared browser, no extra deps), as in specs/evidence/003/fight-check.mjs,
// plus device emulation (phones with touch, desktops) and multi-touch fingers.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** Results in the style of the other evidence scripts: PASS/FAIL lines and a results file in `out`. */
export function recorder(out, file) {
  const results = {};
  let failures = 0;
  return {
    results,
    record(id, pass, detail = {}) {
      results[id] = { pass, ...detail };
      if (!pass) failures++;
      console.log(`${pass ? "PASS" : "FAIL"} ${id} ${JSON.stringify(detail)}`);
    },
    finish() {
      writeFileSync(join(out, file), JSON.stringify(results, null, 2));
      console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
      return failures === 0 ? 0 : 1;
    },
  };
}

export async function launchChrome() {
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
  const file = join(profile, "DevToolsActivePort");
  let port = null;
  for (let i = 0; i < 100 && !port; i++) {
    if (existsSync(file)) port = readFileSync(file, "utf8").split("\n")[0] || null;
    if (!port) await sleep(100);
  }
  if (!port) throw new Error("Chrome did not start");
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
  const send = (method, params = {}, sessionId) => {
    const id = nextId++;
    ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };
  return {
    send,
    listeners,
    close() {
      ws.close();
      chrome.kill();
      try {
        rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {}
    },
  };
}

/** A page (tab) with helpers: evaluate, screenshots, emulation, keys and touch fingers. */
export async function openPage(browser, out) {
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const page = (method, params) => browser.send(method, params, sessionId);
  await page("Page.enable");
  await page("Runtime.enable");
  const consoleMessages = [];
  browser.listeners.push((evt) => {
    if (evt.sessionId === sessionId && evt.method === "Runtime.consoleAPICalled") {
      consoleMessages.push({ type: evt.params.type, text: evt.params.args.map((a) => a.value ?? a.description ?? "").join(" ") });
    }
    if (evt.sessionId === sessionId && evt.method === "Runtime.exceptionThrown") {
      consoleMessages.push({ type: "error", text: evt.params.exceptionDetails?.exception?.description ?? "exception" });
    }
  });

  async function evaluate(expression, userGesture = false) {
    const res = await page("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture });
    if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
    return res.result.value;
  }

  const fingers = new Map();
  const points = () => [...fingers.entries()].map(([id, p]) => ({ x: p.x, y: p.y, id, radiusX: 6, radiusY: 6, force: 1 }));

  const api = {
    page,
    evaluate,
    consoleMessages,
    async shot(name, clip) {
      const params = { format: "png" };
      if (clip) params.clip = { ...clip, scale: clip.scale ?? 1 };
      const { data } = await page("Page.captureScreenshot", params);
      const path = join(out, `${name}.png`);
      writeFileSync(path, Buffer.from(data, "base64"));
      return path;
    },
    /** A phone or tablet: mobile viewport, device scale, touch with 5 points. */
    async phone(width, height, deviceScaleFactor = 3) {
      await page("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor,
        mobile: true,
        screenOrientation: width > height ? { type: "landscapePrimary", angle: 90 } : { type: "portraitPrimary", angle: 0 },
      });
      await page("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    },
    /** A desktop window: no touch, device scale 1. */
    async desktop(width, height) {
      await page("Emulation.setTouchEmulationEnabled", { enabled: false });
      await page("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    },
    async open(url, ready = "!!window.__game && window.__game.frame > 2") {
      await page("Page.navigate", { url });
      for (let i = 0; i < 150; i++) {
        if (await evaluate(ready).catch(() => false)) return;
        await sleep(100);
      }
      throw new Error(`game did not start for ${url}`);
    },
    /** Center of the first element matching `selector`, or null when it has no box. */
    async center(selector) {
      return evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null;
        const r = el.getBoundingClientRect(); if (!r.width || !r.height) return null;
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, left: r.left, top: r.top }; })()`);
    },
    // Fingers: touchStart and touchMove carry every finger down (CDP presses and
    // moves them one by one); touchEnd lists only the finger that lifts (measured
    // in Chrome 157: leaving a finger out of a touchMove does not lift it).
    async fingerDown(id, x, y) {
      fingers.set(id, { x, y });
      await page("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points() });
    },
    async fingerMove(id, x, y) {
      fingers.set(id, { x, y });
      await page("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points() });
    },
    async fingerUp(id) {
      const p = fingers.get(id);
      if (!p) return;
      fingers.delete(id);
      await page("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [{ x: p.x, y: p.y, id, radiusX: 6, radiusY: 6, force: 1 }] });
    },
    /** A tap: one finger down for `ms`, then up. */
    async tapAt(id, x, y, ms = 50) {
      await api.fingerDown(id, x, y);
      await sleep(ms);
      await api.fingerUp(id);
    },
    async liftAll() {
      fingers.clear();
      await page("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    },
    async key(type, code, key = code) {
      await page("Input.dispatchKeyEvent", { type, code, key, windowsVirtualKeyCode: 0 });
    },
  };
  return api;
}
