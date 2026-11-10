// The owner's sign-in (POST /login) in password mode: same-origin check, rate limits per address and overall, password + optional
// 2-step code, then a database-backed session in an HttpOnly cookie. Every attempt is recorded in the audit log.
import { json, clientIp, limitKey } from '../lib/http-util.mjs';
import { createSerialLock, isPlainObject, MINUTE } from '../lib/util.mjs';
import { logger } from '../lib/log.mjs';
import { EVENTS } from '../lib/events.mjs';
import { ADMIN_KEYS, verifyPassword, needsRehash, hashPassword, verifyTotp, unseal, newSessionId, hashSessionId } from '../lib/auth.mjs';

const LOGIN_WINDOW_MS = 15 * MINUTE; // the window for counting sign-in attempts

// o: the console options (loginMaxPerIp, loginMaxTotal, loginPenaltyMs, sessionHours). cookie: { name, secure } for the session cookie
// ('secure' is '; Secure' or ''). badOrigin and readBody are the console's own helpers; securityHeaders go on the success response.
export function createLogin({ o, store, trusted, audit, badOrigin, readBody, cookie, securityHeaders }) {
  const { name: COOKIE, secure } = cookie;
  const withTotpLock = createSerialLock(); // serialises the TOTP check-and-record (one console process)

  async function login(req, res) {
    if (badOrigin(req, res)) return;
    const ip = clientIp(req, trusted), ua = String(req.headers['user-agent'] || '').slice(0, 200);
    // 8 tries per IP per 15 minutes (hard limit). Failed tries overall are also counted: past the cap, wrong guesses are
    // refused with 429 but a correct password + code still signs in, so a flood of bad guesses from many addresses
    // cannot lock the real owner out.
    const overall = (await store.rateLimit.count('login-fail:all', LOGIN_WINDOW_MS)) >= o.loginMaxTotal;
    if ((await store.rateLimit.hit('login:' + limitKey(ip), LOGIN_WINDOW_MS, o.loginMaxPerIp)) > o.loginMaxPerIp) {
      return json(res, 429, { error: 'Too many attempts. Wait 15 minutes and try again.' }, { 'retry-after': '900' });
    }
    let b; try { b = JSON.parse((await readBody(req)) || '{}'); } catch (e) { return json(res, e.status === 413 ? 413 : 400, { error: 'bad request' }); }
    if (!isPlainObject(b)) return json(res, 400, { error: 'bad request' });
    const hash = await store.meta.get(ADMIN_KEYS.passwordHash);
    const totpStored = await store.meta.get(ADMIN_KEYS.totpSecret);
    const totpSecret = totpStored || '';
    let totpPlain = null; // the usable secret; stays null when it is encrypted and the key is missing or wrong (sign-in then fails closed)
    if (totpStored) { try { totpPlain = unseal(totpStored); } catch (err) { logger.error('cannot read the 2-step secret; sign-in is refused', { err }); } }
    // both checks always run, so timing does not reveal which of the two was wrong
    let pwOk;
    try { pwOk = !!hash && await verifyPassword(String(b.password ?? ''), hash); }
    catch (e) { // too many checks already waiting (a flood): refuse this one without counting it as a wrong password
      if (e?.code !== 'AUTH_BUSY') throw e;
      return json(res, 429, { error: 'Sign-in is busy. Wait a few seconds and try again.' }, { 'retry-after': '10' });
    }
    // Read the last used step, check the code and record the new step as ONE unit (one login at a time), so two
    // simultaneous logins with the same code cannot both pass. Only the password-correct case burns the code.
    const step = await withTotpLock(async () => {
      const lastStep = Number((await store.meta.get(ADMIN_KEYS.totpLastStep)) ?? -1);
      const s = totpSecret ? (totpPlain ? verifyTotp(totpPlain, b.code, Date.now(), lastStep) : null) : 0;
      if (totpSecret && s !== null && pwOk) await store.meta.set(ADMIN_KEYS.totpLastStep, s);
      return s;
    });
    if (!pwOk || step === null) {
      audit({ ev: EVENTS.adminLoginFailed, ip, ua });
      await store.rateLimit.hit('login-fail:all', LOGIN_WINDOW_MS);
      if (overall) {
        // The cap does not lock the owner out (a correct password still signs in), so slow the guessers instead: each wrong
        // guess now takes longer to answer, which limits how many a distributed attacker can have in flight.
        if (o.loginPenaltyMs > 0) await new Promise((r) => setTimeout(r, o.loginPenaltyMs));
        return json(res, 429, { error: 'Too many failed attempts. Wait a few minutes and try again.' }, { 'retry-after': '300' });
      }
      return json(res, 401, { error: 'Wrong password or code.' }); // the same words whether or not 2-step is on, so that is not revealed
    }
    const id = newSessionId(), maxAge = Math.round(o.sessionHours * 3600);
    await store.sessions.create(hashSessionId(id), new Date(Date.now() + maxAge * 1000).toISOString());
    audit({ ev: EVENTS.adminLogin, ip, ua });
    // the password was right: if its hash was made with an older, cheaper setting, replace it with a current one
    if (needsRehash(hash)) { try { await store.meta.set(ADMIN_KEYS.passwordHash, await hashPassword(String(b.password))); } catch (err) { logger.warn('could not upgrade the password hash', { err }); } }
    res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': `${COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`, ...securityHeaders });
    res.end(JSON.stringify({ ok: true }));
  }

  return login;
}
