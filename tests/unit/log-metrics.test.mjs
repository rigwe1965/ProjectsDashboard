import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMetrics } from '../../lib/metrics.mjs';
import { log } from '../../lib/log.mjs';

test('metrics: counters with labels, gauges, escaping, stable text format', () => {
  const m = createMetrics();
  m.describe('hits_total', 'Hits');
  m.inc('hits_total', { code: '2xx' }); m.inc('hits_total', { code: '2xx' }, 2); m.inc('hits_total', { code: '5xx' });
  m.inc('plain_total');
  m.gauge('open', () => 7);
  assert.equal(m.get('hits_total', { code: '2xx' }), 3);
  assert.equal(m.get('hits_total', { code: '4xx' }), 0);
  const text = m.render();
  assert.match(text, /# HELP hits_total Hits\n# TYPE hits_total counter\nhits_total\{code="2xx"\} 3\nhits_total\{code="5xx"\} 1/);
  assert.match(text, /\nplain_total 1\n/);
  assert.match(text, /# TYPE open gauge\nopen 7\n/);
  m.inc('x_total', { v: 'a"b\nc' });
  assert.doesNotMatch(m.render(), /a"b/, 'quotes and newlines in label values are neutralised');
});

function capture(fn, env) {
  const out = [], err = [];
  const so = process.stdout.write, se = process.stderr.write, old = { ...process.env };
  Object.assign(process.env, env);
  process.stdout.write = (s) => { out.push(String(s)); return true; };
  process.stderr.write = (s) => { err.push(String(s)); return true; };
  try { fn(); } finally { process.stdout.write = so; process.stderr.write = se; for (const k of Object.keys(env)) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } }
  return { out: out.join(''), err: err.join('') };
}

test('log: json lines with fields, errors reduced to message+stack, level filter, warnings to stderr', () => {
  const r = capture(() => { log('info', 'hello', { port: 1, err: new Error('boom') }); log('debug', 'hidden'); log('warn', 'careful'); }, { LOG_FORMAT: 'json', LOG_LEVEL: 'info' });
  const line = JSON.parse(r.out.trim());
  assert.equal(line.level, 'info'); assert.equal(line.msg, 'hello'); assert.equal(line.port, 1);
  assert.equal(line.err.message, 'boom'); assert.match(line.err.stack, /boom/);
  assert.ok(!r.out.includes('hidden'));
  assert.equal(JSON.parse(r.err.trim()).msg, 'careful');
});

test('log: text format is one readable line', () => {
  const r = capture(() => log('info', 'started', { port: 4300, host: 'x' }), { LOG_FORMAT: 'text' });
  assert.match(r.out, /^\S+ INFO {2}started port=4300 host=x\n$/);
});

test('the gateway and the console keep a fatal error\'s exit code through their graceful shutdown (audit F-10)', async () => {
  const { readFileSync } = await import('node:fs');
  // Both services run `process.exitCode = 1; shutdown()` on a fatal error, and shutdown() ends the process. A plain exit(0) would
  // override the 1 and make a crash look like a clean stop. (A real crash cannot be provoked from outside, so this pins the source.)
  for (const f of ['demo-gateway/server.mjs', 'admin-console/server.mjs']) {
    const src = readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
    assert.match(src, /process\.exitCode = 1; shutdown\(why\)/, f);
    assert.match(src, /process\.exit\(process\.exitCode \?\? 0\)/, f);
    assert.doesNotMatch(src, /process\.exit\(0\)/, f);
  }
});
