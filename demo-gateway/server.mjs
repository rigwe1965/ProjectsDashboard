// Starts the demo gateway (see gateway.mjs for how it works). Settings come from environment variables,
// listed in demo-gateway/README.md.
import { createGateway } from './gateway.mjs';
import { demoApps } from './grants.mjs';
import { ports } from '../lib/config.mjs';

const gw = await createGateway({ port: ports.gateway });
const RETENTION_DAYS = Number(process.env.AUDIT_RETENTION_DAYS || 90);
const pruned = await gw.store.audit.prune(RETENTION_DAYS);
if (pruned) console.log(`Pruned ${pruned} audit events older than ${RETENTION_DAYS} days`);
const port = await gw.listen();
console.log(`Demo gateway on ${process.env.DEMO_SCHEME || 'http'}://*.${gw.baseHost} (listening 127.0.0.1:${port}). Products: ${Object.keys(demoApps()).join(', ') || 'none ready'}`);

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await gw.close(); process.exit(0); });
