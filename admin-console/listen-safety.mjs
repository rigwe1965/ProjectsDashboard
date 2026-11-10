// Start-up checks for the console: it refuses to listen beyond this machine unless it is protected. Throws an Error that says what to do.
import { ADMIN_KEYS } from '../lib/auth.mjs';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

// `o` is the console's options (bindHost, scheme, allowHttp); `store` is where the password and 2-step secret are kept.
// The checks run in this order, so the first thing missing is the first thing reported.
export async function assertSafeToListen(o, store) {
  if (LOOPBACK.has(o.bindHost)) return;
  if (!(await store.meta.get(ADMIN_KEYS.passwordHash))) {
    throw new Error(`Refusing to listen on ${o.bindHost} without a password. Run "npm run console:auth set-password" first.`);
  }
  // The hosted setup sets ADMIN_REQUIRE_TOTP=1: a password alone is not enough for a console on the internet.
  if (process.env.ADMIN_REQUIRE_TOTP === '1' && !(await store.meta.get(ADMIN_KEYS.totpSecret))) {
    throw new Error(`Refusing to listen on ${o.bindHost} without 2-step codes. Run "npm run console:auth enable-totp" first (or unset ADMIN_REQUIRE_TOTP for a test).`);
  }
  // Beyond this machine the password and session cookie would cross the network: require HTTPS (a proxy in front terminates
  // it), unless the operator explicitly accepts plain HTTP for a test on one machine.
  if (o.scheme !== 'https' && !o.allowHttp) {
    throw new Error(`Refusing to serve the console over plain HTTP on ${o.bindHost}. Put it behind HTTPS (ADMIN_SCHEME=https), or set ADMIN_ALLOW_HTTP=1 for a test on one machine.`);
  }
}
