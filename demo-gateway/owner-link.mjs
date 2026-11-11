// The owner's own demo link, for start-customer-demo.bat (audit F-08).
//   node demo-gateway/owner-link.mjs <product>           revokes the owner's earlier link(s) for the product, creates a fresh 8-hour one,
//                                                        and prints it as the last line, indented (the .bat picks that line up)
//   node demo-gateway/owner-link.mjs --shared <product>  exit 0 if the product runs one shared demo instance the launcher must start,
//                                                        1 if it gives every link a private copy (nothing shared to start), 2 if unknown
// Why revoke: for a product with private copies each open link holds a seat for up to its idle time, so a pile of old owner links would
// leave no seat for a customer. Revoking the old one frees its seat within about 30 seconds.
import { loadGrants, createGrant, revokeGrant, isActive, demoApps } from './grants.mjs';
import { closeStore } from '../lib/store/index.mjs';
import { pathToFileURL } from 'node:url';

export const OWNER = 'Local owner';

export async function ownerLink(app, { hours = 8 } = {}) {
  const revoked = [];
  for (const g of await loadGrants()) {
    if (g.app === app && g.customer === OWNER && isActive(g)) { await revokeGrant(g.id, { by: 'launcher' }); revoked.push(g.id); }
  }
  const { grant, link } = await createGrant({ customer: OWNER, app, hours }, { by: 'launcher' });
  return { grant, link, revoked };
}

export const needsSharedInstance = (app) => { const a = demoApps()[app]; return a ? !a.perLink : null; };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { // only when run as a command, so tests can import it
  const [a, b] = process.argv.slice(2);
  try {
    if (a === '--shared') { const s = needsSharedInstance(b); process.exitCode = s === null ? 2 : s ? 0 : 1; }
    else {
      const { link, revoked } = await ownerLink(a);
      if (revoked.length) console.log('Replaced ' + revoked.length + ' earlier owner link(s) for ' + a + '.');
      console.log('  ' + link);
    }
  } catch (e) { console.error(e.message); process.exitCode = 1; }
  await closeStore();
}
