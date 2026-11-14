// The demo container recipes (deploy/apps/*/Dockerfile) are built on a pinned Node image. Node 25 and later no longer ship corepack,
// so `corepack enable` failed with exit code 127 and the ClaudeWorkspace demo image could not be built (found 2026-11-12 by building
// every image). A unit test cannot build an image, so this keeps the known cause out and checks the images stay pinned.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';

const appsDir = new URL('../../deploy/apps/', import.meta.url);
const recipes = readdirSync(appsDir).filter((d) => existsSync(new URL(`${d}/Dockerfile`, appsDir)))
  .map((d) => [d, readFileSync(new URL(`${d}/Dockerfile`, appsDir), 'utf8')]);
// An app may have a second image (the RMM's dashboard is Dockerfile.ui): it gets the same checks.
const extra = readdirSync(appsDir).flatMap((d) => readdirSync(new URL(`${d}/`, appsDir)).filter((f) => /^Dockerfile\.[a-z]+$/.test(f)).map((f) => [`${d}/${f}`, readFileSync(new URL(`${d}/${f}`, appsDir), 'utf8')]));

test('there is a recipe for each demo product', () => {
  assert.deepEqual(recipes.map(([d]) => d).sort(), ['airfinder', 'claudeos', 'claudeworkspace', 'crm', 'imageapp', 'rmm']);
});

for (const [name, text] of [...recipes, ...extra]) {
  const instructions = text.split(/\r?\n/).filter((l) => !l.trim().startsWith('#'));
  test(`${name}: no instruction relies on corepack (the pinned Node image does not ship it)`, () => {
    const bad = instructions.filter((l) => /\bcorepack\b/.test(l));
    assert.deepEqual(bad, [], 'install the package manager with npm instead');
  });
  test(`${name}: every base image is pinned by digest`, () => {
    for (const l of instructions.filter((x) => /^\s*FROM\s/i.test(x))) assert.match(l, /@sha256:[0-9a-f]{64}/, `unpinned: ${l}`);
  });
}

// Demo-only patches applied inside the images. Each stops the build when the line it changes has moved, so these tests check the
// patch is still written and still matches what the app's source really contains (the apps are siblings of this repo).
const read = (p) => readFileSync(new URL(p, appsDir), 'utf8');
test('claudeos: worker-thread fetches and the shared rate limit are patched, and the patch targets exist in the app', () => {
  const docker = read('claudeos/Dockerfile');
  assert.match(docker, /pd_seq_executor/);
  assert.match(docker, /"50000\/day", "5000\/hour"/);
  const appRoot = new URL('../../../ClaudeOS/', appsDir);
  if (!existsSync(new URL('dashboard/_pages/_overview.py', appRoot))) return; // ClaudeOS checkout not next to this repo (CI)
  for (const f of ['_overview', '_projects', '_tickets']) assert.match(readFileSync(new URL(`dashboard/_pages/${f}.py`, appRoot), 'utf8'), /^from concurrent\.futures import ThreadPoolExecutor, as_completed$/m, f);
  assert.equal((readFileSync(new URL('core/api/limiter.py', appRoot), 'utf8').match(/"500\/day", "100\/hour"/g) || []).length, 3);
});
test('claudeworkspace: the vehicle-photo host is added to both apps\' img-src, and the patch target exists in the app', () => {
  assert.match(read('claudeworkspace/Dockerfile'), /upload\.wikimedia\.org/);
  const appRoot = new URL('../../../ClaudeWorkspace/reci-transport/', appsDir);
  if (!existsSync(new URL('apps/web/middleware.ts', appRoot))) return;
  for (const a of ['web', 'admin']) assert.ok(readFileSync(new URL(`apps/${a}/middleware.ts`, appRoot), 'utf8').includes('https://images.unsplash.com"'), a);
});
