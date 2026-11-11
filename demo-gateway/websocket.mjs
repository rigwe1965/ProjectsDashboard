// WebSocket proxying (Streamlit and similar). The grant is checked when the socket opens and then every `wsRecheckMs`, so revoking a link
// also cuts off sockets that are already open. Only WebSocket upgrades are proxied; any other Upgrade would be an unfiltered byte pipe.
import net from 'node:net';
import { isActive } from './grants.mjs';
import { clientIp } from '../lib/http-util.mjs';
import { EVENTS } from '../lib/events.mjs';
import { logger } from '../lib/log.mjs';
import { deniedRecord } from './pages.mjs';
import { SPOOFABLE, cookiesForUpstream, forwardedFor, upstreamPort, upgradeResponseHead, requestPath } from './proxy-headers.mjs';

// ctx: o (options), trusted (proxy addresses), resolveRequest, grantFor, tooManyMisses, auditDenied, uaOf, instances, audit, metrics, and
// `ws`, the gateway's record of open sockets: { counts (grant id -> open sockets), closers (a set of functions that close each socket),
// release(grant id) (give back one slot) }. Returns the handler for the server's 'upgrade' event.
export function createUpgradeHandler({ o, trusted, resolveRequest, grantFor, tooManyMisses, auditDenied, uaOf, instances, ws, audit, metrics }) {
  const { counts: wsCounts, closers: wsClosers, release: releaseWs } = ws;
  const rejectUpgrade = (socket, code, text) => { socket.end(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); };

  async function upgrade(req, socket, head) {
    socket.on('error', () => {});
    const { hostHdr, slug, target } = resolveRequest(req);
    if (!target) return rejectUpgrade(socket, 404, 'Not Found');
    const path = requestPath(req.url);
    if (path === null) return rejectUpgrade(socket, 400, 'Bad Request');
    // Only WebSocket is proxied. Any other Upgrade (h2c, ...) would become an unfiltered raw byte pipe to the demo app.
    if (String(req.headers.upgrade || '').toLowerCase() !== 'websocket') return rejectUpgrade(socket, 400, 'Bad Request');
    const ip = clientIp(req, trusted);
    const g = await grantFor(req);
    if (!g) return tooManyMisses(ip) ? rejectUpgrade(socket, 429, 'Too Many Requests') : rejectUpgrade(socket, 401, 'Unauthorized');
    if (!isActive(g) || g.app !== slug) { await auditDenied(g.id + ':' + ip, deniedRecord(g.id, slug, ip, uaOf(req), { via: 'websocket' })); return rejectUpgrade(socket, 403, 'Forbidden'); }
    // The upstream is told a different Origin below, so its own cross-site check cannot work: do the check here. A browser
    // always sends the page's own origin; a page on another (even sibling) host must not ride this session.
    if (req.headers.origin) {
      let sameHost = false;
      try { sameHost = new URL(req.headers.origin).host.toLowerCase() === hostHdr; } catch { /* malformed Origin */ }
      if (!sameHost) { await auditDenied(g.id + ':' + ip, deniedRecord(g.id, slug, ip, uaOf(req), { why: 'bad-origin', via: 'websocket' })); return rejectUpgrade(socket, 403, 'Forbidden'); }
    }
    if ((wsCounts.get(g.id) || 0) >= o.maxWsPerGrant) return rejectUpgrade(socket, 429, 'Too Many Requests');
    wsCounts.set(g.id, (wsCounts.get(g.id) || 0) + 1);

    let slot = null;
    if (target.perLink) {
      // The socket was counted above; a refusal here never reaches close(), so it must give the count back itself.
      let inst; try { inst = await instances.lookup(slug, g.id); } catch (err) { releaseWs(g.id); throw err; }
      if (inst?.state !== 'ready') { releaseWs(g.id); return rejectUpgrade(socket, 503, 'Service Unavailable'); }
      slot = inst.slot; instances.touch(slug, slot);
    }
    const { host: upHost, port } = upstreamPort(target, path, slot);
    const upstream = net.connect({ host: upHost, port });
    let connected = false, closed = false;
    const close = (why) => {
      if (closed) return; closed = true;
      clearInterval(timer); wsClosers.delete(close);
      releaseWs(g.id);
      socket.destroy(); upstream.destroy();
      if (why) audit({ ev: EVENTS.wsClosed, grant: g.id, app: slug, ip, why });
    };
    wsClosers.add(close);
    // Revocation and expiry apply to sockets that are already open: look the grant up again every few seconds.
    // If the database cannot be asked, the grant cannot be confirmed: after three failed checks in a row, fail closed.
    let fails = 0;
    const timer = setInterval(async () => {
      try {
        const cur = await grantFor(req); fails = 0;
        if (slot !== null) instances.touch(slug, slot); // an open socket counts as use
        if (!isActive(cur) || cur.app !== slug) close('grant-ended');
      } catch (err) {
        logger.warn('ws grant re-check failed', { grant: g.id, fails: fails + 1, err });
        if (++fails >= 3) close('recheck-failed');
      }
    }, o.wsRecheckMs);
    timer.unref?.();

    upstream.setTimeout(10000, () => { if (!connected) { rejectUpgrade(socket, 504, 'Gateway Timeout'); close('connect-timeout'); } });
    upstream.on('error', () => { if (!connected) rejectUpgrade(socket, 503, 'Service Unavailable'); close(connected ? 'upstream-error' : 'upstream-unreachable'); });
    upstream.on('close', () => close());
    socket.on('close', () => close());
    upstream.on('connect', () => {
      connected = true; upstream.setTimeout(0); socket.setTimeout(0); socket.setNoDelay(true); upstream.setNoDelay(true);
      // Re-send the upgrade request as received, minus the gateway cookie, with Host/Origin pointed at the upstream
      // (Streamlit and similar servers refuse a WebSocket whose Origin does not match its Host).
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const k = req.rawHeaders[i], lk = k.toLowerCase();
        if (lk === 'host' || lk === 'cookie' || lk === 'origin' || lk.startsWith('x-forwarded-') || SPOOFABLE.has(lk)) continue;
        lines.push(`${k}: ${req.rawHeaders[i + 1]}`);
      }
      lines.push(`Host: ${upHost}:${port}`);
      const rest = cookiesForUpstream(req);
      if (rest) lines.push(`Cookie: ${rest}`);
      if (req.headers.origin) lines.push(`Origin: http://${upHost}:${port}`);
      lines.push(`X-Forwarded-Host: ${hostHdr}`, `X-Forwarded-Proto: ${o.scheme}`, `X-Forwarded-For: ${forwardedFor(req, trusted)}`);
      upstream.write(lines.join('\r\n') + '\r\n\r\n');
      if (head?.length) upstream.write(head);
      // The sockets are joined only if the app really switches protocols. Anything else (a 200 that keeps the connection open, say) would
      // leave the customer a raw line to the app that skips every check above, so it is answered with 502 and both sockets are closed.
      const fail = (why) => { rejectUpgrade(socket, 502, 'Bad Gateway'); close(why); };
      const headTimer = setTimeout(() => fail('upgrade-timeout'), 10000);
      let buf = Buffer.alloc(0);
      const onData = (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        const end = buf.indexOf('\r\n\r\n');
        if (end < 0) { if (buf.length > 16384) { clearTimeout(headTimer); upstream.off('data', onData); fail('upgrade-refused'); } return; }
        clearTimeout(headTimer); upstream.off('data', onData); upstream.pause();
        const headText = buf.subarray(0, end).toString('latin1');
        if (!/^HTTP\/1\.1 101[ \r]/.test(headText + ' ')) return fail('upgrade-refused');
        if (closed) return;
        socket.write(upgradeResponseHead(headText) + '\r\n\r\n', 'latin1');
        if (buf.length > end + 4) socket.write(buf.subarray(end + 4));
        socket.pipe(upstream); upstream.pipe(socket); upstream.resume();
        metrics.inc('pd_gateway_websockets_total');
        audit({ ev: EVENTS.wsOpen, grant: g.id, app: slug, ip });
      };
      upstream.on('data', onData);
    });
  }
  return upgrade;
}
