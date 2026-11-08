// Logging for the long-running services (gateway, console). One line per event.
//   LOG_FORMAT=json (default when not on a terminal): {"t":"...","level":"info","msg":"...", ...fields}  -> easy for log collectors
//   LOG_FORMAT=text (default on a terminal): 2026-11-07T10:00:00.000Z INFO msg key=value
//   LOG_LEVEL=debug|info|warn|error (default info)
// Never pass secrets or full tokens as fields. Error objects are reduced to message + stack.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const format = () => process.env.LOG_FORMAT || (process.stdout.isTTY ? 'text' : 'json');
const min = () => LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

const plain = (v) => (v instanceof Error
  ? { message: v.message, code: v.code, stack: v.stack?.split('\n').slice(0, 6).join('\n'), ...(v.cause ? { cause: plain(v.cause) } : {}) }
  : v);

export function log(level, msg, fields = {}) {
  if ((LEVELS[level] ?? 20) < min()) return;
  const clean = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, plain(v)]));
  const t = new Date().toISOString();
  const line = format() === 'json'
    ? JSON.stringify({ t, level, msg, ...clean })
    : `${t} ${level.toUpperCase().padEnd(5)} ${msg}${Object.keys(clean).length ? ' ' + Object.entries(clean).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' ') : ''}`;
  (LEVELS[level] >= LEVELS.warn ? process.stderr : process.stdout).write(line + '\n');
}

// Last-resort safety net for the long-running services: log in the structured format, then run the graceful shutdown.
export function installProcessHandlers(onFatal) {
  process.on('unhandledRejection', (err) => { logger.error('unhandled rejection', { err }); onFatal?.('unhandledRejection'); });
  process.on('uncaughtException', (err) => { logger.error('uncaught exception', { err }); onFatal?.('uncaughtException'); });
}

export const logger = {
  debug: (m, f) => log('debug', m, f),
  info: (m, f) => log('info', m, f),
  warn: (m, f) => log('warn', m, f),
  error: (m, f) => log('error', m, f),
};
