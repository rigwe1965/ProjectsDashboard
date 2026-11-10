// Process status as rows, for the console. A failed or unreadable status check is reported, never silently shown as "everything stopped".
// Each status check starts a supervisor process and probes every app, so concurrent requests (the page asks for apps and demos at
// the same time, from every open tab) share ONE check, and its answer is reused for a couple of seconds. An action that changes
// what is running (start, stop, restart, reset) drops the saved answer, so the next request sees the new state.
import { logger } from '../lib/log.mjs';
import { SECOND } from '../lib/util.mjs';

const STATUS_TIMEOUT_MS = 30 * SECOND;

export function createStatusCache({ supervisor, reuseMs }) {
  let saved = null, running = null, generation = 0;
  const drop = () => { generation++; saved = null; };
  function get() {
    if (saved && Date.now() - saved.t < reuseMs) return Promise.resolve(saved.v);
    if (!running) {
      const gen = generation;
      running = (async () => {
        const { ok, output } = await supervisor(['status', '--json'], STATUS_TIMEOUT_MS);
        let v;
        try { v = { rows: JSON.parse(output), statusError: null }; } catch {
          logger.warn('supervisor status unreadable', { ok, output: String(output).slice(0, 300) });
          v = { rows: [], statusError: ok ? 'unreadable' : 'failed' };
        }
        if (gen === generation && !v.statusError) saved = { t: Date.now(), v };
        return v;
      })().finally(() => { running = null; });
    }
    return running;
  }
  return { get, drop };
}
