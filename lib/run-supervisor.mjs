// Runs the supervisor CLI (node supervisor/index.mjs <args>) as a child process. Used by the admin console and the demo gateway.
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { root } from './config.mjs';

export function runSupervisor(args, timeout = 120000) {
  return new Promise((resolve) => {
    execFile(process.execPath, [join(root, 'supervisor', 'index.mjs'), ...args], { env: process.env, timeout, windowsHide: true, maxBuffer: 8 * 1048576 },
      (err, stdout, stderr) => resolve({
        ok: !err,
        timedOut: !!err?.killed,
        output: ((stdout + stderr).trim() || err?.message || '') + (err?.killed ? '\n(timed out: check the status before trying again)' : ''),
      }));
  });
}
