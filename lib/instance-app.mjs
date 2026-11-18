// One private demo instance per customer link ("perLink" in the registry).
//
// A demo app that keeps its state in files can run many times side by side, each copy with its own data folder and its own ports.
// The registry's `perLink` block says how:
//   "perLink": {
//     "max": 4,                 how many copies may run at once (1-50); the next customer waits or is told to come back
//     "portBase": 21100,        copy number k (0-based) runs process i on portBase + k*10 + i
//     "idleMinutes": 120,       a copy nobody has touched for this long is stopped and its data deleted
//     "env": { ... },           extra environment for every process and prepare step; {inst} is the copy's data folder
//     "prepare": [ { cmd, cwd, envFile, env, timeoutSec } ]   run once, in order, to create the copy's data
//   }
// This module only describes a copy (its id, folder and ports). Starting and stopping it is `supervisor instance-start|instance-stop`.
import { join, resolve, sep } from 'node:path';
import { rmSync, mkdirSync } from 'node:fs';
import { dataDir } from './config.mjs';

export const MAX_SLOTS = 50; // was 9. Copy k still runs on portBase + k*10 + i, so a product that already has copies keeps every port
export const instanceId = (appId, slot) => `${appId}.i${slot}`;
// forward slashes on purpose: valid on every OS, and safe inside a sqlite:/// URL or a command line
export const instanceDir = (appId, slot) => join(dataDir, 'instances', appId, String(slot)).replaceAll('\\', '/');
export const slotPort = (app, slot, index) => app.perLink.portBase + slot * 10 + index;
export const validSlot = (app, slot) => Number.isInteger(slot) && slot >= 0 && slot < (app.perLink?.max ?? 0);

// The registry entry of copy number `slot`: same app, its own id, ports and data folder. Never listed in the registry itself.
// `anySlot` is for stopping a copy: its seat may be numbered above a `max` that was lowered after it started, and it must still be stoppable.
export function instanceApp(app, slot, { anySlot = false } = {}) {
  if (!app.perLink || !(anySlot ? Number.isInteger(slot) && slot >= 0 && slot < MAX_SLOTS : validSlot(app, slot))) throw new Error(`${app.id} has no instance ${slot}`);
  const extra = app.perLink.env ?? {};
  return {
    ...app, id: instanceId(app.id, slot), baseId: app.id, slot, inst: instanceDir(app.id, slot),
    perLink: undefined, reset: undefined, demoOf: undefined, demoReady: false,
    processes: app.processes.map((p, i) => ({ ...p, port: slotPort(app, slot, i), env: { ...(p.env ?? {}), ...extra } })),
  };
}

// The folder only ever comes from a registry id (letters, digits, _ and -) and a number, so nothing outside data/instances/<id>/ is touched.
function safeDir(appId, slot) {
  if (!/^[\w-]+$/.test(appId) || !Number.isInteger(slot) || slot < 0 || slot > MAX_SLOTS) throw new Error('Invalid instance');
  const dir = resolve(dataDir, 'instances', appId, String(slot));
  if (!dir.startsWith(resolve(dataDir, 'instances') + sep)) throw new Error('Invalid instance');
  return dir;
}
export const removeInstanceDir = (appId, slot) => rmSync(safeDir(appId, slot), { recursive: true, force: true });
export const freshInstanceDir = (appId, slot) => { removeInstanceDir(appId, slot); mkdirSync(safeDir(appId, slot), { recursive: true }); };
