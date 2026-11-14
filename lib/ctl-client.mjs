// Client for deploy/ctl/pd-ctl.py: the restricted container controller that runs on the host. The hosted console has no Docker access
// of its own; it asks this helper (over a unix socket, with a bearer token) to start, stop or restart a registered demo container or
// to read its log. Returns the same { ok, output } shape the supervisor does.
import http from 'node:http';

export function createCtlClient({ socketPath, token, timeoutMs = 90000 }) {
  if (!socketPath || !token) throw new Error('ctl client needs a socket path and a token');
  return function ctl(verb, container, extra = {}) {
    return new Promise((resolve) => {
      const body = JSON.stringify({ container, ...extra });
      const req = http.request({
        socketPath, path: `/v1/${verb}`, method: 'POST', timeout: timeoutMs,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try { const j = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve({ ok: !!j.ok, output: j.output ?? j.error ?? '' }); }
          catch { resolve({ ok: false, output: 'unreadable answer from the controller' }); }
        });
      });
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, timedOut: true, output: 'the controller did not answer in time' }); });
      req.on('error', () => resolve({ ok: false, output: 'the controller is not reachable' }));
      req.end(body);
    });
  };
}
