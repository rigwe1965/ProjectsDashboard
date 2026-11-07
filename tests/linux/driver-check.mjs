// Linux self-test for the supervisor, run INSIDE the dashboard image (needs ss, ps, sh, process groups):
//   docker run --rm --entrypoint node projects-dashboard tests/linux/driver-check.mjs
// It checks the POSIX driver directly, then runs the real supervisor CLI start -> status -> stop against a tiny app.
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { posixDriver } from '../../lib/process-driver.mjs';
import { httpUp, portInUse } from '../../lib/http-util.mjs';

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`); };
const waitUp = async (port, ms = 15000) => { for (let t = 0; t < ms; t += 250) { if (await httpUp(port, '/')) return true; await sleep(250); } return false; };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

const dir = mkdtempSync(join(tmpdir(), 'pd-linux-'));
const server = `node -e "require('http').createServer((q,r)=>r.end('hello')).listen(PORT,'127.0.0.1',()=>console.log('listening PORT'))"`;

// ---- 1. the driver on its own
const PORT = 18999, logPath = join(dir, 'app.log');
const child = posixDriver.spawnApp({ cmd: server.replaceAll('PORT', PORT), cwd: dir, env: { ...process.env }, logPath });
check('spawnApp starts an app that answers HTTP', await waitUp(PORT));
const st = posixDriver.startTime(child.pid);
check('startTime returns a stable identifier for a live pid', !!st && st === posixDriver.startTime(child.pid), String(st));
check('startTime is null for a pid that does not exist', posixDriver.startTime(99999999) === null);
const lp = posixDriver.listenerPid(PORT);
check('listenerPid finds the process listening on the port', !!lp && alive(lp), String(lp));
check('listenerPid is null for a port nobody listens on', posixDriver.listenerPid(18998) === null);
await sleep(300);
check('output was redirected to the log file', readFileSync(logPath, 'utf8').includes(`listening ${PORT}`));
const gone = await posixDriver.killTree(child.pid);
await sleep(300);
check('killTree stops the whole app and the port is free', gone && !(await portInUse(PORT)) && !alive(lp), `gone=${gone}`);
check('killTree on an already-dead pid reports it is gone', (await posixDriver.killTree(99999999)) === true);

// ---- 2. the real supervisor CLI, with a temporary registry and data folder
writeFileSync(join(dir, 'registry.json'), JSON.stringify({ apps: [{ id: 'toy', name: 'Toy', path: dir,
  processes: [{ name: 'app', cmd: server.replaceAll('PORT', '18997'), port: 18997, health: '/' }] }] }));
const env = { ...process.env, DASHBOARD_REGISTRY: join(dir, 'registry.json'), DASHBOARD_DATA: join(dir, 'data'), PD_DRIVER: 'posix' };
const sup = (...a) => execFileSync(process.execPath, ['supervisor/index.mjs', ...a], { env, encoding: 'utf8' });
check('supervisor start brings the app UP', /UP/.test(sup('start', 'toy')));
const row = JSON.parse(sup('status', '--json'))[0];
check('status reports it up and managed', row.up === true && row.managed === true, JSON.stringify(row));
check('app serves requests', await httpUp(18997, '/'));
check('stop reports success', /Stopped toy\/app/.test(sup('stop', 'toy')));
await sleep(500);
const after = JSON.parse(sup('status', '--json'))[0];
check('afterwards it is down and no longer managed', after.up === false && after.managed === false, JSON.stringify(after));
check('the port is free again', !(await portInUse(18997)));
check('app output was captured in data/logs', existsSync(join(dir, 'data', 'logs', 'toy-app.log')));

rmSync(dir, { recursive: true, force: true });
const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} check(s) FAILED` : `\nall ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
