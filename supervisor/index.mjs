// Supervisor: status | start <app> | stop <app> | restart <app>
// Safety rules:
//  - never reads .env files, never writes into app folders
//  - never kills by port or by name: only PIDs it recorded itself, and only if the
//    process start time still matches (guards against PID reuse)
//  - refuses to start a process whose port is already in use or reserved
//  - app env vars are set on the child process only
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { getStore, closeStore } from '../lib/store/index.mjs';
import { join, resolve } from 'node:path';
import { cleanEnv } from '../lib/clean-env.mjs';
import { root, dataDir } from '../lib/config.mjs';
import { loadRegistry } from '../lib/registry.mjs';
import { portInUse, httpUp } from '../lib/http-util.mjs';
import { getDriver } from '../lib/process-driver.mjs';
import { containerRunning, startContainer, stopContainer } from '../lib/docker.mjs';

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

function fill(str, proc, app) {
  return str
    .replaceAll('{url}', `http://localhost:${proc.port}`)
    .replaceAll('{port}', String(proc.port))
    .replace(/\{port:(\w+)\}/g, (_, n) => String(app.processes.find((p) => p.name === n).port));
}

const getApp = (id) => {
  const app = registry.apps.find((a) => a.id === id);
  if (!app) { console.error(`Unknown app "${id}". Known: ${registry.apps.map((a) => a.id).join(', ')}`); process.exit(1); }
  return app;
};

async function status(json) {
  const state = await store.processState.all();
  const rows = [];
  for (const app of registry.apps) {
    for (const p of app.processes) {
      const rec = state[app.id]?.[p.name];
      const up = await httpUp(p.port, p.health, p.host);
      // managed = one of the PIDs we recorded is still alive (the shell wrapper may be gone while the app listens)
      const managed = p.container
        ? !!(rec?.container && up && await containerRunning(rec.container))
        : !!(rec && up && ((rec.startTime && startTime(rec.pid) === rec.startTime) || (rec.listenPid && startTime(rec.listenPid) === rec.listenStartTime)));
      rows.push({ app: app.id, proc: p.name, port: p.port, optional: !!p.optional, up, managed, url: `http://127.0.0.1:${p.port}${p.health}` });
    }
  }
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
  // pre-flight all ports first so we never half-start an app
  for (const p of todo) {
    if (reserved.has(p.port)) { console.error(`Port ${p.port} is reserved. Aborting.`); process.exit(1); }
    if (await portInUse(p.port)) { console.error(`Port ${p.port} (${app.id}/${p.name}) is already in use. Not starting anything.`); process.exit(1); }
  }
  for (const p of todo) {
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
    const env = cleanEnv({ ...process.env });
    if (p.envFile) { // the DASHBOARD's own env file (under data/), never the app's .env
      const f = join(root, p.envFile);
      if (!existsSync(f)) { console.error(`Env file missing for ${app.id}/${p.name}: ${p.envFile}`); process.exit(1); }
      for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
        const t = line.trim(); const i = t.indexOf('=');
        if (t && !t.startsWith('#') && i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1);
      }
    }
    for (const [k, v] of Object.entries(p.env ?? {})) env[k] = fill(v, p, app);
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

const [cmd, id, ...rest] = process.argv.slice(2);
const only = rest.find((a) => a.startsWith('--only='))?.split('=')[1];
if (cmd === 'status') await status(id === '--json');
else if (cmd === 'start') await start(getApp(id), only);
else if (cmd === 'stop') await stop(getApp(id), only);
else if (cmd === 'restart') { const a = getApp(id); await stop(a, only); await start(a, only); }
else console.log('Usage: node supervisor/index.mjs status | start <app> [--only=proc] | stop <app> [--only=proc] | restart <app>');
await closeStore();
if (failed) process.exitCode = 1;
