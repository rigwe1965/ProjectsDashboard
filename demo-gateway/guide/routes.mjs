// The AI guide's web side, on a demo's own address (<product>.<base host>/_pd/guide...). The gateway calls handle() for a signed-in customer's
// request after it has checked the link is live and is for this product; handle() answers the guide's own paths and returns false for any other.
//
//   GET  /_pd/guide        the page: the demo in a frame next to a chat panel
//   GET  /_pd/guide.js     its script (same origin, so the page's policy needs no inline script)
//   GET  /_pd/guide.css    its style
//   POST /_pd/guide/chat   { message } -> a stream of server-sent events: {t:'text',d}, {t:'note',d}, {t:'error',d}, then {t:'done',left}
//
// What a customer types is held in memory only, for this browser session's last 10 turns, and is never written to disk or to the log.
import { readFileSync } from 'node:fs';
import { logger } from '../../lib/log.mjs';
import { BASE_SECURITY_HEADERS } from '../../lib/http-util.mjs';
import { loadGuide } from './content.mjs';
import { buildSystemPrompt } from './prompt.mjs';
import { MESSAGES, MAX_HISTORY } from './client.mjs';

export const MAX_MESSAGE_CHARS = 500;
const MAX_BODY = 4096;
const IDLE_MS = 2 * 3600e3; // a conversation not used for this long is forgotten
const MAX_CONVERSATIONS = 500; // across the whole gateway; the least recently used go first

const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');
const SCRIPT = read('guide.js'), STYLE = read('guide.css');

// The page's policy: nothing is allowed except its own script and style, its own frame of the demo, and calls back to the gateway.
export const GUIDE_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const PAGE_HEADERS = (https) => ({ ...BASE_SECURITY_HEADERS, 'content-security-policy': GUIDE_CSP, ...(https ? { 'strict-transport-security': 'max-age=31536000' } : {}) });

const plural = (n) => `${n} ${n === 1 ? 'message' : 'messages'}`;
const productLabel = (target) => String(target?.name ?? '').replace(/\s*\(demo instance\)\s*$/i, '').replace(/\s+demo$/i, '').trim();

