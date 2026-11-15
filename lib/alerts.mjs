// Owner alerts: a message to a webhook when something that should be running is down, and another when it is back.
//   ALERT_WEBHOOK_URL   where to POST (ntfy.sh topic, Discord or Slack webhook, or any URL that accepts a POST). Unset = no alerts.
// Messages name apps and processes only: never customer names, links, addresses or secrets. The URL itself is a secret (anyone who
// has it can post to your channel), so it is never logged; only its host is.

const CHECK = (u) => {
  let url;
  try { url = new URL(u); } catch { throw new Error('ALERT_WEBHOOK_URL is not a valid URL'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('ALERT_WEBHOOK_URL must start with https:// (http:// is only allowed for localhost)');
  return url;
};

// Sends one message. The body format follows the service: Discord {content}, Slack {text}, anything else (ntfy.sh and similar)
// gets the plain text with a Title header. Resolves true when the service answered 2xx. Never throws.
export function makeWebhookSender(rawUrl, { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  const url = CHECK(rawUrl);
  const host = url.hostname;
  const send = async (title, text) => {
    let init;
    if (/(^|\.)discord(app)?\.com$/.test(host)) init = { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: `**${title}**\n${text}` }) };
    else if (host === 'hooks.slack.com') init = { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: `*${title}*\n${text}` }) };
    else init = { headers: { 'content-type': 'text/plain; charset=utf-8', title }, body: text };
    try {
      const r = await fetchImpl(url, { method: 'POST', ...init, signal: AbortSignal.timeout(timeoutMs) });
      return r.ok;
    } catch { return false; }
  };
  send.host = host;
  return send;
}

// Email through Resend (https://resend.com), as another way to send the same (title, text) message.
//   RESEND_API_KEY   a "sending access" key for the sending domain      ALERT_EMAIL_TO   who receives it (one address or comma-separated)
//   ALERT_EMAIL_FROM an address on the verified domain, e.g. alerts@facyke.com
// The key is never logged. Resolves true when Resend answered 2xx; never throws.
export function makeEmailSender({ apiKey, from, to, fetchImpl = fetch, timeoutMs = 10000 }) {
  const recipients = String(to || '').split(',').map((a) => a.trim()).filter(Boolean);
  if (!apiKey || !from || !recipients.length) throw new Error('email alerts need RESEND_API_KEY, ALERT_EMAIL_FROM and ALERT_EMAIL_TO');
  if (!recipients.every((a) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(a))) throw new Error('ALERT_EMAIL_TO is not a valid address');
  const send = async (title, text) => {
    try {
      const r = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to: recipients, subject: title, text }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      return r.ok;
    } catch { return false; }
  };
  send.host = 'api.resend.com';
  return send;
}

// Sends one message through every channel; true when at least one delivered it.
export function sendToAll(senders) {
  const send = async (title, text) => (await Promise.all(senders.map((s) => s(title, text)))).some(Boolean);
  send.host = senders.map((s) => s.host).join(', ');
  return send;
}

// Tracks the state of named things and sends a message on the changes that matter.
//   observe(key, ok, detail): a thing that has failed `failAfter` checks in a row is reported DOWN once, reminded every `repeatMs`
//   while it stays down, and reported BACK when it recovers. One failed check alone is never reported (a restart takes a moment).
//   clear(key): forget a thing without a message (the owner stopped it on purpose).
// A message counts as sent only when `send` answers true. A DOWN or reminder that did not get through is tried again at the next check,
// and a BACK that did not get through is kept and tried again while the thing stays up (the network is often what is down). observe()
// answers 'down' | 'reminder' | 'back' when the message was delivered, 'unsent' when it was due but did not get through, else null.
export function createAlerter({ send, failAfter = 2, repeatMs = 6 * 3600e3, now = Date.now, name = 'ProjectsDashboard' }) {
  const things = new Map(); // key -> { fails, since, lastSent }
  return {
    async observe(key, ok, detail = '') {
      const t = things.get(key) ?? { fails: 0, since: null, lastSent: null };
      if (ok) {
        if (t.lastSent == null) { things.delete(key); return null; } // never reported as down, so nothing to report back
        if (await send(`${name}: ${key} is back`, `${key} is running again. It was down for ${mins(now() - t.since)}.`)) { things.delete(key); return 'back'; }
        t.fails = 0; things.set(key, t); // keep the record until the message is delivered
        return 'unsent';
      }
      t.fails++;
      if (t.since == null) t.since = now();
      things.set(key, t);
      if (t.fails < failAfter) return null;
      if (t.lastSent == null) {
        if (!(await send(`${name}: ${key} is DOWN`, `${key} is not responding.${detail ? ' ' + detail : ''}`))) return 'unsent';
        t.lastSent = now(); return 'down';
      }
      if (now() - t.lastSent >= repeatMs) {
        if (!(await send(`${name}: ${key} is still DOWN`, `${key} has been down for ${mins(now() - t.since)}.${detail ? ' ' + detail : ''}`))) return 'unsent';
        t.lastSent = now(); return 'reminder';
      }
      return null;
    },
    clear(key) { things.delete(key); },
  };
}
const mins = (ms) => { const m = Math.max(1, Math.round(ms / 60000)); return m < 120 ? `${m} min` : `${Math.round(m / 60)} h`; };

// One round of checks. Reports: the database not answering, the supervisor status not readable, and any process the supervisor
// started (it has a record) that no longer answers. A process the owner stopped has no record, so it is never reported.
//   status() -> array of { app, proc, up } (throws when unreadable)   records() -> { app: { proc: rec } }   dbCheck() -> throws when the database does not answer
export async function runChecks({ alerter, status, records, dbCheck }) {
  try { await dbCheck(); await alerter.observe('database', true); } catch (e) { await alerter.observe('database', false, String(e?.message || e).slice(0, 150)); }
  let rows, recs;
  try { rows = await status(); recs = await records(); } catch { rows = null; }
  if (!rows) { await alerter.observe('status check', false, 'The dashboard could not read the status of the apps.'); return; }
  await alerter.observe('status check', true);
  for (const r of rows) {
    const key = `${r.app}/${r.proc}`;
    if (!recs?.[r.app]?.[r.proc]) alerter.clear(key);
    else await alerter.observe(key, !!r.up);
  }
}
