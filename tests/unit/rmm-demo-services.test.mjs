// supervisor/demo-fixes/rmm_demo_services.py is shared by the RMM demo API starter and the RMM demo reset (audit D-13).
// It is tested here with Docker, sockets and sleeping replaced, so no container is needed. Skipped when there is no Python.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const folder = dirname(fileURLToPath(new URL('../../supervisor/demo-fixes/rmm_demo_services.py', import.meta.url)));
const python = ['python', 'python3'].find((p) => spawnSync(p, ['--version'], { stdio: 'ignore' }).status === 0);
const py = (code) => spawnSync(python, ['-I', '-c', `import sys; sys.path.insert(0, ${JSON.stringify(folder)})\n${code}`], { encoding: 'utf8' });
const skip = python ? false : 'no python on this machine';

test('require_demo_database: only the demo database passes', { skip }, () => {
  const ok = py('import rmm_demo_services as s; s.require_demo_database("postgresql://u:p@127.0.0.1:5433/rmm_demo"); print("passed")');
  assert.equal(ok.status, 0, ok.stderr); assert.match(ok.stdout, /passed/);
  for (const url of ['', 'postgresql://u:p@127.0.0.1:5432/rmm_demo', 'postgresql://u:p@db.example.com:5433/rmm_demo', 'postgresql://u:p@127.0.0.1:5433/rmm_prod']) {
    const bad = py(`import rmm_demo_services as s; s.require_demo_database(${JSON.stringify(url)})`);
    assert.notEqual(bad.status, 0, url); assert.match(bad.stderr, /Refusing: DATABASE_URL is not the demo database\./);
  }
});

test('ensure_demo_services: starts both containers, waits for both ports, then pauses', { skip }, () => {
  const r = py(`
import rmm_demo_services as s
calls, tried, slept = [], [], []
class Done:
    def close(self): pass
s.subprocess.run = lambda args, **kw: calls.append(args)
def connect(addr, timeout):
    tried.append(addr[1])
    if addr[1] == 5433 and tried.count(5433) < 3: raise OSError()   # the first two tries fail
    return Done()
s.socket.create_connection = connect
s.time.sleep = lambda n: slept.append(n)
s.ensure_demo_services()
print(calls); print(tried); print(slept)`);
  assert.equal(r.status, 0, r.stderr);
  const [calls, tried, slept] = r.stdout.trim().split(/\r?\n/);
  assert.equal(calls, "[['docker', 'start', 'pd-rmm-demo-pg'], ['docker', 'start', 'pd-rmm-demo-redis']]");
  assert.equal(tried, '[5433, 5433, 5433, 6380]');
  assert.equal(slept, '[1, 1, 2]', 'one second between tries, two seconds at the end');
});

test('ensure_demo_services: a port that never opens stops with a message naming the port and Docker', { skip }, () => {
  const r = py(`
import rmm_demo_services as s
s.subprocess.run = lambda *a, **k: None
s.time.sleep = lambda n: None
def refuse(addr, timeout): raise OSError()
s.socket.create_connection = refuse
s.ensure_demo_services()`);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Port 5433 did not come up\. Docker Desktop must be running/);
});
