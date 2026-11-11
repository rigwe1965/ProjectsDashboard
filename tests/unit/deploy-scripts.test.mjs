// The shell scripts of the hosted setup (audit F-19). They run on Linux in CI; where there is no usable `sh` the tests are skipped.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readdirSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'pd-dep-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const script = (n) => fileURLToPath(new URL('../../deploy/' + n, import.meta.url));
const hasSh = spawnSync('sh', ['-c', 'echo ok'], { encoding: 'utf8' }).stdout?.trim() === 'ok';
const opts = { skip: !hasSh && 'no sh on this machine' };

function stub(name, body) { const f = join(dir, name); writeFileSync(f, '#!/bin/sh\n' + body + '\n'); chmodSync(f, 0o755); }
const run = (args, env) => spawnSync('sh', [script('db-backup.sh'), ...args], { encoding: 'utf8', timeout: 30000, env: { ...process.env, PATH: dir + delimiter + process.env.PATH, ...env } });

test('db-backup.sh --once writes a complete backup under its final name, and keeps only the newest ones', opts, () => {
  stub('pg_dump', 'echo "dump-$$-$(date +%N)"');
  const out = join(dir, 'ok'); 
  for (let i = 0; i < 4; i++) { const r = run(['--once'], { BACKUP_DIR: out, BACKUP_KEEP: '2' }); assert.equal(r.status, 0, r.stderr); spawnSync('sh', ['-c', 'sleep 1.1']); }
  const files = readdirSync(out);
  assert.equal(files.length, 2, 'only the newest two are kept: ' + files);
  assert.ok(files.every((f) => /^dashboard-\d{8}-\d{6}\.dump$/.test(f)), 'and none is a half-written .part file');
});

test('db-backup.sh: a failed dump leaves no file that looks like a backup, and reports failure', opts, () => {
  stub('pg_dump', 'echo partial; exit 1');
  const out = join(dir, 'fail');
  const r = run(['--once'], { BACKUP_DIR: out });
  assert.equal(r.status, 1); assert.match(r.stderr, /backup FAILED/);
  assert.deepEqual(existsSync(out) ? readdirSync(out) : [], []);
  stub('pg_dump', 'exit 0'); // succeeds but writes nothing: also not a backup
  assert.equal(run(['--once'], { BACKUP_DIR: out }).status, 1);
  assert.deepEqual(readdirSync(out), []);
});

test('the deploy shell scripts parse (sh -n)', opts, () => {
  for (const f of ['db-backup.sh', 'reset-demos.sh']) { const r = spawnSync('sh', ['-n', script(f)], { encoding: 'utf8' }); assert.equal(r.status, 0, f + ': ' + r.stderr); }
});
