// Starts the demo gateway (see gateway.mjs for how it works). Settings come from environment variables,
// listed in demo-gateway/README.md.
import { createGateway } from './gateway.mjs';
import { demoApps } from './grants.mjs';
import { ports } from '../lib/config.mjs';
import { closeStore } from '../lib/store/index.mjs';
import { logger, installProcessHandlers } from '../lib/log.mjs';

const gw = await createGateway({ port: ports.gateway });
const RETENTION_DAYS = Number(process.env.AUDIT_RETENTION_DAYS || 90);
// Housekeeping must never keep the gateway from starting.
// Retention is applied at start-up and then once a day, so a long-running gateway does not keep personal data past the limit.
const keepDays = Number.isFinite(RETENTION_DAYS) ? RETENTION_DAYS : 90;
async function pruneAudit() {
  try {
    const pruned = await gw.store.audit.prune(keepDays);
    if (pruned) logger.info('pruned old audit events', { count: pruned, olderThanDays: keepDays });
  } catch (err) { logger.warn('audit prune failed; continuing', { err }); }
}
await pruneAudit();
setInterval(pruneAudit, 24 * 3600e3).unref();
// Shared demos go back to their seeded state once every link opened for them has ended (DEMO_AUTO_RESET=0 turns this off).
if (process.env.DEMO_AUTO_RESET !== '0') {
  const everyMs = Math.max(10000, Number(process.env.DEMO_RESET_CHECK_SECONDS || 60) * 1000);
  let sweeping = false;
  setInterval(() => { if (sweeping) return; sweeping = true; gw.resetSweep().catch((err) => logger.error('reset sweep failed', { err })).finally(() => { sweeping = false; }); }, everyMs).unref();
}
// Private demo copies (one per link): clean up after a restart, then every 30 seconds stop the copies whose link has ended or that sit unused.
gw.instanceReconcile().catch((err) => logger.error('instance clean-up at start-up failed', { err }));
{
  let sweeping = false;
  setInterval(() => { if (sweeping) return; sweeping = true; gw.instanceSweep().catch((err) => logger.error('instance sweep failed', { err })).finally(() => { sweeping = false; }); }, 30000).unref();
}
const port = await gw.listen(process.env.GATEWAY_BIND || '127.0.0.1').catch((err) => {
  logger.error(err.code === 'EADDRINUSE' ? 'gateway port is already in use' : 'gateway could not start listening', { err });
  process.exit(1);
});
logger.info('demo gateway listening', { port, publicHost: gw.baseHost, scheme: process.env.DEMO_SCHEME || 'http', products: Object.keys(demoApps()) });

// Graceful shutdown: stop taking connections, close open WebSockets, close the database, then exit.
// A hard timeout makes sure a stuck connection cannot keep the container from stopping.
let stopping = false;
async function shutdown(sig) {
  if (stopping) return; stopping = true;
  logger.info('shutting down', { signal: sig });
  const force = setTimeout(() => { logger.warn('forced exit after timeout'); process.exit(1); }, 10000); force.unref();
  try { await gw.close(); await closeStore(); } catch (e) { logger.error('error during shutdown', { err: e }); }
  process.exit(0);
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => shutdown(sig));
installProcessHandlers((why) => { process.exitCode = 1; shutdown(why); });
