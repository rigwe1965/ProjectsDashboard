// Command line for demo links (npm run demo ...):
//   node demo-gateway/grants-cli.mjs create --customer "Acme Ltd" --app imageapp [--hours 48] [--max-uses 3] [--device-lock]
//   node demo-gateway/grants-cli.mjs list
//   node demo-gateway/grants-cli.mjs revoke <grantId>
import { loadGrants, createGrant, revokeGrant, publicGrant } from './grants.mjs';
import { closeStore } from '../lib/store/index.mjs';

  const [cmd, ...args] = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : undefined; };
try {
  if (cmd === 'create') {
    const { grant, link } = await createGrant({ customer: opt('customer'), app: opt('app'), hours: opt('hours') || 48, maxUses: opt('max-uses') ?? null, deviceLock: args.includes('--device-lock') }, { by: 'cli' });
    console.log('Grant ' + grant.id + ' for "' + grant.customer + '" -> ' + grant.app + ', expires ' + grant.expiresAt + '\nSend this link (shown once):\n  ' + link);
  } else if (cmd === 'list') {
    for (const g of (await loadGrants()).map(publicGrant)) console.log(g.id + '  ' + g.app.padEnd(12) + ' ' + g.customer.padEnd(24) + ' ' + g.state.padEnd(8) + ' until ' + g.expiresAt + '  used ' + g.uses + (g.maxUses ? '/' + g.maxUses : '') + (g.deviceLock ? '  device-locked' : ''));
  } else if (cmd === 'revoke') { console.log('Revoked ' + (await revokeGrant(args[0], { by: 'cli' })).id); }
  else console.log('Usage: grants-cli.mjs create --customer "X" --app <id> [--hours N] [--max-uses N] [--device-lock] | list | revoke <id>');
} catch (e) { console.error(e.message); process.exitCode = 1; }
await closeStore();
