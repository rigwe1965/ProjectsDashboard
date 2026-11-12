// The demo container recipes (deploy/apps/*/Dockerfile) are built on a pinned Node image. Node 25 and later no longer ship corepack,
// so `corepack enable` failed with exit code 127 and the ClaudeWorkspace demo image could not be built (found 2026-11-12 by building
// every image). A unit test cannot build an image, so this keeps the known cause out and checks the images stay pinned.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';

const appsDir = new URL('../../deploy/apps/', import.meta.url);
const recipes = readdirSync(appsDir).filter((d) => existsSync(new URL(`${d}/Dockerfile`, appsDir)))
  .map((d) => [d, readFileSync(new URL(`${d}/Dockerfile`, appsDir), 'utf8')]);

test('there is a recipe for each demo product', () => {
  assert.deepEqual(recipes.map(([d]) => d).sort(), ['airfinder', 'claudeworkspace', 'crm', 'imageapp']);
});

for (const [name, text] of recipes) {
  const instructions = text.split(/\r?\n/).filter((l) => !l.trim().startsWith('#'));
  test(`${name}: no instruction relies on corepack (the pinned Node image does not ship it)`, () => {
    const bad = instructions.filter((l) => /\bcorepack\b/.test(l));
    assert.deepEqual(bad, [], 'install the package manager with npm instead');
  });
  test(`${name}: every base image is pinned by digest`, () => {
    for (const l of instructions.filter((x) => /^\s*FROM\s/i.test(x))) assert.match(l, /@sha256:[0-9a-f]{64}/, `unpinned: ${l}`);
  });
}
