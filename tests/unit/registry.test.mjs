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
