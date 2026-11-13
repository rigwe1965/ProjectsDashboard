// The hosted compose file keeps customer demos away from the gateway and the console (found with a real probe on 2026-11-12:
// a demo container could open a connection to both). Each of the two listens only on a fixed address of the edge network, which the
// demo networks do not have; their health checks must use that same address or the container is reported unhealthy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const compose = readFileSync(new URL('../../deploy/docker-compose.yml', import.meta.url), 'utf8');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, (c) => '\\' + c);
// The text of one service: from its "  name:" line to the next service or the next top-level key.
const service = (name) => {
  const start = new RegExp(String.raw`^  ${escapeRe(name)}:\r?$`, 'm').exec(compose);
  assert.ok(start, `service ${name} not found`);
  const rest = compose.slice(start.index + start[0].length);
  const end = /^( {2}[a-z][a-z0-9-]*:\r?$|[a-z]+:)/m.exec(rest);
  return end ? rest.slice(0, end.index) : rest;
};

for (const [name, bindVar, port] of [['gateway', 'GATEWAY_BIND', 4300], ['console', 'ADMIN_BIND', 4100]]) {
  test(`${name} listens only on its own edge address, never on every interface, and its health check uses it`, () => {
    const body = service(name);
    const bind = body.match(new RegExp(String.raw`${bindVar}:\s*(\S+)`))?.[1];
    assert.ok(bind && bind !== '0.0.0.0', `${bindVar} must be a fixed address, not ${bind}`);
    assert.match(body, new RegExp(String.raw`edge:\s*\{\s*ipv4_address:\s*${escapeRe(bind)}\s*\}`), `${name} must have ${bind} on the edge network`);
    assert.ok(body.includes(`http://${bind}:${port}/_pd/healthz`), `the health check must call ${bind}, not 127.0.0.1`);
  });
}

test('the gateway and the console get different edge addresses, outside the automatic range', () => {
  const addrs = [...compose.matchAll(/edge:\s*\{\s*ipv4_address:\s*(172\.30\.0\.\d+)\s*\}/g)].map((m) => m[1]);
  assert.ok(addrs.length >= 3, 'expected Caddy, the console and the gateway to have fixed addresses');
  assert.equal(new Set(addrs).size, addrs.length, 'two services share an edge address');
  for (const a of addrs) assert.ok(Number(a.split('.')[3]) < 128, `${a} is in the automatic address range (172.30.0.128/25)`);
});

test('the console health check names a host the console serves (it answers 403 to any other)', () => {
  const body = service('console');
  const hosts = body.match(/ADMIN_ALLOWED_HOSTS:\s*(.*)/)[1];
  const sent = body.match(/"-H", "Host: ([^"]+)"/)?.[1];
  assert.ok(sent && hosts.split(/[,\s]/).includes(sent), `health check Host "${sent}" is not in ADMIN_ALLOWED_HOSTS (${hosts})`);
});
