import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, expand, loadRegistry } from '../../lib/registry.mjs';
import { appsRoot, root } from '../../lib/config.mjs';

const proc = (o = {}) => ({ name: 'app', cmd: 'x', port: 5000, ...o });
const app = (o = {}) => ({ id: 'a', name: 'A', path: 'p', processes: [proc()], ...o });

test('the real registry loads and is valid', () => {
  const reg = loadRegistry();
  assert.ok(reg.apps.length > 0);
  assert.deepEqual(validate(reg), []);
});

test('placeholders in paths and env values are expanded', () => {
  const out = expand({ path: '${APPS_ROOT}/X', env: { D: '${DASHBOARD_ROOT}/data' }, n: 3 });
  assert.equal(out.path, `${appsRoot}/X`);
  assert.equal(out.env.D, `${root}/data`);
  assert.equal(out.n, 3);
});

test('valid minimal registry has no problems', () => assert.deepEqual(validate({ apps: [app()] }), []));
test('rejects a registry without apps', () => assert.equal(validate({}).length, 1));
test('rejects duplicate app ids', () => {
  assert.match(validate({ apps: [app(), app({ processes: [proc({ port: 5001 })] })] }).join(), /duplicate id/);
});
test('rejects process names that could break out of a log path or shell command', () => {
  for (const name of ['a"b', 'a&b', 'a b', 'a;b', '../x', 'a$(x)']) {
    assert.match(validate({ apps: [app({ processes: [proc({ name })] })] }).join(), /process name may only contain/, name);
  }
  assert.deepEqual(validate({ apps: [app({ processes: [proc({ name: 'web_2-api' })] })] }), []);
});
test('rejects the same port used twice', () => {
  const reg = { apps: [app(), app({ id: 'b' })] };
  assert.match(validate(reg).join(), /port 5000 is used/);
});
test('rejects reserved and out-of-range ports', () => {
  assert.match(validate({ reservedPorts: [5000], apps: [app()] }).join(), /reserved/);
  assert.match(validate({ apps: [app({ processes: [proc({ port: 70000 })] })] }).join(), /1-65535/);
});
test('rejects bad demo wiring', () => {
  assert.match(validate({ apps: [app({ demoReady: true })] }).join(), /demoReady needs demoOf/);
  assert.match(validate({ apps: [app({ demoOf: 'nope' })] }).join(), /does not exist/);
});

test('the real registry never runs `python -m <module>` with the machine\'s bare python (it has none of the app\'s packages)', async () => {
  const { loadRegistry } = await import('../../lib/registry.mjs');
  const bare = loadRegistry().apps.flatMap((a) => a.processes.map((p) => ({ id: `${a.id}/${p.name}`, cmd: String(p.cmd || '') }))).filter((x) => /^python(\.exe)?\s+-m\s/.test(x.cmd));
  assert.deepEqual(bare.map((x) => x.id), [], 'use the app\'s own venv interpreter, e.g. the dashboard folder venv python.exe -m streamlit ...');
});

test('demoApps() has no prototype, so names like constructor and __proto__ are not products (audit F-13)', async () => {
  const { demoApps } = await import('../../lib/registry.mjs');
  const apps = demoApps();
  assert.equal(Object.getPrototypeOf(apps), null);
  for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) assert.equal(apps[name], undefined, name);
  assert.ok(Object.keys(apps).length > 0, 'the real products are still there');
});

test('validate: demoRoutes must name a real process and a sane prefix; empty entries are reported, not thrown on (audit F-16)', async () => {
  const { validate } = await import('../../lib/registry.mjs');
  const app = (extra = {}) => ({ id: 'a', name: 'A', path: '.', processes: [{ name: 'web', cmd: 'x', port: 18001 }, { name: 'admin', cmd: 'x', port: 18002 }], ...extra });
  assert.deepEqual(validate({ apps: [app({ demoRoutes: [{ prefix: '/admin', process: 'admin' }] })] }), []);
  assert.match(validate({ apps: [app({ demoRoutes: [{ prefix: '/admin', process: 'nope' }] })] }).join('\n'), /demoRoutes\[0\] names a process that does not exist/);
  assert.match(validate({ apps: [app({ demoRoutes: [{ prefix: 'admin', process: 'admin' }] })] }).join('\n'), /prefix must start with "\/"/);
  assert.match(validate({ apps: [app({ demoRoutes: [{ prefix: '/admin/', process: 'admin' }] })] }).join('\n'), /not end with one/);
  assert.match(validate({ apps: [app({ demoRoutes: [null] })] }).join('\n'), /demoRoutes\[0\]/);
  assert.match(validate({ apps: [app({ demoRoutes: 'x' })] }).join('\n'), /demoRoutes must be an array/);
  // a stray comma leaves null in the list: the problem is reported like any other
  assert.match(validate({ apps: [app(), null] }).join('\n'), /not an object/);
  assert.match(validate({ apps: [app({ processes: [null, { name: 'web', cmd: 'x', port: 18003 }] })] }).join('\n'), /process entry is not an object/);
  assert.match(validate({ apps: [app(), 'oops', 5] }).join('\n'), /not an object/);
});

test('the real registry still validates, and its demoRoutes all point at real processes (audit F-16)', async () => {
  const { loadRegistry, validate } = await import('../../lib/registry.mjs');
  const reg = loadRegistry();
  assert.deepEqual(validate(reg), []);
  assert.ok(reg.apps.some((a) => a.demoRoutes?.length), 'the registry uses demoRoutes');
});

test('loadRegistry checks the file at most once per REGISTRY_RECHECK_MS, and 0 means every call', async () => {
  const { mkdtempSync, writeFileSync, utimesSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'pd-reg-'));
  const file = join(dir, 'r.json');
  const write = (name, secs) => { writeFileSync(file, JSON.stringify({ apps: [app({ name })] })); utimesSync(file, secs, secs); };
  const saved = process.env.REGISTRY_RECHECK_MS;
  try {
    process.env.REGISTRY_RECHECK_MS = '60000';
    write('One', 1000);
    assert.equal(loadRegistry(file).apps[0].name, 'One');
    write('Two', 2000);
    assert.equal(loadRegistry(file).apps[0].name, 'One', 'inside the window the file is not even looked at');
    process.env.REGISTRY_RECHECK_MS = '0';
    assert.equal(loadRegistry(file).apps[0].name, 'Two', 'with 0 every call sees the edit, as before');
    write('Bad', 3000); writeFileSync(file, '{ not json'); utimesSync(file, 3000, 3000);
    assert.throws(() => loadRegistry(file));
  } finally {
    if (saved === undefined) delete process.env.REGISTRY_RECHECK_MS; else process.env.REGISTRY_RECHECK_MS = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});
