// Supervisor: status | start <app> | stop <app> | restart <app> | reset <demo-instance> | build <app>
// Safety rules:
//  - never reads .env files, never writes into app folders
//  - never kills by port or by name: only PIDs it recorded itself, and only if the
//    process start time still matches (guards against PID reuse)
//  - refuses to start a process whose port is already in use or reserved
//  - app env vars are set on the child process only
import { readFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { getStore, closeStore } from '../lib/store/index.mjs';
import { join, resolve } from 'node:path';
import { cleanEnv, minimalEnv } from '../lib/clean-env.mjs';
import { parseEnvText } from '../lib/util.mjs';
import { root, dataDir } from '../lib/config.mjs';
import { loadRegistry } from '../lib/registry.mjs';
import { portInUse, httpUp } from '../lib/http-util.mjs';
import { getDriver } from '../lib/process-driver.mjs';
import { containerRunning, startContainer, stopContainer, ensureEngine } from '../lib/docker.mjs';
import { instanceApp, validSlot, freshInstanceDir, removeInstanceDir } from '../lib/instance-app.mjs';

const logDir = join(dataDir, 'logs');
const registry = loadRegistry();
const reserved = new Set(registry.reservedPorts ?? []);

mkdirSync(logDir, { recursive: true });
// Process records live in the database, one row per app/process, so two supervisors starting different apps
// at the same time can no longer overwrite each other's records (state.json used to be rewritten whole).
const store = await getStore();

// OS-specific parts (starting, PID identity, port listener, killing) live in lib/process-driver.mjs.
const driver = getDriver();
let failed = false; // any start that did not come up or stop that did not stop makes the exit code non-zero
const startTime = (pid) => driver.startTime(pid);
const listenerPid = (port) => driver.listenerPid(port);

// {port:name} -> the port of that process of the app. Every kind of command (start, prepare, reset) goes through this.
const portRefs = (app) => (str) => str.replace(/\{port:(\w+)\}/g, (_, n) => String(app.processes.find((p) => p.name === n).port));

function fill(str, proc, app) {
  return portRefs(app)(str
    .replaceAll('{url}', `http://localhost:${proc.port}`)
    .replaceAll('{port}', String(proc.port))
    .replaceAll('{inst}', app.inst ?? ''));
}

// The environment for a child: a minimal base, the dashboard's own env file (under data/, never the app's .env), then the
// registry's env values.
function childEnv(app, p, fillStr) {
  const env = cleanEnv(minimalEnv(process.env));
  if (p.envFile) {
    const f = join(root, p.envFile);
    if (!existsSync(f)) throw new Error(`Env file missing for ${app.id}: ${p.envFile}`);
    Object.assign(env, parseEnvText(readFileSync(f, 'utf8')));
  }
  for (const [k, v] of Object.entries(p.env ?? {})) env[k] = fillStr(v);
  return env;
}

const getApp = (id) => {
  const app = registry.apps.find((a) => a.id === id);
  if (!app) { console.error(`Unknown app "${id}". Known: ${registry.apps.map((a) => a.id).join(', ')}`); process.exit(1); }
  return app;
};

// Is this process running AND one we started (a recorded PID is still the same process)? The shell wrapper may be gone while the app listens.
async function isManaged(p, rec, up, timeOf = startTime) {
  if (p.container) return !!(rec?.container && up && await containerRunning(rec.container));
  return !!(rec && up && ((rec.startTime && timeOf(rec.pid) === rec.startTime) || (rec.listenPid && timeOf(rec.listenPid) === rec.listenStartTime)));
}

async function status(json) {
  const state = await store.processState.all();
  // All recorded PIDs are looked up in one call, and every process is probed at the same time: a status check used to take as long
  // as the sum of every probe (about ten seconds with everything running), which left the console page waiting on its first load.
  const pids = Object.values(state).flatMap((procs) => Object.values(procs)).flatMap((r) => [r.pid, r.listenPid]).filter(Boolean);
  const times = driver.startTimes ? driver.startTimes(pids) : new Map();
  const timeOf = (pid) => (times.has(Number(pid)) ? times.get(Number(pid)) : null);
  const rows = await Promise.all(registry.apps.flatMap((app) => app.processes.map(async (p) => {
    const rec = state[app.id]?.[p.name];
    const up = await httpUp(p.port, p.health, p.host);
    // managed = one of the PIDs we recorded is still alive (the shell wrapper may be gone while the app listens)
    const managed = await isManaged(p, rec, up, timeOf);
    return { app: app.id, proc: p.name, port: p.port, optional: !!p.optional, up, managed, url: `http://127.0.0.1:${p.port}${p.health}` };
  })));
  if (json) { console.log(JSON.stringify(rows)); return; }
  for (const r of rows) {
    const app = registry.apps.find((a) => a.id === r.app);
    const s = r.up ? (r.managed ? 'running (managed)' : 'running (external)') : 'stopped';
    console.log(`${(app.name + ' / ' + r.proc).padEnd(44)} :${String(r.port).padEnd(5)} ${s}${r.optional ? '  [optional]' : ''}`);
  }
}

async function start(app, only) {
  const todo = app.processes.filter((p) => (only ? p.name === only : !p.optional));
  if (todo.some((p) => !p.container) && !existsSync(app.path)) { console.error(`Path not found: ${app.path}`); process.exit(1); }
  // An app that runs a production build (not a dev server) must have been built first: say so instead of failing to boot.
  if (app.build?.produces && !existsSync(resolve(app.path, app.build.cwd ?? '.', app.build.produces))) {
    console.error(`${app.id} has not been built yet. Run: node supervisor/index.mjs build ${app.id}`); process.exit(1);
  }
  // a demo whose database lives in Docker needs the engine up first (this waits longer than an app's own 60 s)
  if (app.requiresDocker) {
    const d = await ensureEngine({ log: (m) => console.log(m) });
    if (!d.ok) { console.error(d.message); process.exit(1); }
    if (d.started) console.log('Docker is running.');
  }
  // Start is safe to press again: a process we already started and that is answering is left alone, so a partly running app
  // (one process up, one down) gets only its missing process started. Anything else holding the port is still refused below.
  const state = await store.processState.all();
  const pending = [];
  for (const p of todo) {
    if (await isManaged(p, state[app.id]?.[p.name], await httpUp(p.port, p.health, p.host))) console.log(`${app.id}/${p.name} is already running on :${p.port}`);
    else pending.push(p);
  }
  // pre-flight all ports first so we never half-start an app
  for (const p of pending) {
    if (reserved.has(p.port)) { console.error(`Port ${p.port} is reserved. Aborting.`); process.exit(1); }
    if (await portInUse(p.port)) { console.error(`Port ${p.port} (${app.id}/${p.name}) is already in use. Not starting anything.`); process.exit(1); }
  }
  for (const p of pending) {
    if (p.container) { // an existing container: the supervisor only starts it (see lib/docker.mjs)
      try { await startContainer(p.container); } catch (e) { console.error(`Could not start container "${p.container}": ${e.message}`); process.exit(1); }
      await store.processState.set(app.id, p.name, { container: p.container, port: p.port, startedAt: new Date().toISOString() });
      process.stdout.write(`Started ${app.id}/${p.name} (container ${p.container}) on :${p.port}, waiting for it to respond...`);
      let up = false;
      for (let i = 0; i < 60 && !up; i++) { up = await httpUp(p.port, p.health, p.host); if (!up) await new Promise((r) => setTimeout(r, 1000)); }
      console.log(up ? ' UP' : ' NOT RESPONDING after 60s (docker logs ' + p.container + ')');
      if (!up) failed = true;
      continue;
    }
    const cwd = resolve(app.path, p.cwd ?? '.');
    if (!existsSync(cwd)) { console.error(`Working directory not found for ${app.id}/${p.name}: ${cwd}`); failed = true; await closeStore(); process.exit(1); }
    let env;
    try { env = childEnv(app, p, (v) => fill(v, p, app)); } catch (e) { console.error(`${e.message} (${app.id}/${p.name})`); process.exit(1); }
    const logPath = join(logDir, `${app.id}-${p.name}.log`);
    const child = driver.spawnApp({ cmd: fill(p.cmd, p, app), cwd, env, logPath });
    await new Promise((r) => setTimeout(r, 800));
    if (child.spawnError || !child.pid) { console.error(`Could not start ${app.id}/${p.name}: ${child.spawnError?.message ?? 'no process id'}`); failed = true; continue; }
    const rec = { pid: child.pid, startTime: startTime(child.pid), port: p.port, startedAt: new Date().toISOString() };
    await store.processState.set(app.id, p.name, rec);
    process.stdout.write(`Started ${app.id}/${p.name} (pid ${child.pid}) on :${p.port}, waiting for it to respond...`);
    let ok = false;
    // stop waiting early when the shell wrapper has already exited without the port opening (the app crashed on boot)
    for (let i = 0; i < 60 && !ok; i++) { ok = await httpUp(p.port, p.health); if (!ok) { if (child.exited && !listenerPid(p.port)) break; await new Promise((r) => setTimeout(r, 1000)); } }
    console.log(ok ? ' UP' : child.exited && !listenerPid(p.port) ? ` EXITED (code ${child.exitCode}); see data/logs` : ' NOT RESPONDING after 60s (see data/logs)');
    if (!ok) failed = true;
    const lp = listenerPid(p.port);
    if (lp) await store.processState.set(app.id, p.name, { ...rec, listenPid: lp, listenStartTime: startTime(lp) });
  }
}

async function stop(app, only) {
  const recs = (await store.processState.all())[app.id] ?? {};
  for (const [name, rec] of Object.entries(recs)) {
    if (only && name !== only) continue;
    if (rec.container) {
      try { await stopContainer(rec.container); console.log(`Stopped ${app.id}/${name} (container ${rec.container})`); }
      catch (e) { console.log(`${app.id}/${name}: could NOT stop container ${rec.container}: ${e.message}. Record kept.`); failed = true; continue; }
      await store.processState.remove(app.id, name); delete recs[name];
      continue;
    }
    // every PID we recorded for this process, each verified by its start time before it is touched (guards PID reuse)
    const targets = [{ pid: rec.pid, st: rec.startTime }, { pid: rec.listenPid, st: rec.listenStartTime }].filter((t) => t.pid);
    let killed = 0;
    for (const t of targets) {
      const now = startTime(t.pid);
      if (!now || now !== t.st) continue; // gone, or the PID was reused by something else: leave it alone
      if (await driver.killTree(t.pid)) killed++; // a failure is caught by the listener check below
    }
    // verify: if the process we recorded as the port's listener is still the one listening, the stop failed
    const stillOn = rec.port ? listenerPid(rec.port) : null;
    if (rec.listenPid && stillOn === rec.listenPid && startTime(stillOn) === rec.listenStartTime) {
      console.log(`${app.id}/${name}: could NOT stop it, pid ${stillOn} is still listening on :${rec.port}. Record kept.`);
      failed = true;
      continue;
    }
    console.log(killed ? `Stopped ${app.id}/${name} (${killed} process tree(s))` : `${app.id}/${name}: recorded process is no longer running; clearing record`);
    await store.processState.remove(app.id, name);
    delete recs[name];
  }
  if (!Object.keys(recs).length) console.log(`${app.id}: nothing left running under dashboard control.`);
}

// One private copy of a demo for one customer link (registry "perLink"): a fresh data folder, the prepare steps that fill it, then
// the app's processes on that copy's own ports. `instance-stop` stops them and deletes the folder. The copy is never listed in the registry.
const perLinkApp = (base, slotArg) => {
  const slot = Number(slotArg);
  if (!base.perLink || !validSlot(base, slot)) { console.error(`${base.id} has no instance "${slotArg}" (see perLink in the registry).`); process.exit(2); }
  return instanceApp(base, slot);
};
async function instanceStart(base, slotArg) {
  const app = perLinkApp(base, slotArg);
  freshInstanceDir(base.id, app.slot);
  const fillStep = (v) => fill(v, { port: '' }, app);
  const steps = base.perLink.prepare ?? [];
  for (const [i, st] of steps.entries()) {
    const r = await runLoggedStep({ app, step: st, envSource: { ...st, env: { ...(base.perLink.env ?? {}), ...(st.env ?? {}) } }, fillStep,
      logName: `${app.id}-prepare.log`, label: `prepare ${i + 1}`, defaultTimeoutSec: 300 });
    if (!r.ok) {
      if (r.problem) console.error(`Prepare step ${i + 1}: ${r.problem}`);
      else console.log(`Prepare step ${i + 1}/${steps.length} FAILED (${r.how}); see data/logs/${app.id}-prepare.log`);
      failed = true; return;
    }
  }
  await start(app);
}
async function instanceStop(base, slotArg) {
  const app = perLinkApp(base, slotArg);
  await stop(app);
  if (!failed) removeInstanceDir(base.id, app.slot); // keep the data if a process could not be stopped
}

// Put a demo instance back to its seeded state: stop it, run the registry's reset steps (each with its own env file, in order,
// output appended to data/logs/<id>-reset.log), then start it again if it was running. A failed step stops the sequence, but the
// instance is still started so the demo stays available (possibly with old data); the exit code says it failed.
// Runs one reset command through the shell. On a timeout the whole process tree is stopped (a shell's children would otherwise
// be left running), so a hung step cannot leave stray processes behind.
// Step output goes to a log file: hide the values of secret-looking settings (keys, tokens, passwords, connection strings) if a script prints them.
function redact(text, env) {
  for (const [k, v] of Object.entries(env ?? {})) if (/KEY|SECRET|TOKEN|PASS|URL|DSN/i.test(k) && typeof v === 'string' && v.length >= 8) text = text.split(v).join('***');
  // a seed script that prints the account it created ("Created admin user: name / password") is not an env value, so mask by pattern too
  return text.replace(/(Created \w+ user: \S+ \/ )\S+/gi, '$1***');
}
function runStep(cmd, cwd, env, timeoutMs) {
  return new Promise((resolve) => {
    let output = '', timedOut = false, settled = false, timer;
    const done = (r) => { if (!settled) { settled = true; clearTimeout(timer); resolve({ output: redact(output, env), timedOut, ...r }); } };
    const child = spawn(cmd, { cwd, env, shell: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const keep = (d) => { if (output.length < 4 * 1048576) output += d; };
    child.stdout.on('data', keep); child.stderr.on('data', keep);
    timer = setTimeout(async () => { timedOut = true; if (child.pid) await driver.killTree(child.pid); done({ status: null }); }, timeoutMs);
    child.on('error', (e) => done({ status: null, error: e.message }));
    child.on('close', (code) => done({ status: code }));
  });
}
// One step of a build, reset or per-copy prepare: working folder and env are checked first, then the command runs with a timeout and its
// output is appended to data/logs/<logName>. Returns { ok: true }, or { ok: false, problem } when it could not even start (the caller
// words that), or { ok: false, how } when it ran and failed ('timed out', an error, or 'exit N').
async function runLoggedStep({ app, step, envSource, fillStep, logName, label, defaultTimeoutSec, onStart = () => {} }) {
  const cwd = resolve(app.path, step.cwd ?? '.');
  if (!existsSync(cwd)) return { ok: false, problem: `working directory not found: ${cwd}` };
  let env; try { env = childEnv(app, envSource, fillStep); } catch (e) { return { ok: false, problem: e.message }; }
  onStart();
  const r = await runStep(fillStep(step.cmd), cwd, env, (step.timeoutSec ?? defaultTimeoutSec) * 1000);
  try { appendFileSync(join(logDir, logName), `\n--- ${new Date().toISOString()} ${label}: exit ${r.timedOut ? 'timed out' : r.status ?? 'error'}\n${r.output}${r.error ? 'error: ' + r.error + '\n' : ''}`, { mode: 0o600 }); } catch { /* best effort */ }
  if (r.error || r.timedOut || r.status !== 0) return { ok: false, how: r.timedOut ? 'timed out' : r.error ?? 'exit ' + r.status };
  return { ok: true };
}
// Build a demo for production (e.g. `next build`) using the registry's "build" block. Run it once, and again after the app's code
// changes. The build runs with the demo's own env file; the dashboard never reads the app's .env.
async function build(app) {
  const b = app.build;
  if (!b?.cmd) { console.error(`${app.id} has no "build" in the registry.`); failed = true; return; }
  const r = await runLoggedStep({ app, step: b, envSource: b, fillStep: (v) => v, logName: `${app.id}-build.log`, label: 'build', defaultTimeoutSec: 1800,
    onStart: () => process.stdout.write(`Building ${app.id} (this can take a few minutes)...`) });
  if (r.problem) { console.error(r.problem[0].toUpperCase() + r.problem.slice(1)); failed = true; return; }
  if (!r.ok) { console.log(` FAILED (${r.how}); see data/logs/${app.id}-build.log`); failed = true; return; }
  console.log(' done');
}
async function reset(app) {
  if (!app.reset) { console.error(`${app.id} has no "reset" in the registry.`); failed = true; return; }
  let wasRunning = false; // answering on its port counts; a stale record of a process that is gone does not
  for (const p of app.processes) if (!p.optional && await httpUp(p.port, p.health, p.host)) wasRunning = true;
  await stop(app);
  const fillStep = portRefs(app);
  let ok = true;
  for (const [i, st] of app.reset.steps.entries()) {
    const r = await runLoggedStep({ app, step: st, envSource: st, fillStep, logName: `${app.id}-reset.log`, label: `step ${i + 1}`, defaultTimeoutSec: 600,
      onStart: () => process.stdout.write(`Reset ${app.id} step ${i + 1}/${app.reset.steps.length}...`) });
    if (r.problem) { console.error(`Reset step ${i + 1}: ${r.problem}`); ok = false; break; }
    if (!r.ok) { console.log(` FAILED (${r.how}); see data/logs/${app.id}-reset.log`); ok = false; break; }
    console.log(' ok');
  }
  if (wasRunning) await start(app);
  if (!ok) failed = true; else console.log(`${app.id} was reset to its seeded state.`);
}

const [cmd, id, ...rest] = process.argv.slice(2);
const only = rest.find((a) => a.startsWith('--only='))?.split('=')[1];
if (cmd === 'status') await status(id === '--json');
else if (cmd === 'start') await start(getApp(id), only);
else if (cmd === 'stop') await stop(getApp(id), only);
else if (cmd === 'restart') { const a = getApp(id); await stop(a, only); await start(a, only); }
else if (cmd === 'reset') await reset(getApp(id));
else if (cmd === 'build') await build(getApp(id));
else if (cmd === 'instance-start') await instanceStart(getApp(id), rest[0]);
else if (cmd === 'instance-stop') await instanceStop(getApp(id), rest[0]);
else console.log('Usage: node supervisor/index.mjs status | start <app> [--only=proc] | stop <app> [--only=proc] | restart <app> | reset <demo-instance> | build <app> | instance-start|instance-stop <app> <slot>');
await closeStore();
if (failed) process.exitCode = 1;
