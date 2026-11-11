// Old records are removed once a day (and at start-up): customer audit events after `keepDays`, the owner's own sign-in events after `keepAdminDays`,
// and the per-link activity rollup and AI guide usage counts after `keepDays` too, so what a customer did is never kept longer than their audit trail. Each part is tried on
// its own and a failure is logged, never thrown: housekeeping must not stop the gateway from starting or running.
import { logger } from '../lib/log.mjs';

export async function pruneOld(store, keepDays, keepAdminDays) {
  const out = { audit: 0, activity: 0, guide: 0 };
  try {
    out.audit = await store.audit.prune(keepDays, keepAdminDays);
    if (out.audit) logger.info('pruned old audit events', { count: out.audit, olderThanDays: keepDays });
  } catch (err) { logger.warn('audit prune failed; continuing', { err }); }
  try {
    out.activity = await store.activity.prune(keepDays);
    if (out.activity) logger.info('pruned old link activity', { count: out.activity, olderThanDays: keepDays });
  } catch (err) { logger.warn('activity prune failed; continuing', { err }); }
  try {
    out.guide = await store.guideUsage.prune(keepDays); // AI guide counts follow the same limit
    if (out.guide) logger.info('pruned old guide usage', { count: out.guide, olderThanDays: keepDays });
  } catch (err) { logger.warn('guide usage prune failed; continuing', { err }); }
  return out;
}
