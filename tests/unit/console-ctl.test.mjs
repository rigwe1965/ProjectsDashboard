// Console + host controller: with a controller configured, Start/Stop/Restart/Log work on container demos; without one, nothing changes.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { httpRequest } from '../helpers.mjs';

const dir = mkdtempSync(join(tmpdir(), 'pd-ctlcon-'));
writeFileSync(join(dir, 'registry.json'), JSON.stringify({ apps: [
  { id: 'box', name: 'Box', path: '.', processes: [{ name: 'app', container: 'pd-box', host: 'box', port: 19101, health: '/' }] },
] }));
process.env.DASHBOARD_DATA = dir;
process.env.DASHBOARD_REGISTRY = join(dir, 'registry.json');
const { createConsole } = await import('../../admin-console/console.mjs');
const { closeStore } = await import('../../lib/store/index.mjs');

const started = [];
after(async () => { for (const c of started) await c.close(); await closeStore(); rmSync(dir, { recursive: true, force: true }); });
const FAKE = 'abcdef12'.repeat(4); // built at run time: a literal would trip the secret scanner
const calls = [];
const ctl = async (verb, container, extra) => { calls.push([verb, container, extra]); return verb === 'logs' ? { ok: true, output: 'line one\nTOKEN=' + FAKE } : { ok: true, output: '' }; };
const supervisor = async () => ({ ok: true, output: JSON.stringify([{ app: 'box', proc: 'app', up: true, managed: false, url: null }]) });

async function boot(opts) {
  const c = await createConsole({ port: 0, supervisor, ...opts }); const port = await c.listen(); started.push(c);
  const cookie = (await httpRequest({ port, path: '/?t=' + c.launchToken })).headers['set-cookie'][0].split(';')[0];
  const post = (path) => httpRequest({ port, method: 'POST', path, headers: { cookie, origin: `http://127.0.0.1:${port}` } });
  const get = (path) => httpRequest({ port, path, headers: { cookie } });
  return { port, post, get };
}

test('with a controller: apps are controllable, actions go to the container, log comes from the controller', async () => {
  calls.length = 0;
  const { post, get } = await boot({ ctl, appControl: true });
  const apps = JSON.parse((await get('/api/apps')).body);
  assert.equal(apps[0].controls, true);
  assert.equal(apps[0].processes[0].managed, true, 'a running container can be stopped/restarted');
  const r = await post('/api/apps/box/restart');
  assert.equal(r.status, 200);
  assert.deepEqual(calls.at(-1).slice(0, 2), ['restart', 'pd-box']);
  assert.equal((await post('/api/apps/box/stop')).status, 200);
  const log = JSON.parse((await get('/api/apps/box/logs?proc=app')).body).log;
  assert.match(log, /line one/);
  assert.doesNotMatch(log, new RegExp(FAKE), 'secrets in the log are masked');
});

test('a failing controller call is reported as a failure, not success', async () => {
  const { post } = await boot({ ctl: async () => ({ ok: false, output: 'boom' }), appControl: true });
  const r = await post('/api/apps/box/restart');
  assert.equal(r.status, 502);
  assert.equal(JSON.parse(r.body).ok, false);
});

test('without a controller and with control off, actions are still refused', async () => {
  const { post } = await boot({ ctl: null, appControl: false });
  assert.equal((await post('/api/apps/box/restart')).status, 403);
});
