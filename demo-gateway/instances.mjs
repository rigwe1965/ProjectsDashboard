// Private demo copies, one per customer link (registry "perLink", see lib/instance-app.mjs).
//
// The gateway gives each opened link its own copy of the demo, with its own data, started on demand and thrown away when the link
// ends or the copy sits unused. The seat table for a product lives in the store's meta table under "inst:<product>":
//   { "<slot>": { grant, state: 'starting'|'ready'|'failed'|'stopping', at, seen } }
// One gateway process owns the table (changes are serialised below); the admin console only reads it.
import { isActive } from './grants.mjs';
import { instanceDir } from '../lib/instance-app.mjs';
import { existsSync } from 'node:fs';
import { logger } from '../lib/log.mjs';

export const START_TIMEOUT_MS = 6 * 60 * 1000;   // a copy that has been "starting" longer than this is treated as failed
export const RETRY_AFTER_FAIL_MS = 20 * 1000;    // a failed start is retried by the customer's next request, not faster than this
export const FAILED_KEEP_MS = 60 * 1000;         // a failed seat is cleaned up and freed after this
const key = (product) => 'inst:' + product;

export async function listInstances(store, product) {
  try { return JSON.parse((await store.meta.get(key(product))) || '{}'); } catch { return {}; }
}

export function createInstances({ store, supervisor, now = () => Date.now() }) {
  let chain = Promise.resolve();
  const locked = (fn) => { const run = chain.then(fn); chain = run.catch(() => {}); return run; };
  const seen = new Map(); // `${product}:${slot}` -> last time a request or open socket used the copy (saved to the table by sweep)
  const write = (product, table) => store.meta.set(key(product), JSON.stringify(table));
  const audit = (e) => Promise.resolve().then(() => store.audit.add(e)).catch((err) => logger.warn('audit write failed', { err }));
  const mine = (table, grantId) => Object.entries(table).find(([, e]) => e.grant === grantId);

  // Read-only: this grant's copy, if it has one.
  async function lookup(product, grantId) {
    const hit = mine(await listInstances(store, product), grantId);
    return hit ? { slot: Number(hit[0]), ...hit[1] } : null;
  }
  // Read-only: could this grant get a copy right now (it has one, or a seat is free)?
  async function hasRoom(product, app, grantId) {
    const table = await listInstances(store, product);
    return !!mine(table, grantId) || Object.keys(table).length < app.perLink.max;
  }
  const touch = (product, slot) => seen.set(`${product}:${slot}`, now());

  async function begin(product, app, slot, grantId) {
    audit({ ev: 'instance-start', app: product, grant: grantId, slot });
    let r;
    try { r = await supervisor(['instance-start', app.id, String(slot)], START_TIMEOUT_MS); }
    catch (err) { r = { ok: false, output: String(err?.message || err) }; }
    if (!r.ok) {
      logger.error('private demo copy failed to start', { product, slot, output: String(r.output || '').slice(-400) });
      supervisor(['instance-stop', app.id, String(slot)], 120000).catch(() => {}); // stop whatever half-started and delete its folder
    }
    await locked(async () => {
      const table = await listInstances(store, product);
      if (table[slot]?.grant !== grantId || table[slot].state !== 'starting') return; // swept or replaced meanwhile
      table[slot] = { ...table[slot], state: r.ok ? 'ready' : 'failed', at: now(), seen: now() };
      await write(product, table);
    });
    if (r.ok) touch(product, slot);
    audit({ ev: r.ok ? 'instance-ready' : 'instance-failed', app: product, grant: grantId, slot });
  }

  // Make sure this grant has a copy and, if it has none or a failed one, start it (in the background).
  // Returns { status: 'ready'|'starting'|'failed'|'full', slot }.
  function ensure(product, app, grantId) {
    return locked(async () => {
      const table = await listInstances(store, product);
      const t = now();
      let hit = mine(table, grantId);
      if (hit) {
        const [slot, e] = hit;
        if (e.state === 'ready') return { status: 'ready', slot: Number(slot) };
        if (e.state === 'starting' && t - e.at < START_TIMEOUT_MS) return { status: 'starting', slot: Number(slot) };
        if (e.state === 'stopping') return { status: 'starting', slot: Number(slot) };
        if (e.state === 'failed' && t - e.at < RETRY_AFTER_FAIL_MS) return { status: 'failed', slot: Number(slot) };
        table[slot] = { grant: grantId, state: 'starting', at: t, seen: t };           // retry on the same seat
        await write(product, table);
        begin(product, app, Number(slot), grantId).catch((err) => logger.error('instance start errored', { err }));
        return { status: 'starting', slot: Number(slot) };
      }
      const free = [...Array(app.perLink.max).keys()].find((s) => !table[s]);
      if (free === undefined) return { status: 'full', slot: null };
      table[free] = { grant: grantId, state: 'starting', at: t, seen: t };
      await write(product, table);
      begin(product, app, free, grantId).catch((err) => logger.error('instance start errored', { err }));
      return { status: 'starting', slot: free };
    });
  }

  // The copy stopped answering (it crashed): mark it failed, so this customer's next request starts a new one.
  const markDown = (product, slot, grantId) => locked(async () => {
    const table = await listInstances(store, product);
    if (table[slot]?.grant !== grantId || table[slot].state !== 'ready') return;
    table[slot] = { ...table[slot], state: 'failed', at: 0 };
    await write(product, table);
  });

  // Stop one copy and free its seat.
  async function stopSeat(product, app, slot, why) {
    await locked(async () => {
      const table = await listInstances(store, product);
      if (!table[slot]) return;
      table[slot] = { ...table[slot], state: 'stopping', at: now() };
      await write(product, table);
    });
    const grant = (await listInstances(store, product))[slot]?.grant;
    let r; try { r = await supervisor(['instance-stop', app.id, String(slot)], 120000); } catch (err) { r = { ok: false, output: String(err?.message || err) }; }
    if (r.ok) {
      await locked(async () => { const table = await listInstances(store, product); delete table[slot]; await write(product, table); });
      seen.delete(`${product}:${slot}`);
      audit({ ev: 'instance-stop', app: product, grant, slot, why });
    } else logger.error('private demo copy could not be stopped; the seat stays taken', { product, slot, output: String(r.output || '').slice(-300) });
  }

  // One pass: stop copies whose link ended, that nobody has used for a while, that failed, or that never finished starting.
  async function sweep(apps) {
    const t = now();
    const grants = await store.grants.list();
    const done = [];
    for (const [product, app] of Object.entries(apps)) {
      if (!app.perLink) continue;
      const table = await listInstances(store, product);
      let dirty = false;
      for (const [slot, e] of Object.entries(table)) {
        const last = Math.max(Number(e.seen) || 0, seen.get(`${product}:${slot}`) || 0);
        if (seen.get(`${product}:${slot}`) && seen.get(`${product}:${slot}`) > (Number(e.seen) || 0)) { e.seen = seen.get(`${product}:${slot}`); dirty = true; }
        const g = grants.find((x) => x.id === e.grant);
        let why = null;
        if (!isActive(g)) why = 'link-ended';
        else if (e.state === 'ready' && t - last > (app.perLink.idleMinutes ?? 120) * 60000) why = 'idle';
        else if (e.state === 'failed' && t - e.at > FAILED_KEEP_MS) why = 'failed';
        else if (e.state === 'starting' && t - e.at > START_TIMEOUT_MS) why = 'start-timeout';
        else if (e.state === 'stopping' && t - e.at > 5 * 60000) why = 'stuck-stopping';
        if (why) { await stopSeat(product, app, Number(slot), why); done.push({ product, slot: Number(slot), why }); }
      }
      if (dirty) await locked(async () => { const cur = await listInstances(store, product); for (const [s, e] of Object.entries(table)) if (cur[s]?.grant === e.grant) cur[s].seen = e.seen; await write(product, cur); });
    }
    return done;
  }

  // At gateway start-up: a copy that was "starting" when the gateway stopped will never finish; leftovers with no seat are removed.
  async function reconcile(apps) {
    for (const [product, app] of Object.entries(apps)) {
      if (!app.perLink) continue;
      await locked(async () => {
        const table = await listInstances(store, product); let changed = false;
        for (const [slot, e] of Object.entries(table)) if (e.state === 'starting') { table[slot] = { ...e, state: 'failed', at: 0 }; changed = true; }
        if (changed) await write(product, table);
      });
      const table = await listInstances(store, product);
      for (let slot = 0; slot < app.perLink.max; slot++) {
        if (!table[slot] && existsSync(instanceDir(app.id, slot))) supervisor(['instance-stop', app.id, String(slot)], 120000).catch(() => {});
      }
    }
  }

  return { lookup, hasRoom, ensure, touch, markDown, sweep, reconcile, list: (product) => listInstances(store, product) };
}
