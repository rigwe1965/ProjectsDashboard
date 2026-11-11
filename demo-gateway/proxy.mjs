// Sending a customer's request on to the demo app (after the gateway has decided it may go): finding or waiting for the customer's
// private copy when the product has them, then forwarding the request and streaming the answer back.
import http from 'node:http';
import { pipeline } from 'node:stream';
import { logger } from '../lib/log.mjs';
import { HSTS } from './pages.mjs';
import { upstreamPort, requestHeaders, responseHeaders } from './proxy-headers.mjs';

// o: the gateway options (maxBodyBytes, upstreamTimeoutMs, scheme). agent: the keep-alive http.Agent for upstream connections.
// instances: the private-copy manager. page: the gateway's own page writer. https: whether the gateway is served over HTTPS.
export function createProxy({ o, trusted, agent, metrics, instances, page, https }) {
  // For a product with private copies: the customer's copy when it is ready, and null after answering with a page that says why not
  // (all seats taken, could not start, still starting).
  async function readyCopy(res, slug, target, g) {
    let inst = await instances.lookup(slug, g.id);
    if (inst?.state !== 'ready') inst = await instances.ensure(slug, target, g.id).then((r) => ({ ...r, state: r.status }));
    if (inst.state !== 'ready') {
      if (inst.state === 'full') page(res, 503, 'All demo seats are taken', 'Every private demo seat is in use right now. Please try again in a few minutes.', { 'retry-after': '60' });
      else if (inst.state === 'failed') page(res, 503, 'Demo could not start', 'Your private demo did not start. Please wait a moment and refresh this page to try again.', { 'retry-after': '20' });
      // starting: a page that checks again by itself
      else page(res, 503, 'Preparing your demo', 'Your private copy is being set up. This page refreshes by itself and takes up to a minute.', { 'retry-after': '3' }, '<meta http-equiv=refresh content=3>');
      return null;
    }
    instances.touch(slug, inst.slot);
    return inst;
  }

  // Forwards the request to the demo app and streams the answer back. `slot` is the private copy's number (null for shared demos).
  function forward(req, res, { path, slug, slot, g, target, hostHdr, guideFrame = false }) {
    const { host: upHost, port } = upstreamPort(target, path, slot);
    const headers = requestHeaders(req, { upHost, port, hostHdr, scheme: o.scheme, trusted });
    const up = http.request({ host: upHost, port, method: req.method, path: req.url, headers, agent }, (ur) => {
      const out = responseHeaders(ur.headers, { upHost, port, hostHdr, scheme: o.scheme, https, hsts: HSTS, guideFrame });
      res.writeHead(ur.statusCode, out);
      // pipeline() keeps pipe()'s backpressure (a slow browser slows the upstream) and also ends the browser's response
      // when the upstream dies mid-body, instead of leaving it hanging
      pipeline(ur, res, (err) => { if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') logger.debug('proxy stream ended early', { err }); });
    });
    // An upstream that accepts the connection but never answers must not hold the customer's request open forever.
    up.setTimeout(o.upstreamTimeoutMs, () => up.destroy(Object.assign(new Error('upstream timeout'), { code: 'ETIMEOUT' })));
    up.on('error', (e) => {
      if (res.headersSent) return res.destroy();
      metrics.inc('pd_gateway_upstream_errors_total', { kind: e.code === 'ETIMEOUT' ? 'timeout' : 'unreachable' });
      // Only a refused connection means the copy's process is gone. A browser that cancels a request also ends here (a reset or
      // hang-up), and treating that as a crash would restart the copy and throw away the customer's data.
      if (slot !== null && e.code === 'ECONNREFUSED') instances.markDown(slug, slot, g.id).catch(() => {});
      if (e.code === 'ETIMEOUT') page(res, 504, 'Demo is taking too long', 'The demo did not answer in time. Please try again.');
      else page(res, 503, 'Demo unavailable', 'The demo is not running right now. Please try again shortly.');
    });
    // If the browser goes away mid-request, stop working for it.
    res.on('close', () => { if (!res.writableFinished) up.destroy(); });
    req.on('error', () => up.destroy()); // the browser dropped mid-upload
    let seen = 0;
    req.on('data', (c) => {
      seen += c.length;
      if (seen > o.maxBodyBytes) { // no content-length, or it lied
        req.unpipe(up); up.destroy();
        if (!res.headersSent) page(res, 413, 'Upload too large', 'That file is bigger than this demo allows.');
        res.once('finish', () => req.destroy());
      }
    });
    req.pipe(up);
  }

  return { readyCopy, forward };
}
