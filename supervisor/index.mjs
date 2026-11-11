// Supervisor: status | start <app> | stop <app> | restart <app> | reset <demo-instance> | build <app>
// This file is only the command line: it builds the parts (registry, store, process driver, docker) and runs one command.
// The commands themselves are in core.mjs, the shell steps in steps.mjs, the command/env building in env.mjs.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStore, closeStore } from '../lib/store/index.mjs';
import { dataDir } from '../lib/config.mjs';
import { loadRegistry } from '../lib/registry.mjs';
import { getDriver } from '../lib/process-driver.mjs';
import * as docker from '../lib/docker.mjs';
import { createSupervisor, Exit } from './core.mjs';

const USAGE = 'Usage: node supervisor/index.mjs status | start <app> [--only=proc] | stop <app> [--only=proc] | restart <app> | reset <demo-instance> | build <app> | instance-start|instance-stop <app> <slot>';

// Runs one command and returns the exit code. The parts can be passed in; by default they are the real ones.
export async function main(argv, { registry = loadRegistry(), store, driver = getDriver(), logDir = join(dataDir, 'logs') } = {}) {
  mkdirSync(logDir, { recursive: true });
  // Process records live in the database, one row per app/process, so two supervisors starting different apps
  // at the same time can no longer overwrite each other's records (state.json used to be rewritten whole).
  store ??= await getStore();
  const sup = createSupervisor({ registry, store, driver, docker, logDir });
  const [cmd, id, ...rest] = argv;
  const only = rest.find((a) => a.startsWith('--only='))?.split('=')[1];
  const commands = {
    status: () => sup.status(id === '--json'),
    start: () => sup.start(sup.getApp(id), only),
    stop: () => sup.stop(sup.getApp(id), only),
    restart: async () => { const a = sup.getApp(id); await sup.stop(a, only); await sup.start(a, only); },
    reset: () => sup.reset(sup.getApp(id)),
    build: () => sup.build(sup.getApp(id)),
    'instance-start': () => sup.instanceStart(sup.getApp(id), rest[0]),
    'instance-stop': () => sup.instanceStop(sup.getApp(id), rest[0]),
  };
  let code = 0;
  try {
    if (Object.hasOwn(commands, cmd)) await commands[cmd]();
    else { console.log(USAGE); if (cmd) code = 2; } // no command at all is just a request for help; an unknown one must not look like success
    if (sup.failed()) code = 1;
  } catch (e) {
    if (!(e instanceof Exit)) throw e;
    code = e.code;
  }
  return code;
}

// Run as a command (node supervisor/index.mjs ...), but not when a test or another module imports it.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const code = await main(process.argv.slice(2));
  await closeStore();
  if (code) process.exitCode = code;
}
