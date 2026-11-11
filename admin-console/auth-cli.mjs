// Manage the admin console login.   npm run console:auth -- <command>
//   status         show whether a password / two-step code is set
//   set-password   choose the owner password (asks twice, hidden). Signs out all existing sessions.
//                  --from-file <path>: read the password from a file instead (the file is deleted at once)
//   enable-totp    turn on 2-step codes: shows a secret to add to an authenticator app, asks for one code to confirm
//                  without a prompt: enable-totp --start --to-file <path> (secret goes to the file), then enable-totp --code <6 digits>
//   disable-totp   turn 2-step codes off
//   remove-password  go back to the launch-token URL (only for localhost use)
//   sign-out-all   end every signed-in browser session
//   gen-key        print a new random ADMIN_DATA_KEY; with it set, the 2-step secret is stored encrypted
// Passwords are never taken from command-line arguments (they would end up in shell history).
import { readFileSync, writeFileSync, unlinkSync, lstatSync } from 'node:fs';
import readline from 'node:readline';
import { resolve } from 'node:path';
import { Writable } from 'node:stream';
import { getStore, closeStore } from '../lib/store/index.mjs';
import { EVENTS } from '../lib/events.mjs';
import { ADMIN_KEYS, passwordProblem, hashPassword, newTotpSecret, verifyTotp, otpauthUrl, seal, unseal, isSealed, dataKey, newDataKey } from '../lib/auth.mjs';

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
    const pw = await store.meta.get(ADMIN_KEYS.passwordHash), totp = await store.meta.get(ADMIN_KEYS.totpSecret);
    console.log(`Password:        ${pw ? 'set (password mode: sign in at /login)' : 'not set (token mode: use the URL printed at launch)'}`);
    console.log(`2-step codes:    ${totp ? 'on' : 'off'}`);
    if (totp) console.log(`2-step secret:   ${isSealed(totp) ? 'encrypted' + (dataKey() ? '' : ' (ADMIN_DATA_KEY is not set here, so it cannot be read)') : 'NOT encrypted' + (dataKey() ? ' (the console encrypts it when it next starts)' : ': set ADMIN_DATA_KEY (npm run console:auth -- gen-key) to encrypt it')}`);
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
    await store.meta.set(ADMIN_KEYS.passwordHash, await hashPassword(a));
    await store.sessions.clear();
    await audit(EVENTS.adminPasswordSet);
    console.log('Password saved. All signed-in sessions were ended. Sign in at the console address; no restart is needed.');
    if (!(await store.meta.get(ADMIN_KEYS.totpSecret))) console.log('Next: "npm run console:auth -- enable-totp" adds a 2-step code (recommended).');
  } else if (cmd === 'enable-totp') {
    if (!(await store.meta.get(ADMIN_KEYS.passwordHash))) throw new Error('Set a password first (set-password).');
    const argAfter = (flag) => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : undefined; };
    const describe = (secret) => [
      'Add this to your authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy):',
      `  Secret:  ${secret.match(/.{1,4}/g).join(' ')}`,
      `  Or open: ${otpauthUrl(secret, 'owner', 'Projects Dashboard')}`,
    ].join('\n');
    let secret, entered, started = false;
    if (process.argv.includes('--start')) {
      // Step 1 of 2 without a prompt: keep the new secret as pending and write it to a file (not to the terminal), so it
      // can be read privately. Nothing changes for sign-in until step 2 confirms a code.
      const file = argAfter('--to-file');
      if (!file) throw new Error('Usage: enable-totp --start --to-file <path>');
      const pending = newTotpSecret();
      await store.meta.set(ADMIN_KEYS.totpPending, seal(pending));
      await store.meta.set(ADMIN_KEYS.totpPendingFile, resolve(file));
      writeFileSync(file, describe(pending) + '\n', { mode: 0o600 });
      console.log(`The secret was written to ${file}. Add it to your authenticator app, then run: enable-totp --code <6 digits> (that deletes the file).`);
      started = true;
    } else if (process.argv.includes('--code')) {
      secret = unseal(await store.meta.get(ADMIN_KEYS.totpPending));
      if (!secret) throw new Error('No pending secret. Run "enable-totp --start --to-file <path>" first.');
      entered = argAfter('--code');
    } else {
      secret = newTotpSecret();
      console.log(describe(secret));
      entered = await ask('Enter the 6-digit code it shows, to confirm: ');
    }
    if (!started) {
      const step = verifyTotp(secret, entered);
      if (step === null) throw new Error('That code was not right. 2-step codes were NOT turned on. Run the command again.');
      await store.meta.set(ADMIN_KEYS.totpSecret, seal(secret));
      await store.meta.set(ADMIN_KEYS.totpLastStep, step);
      await store.meta.set(ADMIN_KEYS.totpPending, '');
      const leftover = await store.meta.get(ADMIN_KEYS.totpPendingFile);
      if (leftover) { // the setup file holds the secret in the clear: remove it now that setup is done
        // ...but only if it is still the file --start wrote (a plain file that starts with our text), never some other file the stored path might point to
        try {
          if (lstatSync(leftover).isFile() && readFileSync(leftover, 'utf8').startsWith('Add this to your authenticator app')) { writeFileSync(leftover, ''); unlinkSync(leftover); }
          else console.error(`Left ${leftover} alone: it is not the setup file this command wrote.`);
        } catch { /* already gone */ }
        await store.meta.set(ADMIN_KEYS.totpPendingFile, '');
      }
      await store.sessions.clear();
      await audit(EVENTS.adminTotpEnabled);
      console.log('2-step codes are on. All signed-in sessions were ended.');
      if (!dataKey()) console.log('Note: the secret is stored unencrypted. Set ADMIN_DATA_KEY (npm run console:auth -- gen-key) for the console to encrypt it.');
    }
  } else if (cmd === 'disable-totp') {
    await store.meta.set(ADMIN_KEYS.totpSecret, ''); await store.meta.set(ADMIN_KEYS.totpLastStep, '-1');
    await audit(EVENTS.adminTotpDisabled); console.log('2-step codes are off.');
  } else if (cmd === 'remove-password') {
    await store.meta.set(ADMIN_KEYS.passwordHash, ''); await store.meta.set(ADMIN_KEYS.totpSecret, '');
    await store.sessions.clear(); await audit(EVENTS.adminPasswordRemoved);
    console.log('Password and 2-step codes removed. The console uses the launch-token URL again (localhost only).');
  } else if (cmd === 'gen-key') {
    console.log(newDataKey());
    console.error('Keep this value outside the dashboard folder (for example in your service or container environment) as ADMIN_DATA_KEY. If it is lost, run disable-totp and enable-totp again.');
  } else if (cmd === 'sign-out-all') {
    await store.sessions.clear(); await audit(EVENTS.adminSessionsCleared); console.log('All sessions ended.');
  } else {
    console.log('Usage: npm run console:auth -- status | set-password | enable-totp | disable-totp | remove-password | sign-out-all | gen-key');
    code = cmd ? 1 : 0;
  }
} catch (e) { console.error(e.message); code = 1; }
rl.close(); await closeStore(); process.exitCode = code;
