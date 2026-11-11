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

// The owner's own settings that a test process must never inherit (audit F-01): they point at the real backup folder, alert
// webhook and data key, so a spawned console would write an empty backup there, send real alerts, and skip its own "key not set" paths.
const OWNER_ENV = ['DASHBOARD_BACKUP_DIR', 'ALERT_WEBHOOK_URL', 'ADMIN_DATA_KEY', 'DASHBOARD_DB', 'DATABASE_URL', 'TEST_DATABASE_URL', 'ADMIN_REQUIRE_TOTP', 'ADMIN_BIND'];
// process.env without those variables, plus `extra`. Use it as the `env` of every spawned test process.
export function testEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of OWNER_ENV) delete env[k];
  return { ...env, ...extra };
}
