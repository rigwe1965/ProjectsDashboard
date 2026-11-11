// The supervisor's commands: status, start, stop, build, reset and the per-link copies. Everything it needs comes in through
// createSupervisor(), so it can be used (and tested) without running the command line:
//   registry  the loaded registry          store   the dashboard store (only processState is used)
//   driver    process control (lib/process-driver.mjs)       docker   the container functions (lib/docker.mjs)
//   logDir    where app and step logs go
// Safety rules:
//  - never reads .env files, never writes into app folders
//  - never kills by port or by name: only PIDs it recorded itself, and only if the process start time still matches (guards against PID reuse)
//  - refuses to start a process whose port is already in use or reserved
//  - app env vars are set on the child process only
import { existsSync, appendFileSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { portInUse, httpUp } from '../lib/http-util.mjs';
import { instanceApp, validSlot, freshInstanceDir, removeInstanceDir } from '../lib/instance-app.mjs';
import { fill, portRefs, childEnv } from './env.mjs';
import { createStepRunner } from './steps.mjs';
import { rotateLog } from '../lib/log-rotate.mjs';

// Thrown to end a command early with an exit code; the entry point turns it into the process exit code.
export class Exit extends Error { constructor(code) { super(`exit ${code}`); this.code = code; } }
const die = (message, code = 1) => { console.error(message); throw new Exit(code); };

export function createSupervisor({ registry, store, driver, docker, logDir }) {
  const reserved = new Set(registry.reservedPorts ?? []);
  const { containerRunning, startContainer, stopContainer, ensureEngine } = docker;
  const { runLoggedStep } = createStepRunner({ driver, logDir });
  let failed = false; // any start that did not come up or stop that did not stop makes the exit code non-zero
  const startTime = (pid) => driver.startTime(pid);
  const listenerPid = (port) => driver.listenerPid(port);

  const getApp = (id) => {
    const app = registry.apps.find((a) => a.id === id);
    if (!app) die(`Unknown app "${id}". Known: ${registry.apps.map((a) => a.id).join(', ')}`);
    return app;
  };

  // Is this process running AND one we started (a recorded PID is still the same process)? The shell wrapper may be gone while the app listens.
  async function isManaged(p, rec, up, timeOf = startTime) {
    if (p.container) return !!(rec?.container && up && await containerRunning(rec.container));
    return !!(rec && up && ((rec.startTime && timeOf(rec.pid) === rec.startTime) || (rec.listenPid && timeOf(rec.listenPid) === rec.listenStartTime)));
  }

  // A demo whose database lives in Docker needs the engine up first (start and reset both do; this waits longer than an app's own 60 s).
  async function needDocker(app) {
    if (!app.requiresDocker) return;
    const d = await ensureEngine({ log: (m) => console.log(m) });
    if (!d.ok) die(d.message);
    if (d.started) console.log('Docker is running.');
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
    if (todo.some((p) => !p.container) && !existsSync(app.path)) die(`Path not found: ${app.path}`);
    // An app that runs a production build (not a dev server) must have been built first: say so instead of failing to boot.
    if (app.build?.produces && !existsSync(resolve(app.path, app.build.cwd ?? '.', app.build.produces))) {
      die(`${app.id} has not been built yet. Run: node supervisor/index.mjs build ${app.id}`);
    }
    await needDocker(app);
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
      if (reserved.has(p.port)) die(`Port ${p.port} is reserved. Aborting.`);
      if (await portInUse(p.port)) die(`Port ${p.port} (${app.id}/${p.name}) is already in use. Not starting anything.`);
    }
    for (const p of pending) {
      if (p.container) { // an existing container: the supervisor only starts it (see lib/docker.mjs)
        try { await startContainer(p.container); } catch (e) { die(`Could not start container "${p.container}": ${e.message}`); }
        await store.processState.set(app.id, p.name, { container: p.container, port: p.port, startedAt: new Date().toISOString() });
        process.stdout.write(`Started ${app.id}/${p.name} (container ${p.container}) on :${p.port}, waiting for it to respond...`);
        let up = false;
        for (let i = 0; i < 60 && !up; i++) { up = await httpUp(p.port, p.health, p.host); if (!up) await new Promise((r) => setTimeout(r, 1000)); }
        console.log(up ? ' UP' : ' NOT RESPONDING after 60s (docker logs ' + p.container + ')');
        if (!up) failed = true;
        continue;
      }
      const cwd = resolve(app.path, p.cwd ?? '.');
      if (!existsSync(cwd)) { failed = true; die(`Working directory not found for ${app.id}/${p.name}: ${cwd}`); }
      let env;
      try { env = childEnv(app, p, (v) => fill(v, p, app)); } catch (e) { die(`${e.message} (${app.id}/${p.name})`); }
      const logPath = join(logDir, `${app.id}-${p.name}.log`);
      // The app's output is appended to this file by the shell. Make the file owner-only first (where the system supports it), so other
      // users of the machine cannot read what the app prints.
      rotateLog(logPath); // a log over 5 MB moves to <name>.log.1 before the app starts writing to it
      try { appendFileSync(logPath, '', { mode: 0o600 }); chmodSync(logPath, 0o600); } catch { /* best effort */ }
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
    if (!base.perLink || !validSlot(base, slot)) die(`${base.id} has no instance "${slotArg}" (see perLink in the registry).`, 2);
    return instanceApp(base, slot);
  };
  async function instanceStart(base, slotArg) {
    const app = perLinkApp(base, slotArg);
    // Whatever is still running on this copy (one of two processes that crashed, a start that was cut short) holds files in the folder
    // that is about to be deleted. Stop it first; if it cannot be stopped, leave the folder alone and say so (audit F-11).
    await stop(app);
    if (failed) { console.log(`${app.id}: something from an earlier start could not be stopped, so the copy was not started.`); return; }
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

  // Put a demo instance back to its seeded state: stop it, run the registry's reset steps (each with its own env file, in order,
  // output appended to data/logs/<id>-reset.log), then start it again if it was running. A failed step stops the sequence, but the
  // instance is still started so the demo stays available (possibly with old data); the exit code says it failed.
  async function reset(app) {
    if (!app.reset) { console.error(`${app.id} has no "reset" in the registry.`); failed = true; return; }
    await needDocker(app); // before anything is stopped: with Docker unavailable the running demo is left as it was
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

  return { getApp, isManaged, status, start, stop, instanceStart, instanceStop, build, reset, failed: () => failed };
}
