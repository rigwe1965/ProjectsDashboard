// Keeps a growing log file from filling the disk (audit F-09). Called just before something appends to the log: a file over `maxBytes`
// is renamed to `<file>.1`, replacing the previous `.1`, so a log never holds more than about twice the limit. Best effort: a log that
// cannot be renamed (another process still holds it open on Windows) is simply left to keep growing until the next start.
import { statSync, renameSync, rmSync } from 'node:fs';

export const LOG_MAX_BYTES = Number(process.env.LOG_ROTATE_MB) > 0 ? Number(process.env.LOG_ROTATE_MB) * 1024 * 1024 : 5 * 1024 * 1024;

export function rotateLog(path, maxBytes = LOG_MAX_BYTES) {
  try {
    if (statSync(path).size <= maxBytes) return false;
    try { rmSync(path + '.1', { force: true }); } catch { /* the rename below replaces it where it can */ }
    renameSync(path, path + '.1');
    return true;
  } catch { return false; }
}
