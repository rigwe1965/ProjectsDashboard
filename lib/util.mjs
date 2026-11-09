// Small helpers that several services and CLIs each used to define for themselves (see audits/duplication-audit-2026-11-09.md).
// No dependencies and no side effects on import, so any script can use them, including the ones that run before the store opens.

// A number from an environment-style value; `d` when it is unset, empty or not a number. (Unlike `Number(v || d)`, the text "abc"
// gives the default instead of NaN, and an explicit 0 is kept.)
export const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The text of anything that was thrown (an Error, a string, undefined).
export const errMessage = (e) => String(e?.message || e);

// An IPv4 address as Node reports it on a dual-stack socket ("::ffff:10.0.0.5") back to plain "10.0.0.5".
export const unmapV4 = (addr) => String(addr || '').replace(/^::ffff:/, '');

// KEY=value lines to an object. Blank lines and lines starting with # are skipped; the key is trimmed. The value is kept as
// written after the first "=" (trailing blanks are already gone with the line's own trim), or trimmed fully with { trimValues: true }.
// No quote handling and no ${} expansion on purpose: a value is exactly what follows the "=".
export function parseEnvText(text, { trimValues = false } = {}) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i > 0) out[t.slice(0, i).trim()] = trimValues ? t.slice(i + 1).trim() : t.slice(i + 1);
  }
  return out;
}

// Runs async functions one after another, in the order they were asked for. A failure is returned to its own caller and does
// not stop the ones queued behind it. Use one lock per thing that must not be changed by two callers at once.
export function createSerialLock() {
  let chain = Promise.resolve();
  return (fn) => {
    const run = chain.then(fn);
    chain = run.catch(() => {});
    return run;
  };
}

// Wraps an async task so a call made while the previous run is still going is skipped. For timers (setInterval) whose task can
// take longer than the interval. A failure goes to `onError`; it never escapes into the timer.
export function skipIfRunning(task, onError = () => {}) {
  let running = false;
  return () => {
    if (running) return Promise.resolve(false);
    running = true;
    return Promise.resolve()
      .then(task)
      .catch(onError)
      .finally(() => { running = false; })
      .then(() => true);
  };
}

// Starts a promise-returning side effect (for example an audit write) that must never break the caller's request. A failure is
// handed to `onError` and nothing is thrown or left unhandled.
export function fireAndForget(fn, onError = () => {}) {
  Promise.resolve().then(fn).catch(onError);
}
