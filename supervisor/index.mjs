// Supervisor: status | start <app> | stop <app> | restart <app>
// Safety rules:
//  - never reads .env files, never writes into app folders
//  - never kills by port or by name: only PIDs it recorded itself, and only if the
//    process start time still matches (guards against PID reuse)
//  - refuses to start a process whose port is already in use or reserved
//  - app env vars are set on the child process only
import { readFileSync, writeFileSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import net from 'node:net';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const registryPath = process.env.DASHBOARD_REGISTRY || join(root, 'registry', 'apps.json');
const dataDir = process.env.DASHBOARD_DATA || join(root, 'data');
const statePath = join(dataDir, 'state.json');
const logDir = join(dataDir, 'logs');
const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
const reserved = new Set(registry.reservedPorts ?? []);

mkdirSync(logDir, { recursive: true });
const loadState = () => (existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {});
const saveState = (s) => writeFileSync(statePath, JSON.stringify(s, null, 2));

const portInUse = (port) =>
  new Promise((res) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    s.once('connect', () => { s.destroy(); res(true); });
    s.once('error', () => res(false));
    s.setTimeout(800, () => { s.destroy(); res(false); });
  });

async function httpUp(port, path) {
  try { await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(2500) }); return true; }
  catch { return false; }
}

function startTime(pid) {
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command',
      `(Get-Process -Id ${Number(pid)} -ErrorAction Stop).StartTime.ToFileTimeUtc()`], { encoding: 'utf8' });
    return out.trim();
  } catch { return null; }
}

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
  const state = loadState();
  const rows = [];
  for (const app of registry.apps) {
    for (const p of app.processes) {
      const rec = state[app.id]?.[p.name];
      const up = await httpUp(p.port, p.health);
      const managed = !!(rec && startTime(rec.pid) === rec.startTime);
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
  if (!existsSync(app.path)) { console.error(`Path not found: ${app.path}`); process.exit(1); }
  const state = loadState();
  state[app.id] ??= {};
  const todo = app.processes.filter((p) => (only ? p.name === only : !p.optional));
  // pre-flight all ports first so we never half-start an app
  for (const p of todo) {
    if (reserved.has(p.port)) { console.error(`Port ${p.port} is reserved. Aborting.`); process.exit(1); }
    if (await portInUse(p.port)) { console.error(`Port ${p.port} (${app.id}/${p.name}) is already in use. Not starting anything.`); process.exit(1); }
  }
  for (const p of todo) {
    const cwd = resolve(app.path, p.cwd ?? '.');
    const env = { ...process.env };
    for (const [k, v] of Object.entries(p.env ?? {})) env[k] = fill(v, p, app);
    const log = openSync(join(logDir, `${app.id}-${p.name}.log`), 'a');
    const child = spawn(fill(p.cmd, p, app), { cwd, env, shell: true, detached: true, windowsHide: true, stdio: ['ignore', log, log] });
    child.unref();
    await new Promise((r) => setTimeout(r, 800));
    state[app.id][p.name] = { pid: child.pid, startTime: startTime(child.pid), port: p.port, startedAt: new Date().toISOString() };
    saveState(state);
    process.stdout.write(`Started ${app.id}/${p.name} (pid ${child.pid}) on :${p.port}, waiting for it to respond...`);
    let ok = false;
    for (let i = 0; i < 60 && !ok; i++) { ok = await httpUp(p.port, p.health); if (!ok) await new Promise((r) => setTimeout(r, 1000)); }
    console.log(ok ? ' UP' : ' NOT RESPONDING after 60s (see data/logs)');
  }
}

function stop(app, only) {
  const state = loadState();
  const recs = state[app.id] ?? {};
  for (const [name, rec] of Object.entries(recs)) {
    if (only && name !== only) continue;
    const st = startTime(rec.pid);
    if (st && st === rec.startTime) {
      try { execFileSync('taskkill', ['/PID', String(rec.pid), '/T', '/F'], { stdio: 'ignore' }); console.log(`Stopped ${app.id}/${name} (pid ${rec.pid})`); }
      catch { console.log(`Could not stop ${app.id}/${name} (pid ${rec.pid})`); continue; }
    } else {
      console.log(`${app.id}/${name}: recorded process is no longer running; clearing record`);
    }
    delete recs[name];
  }
  state[app.id] = recs;
  saveState(state);
  if (!Object.keys(recs).length) console.log(`${app.id}: nothing left running under dashboard control.`);
}

const [cmd, id, ...rest] = process.argv.slice(2);
const only = rest.find((a) => a.startsWith('--only='))?.split('=')[1];
if (cmd === 'status') await status(id === '--json');
else if (cmd === 'start') await start(getApp(id), only);
else if (cmd === 'stop') stop(getApp(id), only);
else if (cmd === 'restart') { const a = getApp(id); stop(a, only); await start(a, only); }
else console.log('Usage: node supervisor/index.mjs status | start <app> [--only=proc] | stop <app> [--only=proc] | restart <app>');
