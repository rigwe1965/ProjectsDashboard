// Run an app as an existing container instead of a host process: the registry process entry says
// "container": "<name>" and the supervisor starts/stops that container with the docker CLI.
// The container is created beforehand (docker compose up --no-start, see deploy/); the supervisor never builds or
// deletes images, volumes or containers. Only the container name is passed to docker, as an argument, never to a shell.
import { execFile } from 'node:child_process';

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
