// One-off shell steps (build, reset, per-copy prepare): run with a timeout, output appended to a log file.
import { existsSync, appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { childEnv } from './env.mjs';
import { rotateLog } from '../lib/log-rotate.mjs';

// Step output goes to a log file: hide the values of secret-looking settings (keys, tokens, passwords, connection strings) if a script prints them.
export function redact(text, env) {
  for (const [k, v] of Object.entries(env ?? {})) if (/KEY|SECRET|TOKEN|PASS|URL|DSN/i.test(k) && typeof v === 'string' && v.length >= 8) text = text.split(v).join('***');
  // a seed script that prints the account it created ("Created admin user: name / password") is not an env value, so mask by pattern too
  return text.replace(/(Created \w+ user: \S+ \/ )\S+/gi, '$1***');
}

// `driver` stops a step's whole process tree on a timeout; `logDir` is where the logs go.
export function createStepRunner({ driver, logDir }) {
  // Runs one command through the shell. On a timeout the whole process tree is stopped (a shell's children would otherwise
  // be left running), so a hung step cannot leave stray processes behind.
  function runStep(cmd, cwd, env, timeoutMs) {
    return new Promise((resolvePromise) => {
      let output = '', timedOut = false, settled = false, timer;
      const done = (r) => { if (!settled) { settled = true; clearTimeout(timer); resolvePromise({ output: redact(output, env), timedOut, ...r }); } };
      const child = spawn(cmd, { cwd, env, shell: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const keep = (d) => { if (output.length < 4 * 1048576) output += d; };
      child.stdout.on('data', keep); child.stderr.on('data', keep);
      timer = setTimeout(async () => { timedOut = true; if (child.pid) await driver.killTree(child.pid); done({ status: null }); }, timeoutMs);
      child.on('error', (e) => done({ status: null, error: e.message }));
      child.on('close', (code) => done({ status: code }));
    });
  }

  // One step of a build, reset or per-copy prepare: working folder and env are checked first, then the command runs with a timeout and its
  // output is appended to <logDir>/<logName>. Returns { ok: true }, or { ok: false, problem } when it could not even start (the caller
  // words that), or { ok: false, how } when it ran and failed ('timed out', an error, or 'exit N').
  async function runLoggedStep({ app, step, envSource, fillStep, logName, label, defaultTimeoutSec, onStart = () => {} }) {
    const cwd = resolve(app.path, step.cwd ?? '.');
    if (!existsSync(cwd)) return { ok: false, problem: `working directory not found: ${cwd}` };
    let env; try { env = childEnv(app, envSource, fillStep); } catch (e) { return { ok: false, problem: e.message }; }
    onStart();
    const r = await runStep(fillStep(step.cmd), cwd, env, (step.timeoutSec ?? defaultTimeoutSec) * 1000);
    rotateLog(join(logDir, logName));
    try { appendFileSync(join(logDir, logName), `\n--- ${new Date().toISOString()} ${label}: exit ${r.timedOut ? 'timed out' : r.status ?? 'error'}\n${r.output}${r.error ? 'error: ' + r.error + '\n' : ''}`, { mode: 0o600 }); } catch { /* best effort */ }
    if (r.error || r.timedOut || r.status !== 0) return { ok: false, how: r.timedOut ? 'timed out' : r.error ?? 'exit ' + r.status };
    return { ok: true };
  }
  return { runStep, runLoggedStep };
}