// o: { enabled, brandName, bookingUrl, https, scheme, maxMessage }; budget: createBudget(...); client: createGuideClient(...)
export function createGuideRoutes({ o, store, budget, client }) {
  const enabled = Boolean(o.enabled && budget && client?.available);
  const maxMessage = o.maxMessage ?? MAX_MESSAGE_CHARS;
  const talks = new Map(); // session hash -> { msgs: [{role, content}], at }

  const remember = (key, msgs) => {
    talks.delete(key); talks.set(key, { msgs: msgs.slice(-MAX_HISTORY), at: Date.now() }); // delete + set keeps the Map in least-recently-used order
    while (talks.size > MAX_CONVERSATIONS) talks.delete(talks.keys().next().value);
  };
  const recall = (key) => {
    const t = talks.get(key);
    if (!t) return [];
    if (Date.now() - t.at > IDLE_MS) { talks.delete(key); return []; }
    return t.msgs;
  };
  const sweep = setInterval(() => { const cut = Date.now() - IDLE_MS; for (const [k, v] of talks) if (v.at < cut) talks.delete(k); }, 10 * 60e3);
  sweep.unref();

  // Does this link, on this product, have a guide? -> { ok: true, guide } or { ok: false }. The guide file is read each time, so a corrected guide is live at once.
  function eligible(g, slug, target) {
    if (!enabled || target?.guide !== true || !(g.guideMessages > 0)) return { ok: false };
    const loaded = loadGuide(slug, o.guidesDir);
    return loaded.ok ? { ok: true, guide: loaded.text } : { ok: false };
  }
  const notAvailable = (res, json) => json(res, 404, { error: MESSAGES.off });

  async function readJson(req) {
    let b = '';
    for await (const c of req) { b += c; if (b.length > MAX_BODY) return { tooBig: true }; }
    try { const v = JSON.parse(b); return v && typeof v === 'object' && !Array.isArray(v) ? { value: v } : { bad: true }; } catch { return { bad: true }; }
  }

  async function chat(req, res, { g, slug, target, hostHdr, session, json }) {
    if (!/^application\/json\b/i.test(String(req.headers['content-type'] ?? ''))) { req.resume(); return json(res, 415, { error: 'Please send JSON.' }); }
    const origin = req.headers.origin; // a browser sends it on a POST; one from another site is refused (the cookie is SameSite=Lax as well)
    if (origin && origin !== `${o.scheme}://${hostHdr}`) { req.resume(); return json(res, 403, { error: 'Not allowed.' }); }
    const body = await readJson(req);
    if (body.tooBig) return json(res, 413, { error: 'That message is too long.' });
    const message = typeof body.value?.message === 'string' ? body.value.message.trim() : '';
    if (body.bad || !message) return json(res, 400, { error: 'Please type a question.' });
    if (message.length > maxMessage) return json(res, 400, { error: `Please keep it under ${maxMessage} characters.` });
    const gate = eligible(g, slug, target);
    if (!gate.ok) return notAvailable(res, json);

    const turn = await budget.begin(g.id, g.guideMessages);
    if (!turn.ok) {
      if (turn.why === 'allowance') return json(res, 429, { error: `You have used all ${plural(turn.allowed)} included with this link. Ask the person who sent you this demo if you would like more.`, left: 0 });
      if (turn.why === 'rate') return json(res, 429, { error: MESSAGES.rate }, { 'retry-after': '30' });
      return json(res, 503, { error: MESSAGES.rate }, { 'retry-after': '300' }); // the gateway's daily limit: not something to explain to a customer
    }

    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no', 'x-content-type-options': 'nosniff' });
    const send = (ev) => { if (!res.writableEnded && !res.destroyed) res.write(`data: ${JSON.stringify(ev)}\n\n`); };
    const ctl = new AbortController();
    let finished = false;
    res.on('close', () => { if (!finished) ctl.abort(); }); // the customer left: stop paying for the answer
    let result;
    try {
      result = await client.ask({
        system: buildSystemPrompt({ productName: productLabel(target), guide: gate.guide, brand: o.brandName, bookingUrl: o.bookingUrl, accounts: target.demoAccounts }),
        history: recall(session), message, signal: ctl.signal, onText: (d) => send({ t: 'text', d }),
      });
    } catch (err) { // ask() does not throw for API problems; this is a bug, and the reservation must still be given back
      logger.error('guide: unexpected error', { err });
      result = { outcome: 'down', text: '', usage: null };
    }
    try { await turn.done(result.usage ?? undefined); } catch (err) { logger.error('guide: usage could not be recorded', { err }); }
    finished = true;
    if (result.outcome === 'ok' || result.outcome === 'truncated') remember(session, [...recall(session), { role: 'user', content: message }, { role: 'assistant', content: result.text }]);
    if (result.outcome === 'aborted') return void res.end();
    let left = 0;
    try { left = Math.max(0, g.guideMessages - (await store.guideUsage.totalForGrant(g.id)).messages); } catch { /* the count is a courtesy; the limit is enforced by begin() */ }
    if (result.outcome === 'truncated') send({ t: 'note', d: MESSAGES.truncated });
    else if (result.outcome !== 'ok') send({ t: 'error', d: MESSAGES[result.outcome === 'refused' ? 'refused' : result.outcome === 'rate' ? 'rate' : 'down'] });
    send({ t: 'done', left });
    res.end();
  }

  function page(res, g) {
    const left = Math.max(0, g.guideMessages);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...PAGE_HEADERS(o.https) });
    res.end('<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><meta name=color-scheme content="light dark"><meta name=robots content="noindex">' +
      '<title>Your demo, with a guide</title><link rel=stylesheet href="/_pd/guide.css">' +
      `<body data-left="${left}" data-max="${maxMessage}"><main class=split><iframe class=demo src="/" title="The demo"></iframe>` +
      '<section class=guide aria-label="Demo guide"><header><strong>Demo guide</strong><span id=left></span><a href="/" target=_top>Hide guide</a></header>' +
      '<p class=ai>This guide is an AI assistant, not a person. What you type here is sent to Anthropic to get an answer. We do not store it: it is kept only in memory while your visit lasts.</p>' +
      '<div id=log role=log aria-live=polite></div>' +
      `<form id=form><textarea id=msg maxlength="${maxMessage}" rows=2 placeholder="Ask how to do something in the demo" aria-label="Your question"></textarea><button id=send type=submit>Send</button></form>` +
      '</section></main><script src="/_pd/guide.js"></script>');
  }

  // Returns true when the request was one of the guide's (and has been answered), false when the gateway should treat it as any other.
  // `session`: a hash of this browser's session cookie, which keys the in-memory conversation. `json`: the gateway's JSON responder.
  async function handle(req, res, { path, g, slug, target, hostHdr, session, json }) {
    if (path !== '/_pd/guide' && path !== '/_pd/guide.js' && path !== '/_pd/guide.css' && path !== '/_pd/guide/chat') return false;
    const isChat = path === '/_pd/guide/chat';
    if (isChat ? req.method !== 'POST' : req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { allow: isChat ? 'POST' : 'GET', 'cache-control': 'no-store' }); res.end(); return true; }
    if (!eligible(g, slug, target).ok) { if (isChat) req.resume(); res.writeHead(404, { 'content-type': isChat ? 'application/json' : 'text/plain; charset=utf-8', 'cache-control': 'no-store' }); res.end(isChat ? JSON.stringify({ error: MESSAGES.off }) : 'Not found'); return true; }
    if (isChat) await chat(req, res, { g, slug, target, hostHdr, session, json });
    else if (path === '/_pd/guide') page(res, g);
    else res.writeHead(200, { 'content-type': path.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8', ...PAGE_HEADERS(o.https) }).end(path.endsWith('.js') ? SCRIPT : STYLE);
    return true;
  }

  return { handle, eligible, enabled, stop: () => clearInterval(sweep), conversations: () => talks.size };
}
