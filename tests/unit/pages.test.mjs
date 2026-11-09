// The console pages' inline scripts must at least be valid JavaScript: a syntax error stops the whole script and leaves every
// panel on "Loading…" with no message (this happened once, and no other test loads the page's code).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

for (const f of ['admin-console/index.html', 'admin-console/login.html']) {
  test(`${f}: inline scripts are valid JavaScript`, () => {
    const html = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    assert.ok(scripts.length > 0, 'expected an inline script');
    for (const s of scripts) assert.doesNotThrow(() => new Script(s, { filename: f }));
  });
}
