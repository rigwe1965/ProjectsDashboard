// Putting a shared demo back to its seeded state, so one customer's data never carries over to the next.
//
// Every product has ONE demo instance that all of its customers share (SEC-03). A product opts in with a "reset" block in the
// registry. A reset runs automatically once nobody can still be using the instance: every link that was opened for the product
// has been revoked or has expired. The admin console can also reset one on demand.
//
// State lives in the store's meta table so the gateway and the console (separate processes) agree:
//   demo_resetting:<product>  ISO time while a reset is running (the gateway refuses new link opens meanwhile)
//   demo_reset_at:<product>   ISO time the last successful reset started
//   demo_reset_failed:<product>  ISO time of the last failed automatic reset (retry after a pause)
import { isActive } from './grants.mjs';
import { logger } from '../lib/log.mjs';

export const RESET_STALE_MS = 25 * 60 * 1000;   // a "resetting" flag older than this is a crashed reset, not a running one
export const RETRY_AFTER_FAIL_MS = 10 * 60 * 1000;
const resettingKey = (p) => 'demo_resetting:' + p, lastKey = (p) => 'demo_reset_at:' + p, failKey = (p) => 'demo_reset_failed:' + p;

export async function isResetting(store, product) {
  const t = Date.parse((await store.meta.get(resettingKey(product))) || '');
  return Number.isFinite(t) && Date.now() - t < RESET_STALE_MS;
}
export const lastResetAt = async (store, product) => (await store.meta.get(lastKey(product))) || null;

// busy:  a link for this product was opened and has not yet ended, so a customer may still be in the demo
// dirty: a link was opened since the last reset, so the instance may hold a customer's data
export function productState(grants, product, lastResetMs = 0) {
  const mine = grants.filter((g) => g.app === product);
  return {
    busy: mine.filter((g) => isActive(g) && g.lastUsedAt).length,
    dirty: mine.some((g) => g.lastUsedAt && Date.parse(g.lastUsedAt) > lastResetMs),
  };
}

// Runs `supervisor reset <instance>` and records the outcome. `supervisor(args, timeoutMs)` resolves { ok, output }.
export async function runReset({ store, product, app, supervisor, by = 'auto' }) {
  if (await isResetting(store, product)) return { ok: false, busy: true, output: 'A reset of this demo is already running.' };
  const startedAt = new Date().toISOString();
  await store.meta.set(resettingKey(product), startedAt);
  let r;
  try { r = await supervisor(['reset', app.id], 20 * 60 * 1000); }
  catch (err) { r = { ok: false, output: String(err?.message || err) }; }
  finally { await store.meta.set(resettingKey(product), ''); }
  if (r.ok) { await store.meta.set(lastKey(product), startedAt); await store.meta.set(failKey(product), ''); }
  else await store.meta.set(failKey(product), new Date().toISOString());
  await store.audit.add({ ev: 'demo-reset', app: product, ok: !!r.ok, by });
  return r;
}

// One pass over every product that has a reset block: reset those that hold customer data and have no customer left in them.
export async function resetSweep({ store, apps, supervisor }) {
  const done = [];
  for (const [product, app] of Object.entries(apps)) {
    if (!app.reset) continue;
    try {
      if (await isResetting(store, product)) continue;
      const last = Date.parse((await lastResetAt(store, product)) || '') || 0;
      const { busy, dirty } = productState(await store.grants.list(), product, last);
      if (!dirty || busy) continue;
      const failedAt = Date.parse((await store.meta.get(failKey(product))) || '') || 0;
      if (Date.now() - failedAt < RETRY_AFTER_FAIL_MS) continue;
      logger.info('resetting demo to its seeded state', { product });
      const r = await runReset({ store, product, app, supervisor, by: 'auto' });
      if (!r.ok) logger.error('automatic demo reset failed', { product, output: String(r.output || '').slice(0, 500) });
      done.push({ product, ok: !!r.ok });
    } catch (err) { logger.error('automatic demo reset errored', { err, product }); }
  }
  return done;
}
