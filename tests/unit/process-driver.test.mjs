import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNetstatListener, parseSsListener, parseLsofPids, parseProcStatStart, getDriver, windowsDriver, posixDriver } from '../../lib/process-driver.mjs';
import { cleanEnv } from '../../lib/clean-env.mjs';
import { validate } from '../../lib/registry.mjs';
import { validContainerName } from '../../lib/docker.mjs';

const NETSTAT = `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1104
  TCP    0.0.0.0:5200           0.0.0.0:0              LISTENING       12345
  TCP    127.0.0.1:15200        0.0.0.0:0              LISTENING       999
  TCP    127.0.0.1:5200         127.0.0.1:50122        ESTABLISHED     12345
`;
test('netstat: finds the listener for an exact port only', () => {
  assert.equal(parseNetstatListener(NETSTAT, 5200), 12345);
  assert.equal(parseNetstatListener(NETSTAT, 200), null, 'a port that is only a suffix of another must not match');
  assert.equal(parseNetstatListener(NETSTAT, 9999), null);
  assert.equal(parseNetstatListener('', 5200), null);
});

const SS = `LISTEN 0      4096       127.0.0.11:41927      0.0.0.0:*
LISTEN 0      511          0.0.0.0:8080       0.0.0.0:*    users:(("node",pid=123,fd=19))
LISTEN 0      511             [::]:18080         [::]:*    users:(("python3",pid=456,fd=7))
LISTEN 0      128             [::]:3000          [::]:*    users:(("next-server (v1",pid=789,fd=21),("sh",pid=700,fd=3))
`;
test('ss: finds the listener PID, IPv4 and IPv6, exact port only', () => {
  assert.equal(parseSsListener(SS, 8080), 123);
  assert.equal(parseSsListener(SS, 18080), 456);
  assert.equal(parseSsListener(SS, 3000), 789, 'first pid when several are listed');
  assert.equal(parseSsListener(SS, 80), null, '80 is a suffix of 8080 and must not match');
  assert.equal(parseSsListener(SS, 41927), null, 'a listener with no visible pid');
  assert.equal(parseSsListener('', 8080), null);
});

test('lsof: first bare PID', () => {
  assert.equal(parseLsofPids('4321\n4322\n'), 4321);
  assert.equal(parseLsofPids(''), null);
  assert.equal(parseLsofPids('lsof: no such thing\n'), null);
});

test('/proc stat: start time is field 22, even when the command name contains spaces and parentheses', () => {
  const fields = ['S', '1', '123', '123', '0', '-1', '4194560', '100', '0', '0', '0', '5', '6', '0', '0', '20', '0', '1', '0', '987654', '1000', '2000'];
  // fields[0] is field 3, so field 22 is fields[19]
  assert.equal(parseProcStatStart(`123 (my (weird) cmd) ${fields.join(' ')}\n`), '987654');
  assert.equal(parseProcStatStart(`7 (node) ${fields.join(' ')}\n`), '987654');
});

test('driver selection', () => {
  assert.equal(getDriver('windows'), windowsDriver);
  assert.equal(getDriver('posix'), posixDriver);
  assert.throws(() => getDriver('amiga'), /Unknown PD_DRIVER/);
  for (const d of [windowsDriver, posixDriver]) for (const fn of ['spawnApp', 'startTime', 'listenerPid', 'killTree']) assert.equal(typeof d[fn], 'function', `${d.name}.${fn}`);
});

test('cleanEnv handles POSIX PATHs and venv/bin as well as Windows ones', () => {
  const posix = cleanEnv({ PATH: '/usr/bin:/home/u/proj/.venv/bin:/opt/venv/bin/:/usr/local/bin', VIRTUAL_ENV: '/x' }, ':');
  assert.equal(posix.PATH, '/usr/bin:/usr/local/bin');
  assert.equal(posix.VIRTUAL_ENV, undefined);
  const win = cleanEnv({ Path: 'C:\\bin;C:\\p\\venv\\Scripts;C:\\tools' }, ';');
  assert.equal(win.Path, 'C:\\bin;C:\\tools');
});

test('registry: a process needs a cmd or a container name, not both, and a valid name', () => {
  const app = (p) => ({ apps: [{ id: 'a', name: 'A', path: '.', processes: [{ name: 'app', port: 5000, ...p }] }] });
  assert.deepEqual(validate(app({ cmd: 'x' })), []);
  assert.deepEqual(validate(app({ container: 'pd-imageapp' })), []);
  assert.match(validate(app({})).join(), /needs a cmd/);
  assert.match(validate(app({ cmd: 'x', container: 'c' })).join(), /either cmd or container/);
  assert.match(validate(app({ container: 'bad name; rm -rf /' })).join(), /invalid container name/);
});

test('container names are restricted to safe characters', () => {
  for (const ok of ['pd-imageapp', 'a', 'my_app.1']) assert.equal(validContainerName(ok), true, ok);
  for (const bad of ['', '-x', 'a b', 'a;b', '$(id)', 'a'.repeat(200), null, 5]) assert.equal(validContainerName(bad), false, String(bad));
});

test('registry: the same port is fine on different hosts, still refused on the same host', () => {
  const reg = (a, b) => ({ apps: [{ id: 'a', name: 'A', path: '.', processes: [{ name: 'x', container: 'c1', port: 5400, ...a }, { name: 'y', container: 'c2', port: 5400, ...b }] }] });
  assert.deepEqual(validate(reg({ host: 'one' }, { host: 'two' })), []);
  assert.match(validate(reg({ host: 'one' }, { host: 'one' })).join(), /port 5400 is used by another process on one/);
  assert.match(validate(reg({}, {})).join(), /port 5400 is used by another process/);
  assert.match(validate(reg({ host: 'one' }, { host: 'bad host!' })).join(), /invalid host/);
  assert.match(validate({ reservedPorts: [5400], apps: reg({}, { host: 'two' }).apps }).join(), /reserved/, 'reserved ports apply to this machine only');
});
