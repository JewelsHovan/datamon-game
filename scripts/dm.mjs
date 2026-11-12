#!/usr/bin/env node
// dm: the agent CLI for Compass: Cardinal Clash.
// One entry point for the things an agent does in this repo: check the toolchain,
// run the dev server, run the gates, ship previews and production deploys, and
// read project status. Every command has a stable exit code, writes full logs to
// .dm/logs/, and prints JSON with --json. No dependencies beyond Node 20+.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);

const STATE = path.join(ROOT, ".dm");
const LOGS = path.join(STATE, "logs");
const DEV_FILE = path.join(STATE, "dev.json");
const DEPLOY_FILE = path.join(STATE, "last-deploy.json");
const WRANGLER = ["--yes", "wrangler@4"];
const GATES = {
  typecheck: ["npm", ["run", "typecheck"]],
  test: ["npm", ["test"]],
  build: ["npm", ["run", "build"]],
};

const EXIT = { ok: 0, fail: 1, usage: 2, prereq: 3 };

// ---------- output ----------

const argv = process.argv.slice(2);
const JSON_MODE = argv.includes("--json");
const args = argv.filter((a) => a !== "--json");

function say(line = "") {
  if (!JSON_MODE) process.stdout.write(line + "\n");
}
function warn(line) {
  process.stderr.write(line + "\n");
}
function finish(code, data = {}) {
  if (JSON_MODE) process.stdout.write(JSON.stringify({ ok: code === 0, exit: code, ...data }, null, 2) + "\n");
  process.exit(code);
}
function flag(name) {
  return args.includes(`--${name}`);
}
function option(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = args[i + 1];
  if (v === undefined || v.startsWith("--")) usage(`--${name} needs a value`);
  return v;
}
function usage(msg) {
  warn(`dm: ${msg}\nRun ./dm help for usage.`);
  finish(EXIT.usage, { error: msg });
}

// ---------- helpers ----------

function ensureDirs() {
  fs.mkdirSync(LOGS, { recursive: true });
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(file, data) {
  ensureDirs();
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

// Run a command with output captured to a log file. Resolves {code, ms, log, output}.
function run(name, cmd, cmdArgs, { echo = false } = {}) {
  ensureDirs();
  const log = path.join(LOGS, `${name}.log`);
  const out = fs.openSync(log, "w");
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, { cwd: ROOT, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", CI: "1" } });
    let output = "";
    const onData = (chunk) => {
      output += chunk;
      fs.writeSync(out, chunk);
      if (echo && !JSON_MODE) process.stdout.write(chunk);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (err) => {
      onData(`dm: could not start ${cmd}: ${err.message}\n`);
    });
    child.on("close", (code) => {
      fs.closeSync(out);
      resolve({ code: code ?? 1, ms: Date.now() - started, log: path.relative(ROOT, log), output });
    });
  });
}

function tail(text, n = 25) {
  return text.trimEnd().split("\n").slice(-n).join("\n");
}

function sh(cmd, cmdArgs) {
  const r = spawnSync(cmd, cmdArgs, { cwd: ROOT, encoding: "utf8" });
  return { code: r.status ?? 1, out: (r.stdout || "").trimEnd(), err: (r.stderr || "").trimEnd() };
}

function git(...a) {
  return sh("git", a);
}

function gitInfo() {
  const branch = git("rev-parse", "--abbrev-ref", "HEAD").out;
  const sha = git("rev-parse", "--short", "HEAD").out;
  const subject = git("log", "-1", "--format=%s").out;
  const dirty = git("status", "--porcelain").out.split("\n").filter(Boolean);
  return { branch, sha, subject, dirty };
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Free on both loopbacks: another Vite on [::1]:5173 would shadow ours at "localhost".
function portFreeOn(port, host) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", (err) => resolve(err.code === "EADDRNOTAVAIL" || err.code === "EAFNOSUPPORT"));
    srv.listen(port, host, () => srv.close(() => resolve(true)));
  });
}

async function portFree(port) {
  return (await portFreeOn(port, "127.0.0.1")) && (await portFreeOn(port, "::1"));
}

async function freePort(start) {
  for (let p = start; p < start + 50; p++) if (await portFree(p)) return p;
  return null;
}

async function httpOk(url, timeoutMs = 10000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return { status: res.status, body: await res.text() };
  } catch (err) {
    return { status: 0, body: String(err) };
  }
}

function urlsIn(text) {
  return [...new Set(text.match(/https:\/\/[A-Za-z0-9.-]+\.workers\.dev\S*/g) || [])];
}

