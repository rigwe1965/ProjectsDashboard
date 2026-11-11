// Small helpers that several services and CLIs each used to define for themselves (see audits/duplication-audit-2026-11-09.md).
// No dependencies and no side effects on import, so any script can use them, including the ones that run before the store opens.

// A number from an environment-style value; `d` when it is unset, empty or not a number. (Unlike `Number(v || d)`, the text "abc"
// gives the default instead of NaN, and an explicit 0 is kept.)
export const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

// Durations in milliseconds, so a timeout reads as `15 * MINUTE` instead of 900000.
export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

// True for a plain JSON object (not null, not an array); what a request body must be before its fields are read.
export const isPlainObject = (b) => !!b && typeof b === 'object' && !Array.isArray(b);

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

// Hides what looks like a secret in log text before it is shown: a password inside a URL (scheme://user:secret@host), and the value
// after a secret-looking name (password, secret, token, key, authorization, bearer ...) written as name=value, name: value or "name": "value".
// It works on patterns, so it is a safety net for the console's log view, not a guarantee; the real protection is that apps do not log secrets.
export function maskSecrets(text) {
  return String(text)
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+(@)/gi, '$1***$2')
    .replace(/(\b(?:authorization|bearer)\b["']?\s*[:=]?\s*(?:bearer\s+|basic\s+)?)[A-Za-z0-9._~+/=-]{8,}/gi, '$1***')
    .replace(/(\b[\w.-]*(?:password|passwd|secret|token|api[_-]?key|apikey|private[_-]?key|access[_-]?key)[\w.-]*["']?\s*[:=]\s*["']?)[^\s"',;&]{4,}/gi, '$1***');
}

// Names from `keys` that are absent, empty or still the template placeholder REPLACE_ME in `env`.
export const missingKeys = (env, keys) => keys.filter((k) => !env[k] || env[k] === 'REPLACE_ME');

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

// Runs `fn` at most once per `ms` and hands every caller in that time the same answer (or the same failure). For a public health check that
// reads the database: however often it is called, the database is asked once per window (audit F-19).
export function cachedFor(ms, fn, now = Date.now) {
  let at = -Infinity, pending = null;
  return () => {
    if (pending && now() - at < ms) return pending;
    at = now(); pending = Promise.resolve().then(fn);
    return pending;
  };
}

// Guard for the scripts that empty a Supabase project: the settings must also NAME the project they mean to empty (DEMO_PROJECT_REF),
// and it must be the project the URL points at. Returns a problem text, or null when the two agree.
export function demoProjectRefProblem(env) {
  const want = String(env.DEMO_PROJECT_REF || '').trim().toLowerCase();
  if (!want || want === 'replace_me') return 'DEMO_PROJECT_REF is not set. Set it to the ref of the demo project (the first part of its URL) so this cannot empty the wrong project';
  let host;
  try { host = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.toLowerCase(); } catch { return 'NEXT_PUBLIC_SUPABASE_URL is not a valid URL'; }
  if (host.split('.')[0] !== want) return 'NEXT_PUBLIC_SUPABASE_URL points at project "' + host.split('.')[0] + '", not the demo project "' + want + '" (DEMO_PROJECT_REF): refusing';
  return null;
}
