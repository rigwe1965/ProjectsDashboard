// The gateway's own pages (not the demo apps' pages): the notices before entry, error pages, and the audit record of a refusal.
import { BASE_SECURITY_HEADERS } from '../lib/http-util.mjs';
import { EVENTS } from '../lib/events.mjs';

// What a customer is told before entering: a private copy of the demo, or a shared one.
export const PRIVATE_NOTICE = 'This is your own private copy of the demonstration, filled with sample data. It is started for you when you open it and deleted when your link ends, so nobody else can see what you enter.<br><br><strong>Please still avoid entering real personal, customer or confidential information.</strong>';
export const SHARED_NOTICE = 'This is a shared demonstration with sample data. Other people may be using it at the same time, what you enter can be seen by them, and it can be reset at any time.<br><br><strong>Please do not enter real personal, customer or confidential information.</strong>';
export const HSTS = 'max-age=31536000';
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
return { page, tooMany };
};
// The audit record of a refused request. `grant` is the grant's id when the request got as far as one; extra fields (why, via) follow.
export const deniedRecord = (grant, app, ip, ua, extra = {}) => ({ ev: EVENTS.denied, ...(grant ? { grant } : {}), app, ip, ua, ...extra });

