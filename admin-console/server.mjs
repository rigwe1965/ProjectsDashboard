// Starts the admin console (see console.mjs for how it works and for the two login modes).
import { createConsole } from './console.mjs';
import { ports } from '../lib/config.mjs';
import { closeStore } from '../lib/store/index.mjs';
import { logger, installProcessHandlers } from '../lib/log.mjs';

const c = await createConsole({ port: ports.console });
const port = await c.listen().catch((err) => {
  logger.error(err.code === 'EADDRINUSE' ? 'console port is already in use' : 'console could not start listening', { err });
  process.exit(1);
});
const where = process.env.ADMIN_PUBLIC_URL || `http://127.0.0.1:${port}`;
if (await c.passwordMode()) {
  console.log(`Admin console running. Sign in with your password (and authenticator code, if enabled):\n  ${where}/`);
} else {
  console.log(`Admin console running. Open this URL (token changes on every launch):\n  ${where}/?t=${c.launchToken}\nTip: run "npm run console:auth set-password" to sign in with a password (and a 2-step code) instead.`);
}
logger.info('admin console listening', { port, bind: process.env.ADMIN_BIND || '127.0.0.1' });

let stopping = false;
async function shutdown(sig) {
  if (stopping) return; stopping = true;
  logger.info('shutting down', { signal: sig });
  const force = setTimeout(() => process.exit(1), 10000); force.unref();
  try { await c.close(); await closeStore(); } catch (e) { logger.error('error during shutdown', { err: e }); }
  process.exit(0);
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => shutdown(sig));
installProcessHandlers((why) => { process.exitCode = 1; shutdown(why); });
