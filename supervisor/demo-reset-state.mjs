// Reset bookkeeping for container deployments, where the demos run in Docker and are reset from the host
// (deploy/reset-demos.sh). It reads and writes the same records the gateway and console use, so links are held back while a
// reset runs and the console shows when it last happened.
//   node supervisor/demo-reset-state.mjs due <product>                  exit 0 if a reset is due, 1 if not (the reason is printed)
//   node supervisor/demo-reset-state.mjs begin <product>                start a reset: prints its start time; exit 3 if one is running
//   node supervisor/demo-reset-state.mjs end <product> ok|fail [time]   finish it (time = what begin printed)
//   node supervisor/demo-reset-state.mjs clear <product>                let new links open again after a failed reset (check the demo's data first)
import { getStore, closeStore } from '../lib/store/index.mjs';
import { beginReset, endReset, resetDue, clearResetFailure } from '../demo-gateway/reset.mjs';

const [cmd, product, arg, startedAt] = process.argv.slice(2);
let code = 0;
try {
  if (!/^[\w-]+$/.test(product || '')) throw new Error('Usage: demo-reset-state.mjs due|begin|end <product> ...');
  const store = await getStore();
  if (cmd === 'due') { const why = await resetDue(store, product); console.log(why); code = why === 'due' ? 0 : 1; }
  else if (cmd === 'begin') { const t = await beginReset(store, product); if (t) console.log(t); else { console.error('A reset of this demo is already running.'); code = 3; } }
  else if (cmd === 'end' && (arg === 'ok' || arg === 'fail')) { await endReset(store, product, { ok: arg === 'ok', startedAt, by: 'host' }); console.log('recorded'); }
  else if (cmd === 'clear') { await clearResetFailure(store, product); console.log('cleared'); }
  else throw new Error('Usage: demo-reset-state.mjs due|begin|end|clear <product> ...');
} catch (e) { console.error(e.message); code = 2; }
await closeStore();
process.exitCode = code;
