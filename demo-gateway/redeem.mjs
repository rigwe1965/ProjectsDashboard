// Opening a demo link: /d/<token>. A GET only shows the notice and a button (mail scanners and chat previews fetch links by themselves);
// the click is a POST, and only that counts a use, checks the link's limits, starts a private copy if the product has them, and sets the cookies.
import { randomBytes } from 'node:crypto';
import { isActive } from './grants.mjs';
import { holdReason } from './reset.mjs';
import { cookieOf as readCookie, limitKey } from '../lib/http-util.mjs';
import { MINUTE } from '../lib/util.mjs';
import { EVENTS } from '../lib/events.mjs';
import { sha256, newSessionId, hashSessionId } from '../lib/auth.mjs';
import { PRIVATE_NOTICE, SHARED_NOTICE, deniedRecord } from './pages.mjs';

const DEV_RE = /^[a-f0-9]{32}$/;

// Everything it needs comes in as arguments: the options (`o`), the store, the private-copy manager, the grant lookup, the rate limiter,
// the audit and metrics sinks and the request's browser string, plus two groups: `pages` ({ page, tooMany }, the gateway's page writers)
// and `cookies` ({ COOKIE, DEV_COOKIE, https }: the two cookie names and whether they are Secure). Returns the handler for one /d/<token> request.
export function createRedeemHandler({ o, store, instances, findGrant, limited, audit, metrics, uaOf, pages, cookies }) {
  const { page, tooMany, landing } = pages;
  const { COOKIE, DEV_COOKIE, https } = cookies;
  // `m` is the match of the path pattern (m[1] is the token); `ip` the client address.
  return async function redeem(req, res, { m, slug, target, ip }) {
      const ua = uaOf(req);
      if (await limited(ip) || (await store.rateLimit.hit('redeem-link:' + m[1].slice(0, 12), MINUTE, 30)) > 30) { metrics.inc('pd_gateway_redeem_total', { result: 'limited' }); return tooMany(res, 60); }
      const g = await findGrant(m[1]);
      if (!isActive(g) || g.app !== slug) {
        audit(deniedRecord(null, slug, ip, ua, { why: !g ? 'unknown' : g.revoked ? 'revoked' : g.app !== slug ? 'wrong-app' : 'expired' }));
        metrics.inc('pd_gateway_redeem_total', { result: 'denied' });
        // repeated bad links from one address (guessing, or a stale bookmark in a loop): stop answering for a while
        if ((await store.rateLimit.hit('redeem-fail:' + limitKey(ip), 10 * MINUTE, o.redeemFailLimit)) > o.redeemFailLimit) return tooMany(res, 600);
        return page(res, 403, 'Link not valid', 'This demo link has expired or is no longer active. Please contact us for a new one.');
      }
      const held = await holdReason(store, slug); // a reset is running, or the last one failed and the demo may still hold earlier data
      if (held) return page(res, 503, 'Demo is being prepared', 'This demo is being reset to a fresh state. Please try this link again in a few minutes.', { 'retry-after': held === 'failed' ? '300' : '60' });
      if (req.method !== 'GET' && req.method !== 'POST') { res.writeHead(405, { allow: 'GET, POST', 'cache-control': 'no-store' }); return res.end(); }
      // A GET never opens the demo or spends a use: mail scanners and chat link-previews fetch links automatically. The
      // customer sees the shared-demo notice and a button; their click is a POST, and only that counts.
      if (req.method === 'GET') {
        if (g.maxUses != null && g.uses >= g.maxUses) return page(res, 403, 'Link not available', 'This link has already been used the maximum number of times. Please contact us for a new one.');
        return landing(res, { productName: target.name, g, notice: target.perLink ? PRIVATE_NOTICE : SHARED_NOTICE, brand: o.brandName, bookingUrl: o.bookingUrl });
      }
      req.resume(); // a POST body (the empty form) is not needed
      // a private copy needs a free seat: say so BEFORE the link's use is counted
      if (target.perLink && !(await instances.hasRoom(slug, target, g.id))) return page(res, 503, 'All demo seats are taken', 'Every private demo seat is in use right now. Please try this link again in a few minutes.', { 'retry-after': '120' });
      // counts this use and enforces the link's limits (maximum opens, pinned browser) in one atomic step
      let devId = readCookie(req, DEV_COOKIE);
      const hadDev = DEV_RE.test(devId);
      if (!hadDev) devId = randomBytes(16).toString('hex');
      const use = await store.grants.redeem(g.id, sha256(devId));
      if (!use.ok) {
        metrics.inc('pd_gateway_redeem_total', { result: 'denied' });
        audit(deniedRecord(g.id, slug, ip, ua, { why: use.why }));
        return page(res, 403, 'Link not available', use.why === 'device-locked'
          ? 'This link is tied to the browser it was first opened in. Please contact us if you need a new one.'
          : 'This link has already been used the maximum number of times. Please contact us for a new one.');
      }
      metrics.inc('pd_gateway_redeem_total', { result: 'ok' });
      audit({ ev: EVENTS.enter, grant: g.id, app: slug, ip, ua });
      const maxAge = Math.max(1, Math.floor((Date.parse(g.expiresAt) - Date.now()) / 1000));
      const sid = newSessionId(); // only its hash is stored
      await store.grantSessions.create(hashSessionId(sid), g.id, g.expiresAt);
      if (target.perLink) await instances.ensure(slug, target, g.id); // allocates the seat and starts the copy in the background
      const flags = `; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${https ? '; Secure' : ''}`;
      res.writeHead(302, { 'set-cookie': [`${COOKIE}=${sid}${flags}`, ...(g.deviceLock && !hadDev ? [`${DEV_COOKIE}=${devId}${flags}`] : [])], location: '/', 'cache-control': 'no-store' });
      return res.end();
  };
}
