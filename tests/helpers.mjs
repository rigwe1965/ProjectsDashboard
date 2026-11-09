// Helpers shared by the unit tests (audit D-12). Not named *.test.mjs, so `npm test` does not run it as a test.
import http from 'node:http';

// One HTTP request to 127.0.0.1:port with the whole body buffered. `host` is the full Host header (default 127.0.0.1:port), so a
// test can reach a gateway by product name. Resolves { status, headers, body }; rejects on a connection error.
export function httpRequest({ port, path = '/', method = 'GET', headers = {}, body, host }) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path, method, headers: { host: host ?? `127.0.0.1:${port}`, ...headers } }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

// A TCP port that was free a moment ago on 127.0.0.1.
export const freePort = () => new Promise((resolve) => {
  const s = http.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

// A registry process entry that is never started (the tests that use it only read the registry).
export const testProc = (name, port) => ({ name, cmd: 'x', port });
