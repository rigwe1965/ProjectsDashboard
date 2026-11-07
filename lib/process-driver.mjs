// OS-specific process control for the supervisor. Two drivers with the same interface:
//   windows: PowerShell / netstat / taskkill / cmd (the behaviour the dashboard has always had)
//   posix:   /proc or ps / ss or lsof / process-group signals / sh        (Linux and macOS, containers)
// Interface:
//   spawnApp({ cmd, cwd, env, logPath }) -> child   starts `cmd`, output appended to logPath, outlives the caller
//   startTime(pid)   -> string|null                 identifies a process incarnation (guards against PID reuse)
//   listenerPid(port)-> number|null                 PID listening on a TCP port
//   killTree(pid)    -> Promise<boolean>            stops the process and its children; true when it is gone
// Select with PD_DRIVER=windows|posix (default: by platform).
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const quiet = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] };

// ---------- parsers: pure functions, unit-tested with real command output
// `netstat -ano -p tcp` on Windows:  "  TCP    0.0.0.0:5200    0.0.0.0:0    LISTENING    12345"
export function parseNetstatListener(text, port) {
  const re = new RegExp(String.raw`^\s*TCP\s+\S+:${Number(port)}\s+\S+\s+LISTENING\s+(\d+)`);
  const m = text.split(/\r?\n/).map((l) => l.match(re)).find(Boolean);
  return m ? Number(m[1]) : null;
}
// `ss -ltnpH` on Linux:  "LISTEN 0 511 0.0.0.0:8080 0.0.0.0:* users:(("node",pid=123,fd=19))"   (IPv6: "[::]:8080")
export function parseSsListener(text, port) {
  for (const line of text.split('\n')) {
    const cols = line.trim().split(/\s+/);
    if (cols[0] !== 'LISTEN' || !(cols[3] || '').endsWith(':' + Number(port))) continue;
    const m = line.match(/pid=(\d+)/);
    if (m) return Number(m[1]);
  }
  return null;
}
// `lsof -nP -iTCP:PORT -sTCP:LISTEN -t` prints bare PIDs
export function parseLsofPids(text) {
  const m = text.split('\n').map((l) => l.trim()).find((l) => /^\d+$/.test(l));
  return m ? Number(m) : null;
}
// /proc/<pid>/stat: "123 (name with ) and spaces) S 1 123 ... starttime(field 22) ..."
export function parseProcStatStart(text) {
  const rest = text.slice(text.lastIndexOf(')') + 2).split(' '); // rest[0] is field 3 (state)
  return rest[19] || null;                                      // field 22 = starttime in clock ticks since boot
}

// ---------- Windows
export const windowsDriver = {
  name: 'windows',
  // Output goes to the log via shell redirection (cmd handles it), NOT via inherited file handles: handles passed to
  // a detached child on Windows silently capture nothing, and a pipe would tie the app's life to the supervisor.
  // Not `detached` (that loses the redirected output); windowsHide gives the app its own hidden console.
  spawnApp({ cmd, cwd, env, logPath }) {
    const child = spawn(`${cmd} >> "${logPath}" 2>&1`, { cwd, env, shell: true, windowsHide: true, stdio: 'ignore' });
    child.unref();
    return child;
  },
  startTime(pid) {
    try {
      return execFileSync('powershell', ['-NoProfile', '-Command',
        `(Get-Process -Id ${Number(pid)} -ErrorAction Stop).StartTime.ToFileTimeUtc()`], quiet).trim();
    } catch { return null; }
  },
  listenerPid(port) {
    try { return parseNetstatListener(execFileSync('netstat', ['-ano', '-p', 'tcp'], quiet), port); } catch { return null; }
  },
  async killTree(pid) {
    try { execFileSync('taskkill', ['/PID', String(Number(pid)), '/T', '/F'], { stdio: 'ignore' }); return true; } catch { return false; }
  },
};

// ---------- POSIX (Linux, macOS)
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
export const posixDriver = {
  name: 'posix',
  // detached = own process group, so the whole app (shell + children) can be stopped together
  spawnApp({ cmd, cwd, env, logPath }) {
    const child = spawn('sh', ['-c', `${cmd} >> "${logPath}" 2>&1`], { cwd, env, detached: true, stdio: 'ignore' });
    child.unref();
    return child;
  },
  startTime(pid) {
    try { return parseProcStatStart(readFileSync(`/proc/${Number(pid)}/stat`, 'utf8')); } catch { /* no /proc (macOS) */ }
    try { return execFileSync('ps', ['-o', 'lstart=', '-p', String(Number(pid))], quiet).trim() || null; } catch { return null; }
  },
  listenerPid(port) {
    try { const p = parseSsListener(execFileSync('ss', ['-ltnpH'], quiet), port); if (p) return p; } catch { /* ss not installed */ }
    try { return parseLsofPids(execFileSync('lsof', ['-nP', `-iTCP:${Number(port)}`, '-sTCP:LISTEN', '-t'], quiet)); } catch { return null; }
  },
  async killTree(pid) {
    pid = Number(pid);
    const signal = (sig) => { try { process.kill(-pid, sig); return true; } catch { try { process.kill(pid, sig); return true; } catch { return false; } } }; // group first, else the process
    if (!signal('SIGTERM')) return !alive(pid);
    for (let i = 0; i < 50; i++) { await sleep(100); if (!alive(pid)) return true; } // up to 5 s to exit cleanly
    signal('SIGKILL'); await sleep(300);
    return !alive(pid);
  },
};

export function getDriver(name = process.env.PD_DRIVER || (process.platform === 'win32' ? 'windows' : 'posix')) {
  if (name === 'windows') return windowsDriver;
  if (name === 'posix') return posixDriver;
  throw new Error(`Unknown PD_DRIVER "${name}". Use windows or posix.`);
}
