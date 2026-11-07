// Starts the admin console (see console.mjs for how it works and for the two login modes).
import { createConsole } from './console.mjs';
import { ports } from '../lib/config.mjs';

const c = await createConsole({ port: ports.console });
const port = await c.listen();
if (await c.passwordMode()) {
  console.log(`Admin console running. Sign in with your password (and authenticator code, if enabled):\n  http://127.0.0.1:${port}/`);
} else {
  console.log(`Admin console running. Open this URL (token changes on every launch):\n  http://127.0.0.1:${port}/?t=${c.launchToken}\nTip: run "npm run console:auth set-password" to sign in with a password (and a 2-step code) instead.`);
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await c.close(); process.exit(0); });
