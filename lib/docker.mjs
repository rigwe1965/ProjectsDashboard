// Run an app as an existing container instead of a host process: the registry process entry says
// "container": "<name>" and the supervisor starts/stops that container with the docker CLI.
// The container is created beforehand (docker compose up --no-start, see deploy/); the supervisor never builds or
// deletes images, volumes or containers. Only the container name is passed to docker, as an argument, never to a shell.
import { execFile, spawn } from 'node:child_process';
import { join } from 'node:path';

export const validContainerName = (n) => typeof n === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(n);

function docker(args, timeout = 60000) {
  return new Promise((resolve, reject) => {
    execFile('docker', args, { encoding: 'utf8', timeout, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim().split('\n').slice(-1)[0] || 'docker failed')); else resolve(stdout.trim());
    });
  });
}
const need = (name) => { if (!validContainerName(name)) throw new Error(`Invalid container name: ${name}`); };

export async function containerRunning(name) {
  need(name);
  try { return (await docker(['inspect', '-f', '{{.State.Running}}', name], 10000)) === 'true'; } catch { return false; }
}
export async function startContainer(name) { need(name); await docker(['start', name]); }
export async function stopContainer(name) { need(name); await docker(['stop', '-t', '10', name], 30000); }

// True when the Docker engine answers (the CLI alone being installed is not enough: Docker Desktop must be running).
export async function engineUp(run = docker) {
  try { await run(['info', '--format', '{{.ServerVersion}}'], 8000); return true; } catch { return false; }
}

// Some demos keep their database in Docker containers (registry "requiresDocker": true). Make sure the engine is running before
// they start: if it is not, start Docker Desktop (Windows and macOS) and wait for it. A cold start takes a minute or two, so the
// wait is longer than the 60 s an app is given to answer. Returns { ok, started, message }. All OS and time access is injectable.
export async function ensureEngine({ timeoutMs = 180000, intervalMs = 3000, up = engineUp, launch = launchDockerDesktop, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now, log = () => {} } = {}) {
  if (await up()) return { ok: true, started: false };
  log('Docker is not running. Starting Docker Desktop (this can take a couple of minutes)...');
  const how = launch();
  if (!how.ok) return { ok: false, started: false, message: how.message };
  const end = now() + timeoutMs;
  while (now() < end) {
    await sleep(intervalMs);
    if (await up()) return { ok: true, started: true };
  }
  return { ok: false, started: true, message: `Docker did not start within ${Math.round(timeoutMs / 1000)} s. Start Docker Desktop yourself and try again.` };
}

export function launchDockerDesktop(platform = process.platform, env = process.env) {
  try {
    if (platform === 'win32') {
      const exe = join(env.ProgramFiles || 'C:/Program Files', 'Docker', 'Docker', 'Docker Desktop.exe');
      spawn(exe, [], { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref();
      return { ok: true };
    }
    if (platform === 'darwin') { spawn('open', ['-a', 'Docker'], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref(); return { ok: true }; }
  } catch { /* fall through */ }
  return { ok: false, message: 'Docker is not running and cannot be started from here. Start the Docker service, then try again.' };
}
