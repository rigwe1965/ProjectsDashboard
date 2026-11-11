// Starting a private copy first stops what is left of an earlier start, and never wipes a folder something still holds (audit F-11).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'pd-irs-'));
process.env.DASHBOARD_DATA = dir; // before the supervisor and the instance helpers are imported
const { createSupervisor } = await import('../../supervisor/core.mjs');
after(() => rmSync(dir, { recursive: true, force: true }));

const registry = { apps: [{ id: 'cp-demo', name: 'Cp', path: dir, demoOf: 'cp', demoReady: true,
  processes: [{ name: 'app', cmd: 'x', port: 19601, health: '/' }], perLink: { max: 2, portBase: 19700, prepare: [] } }] };
const marker = join(dir, 'instances', 'cp-demo', '0', 'in-use.db');

function setup({ killWorks }) {
  const records = { 'cp-demo.i0': { app: { pid: 4242, startTime: 'T1', listenPid: 4243, listenStartTime: 'T2', port: 19700 } } };
  const store = { processState: { all: async () => structuredClone(records), set: async (a, p, r) => { (records[a] ??= {})[p] = r; }, remove: async (a, p) => { delete records[a]?.[p]; } } };
  const events = [];
  const driver = {
    name: 'fake', startTime: (pid) => (pid === 4242 ? 'T1' : pid === 4243 ? 'T2' : null), startTimes: () => new Map(),
    // the listener answers as the recorded one until it is really killed
    listenerPid: () => (killWorks && events.includes('kill') ? null : 4243),
    spawnApp: () => { events.push('spawn'); return { exited: true, pid: 1 }; },
    killTree: async (pid) => { events.push('kill'); events.push(existsSync(marker) ? 'folder-still-there' : 'folder-gone'); return killWorks; },
  };
  mkdirSync(join(dir, 'instances', 'cp-demo', '0'), { recursive: true }); writeFileSync(marker, 'customer data');
  const sup = createSupervisor({ registry, store, driver, docker: {}, logDir: join(dir, 'logs') });
  return { sup, events, records };
}

test('instance-start stops what is left of an earlier start BEFORE it deletes the folder', async () => {
  mkdirSync(join(dir, 'logs'), { recursive: true });
  const { sup, events } = setup({ killWorks: true });
  const log = console.log; console.log = () => {};
  try { await sup.instanceStart(sup.getApp('cp-demo'), '0'); } finally { console.log = log; }
  assert.equal(events.indexOf('kill') >= 0, true, 'the leftover process was stopped');
  assert.ok(events.indexOf('folder-still-there') >= 0, 'it was stopped while the folder was still in place');
  assert.equal(existsSync(marker), false, 'and the folder was recreated empty afterwards');
});

test('instance-start leaves the folder alone and does not start when something could not be stopped', async () => {
  const { sup, events } = setup({ killWorks: false });
  const out = [], log = console.log; console.log = (...a) => out.push(a.join(' '));
  try { await sup.instanceStart(sup.getApp('cp-demo'), '0'); } finally { console.log = log; }
  assert.equal(sup.failed(), true);
  assert.equal(existsSync(marker), true, 'the data a live process holds is not deleted');
  assert.ok(!events.includes('spawn'), 'and nothing new is started on top of it');
  assert.match(out.join('\n'), /could not be stopped, so the copy was not started/);
});

test('a copy whose seat is above a lowered perLink.max can still be stopped, and its folder is removed (audit F-16)', async () => {
  const reg = { apps: [{ ...registry.apps[0], perLink: { max: 1, portBase: 19700, prepare: [] } }] }; // max was 4 when copy 3 started
  const folder = join(dir, 'instances', 'cp-demo', '3');
  mkdirSync(folder, { recursive: true }); writeFileSync(join(folder, 'data.db'), 'x');
  const killed = [];
  const records = { 'cp-demo.i3': { app: { pid: 5151, startTime: 'T9', listenPid: null, port: 19731 } } };
  const st = { processState: { all: async () => structuredClone(records), set: async () => {}, remove: async (a, p) => { delete records[a]?.[p]; } } };
  const driver = { name: 'fake', startTime: () => 'T9', startTimes: () => new Map(), listenerPid: () => null, spawnApp: () => ({ exited: true }), killTree: async (pid) => { killed.push(pid); return true; } };
  const sup = createSupervisor({ registry: reg, store: st, driver, docker: {}, logDir: join(dir, 'logs') });
  const log = console.log; console.log = () => {};
  try { await sup.instanceStop(sup.getApp('cp-demo'), '3'); } finally { console.log = log; }
  assert.deepEqual(killed, [5151], 'the process of seat 3 was stopped');
  assert.equal(sup.failed(), false);
  assert.equal(existsSync(folder), false, 'and its data folder was removed');
  // starting a seat above max is still refused
  const { Exit } = await import('../../supervisor/core.mjs');
  await assert.rejects(() => sup.instanceStart(sup.getApp('cp-demo'), '3'), (e) => e instanceof Exit && e.code === 2);
  // a number that is no seat at all is refused for stop too
  await assert.rejects(() => sup.instanceStop(sup.getApp('cp-demo'), '9'), (e) => e instanceof Exit && e.code === 2);
});
