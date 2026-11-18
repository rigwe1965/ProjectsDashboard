// Registry loader: reads registry/apps.json once, re-reads only when the file changes, validates it,
// and expands ${APPS_ROOT} / ${DASHBOARD_ROOT} so the registry is not tied to one machine.
import { readFileSync, statSync } from 'node:fs';
import { validContainerName } from './docker.mjs';
import { appsRoot, registryPath as defaultPath, root } from './config.mjs';
import { logger } from './log.mjs';

const cache = new Map(); // path -> { mtimeMs, registry }

export function expand(value) {
  if (typeof value === 'string') return value.replaceAll('${APPS_ROOT}', appsRoot).replaceAll('${DASHBOARD_ROOT}', root);
  if (Array.isArray(value)) return value.map(expand);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expand(v)]));
  return value;
}

// Returns a list of problems (empty = valid). Pure function, easy to test.
export function validate(reg) {
  const errs = [];
  if (!reg || !Array.isArray(reg.apps)) return ['registry must have an "apps" array'];
  const ids = new Set(), ports = new Set(), reserved = new Set(reg.reservedPorts ?? []);
  for (const a of reg.apps) {
    if (!a || typeof a !== 'object' || Array.isArray(a)) { errs.push('an entry in "apps" is not an object (a stray comma?)'); continue; } // audit F-16
    const where = `app "${a.id ?? '?'}"`;
    if (!a.id || !/^[\w-]+$/.test(a.id)) errs.push(`${where}: id is missing or has invalid characters`);
    else if (ids.has(a.id)) errs.push(`${where}: duplicate id`);
    ids.add(a.id);
    if (!a.name) errs.push(`${where}: name is missing`);
    if (!a.path) errs.push(`${where}: path is missing`);
    if (!Array.isArray(a.processes) || !a.processes.length) { errs.push(`${where}: needs at least one process`); continue; }
    const names = new Set();
    for (const p of a.processes) {
      if (!p || typeof p !== 'object' || Array.isArray(p)) { errs.push(`${where}: a process entry is not an object`); continue; }
      const pw = `${where} / ${p.name ?? '?'}`;
      if (!p.name) errs.push(`${pw}: process name is missing`);
      else if (!/^[\w-]+$/.test(String(p.name))) errs.push(`${pw}: process name may only contain letters, digits, _ and - (it is used in the log file name and in shell commands)`);
      else if (names.has(p.name)) errs.push(`${pw}: duplicate process name`);
      names.add(p.name);
      if (!p.cmd && !p.container) errs.push(`${pw}: needs a cmd (host process) or a container name`);
      if (p.cmd && p.container) errs.push(`${pw}: use either cmd or container, not both`);
      if (p.container && !validContainerName(p.container)) errs.push(`${pw}: invalid container name`);
      // {port:name} in a command or env value must name a process of this app, or starting it would crash
      const refs = [p.cmd, ...Object.values(p.env ?? {})].filter((v) => typeof v === 'string').flatMap((v) => [...v.matchAll(/\{port:(\w+)\}/g)].map((m) => m[1]));
      for (const n of refs) if (!a.processes.some((q) => q.name === n)) errs.push(`${pw}: {port:${n}} refers to a process that does not exist`);
      if (p.host !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/.test(p.host)) errs.push(`${pw}: invalid host`);
      if (!Number.isInteger(p.port) || p.port < 1 || p.port > 65535) errs.push(`${pw}: port must be 1-65535`);
      else {
        // a port is only unique per host: two containers can both listen on 5400 inside their own network namespaces
        const where = p.host || '127.0.0.1', key = `${where}:${p.port}`;
        if (ports.has(key)) errs.push(`${pw}: port ${p.port} is used by another process${p.host ? ` on ${p.host}` : ''}`);
        else if (!p.host && reserved.has(p.port)) errs.push(`${pw}: port ${p.port} is reserved`);
        ports.add(key);
      }
    }
    if (a.requiresDocker !== undefined && typeof a.requiresDocker !== 'boolean') errs.push(`${where}: requiresDocker must be true or false`);
    if (a.demoReady && !a.demoOf) errs.push(`${where}: demoReady needs demoOf`);
    // guide: the AI guide is offered for this demo (needs a confirmed guides/<product>.md, see demo-gateway/guide/content.mjs)
    if (a.guide !== undefined) {
      if (typeof a.guide !== 'boolean') errs.push(`${where}: guide must be true or false`);
      if (!a.demoOf) errs.push(`${where}: guide is only for demo instances (demoOf)`);
    }
    // demoRoutes: which of a demo's processes answers a path prefix. A route to a process that does not exist would fail every matching request.
    if (a.demoRoutes !== undefined) {
      if (!Array.isArray(a.demoRoutes)) errs.push(`${where}: demoRoutes must be an array`);
      else a.demoRoutes.forEach((r, i) => {
        if (!r || typeof r.prefix !== 'string' || !/^\/[^\s?#]*$/.test(r.prefix) || (r.prefix.length > 1 && r.prefix.endsWith('/'))) errs.push(`${where}: demoRoutes[${i}].prefix must start with "/" and not end with one`);
        if (!r || !a.processes.some((q) => q?.name === r.process)) errs.push(`${where}: demoRoutes[${i}] names a process that does not exist`);
      });
    }
    // reset: how a demo instance is put back to its seeded state (run by `supervisor reset <id>`)
    if (a.reset !== undefined) {
      if (!a.demoOf) errs.push(`${where}: reset is only for demo instances (demoOf)`);
      if (!Array.isArray(a.reset?.steps) || !a.reset.steps.length) errs.push(`${where}: reset needs a non-empty "steps" array`);
      else a.reset.steps.forEach((st, i) => {
        if (!st || typeof st.cmd !== 'string' || !st.cmd.trim()) errs.push(`${where}: reset step ${i + 1} needs a cmd`);
        if (st?.timeoutSec !== undefined && !(Number.isInteger(st.timeoutSec) && st.timeoutSec >= 1 && st.timeoutSec <= 3600)) errs.push(`${where}: reset step ${i + 1} timeoutSec must be 1-3600`);
        const refs = typeof st?.cmd === 'string' ? [...st.cmd.matchAll(/\{port:(\w+)\}/g)].map((m) => m[1]) : [];
        for (const n of refs) if (!a.processes.some((q) => q.name === n)) errs.push(`${where}: reset step ${i + 1}: {port:${n}} refers to a process that does not exist`);
      });
    }
    // build: a production build (e.g. `next build`) run by `supervisor build <id>` before the app is started
    if (a.build !== undefined) {
      if (typeof a.build?.cmd !== 'string' || !a.build.cmd.trim()) errs.push(`${where}: build needs a cmd`);
      if (a.build?.produces !== undefined && typeof a.build.produces !== 'string') errs.push(`${where}: build.produces must be a path`);
    }
    // snapshot: files saved as the golden copy by `snapshot.mjs take` and put back by a reset step (`snapshot.mjs restore`)
    if (a.snapshot !== undefined && (!Array.isArray(a.snapshot?.paths) || !a.snapshot.paths.length || a.snapshot.paths.some((x) => typeof x !== 'string' || !x.trim()))) errs.push(`${where}: snapshot needs a non-empty "paths" array of strings`);
    // demoAccounts: the sign-ins a customer may be given (admin: true marks accounts that are for the owner only)
    if (a.demoAccounts !== undefined) {
      if (!Array.isArray(a.demoAccounts)) errs.push(`${where}: demoAccounts must be an array`);
      else a.demoAccounts.forEach((x, i) => { if (!x || typeof x.user !== 'string' || typeof x.label !== 'string') errs.push(`${where}: demoAccounts[${i}] needs a label and a user`); });
    }
    // perLink: one private copy of this demo per customer link (see lib/instance-app.mjs)
    if (a.perLink !== undefined) {
      const pl = a.perLink, n = pl?.max;
      if (!a.demoOf) errs.push(`${where}: perLink is only for demo instances (demoOf)`);
      if (!Number.isInteger(n) || n < 1 || n > 50) errs.push(`${where}: perLink.max must be a whole number from 1 to 50`);
      if (!Number.isInteger(pl?.portBase) || pl.portBase < 1024 || pl.portBase + Math.max(100, (Number.isInteger(n) ? n : 0) * 10) - 1 > 65535) errs.push(`${where}: perLink.portBase must be a port number (1024 or more)`);
      if (pl?.idleMinutes !== undefined && !(Number.isInteger(pl.idleMinutes) && pl.idleMinutes >= 5 && pl.idleMinutes <= 10080)) errs.push(`${where}: perLink.idleMinutes must be 5-10080`);
      if (a.processes.length > 10) errs.push(`${where}: perLink supports at most 10 processes`);
      if (a.processes.some((p) => p.container)) errs.push(`${where}: perLink cannot be used with container processes`);
      if (!Array.isArray(pl?.prepare)) errs.push(`${where}: perLink.prepare must be an array of steps (may be empty)`);
      else pl.prepare.forEach((st, i) => { if (!st || typeof st.cmd !== 'string' || !st.cmd.trim()) errs.push(`${where}: perLink.prepare step ${i + 1} needs a cmd`); });
      if (Number.isInteger(n) && Number.isInteger(pl?.portBase)) for (let k = 0; k < Math.min(n, 50); k++) for (let i = 0; i < a.processes.length; i++) {
        const port = pl.portBase + k * 10 + i;
        const key = `127.0.0.1:${port}`; // the same key the process ports above use
        if (reserved.has(port) || ports.has(key)) errs.push(`${where}: perLink port ${port} (copy ${k}) is reserved or used by another app`);
        ports.add(key);
      }
    }
  }
  for (const a of reg.apps) if (a && typeof a === 'object' && a.demoOf && !ids.has(a.demoOf)) errs.push(`app "${a.id}": demoOf "${a.demoOf}" does not exist`);
  return errs;
}

// The gateway asks for the registry on every request. Checking the file's time each time is a synchronous disk call on that hot path, so
// the check is repeated at most once per RECHECK_MS (REGISTRY_RECHECK_MS; 0 = every call, the old behaviour). An edit is seen within that time.
const recheckMs = () => { const n = Number(process.env.REGISTRY_RECHECK_MS); return process.env.REGISTRY_RECHECK_MS === undefined || process.env.REGISTRY_RECHECK_MS === '' || Number.isNaN(n) || n < 0 ? 1000 : n; };

export function loadRegistry(path = defaultPath) {
  const hit = cache.get(path);
  const now = Date.now();
  if (hit && now - hit.checkedAt < recheckMs()) return hit.registry;
  const mtimeMs = statSync(path).mtimeMs;
  if (hit && hit.mtimeMs === mtimeMs) { hit.checkedAt = now; return hit.registry; }
  const registry = expand(JSON.parse(readFileSync(path, 'utf8')));
  const errs = validate(registry);
  if (errs.length) throw new Error(`Invalid registry ${path}:\n  - ${errs.join('\n  - ')}`);
  cache.set(path, { mtimeMs, registry, checkedAt: now });
  return registry;
}

// product id -> demo instance entry (only instances explicitly marked demoReady)
// If apps.json is saved in a broken state while the gateway runs, keep serving the last valid copy instead of failing every request.
let lastGood = null;
export function demoApps() {
  try {
    const reg = loadRegistry();
    // No prototype: the map is indexed with text from outside (a host name, a form field), and "constructor" or "__proto__" must not count as a product (audit F-13).
    lastGood = Object.assign(Object.create(null), Object.fromEntries(reg.apps.filter((a) => a.demoOf && a.demoReady === true).map((a) => [a.demoOf, a])));
  } catch (err) {
    if (!lastGood) throw err;
    logger.error('registry reload failed; using the last valid copy', { err });
  }
  return lastGood;
}
