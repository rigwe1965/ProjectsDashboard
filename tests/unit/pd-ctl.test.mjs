// deploy/ctl/pd-ctl.py: the host helper allows only registered demo containers and four verbs. docker itself is replaced by a recorder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const py = ['python3', 'python'].find((c) => spawnSync(c, ['--version']).status === 0);
const script = fileURLToPath(new URL('../../deploy/ctl/pd-ctl.py', import.meta.url)).replaceAll(String.fromCharCode(92), '/');

test('pd-ctl allowlist, verbs and argument handling', { skip: py ? false : 'python not installed' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'pd-ctl-'));
  try {
    const reg = join(dir, 'r.json').replaceAll(String.fromCharCode(92), '/');
    writeFileSync(reg, JSON.stringify({ apps: [
      { id: 'a', processes: [{ name: 'app', container: 'pd-a-demo' }] },
      { id: 'h', hidden: true, processes: [{ name: 'app', container: 'pd-hidden' }] },
    ] }));
    const code = `
import importlib.util, json
spec = importlib.util.spec_from_file_location('ctl', ${JSON.stringify(script)}); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
calls = []
m.run_docker = lambda args, timeout: (calls.append(args) or (True, 'done'))
R = ${JSON.stringify(reg)}
out = {
  'ok_restart': m.handle('restart', {'container': 'pd-a-demo'}, R),
  'ok_logs': m.handle('logs', {'container': 'pd-a-demo', 'lines': 99999}, R),
  'hidden': m.handle('restart', {'container': 'pd-hidden'}, R)[0],
  'caddy': m.handle('stop', {'container': 'projects-dashboard-caddy-1'}, R)[0],
  'badname': m.handle('stop', {'container': '--privileged; rm'}, R)[0],
  'nameless': m.handle('stop', {}, R)[0],
  'badverb': m.handle('rm', {'container': 'pd-a-demo'}, R)[0],
  'calls': calls,
}
print(json.dumps(out))`;
    const r = spawnSync(py, ['-I', '-c', code], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const o = JSON.parse(r.stdout);
    assert.equal(o.ok_restart[0], 200);
    assert.equal(o.hidden, 403); assert.equal(o.caddy, 403); assert.equal(o.badname, 400); assert.equal(o.nameless, 400); assert.equal(o.badverb, 404);
    assert.deepEqual(o.calls[0], ['restart', '-t', '10', 'pd-a-demo']);
    assert.deepEqual(o.calls[1], ['logs', '--tail', '200', 'pd-a-demo'], 'an out-of-range line count falls back to the default');
    assert.equal(o.calls.length, 2, 'refused requests never reach docker');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
