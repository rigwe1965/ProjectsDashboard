// Registry loader: reads registry/apps.json once, re-reads only when the file changes, validates it,
// and expands ${APPS_ROOT} / ${DASHBOARD_ROOT} so the registry is not tied to one machine.
import { readFileSync, statSync } from 'node:fs';
import { validContainerName } from './docker.mjs';
import { appsRoot, registryPath as defaultPath, root } from './config.mjs';

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
    const where = `app "${a?.id ?? '?'}"`;
    if (!a.id || !/^[\w-]+$/.test(a.id)) errs.push(`${where}: id is missing or has invalid characters`);
    else if (ids.has(a.id)) errs.push(`${where}: duplicate id`);
    ids.add(a.id);
    if (!a.name) errs.push(`${where}: name is missing`);
    if (!a.path) errs.push(`${where}: path is missing`);
    if (!Array.isArray(a.processes) || !a.processes.length) { errs.push(`${where}: needs at least one process`); continue; }
    const names = new Set();
    for (const p of a.processes) {
      const pw = `${where} / ${p?.name ?? '?'}`;
      if (!p.name) errs.push(`${pw}: process name is missing`);
      else if (names.has(p.name)) errs.push(`${pw}: duplicate process name`);
      names.add(p.name);
      if (!p.cmd && !p.container) errs.push(`${pw}: needs a cmd (host process) or a container name`);
      if (p.cmd && p.container) errs.push(`${pw}: use either cmd or container, not both`);
      if (p.container && !validContainerName(p.container)) errs.push(`${pw}: invalid container name`);
      if (p.host !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/.test(p.host)) errs.push(`${pw}: invalid host`);
      if (!Number.isInteger(p.port) || p.port < 1 || p.port > 65535) errs.push(`${pw}: port must be 1-65535`);
      else if (ports.has(p.port)) errs.push(`${pw}: port ${p.port} is used by another process`);
      else if (reserved.has(p.port)) errs.push(`${pw}: port ${p.port} is reserved`);
      ports.add(p.port);
    }
    if (a.demoReady && !a.demoOf) errs.push(`${where}: demoReady needs demoOf`);
  }
  for (const a of reg.apps) if (a.demoOf && !ids.has(a.demoOf)) errs.push(`app "${a.id}": demoOf "${a.demoOf}" does not exist`);
  return errs;
}

export function loadRegistry(path = defaultPath) {
  const mtimeMs = statSync(path).mtimeMs;
  const hit = cache.get(path);
  if (hit && hit.mtimeMs === mtimeMs) return hit.registry;
  const registry = expand(JSON.parse(readFileSync(path, 'utf8')));
  const errs = validate(registry);
  if (errs.length) throw new Error(`Invalid registry ${path}:\n  - ${errs.join('\n  - ')}`);
  cache.set(path, { mtimeMs, registry });
  return registry;
}
