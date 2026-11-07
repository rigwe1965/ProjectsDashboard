// Starts the demo gateway (see gateway.mjs for how it works). Settings come from environment variables,
// listed in demo-gateway/README.md.
import { createGateway } from './gateway.mjs';
import { demoApps } from './grants.mjs';
import { ports } from '../lib/config.mjs';
import { closeStore } from '../lib/store/index.mjs';
import { logger } from '../lib/log.mjs';

const gw = await createGateway({ port: ports.gateway });
const RETENTION_DAYS = Number(process.env.AUDIT_RETENTION_DAYS || 90);
const pruned = await gw.store.audit.prune(RETENTION_DAYS);
if (pruned) logger.info('pruned old audit events', { count: pruned, olderThanDays: RETENTION_DAYS });
const port = await gw.listen(process.env.GATEWAY_BIND || '127.0.0.1');
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