// ---------- gates ----------

async function runGates(only) {
  const names = only ? only.split(",").map((s) => s.trim()) : Object.keys(GATES);
  for (const n of names) if (!GATES[n]) usage(`unknown gate "${n}" (gates: ${Object.keys(GATES).join(", ")})`);
  if (!fs.existsSync(path.join(ROOT, "node_modules"))) {
    warn("dm: node_modules is missing. Run `npm ci` first.");
    finish(EXIT.prereq, { error: "node_modules missing" });
  }
  const results = [];
  for (const n of names) {
    const [cmd, a] = GATES[n];
    const r = await run(n, cmd, a);
    const pass = r.code === 0;
    results.push({ gate: n, pass, exit: r.code, seconds: +(r.ms / 1000).toFixed(1), log: r.log });
    say(`${pass ? "PASS" : "FAIL"}  ${n.padEnd(9)} ${(r.ms / 1000).toFixed(1)}s  ${r.log}`);
    if (!pass) {
      warn(`--- last lines of ${r.log} ---\n${tail(r.output)}`);
      break; // later gates depend on earlier ones being green
    }
  }
  return results;
}

// ---------- specs ----------

function readSpecs() {
  const dir = path.join(ROOT, "specs");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{3}-.*\.md$/.test(f))
    .sort()
    .map((file) => {
      const text = fs.readFileSync(path.join(dir, file), "utf8");
      const title = (text.match(/^#\s+\d{3}:\s*(.+)$/m) || [])[1] || file;
      const status = ((text.match(/^Status:\s*([a-z-]+)/m) || [])[1] || "unknown").trim();
      const count = (re) => (text.match(re) || []).length;
      return {
        id: file.slice(0, 3),
        title: title.trim(),
        status,
        criteria: { done: count(/^- \[x\] A\d+/gm), total: count(/^- \[[ x]\] A\d+/gm) },
        tasks: { done: count(/^- \[x\] T\d+/gm), total: count(/^- \[[ x]\] T\d+/gm) },
        file: `specs/${file}`,
      };
    });
}

// ---------- commands ----------

const commands = {
  async help() {
    say(`dm: agent CLI for Compass: Cardinal Clash

Usage: ./dm <command> [options] [--json]

Develop
  doctor                      check Node, deps, git, Cloudflare and GitHub logins
  dev [start|stop|status]     Vite dev server in the background; prints its URL
        --port N              preferred port (default 5173; next free port is used)
  check [--only a,b]          run the gates in order: typecheck, test, build
  build                       production build into dist/

Ship
  preview                     gates, build, upload a preview version to Cloudflare
                              (not live); prints the preview URL
  deploy                      gates, build, deploy to production, smoke-test the URL
        --allow-dirty         deploy with uncommitted changes (off by default)
        --allow-branch        deploy from a branch other than main
        --skip-check          skip the gates (build still runs)
  url                         print the production URL from the last deploy

Project
  status                      git state, dev server, last deploy, spec summary
  specs [--status S]          spec table with criteria and task progress

Every command logs to .dm/logs/<name>.log. --json prints one JSON object on stdout.
Exit codes: 0 ok, 1 a gate, deploy or check failed, 2 usage error, 3 missing prerequisite.`);
    finish(EXIT.ok);
  },

  async doctor() {
    const checks = [];
    const add = (name, ok, detail, fix) => {
      checks.push({ name, ok, detail, ...(ok ? {} : { fix }) });
      say(`${ok ? "ok  " : "FAIL"}  ${name.padEnd(11)} ${detail}${ok || !fix ? "" : `  → ${fix}`}`);
    };
    const major = +process.versions.node.split(".")[0];
    add("node", major >= 20, `v${process.versions.node}`, "install Node 20+");
    const deps = fs.existsSync(path.join(ROOT, "node_modules/.bin/vite"));
    add("deps", deps, deps ? "node_modules present" : "node_modules missing", "npm ci");
    const g = gitInfo();
    add("git", true, `${g.branch} @ ${g.sha}, ${g.dirty.length} uncommitted path(s)`);
    const wr = sh("npx", [...WRANGLER, "whoami"]);
    const wrOk = wr.code === 0 && !/not authenticated/i.test(wr.out + wr.err);
    const account = (wr.out.match(/│\s*([^│]+?)\s*│\s*[0-9a-f]{32}\s*│/) || [])[1];
    add("cloudflare", wrOk, wrOk ? `logged in${account ? ` (${account})` : ""}` : "not logged in", "npx wrangler@4 login");
    const gh = sh("gh", ["api", "user", "--jq", ".login"]);
    add("github", gh.code === 0, gh.code === 0 ? `gh logged in as ${gh.out}` : "gh not logged in", "gh auth login");
    const failed = checks.filter((c) => !c.ok && c.name !== "github");
    finish(failed.length ? EXIT.prereq : EXIT.ok, { checks });
  },

  async dev() {
    const sub = args[1] && !args[1].startsWith("--") ? args[1] : "start";
    const state = readJson(DEV_FILE);
    const running = state && pidAlive(state.pid);
    if (sub === "status") {
      say(running ? `running  ${state.url}  (pid ${state.pid})` : "stopped");
      finish(EXIT.ok, { running: !!running, ...(running ? state : {}) });
    }
    if (sub === "stop") {
      if (running) {
        try {
          process.kill(-state.pid, "SIGTERM");
        } catch {
          process.kill(state.pid, "SIGTERM");
        }
      }
      fs.rmSync(DEV_FILE, { force: true });
      say(running ? `stopped dev server (pid ${state.pid})` : "dev server was not running");
      finish(EXIT.ok, { stopped: !!running });
    }
    if (sub !== "start") usage(`unknown dev subcommand "${sub}" (start, stop, status)`);
    if (running) {
      say(`already running  ${state.url}  (pid ${state.pid})`);
      finish(EXIT.ok, { running: true, ...state });
    }
    const vite = path.join(ROOT, "node_modules/.bin/vite");
    if (!fs.existsSync(vite)) {
      warn("dm: node_modules is missing. Run `npm ci` first.");
      finish(EXIT.prereq, { error: "node_modules missing" });
    }
    const port = await freePort(+option("port", "5173"));
    if (!port) finish(EXIT.fail, { error: "no free port" });
    ensureDirs();
    const log = path.join(LOGS, "dev.log");
    const fd = fs.openSync(log, "w");
    const child = spawn(vite, ["--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
      cwd: ROOT,
      detached: true,
      stdio: ["ignore", fd, fd],
    });
    child.unref();
    const url = `http://127.0.0.1:${port}/`;
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if ((await httpOk(url, 1000)).status === 200) {
        const info = { pid: child.pid, port, url, log: path.relative(ROOT, log), started: new Date().toISOString() };
        writeJson(DEV_FILE, info);
        say(`running  ${url}  (pid ${child.pid}, log ${info.log})`);
        finish(EXIT.ok, { running: true, ...info });
      }
      if (!pidAlive(child.pid)) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    warn(`dm: dev server did not come up. Last lines of ${path.relative(ROOT, log)}:\n${tail(fs.readFileSync(log, "utf8"))}`);
    finish(EXIT.fail, { error: "dev server did not start", log: path.relative(ROOT, log) });
  },

  async check() {
    const results = await runGates(option("only"));
    const ok = results.every((r) => r.pass);
    finish(ok ? EXIT.ok : EXIT.fail, { gates: results });
  },

  async build() {
    const results = await runGates("build");
    finish(results[0].pass ? EXIT.ok : EXIT.fail, { gates: results });
  },

  async preview() {
    const g = gitInfo();
    const gates = await runGates();
    if (!gates.every((r) => r.pass)) finish(EXIT.fail, { stage: "gates", gates });
    const message = `${g.sha}${g.dirty.length ? "-dirty" : ""} ${g.subject}`.slice(0, 100);
    const r = await run("preview", "npx", [...WRANGLER, "versions", "upload", "--message", message]);
    if (r.code !== 0) {
      warn(`--- last lines of ${r.log} ---\n${tail(r.output)}`);
      finish(EXIT.fail, { stage: "upload", log: r.log });
    }
    const url = urlsIn(r.output).find((u) => !/^https:\/\/datamon-game\./.test(u)) || urlsIn(r.output)[0] || null;
    const versionId = (r.output.match(/Version ID:\s*([0-9a-f-]{36})/i) || [])[1] || null;
    say(url ? `preview  ${url}` : `uploaded version ${versionId ?? "(id not found)"}; no preview URL in output (see ${r.log})`);
    finish(EXIT.ok, { url, versionId, sha: g.sha, dirty: g.dirty.length > 0, log: r.log });
  },

  async deploy() {
    const g = gitInfo();
    if (g.branch !== "main" && !flag("allow-branch")) {
      warn(`dm: on branch ${g.branch}. Production deploys come from main; use ./dm preview here, or pass --allow-branch.`);
      finish(EXIT.fail, { stage: "git", branch: g.branch });
    }
    if (g.dirty.length && !flag("allow-dirty")) {
      warn(`dm: ${g.dirty.length} uncommitted path(s). Commit first so the deploy maps to a commit, or pass --allow-dirty.`);
      finish(EXIT.fail, { stage: "git", dirty: g.dirty });
    }
    const gates = await runGates(flag("skip-check") ? "build" : undefined);
    if (!gates.every((r) => r.pass)) finish(EXIT.fail, { stage: "gates", gates });
    const message = `${g.sha}${g.dirty.length ? "-dirty" : ""} ${g.subject}`.slice(0, 100);
    const r = await run("deploy", "npx", [...WRANGLER, "deploy", "--message", message]);
    if (r.code !== 0) {
      warn(`--- last lines of ${r.log} ---\n${tail(r.output)}`);
      finish(EXIT.fail, { stage: "deploy", log: r.log });
    }
    const url = urlsIn(r.output)[0] || null;
    if (!url) {
      warn(`dm: deploy succeeded but no workers.dev URL in the output (see ${r.log}).`);
      finish(EXIT.fail, { stage: "url", log: r.log });
    }
    // Smoke test: the page and one fighter atlas must load from the live URL.
    let smoke = null;
    for (let i = 0; i < 10 && !(smoke && smoke.ok); i++) {
      const page = await httpOk(url);
      const pageOk = page.status === 200 && /<canvas[^>]+id="game"/i.test(page.body);
      const asset = await httpOk(new URL("fighters/julien-hovan/manifest.json", url).href);
      smoke = { ok: pageOk && asset.status === 200, page: page.status, asset: asset.status };
      if (!smoke.ok) await new Promise((res) => setTimeout(res, 3000));
    }
    const record = { url, sha: g.sha, subject: g.subject, dirty: g.dirty.length > 0, at: new Date().toISOString(), smoke };
    writeJson(DEPLOY_FILE, record);
    say(`${smoke.ok ? "live" : "DEPLOYED, SMOKE FAILED"}  ${url}  (${g.sha}, page ${smoke.page}, asset ${smoke.asset})`);
    finish(smoke.ok ? EXIT.ok : EXIT.fail, record);
  },

  async url() {
    const d = readJson(DEPLOY_FILE);
    if (!d) {
      warn("dm: no deploy recorded in .dm/last-deploy.json yet. Run ./dm deploy.");
      finish(EXIT.fail, { error: "no deploy recorded" });
    }
    say(d.url);
    finish(EXIT.ok, d);
  },

  async status() {
    const g = gitInfo();
    const dev = readJson(DEV_FILE);
    const devRunning = !!(dev && pidAlive(dev.pid));
    const deploy = readJson(DEPLOY_FILE);
    const specs = readSpecs();
    const byStatus = {};
    for (const s of specs) byStatus[s.status] = (byStatus[s.status] || 0) + 1;
    say(`git     ${g.branch} @ ${g.sha} ${g.subject}`);
    say(`        ${g.dirty.length} uncommitted path(s)${g.dirty.length ? ": " + g.dirty.slice(0, 5).join(", ") + (g.dirty.length > 5 ? ", ..." : "") : ""}`);
    say(`dev     ${devRunning ? dev.url : "stopped"}`);
    say(`deploy  ${deploy ? `${deploy.url} (${deploy.sha}${deploy.sha === g.sha ? ", current" : ", behind HEAD"}, ${deploy.at})` : "none recorded"}`);
    say(`specs   ${Object.entries(byStatus).map(([k, v]) => `${v} ${k}`).join(", ") || "none"}`);
    finish(EXIT.ok, { git: g, dev: devRunning ? dev : null, deploy, specs: byStatus });
  },

  async specs() {
    const want = option("status");
    const list = readSpecs().filter((s) => !want || s.status === want);
    for (const s of list) {
      say(`${s.id}  ${s.status.padEnd(11)} A ${String(s.criteria.done).padStart(2)}/${String(s.criteria.total).padEnd(2)}  T ${String(s.tasks.done).padStart(2)}/${String(s.tasks.total).padEnd(2)}  ${s.title}`);
    }
    if (!list.length) say("no specs" + (want ? ` with status ${want}` : ""));
    finish(EXIT.ok, { specs: list });
  },
};

const name = args[0] || "help";
const cmd = commands[name === "--help" || name === "-h" ? "help" : name];
if (!cmd) usage(`unknown command "${name}"`);
await cmd();
