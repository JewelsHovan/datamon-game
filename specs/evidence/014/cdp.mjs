// Chrome DevTools Protocol plumbing for the spec 014 browser checks: a private
// headless Chrome (no shared browser, no extra deps), pages as CDP sessions,
// trusted key and mouse input, screenshots, the accessibility tree, and a
// console / network error log. Same approach as specs/evidence/003/fight-check.mjs.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export async function launchChrome() {
  const profile = mkdtempSync(join(tmpdir(), "datamon-014-"));
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
      "--disable-backgrounding-occluded-windows",
      "--window-size=1280,720",
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
  function send(method, params = {}, sessionId) {
    const id = nextId++;
    ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  }
  return {
    send,
    listeners,
    async close() {
      ws.close();
      chrome.kill();
      await sleep(300);
      try {
        rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {}
    },
  };
}

const KEYS = {
  KeyW: ["w", 87], KeyA: ["a", 65], KeyS: ["s", 83], KeyD: ["d", 68], KeyF: ["f", 70], KeyG: ["g", 71], KeyH: ["h", 72],
  KeyL: ["l", 76], KeyM: ["m", 77], Enter: ["Enter", 13], Escape: ["Escape", 27],
  ArrowLeft: ["ArrowLeft", 37], ArrowUp: ["ArrowUp", 38], ArrowRight: ["ArrowRight", 39], ArrowDown: ["ArrowDown", 40],
};

/** A page: a CDP session on a fresh target, with helpers. */
export async function openPage(browser, { width = 1280, height = 720, newWindow = false } = {}) {
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank", newWindow });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const cmd = (method, params) => browser.send(method, params, sessionId);
  await cmd("Page.enable");
  await cmd("Runtime.enable");
  await cmd("Network.enable");
  await cmd("Log.enable");
  await cmd("Accessibility.enable");
  await cmd("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });

  const log = { console: [], network: [], failed: [] };
  browser.listeners.push((evt) => {
    if (evt.sessionId !== sessionId) return;
    if (evt.method === "Runtime.consoleAPICalled") {
      log.console.push({ type: evt.params.type, text: evt.params.args.map((a) => a.value ?? a.description ?? "").join(" ") });
    } else if (evt.method === "Runtime.exceptionThrown") {
      log.console.push({ type: "error", text: evt.params.exceptionDetails?.exception?.description ?? evt.params.exceptionDetails?.text });
    } else if (evt.method === "Log.entryAdded" && evt.params.entry.level === "error") {
      log.console.push({ type: "error", text: `${evt.params.entry.source}: ${evt.params.entry.text} ${evt.params.entry.url ?? ""}` });
    } else if (evt.method === "Network.responseReceived") {
      const { status, url } = evt.params.response;
      log.network.push({ status, url });
    } else if (evt.method === "Network.loadingFailed") {
      log.failed.push({ errorText: evt.params.errorText, blocked: evt.params.blockedReason ?? null, requestId: evt.params.requestId });
    }
  });

  const page = {
    targetId,
    sessionId,
    cmd,
    log,
    /** Errors and 4xx/5xx responses since `mark` (a value from page.mark()). */
    mark: () => ({ console: log.console.length, network: log.network.length }),
    problemsSince(m) {
      return {
        errors: log.console.slice(m.console).filter((c) => c.type === "error"),
        bad: log.network.slice(m.network).filter((n) => n.status >= 400),
      };
    },
    async evaluate(expression) {
      const res = await cmd("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
      return res.result.value;
    },
    async navigate(url) {
      await cmd("Page.navigate", { url });
    },
    async waitUntil(expression, timeoutMs = 15000, everyMs = 50) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        if (await page.evaluate(expression).catch(() => false)) return true;
        await sleep(everyMs);
      }
      return false;
    },
    async shot(dir, name) {
      const { data } = await cmd("Page.captureScreenshot", { format: "png" });
      const path = join(dir, `${name}.png`);
      writeFileSync(path, Buffer.from(data, "base64"));
      return path;
    },
    async key(type, code) {
      const [key, vk] = KEYS[code] ?? [code, 0];
      // No nativeVirtualKeyCode: on macOS those are different codes and can hit browser shortcuts.
      await cmd("Input.dispatchKeyEvent", { type, code, key, windowsVirtualKeyCode: vk, ...(type === "keyDown" && key === "Enter" ? { text: "\r" } : {}) });
    },
    down: (code) => page.key("keyDown", code),
    up: (code) => page.key("keyUp", code),
    async tap(code, ms = 50) {
      await page.down(code);
      await sleep(ms);
      await page.up(code);
      await sleep(40);
    },
    async doubleClick(x, y) {
      for (const clickCount of [1, 2]) {
        await cmd("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount });
        await cmd("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount });
      }
    },
    /** The accessibility tree as nodes keyed by id. */
    async axTree() {
      const { nodes } = await cmd("Accessibility.getFullAXTree");
      const byId = new Map(nodes.map((n) => [n.nodeId, n]));
      const text = (n) => {
        const own = n.role?.value === "StaticText" ? (n.name?.value ?? "") : "";
        return own + (n.childIds ?? []).map((id) => (byId.has(id) ? text(byId.get(id)) : "")).join("");
      };
      return { nodes, byId, text };
    },
    /** The canvas's accessible role and name, and the live region's role, politeness and text. */
    async axSummary() {
      const { nodes, text } = await page.axTree();
      const canvas = nodes.find((n) => ["image", "img"].includes(n.role?.value) && (n.name?.value ?? "").startsWith("Compass: Cardinal Clash"));
      const live = nodes.find((n) => (n.properties ?? []).some((p) => p.name === "live" && p.value?.value === "polite"));
      return {
        canvas: canvas ? { role: canvas.role.value, name: canvas.name.value } : null,
        live: live ? { role: live.role?.value, text: text(live).replace(/ /g, " ").trim() } : null,
      };
    },
    /** All visible text in the accessibility tree, joined. */
    async axText() {
      const { nodes } = await page.axTree();
      return nodes.filter((n) => n.role?.value === "StaticText" && !n.ignored).map((n) => n.name?.value ?? "").join(" | ");
    },
  };
  return page;
}

export function recorder() {
  const results = {};
  let failures = 0;
  return {
    results,
    get failures() {
      return failures;
    },
    record(id, pass, detail = {}) {
      results[id] = { pass, ...detail };
      if (!pass) failures++;
      console.log(`${pass ? "PASS" : "FAIL"} ${id} ${JSON.stringify(detail)}`);
    },
  };
}
