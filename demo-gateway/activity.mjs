// What a customer did with a link, counted for the owner (analytics plan step 2). Nothing here is recorded request by request:
// record() and touch() only update a small map in memory (no waiting, no database), and flush() writes one batch per link and day
// to store.activity every `flushMs`, and once more when the gateway stops.
//
//  - A request is "activity": the time between two requests of one link counts as active time while the gap is at most `gapMs` (5 minutes);
//    a longer gap starts a new visit, and the quiet time is not counted. An open WebSocket keeps calling touch(), so a Streamlit-style app
//    that makes few HTTP requests still shows its time.
//  - Only the first two path segments are kept (ids in them become ":id"), never the query string, and files such as .js .css .png are
//    not counted at all: they follow a page load and say nothing about what the customer looked at.
import { MINUTE } from '../lib/util.mjs';
import { logger } from '../lib/log.mjs';

const ASSET = /\.(?:js|mjs|css|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|mp[34]|webm|txt|xml|json)$/i;
const IDLIKE = /^(?:\d+|[0-9a-f]{16,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const MAX_PENDING = 5000; // entries (link x day) kept in memory if the database is down; the oldest are dropped past this

// '/crm/contacts/42/edit?x=1' -> '/crm/contacts'; '/contacts/42' -> '/contacts/:id'; '/static/app.js' -> null (not counted).
export function pageKey(path) {
  const p = String(path ?? '').split('?')[0];
  if (ASSET.test(p)) return null;
  const segs = p.split('/').filter(Boolean).slice(0, 2).map((s) => (IDLIKE.test(s) ? ':id' : s.slice(0, 40)));
  return '/' + segs.join('/');
}

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

export function createActivity({ store, flushMs = 30000, gapMs = 5 * MINUTE, now = Date.now } = {}) {
  const pending = new Map(); // `${day}|${grantId}` -> batch not written yet
  const lastSeen = new Map(); // grantId -> time of that link's latest request or socket beat
  let timer = null, chain = Promise.resolve();

  const batchFor = (grantId, t) => {
    const key = `${dayOf(t)}|${grantId}`;
    let b = pending.get(key);
    if (!b) {
      if (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value); // database long down: forget the oldest, never grow without limit
      b = { grantId, day: dayOf(t), requests: 0, firstAt: null, lastAt: null, activeMs: 0, wsMs: 0, paths: {} };
      pending.set(key, b);
    }
    return b;
  };
  function beat(grantId, t) {
    const b = batchFor(grantId, t), prev = lastSeen.get(grantId);
    if (prev !== undefined && t - prev > 0 && t - prev <= gapMs) b.activeMs += t - prev;
    lastSeen.set(grantId, t);
    const iso = new Date(t).toISOString();
    b.firstAt ??= iso; b.lastAt = iso;
    return b;
  }

  // A request the gateway has decided to forward for this link. Memory only.
  function record(grantId, path) {
    const key = pageKey(path);
    if (key === null) return;
    const b = beat(grantId, now());
    b.requests += 1;
    b.paths[key] = (b.paths[key] ?? 0) + 1;
  }
  // An open WebSocket is still the customer being there: counts as activity (and time), but not as a page.
  function touch(grantId) { beat(grantId, now()); }
  // A WebSocket closed after `ms` milliseconds open.
  function socketClosed(grantId, ms) { if (ms > 0) batchFor(grantId, now()).wsMs += ms; }

  async function doFlush() {
    const t = now();
    for (const [id, seen] of lastSeen) if (t - seen > gapMs) lastSeen.delete(id); // a new visit would start anyway
    const batches = [...pending.values()]; pending.clear();
    for (const b of batches) {
      const delta = { requests: b.requests, firstAt: b.firstAt, lastAt: b.lastAt, activeSeconds: Math.round(b.activeMs / 1000), wsSeconds: Math.round(b.wsMs / 1000), paths: b.paths };
      if (!delta.requests && !delta.activeSeconds && !delta.wsSeconds && !b.lastAt) continue;
      try { await store.activity.add(b.grantId, b.day, delta); }
      catch (err) { // keep the batch for the next flush instead of losing it
        logger.warn('activity write failed; will retry', { err });
        const again = batchFor(b.grantId, Date.parse(b.day + 'T00:00:00Z'));
        again.requests += b.requests; again.activeMs += b.activeMs; again.wsMs += b.wsMs;
        again.firstAt = [again.firstAt, b.firstAt].filter(Boolean).sort()[0] ?? null; again.lastAt = [again.lastAt, b.lastAt].filter(Boolean).sort().at(-1) ?? null;
        for (const [p, n] of Object.entries(b.paths)) again.paths[p] = (again.paths[p] ?? 0) + n;
      }
    }
  }
  // One flush at a time: a call while one is running waits for it, then flushes what came in meanwhile.
  const flush = () => (chain = chain.catch(() => {}).then(doFlush));

  return {
    record, touch, socketClosed, flush,
    start() { timer ??= setInterval(() => { flush().catch((err) => logger.warn('activity flush failed', { err })); }, flushMs); timer.unref?.(); },
    async stop() { if (timer) clearInterval(timer); timer = null; await flush(); },
    pendingCount: () => pending.size,
  };
}
