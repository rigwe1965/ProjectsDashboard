// Manage the admin console login.   npm run console:auth -- <command>
//   status         show whether a password / two-step code is set
//   set-password   choose the owner password (asks twice, hidden). Signs out all existing sessions.
//                  --from-file <path>: read the password from a file instead (the file is deleted at once)
//   enable-totp    turn on 2-step codes: shows a secret to add to an authenticator app, asks for one code to confirm
//   disable-totp   turn 2-step codes off
//   remove-password  go back to the launch-token URL (only for localhost use)
//   sign-out-all   end every signed-in browser session
// Passwords are never taken from command-line arguments (they would end up in shell history).
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import readline from 'node:readline';
import { Writable } from 'node:stream';
import { getStore, closeStore } from '../lib/store/index.mjs';
import { passwordProblem, hashPassword, newTotpSecret, verifyTotp, otpauthUrl } from '../lib/auth.mjs';

const out = process.stdout;
const muted = new Writable({ write(chunk, enc, cb) { if (!this.muted) out.write(chunk, enc); cb(); } });
const rl = readline.createInterface({ input: process.stdin, output: muted, terminal: !!process.stdin.isTTY });
const lines = process.stdin.isTTY ? null : rl[Symbol.asyncIterator]();
async function ask(question, hidden = false) {
  out.write(question);
  if (lines) { const { value } = await lines.next(); return value ?? ''; } // piped input (scripts, tests)
  muted.muted = hidden;
  const answer = await new Promise((resolve) => rl.question('', resolve));
  muted.muted = false; if (hidden) out.write('\n');
  return answer;
}

const store = await getStore();
const cmd = process.argv[2];
const audit = (ev) => store.audit.add({ ev, by: 'cli' });
let code = 0;

try {
  if (cmd === 'status') {
    const pw = await store.meta.get('admin_password_hash'), totp = await store.meta.get('admin_totp_secret');
    console.log(`Password:        ${pw ? 'set (password mode: sign in at /login)' : 'not set (token mode: use the URL printed at launch)'}`);
    console.log(`2-step codes:    ${totp ? 'on' : 'off'}`);
  } else if (cmd === 'set-password') {
    const fi = process.argv.indexOf('--from-file');
    let a;
    if (fi > 0) {
      // For terminals where the hidden prompt does not work: the password is the first line of a file, which is
      // overwritten and deleted as soon as it has been read (even when the password is then rejected).
      const file = process.argv[fi + 1];
      if (!file) throw new Error('Usage: set-password --from-file <path>');
      try { a = readFileSync(file, 'utf8').split(/\r?\n/)[0]; }
      finally { try { writeFileSync(file, ''); } catch { /* best effort */ } try { unlinkSync(file); } catch { /* best effort */ } }
      console.log('Read the password from the file and deleted it.');
      const problem = passwordProblem(a);
      if (problem) throw new Error(problem);
    } else {
      a = await ask('New password (12+ characters): ', true);
      const problem = passwordProblem(a);
      if (problem) throw new Error(problem);
      if (a !== await ask('Repeat it: ', true)) throw new Error('The two passwords did not match. Nothing was changed.');
    }
    await store.meta.set('admin_password_hash', hashPassword(a));
    await store.sessions.clear();
    await audit('admin-password-set');
    console.log('Password saved. All signed-in sessions were ended. Restart the console, then sign in at its address.');
    if (!(await store.meta.get('admin_totp_secret'))) console.log('Next: "npm run console:auth -- enable-totp" adds a 2-step code (recommended).');
  } else if (cmd === 'enable-totp') {
    if (!(await store.meta.get('admin_password_hash'))) throw new Error('Set a password first (set-password).');
    const secret = newTotpSecret();
    console.log('Add this to your authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy):');
    console.log(`  Secret:  ${secret.match(/.{1,4}/g).join(' ')}`);
    console.log(`  Or open: ${otpauthUrl(secret, 'owner', 'Projects Dashboard')}`);
    const entered = await ask('Enter the 6-digit code it shows, to confirm: ');
    const step = verifyTotp(secret, entered);
    if (step === null) throw new Error('That code was not right. 2-step codes were NOT turned on. Run the command again.');
    await store.meta.set('admin_totp_secret', secret);
    await store.meta.set('admin_totp_last_step', step);
    await store.sessions.clear();
    await audit('admin-totp-enabled');
    console.log('2-step codes are on. All signed-in sessions were ended.');
  } else if (cmd === 'disable-totp') {
    await store.meta.set('admin_totp_secret', ''); await store.meta.set('admin_totp_last_step', '-1');
    await audit('admin-totp-disabled'); console.log('2-step codes are off.');
  } else if (cmd === 'remove-password') {
    await store.meta.set('admin_password_hash', ''); await store.meta.set('admin_totp_secret', '');
    await store.sessions.clear(); await audit('admin-password-removed');
    console.log('Password and 2-step codes removed. The console uses the launch-token URL again (localhost only).');
  } else if (cmd === 'sign-out-all') {
    await store.sessions.clear(); await audit('admin-sessions-cleared'); console.log('All sessions ended.');
  } else {
    console.log('Usage: npm run console:auth -- status | set-password | enable-totp | disable-totp | remove-password | sign-out-all');
    code = cmd ? 1 : 0;
  }
} catch (e) { console.error(e.message); code = 1; }
rl.close(); await closeStore(); process.exitCode = code;
