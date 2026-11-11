// The gateway's own pages (not the demo apps' pages): the notices before entry, error pages, and the audit record of a refusal.
import { BASE_SECURITY_HEADERS } from '../lib/http-util.mjs';
import { EVENTS } from '../lib/events.mjs';

// What a customer is told before entering: a private copy of the demo, or a shared one.
// Said to every customer before they open a demo: what is recorded about their visit (see demo-gateway/README.md, "What is recorded").
const RECORDED = '<br><br>So the owner can see how the demo is used, your address and browser type are noted when you open the link, and the pages you visit and how long you are active are counted. What you type is not recorded here.';
export const PRIVATE_NOTICE = 'This is your own private copy of the demonstration, filled with sample data. It is started for you when you open it and deleted when your link ends, so nobody else can see what you enter.<br><br><strong>Please still avoid entering real personal, customer or confidential information.</strong>' + RECORDED;
export const SHARED_NOTICE = 'This is a shared demonstration with sample data. Other people may be using it at the same time, what you enter can be seen by them, and it can be reset at any time.<br><br><strong>Please do not enter real personal, customer or confidential information.</strong>' + RECORDED;
export const HSTS = 'max-age=31536000';

// ---- the branded page where a customer opens their link (GET /d/<token>)
// Text typed by the owner (customer name, welcome note, brand) is always escaped here.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// "about 3 days", "about 5 hours", "less than an hour", or null when the link has ended.
export function timeLeft(expiresAt, now = Date.now()) {
  const ms = Date.parse(expiresAt) - now;
  if (!(ms > 0)) return null;
  if (ms < 3600e3) return 'less than an hour';
  const hours = Math.floor(ms / 3600e3);
  if (hours < 48) return 'about ' + hours + (hours === 1 ? ' hour' : ' hours');
  return 'about ' + Math.round(ms / 864e5) + ' days';
}

// The owner's "book a call" address (DEMO_BOOKING_URL): only a plain https address is accepted, never one with a user name or password in it.
export function parseBookingUrl(raw) {
  const text = String(raw ?? '').trim();
  if (!text || text.length > 300) return null;
  try { const u = new URL(text); return u.protocol === 'https:' && !u.username && !u.password ? u.href : null; } catch { return null; }
}

// Everything the page shows, as one HTML string. productName: the product's name; g: the link (customer's own name for it is NOT shown, only
// displayName); notice: the trusted notice HTML; brand: the owner's name (or ''); bookingUrl: from parseBookingUrl or null.
export function renderLanding({ productName, g, notice, brand = '', bookingUrl = null, guide = null, now = Date.now() }) {
  const product = esc(String(productName || 'the demo').replace(/\s+demo$/i, ''));
  const left = timeLeft(g.expiresAt, now);
  const welcome = g.welcome ? `<p style="margin:16px 0;padding:12px 16px;border-left:4px solid #888;background:rgba(128,128,128,.12);white-space:normal">${esc(g.welcome).replaceAll('\n', '<br>')}</p>` : '';
  return `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><meta name=color-scheme content="light dark"><meta name=robots content="noindex"><title>Your demo of ${product}</title>` +
    `<body style="font:17px/1.5 system-ui;max-width:34rem;margin:8vh auto;padding:0 20px">` +
    (brand ? `<div style="font-size:14px;letter-spacing:.04em;text-transform:uppercase;opacity:.7">${esc(brand)}</div>` : '') +
    `<h1 style="font-size:26px;margin:6px 0 4px">Your demo of ${product}</h1>` +
    (g.displayName ? `<div style="font-size:18px;opacity:.85">Prepared for <strong>${esc(g.displayName)}</strong></div>` : '') +
    welcome +
    (left ? `<p style="font-size:15px;opacity:.8">This link works until ${esc(new Date(g.expiresAt).toUTCString())} (${left} left).</p>` : '') +
    `<div style="font-size:16px;margin:18px 0">${notice}</div>` +
    (guide ? `<div style="font-size:16px;margin:18px 0;padding:12px 16px;border:1px solid #888;border-radius:8px"><strong>A demo guide is included.</strong> It is an AI assistant beside the demo that can answer up to ${esc(guide.messages)} ${guide.messages === 1 ? 'question' : 'questions'} about how to use it. What you type to it is sent to Anthropic to get the answer. We do not store it.</div>` : '') +
    '<form method="post" style="margin-top:20px"><button type="submit" style="font:inherit;padding:10px 20px;cursor:pointer">I understand - open the demo</button></form>' +
    (guide ? '<form method="post" action="?guide=1" style="margin-top:10px"><button type="submit" style="font:inherit;padding:10px 20px;cursor:pointer">I understand - open it with the guide</button></form>' : '') +
    (bookingUrl ? `<p style="margin-top:28px;font-size:15px">Questions, or want to talk it through? <a href="${esc(bookingUrl)}" target="_blank" rel="noopener noreferrer">Book a call</a></p>` : '');
}
// The gateway's own pages. Whether they carry HSTS follows the gateway's scheme option (the same one the cookies use), not a second reading of the environment.
export const makePages = (https) => {
const OWN_HEADERS = { ...BASE_SECURITY_HEADERS,
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'", ...(https ? { 'strict-transport-security': HSTS } : {}) };
// `head` is extra markup for <head> (for example a meta refresh).
const page = (res, code, title, msg, headers = {}, head = '') => {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', ...OWN_HEADERS, ...headers });
  res.end(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">${head}<title>${title}</title><body style="font:17px system-ui;max-width:32rem;margin:15vh auto;padding:0 20px;color:#222"><h1 style="font-size:22px">${title}</h1><p>${msg}</p>`);
};
// A 429 page. `seconds` is both the wait shown to the customer and the Retry-After header.
const tooMany = (res, seconds) => page(res, 429, 'Too many attempts', `Please wait ${seconds === 60 ? 'a minute' : 'a few minutes'} and try again.`, { 'retry-after': String(seconds) });
// The branded opening page (200). `details` is what renderLanding takes.
const landing = (res, details) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...OWN_HEADERS, 'cache-control': 'no-store' });
  res.end(renderLanding(details));
};
return { page, tooMany, landing };
};
// The audit record of a refused request. `grant` is the grant's id when the request got as far as one; extra fields (why, via) follow.
export const deniedRecord = (grant, app, ip, ua, extra = {}) => ({ ev: EVENTS.denied, ...(grant ? { grant } : {}), app, ip, ua, ...extra });

