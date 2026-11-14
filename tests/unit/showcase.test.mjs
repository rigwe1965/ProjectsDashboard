// The local showcase preview must survive malformed requests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { freePort } from '../helpers.mjs';

const get = (port, path) => new Promise((resolve) => {
  const r = http.request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
  r.on('error', () => resolve(0)); r.end();
});

test('showcase server: a malformed URL gets 400 and the server keeps running', async () => {
  const port = await freePort();
  const child = spawn(process.execPath, [fileURLToPath(new URL('../../showcase/serve.mjs', import.meta.url))], { env: { ...process.env, SHOWCASE_PORT: String(port) }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 30 && !(await get(port, '/x')); i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(await get(port, '/%E0%A4%A'), 400);
    assert.equal(await get(port, '/nope.html'), 404);
    assert.equal(await get(port, '/../package.json'), 404);
  } finally { child.kill(); }
});

test('showcase caching: the stylesheet is named by its content hash and cached for a year; pages are always re-checked', async () => {
  execFileSync(process.execPath, [fileURLToPath(new URL('../../showcase/build.mjs', import.meta.url))], { stdio: 'ignore' });
  const port = await freePort();
  const child = spawn(process.execPath, [fileURLToPath(new URL('../../showcase/serve.mjs', import.meta.url))], { env: { ...process.env, SHOWCASE_PORT: String(port) }, stdio: 'ignore' });
  const fetchFull = (path) => new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => { let b = ''; res.setEncoding('utf8'); res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b })); });
    r.on('error', () => resolve({ status: 0, headers: {}, body: '' })); r.end();
  });
  try {
    for (let i = 0; i < 30 && !(await get(port, '/x')); i++) await new Promise((r) => setTimeout(r, 100));
    for (const page of ['/', '/crm/']) {
      const html = await fetchFull(page);
      assert.equal(html.status, 200);
      assert.equal(html.headers['cache-control'], 'no-cache', 'a page is checked every time');
      const name = html.body.match(/href="(?:\.\.\/|\/)?(style\.[0-9a-f]{10}\.css)"/)?.[1];
      assert.ok(name, `${page} links a hashed stylesheet`);
      const css = await fetchFull('/' + name);
      assert.equal(css.status, 200);
      assert.equal(css.headers['cache-control'], 'public, max-age=31536000, immutable');
      assert.match(css.headers['content-type'], /text\/css/);
      assert.equal(name, `style.${createHash('sha256').update(css.body).digest('hex').slice(0, 10)}.css`, 'the name is the hash of the content');
    }
    assert.equal(await get(port, '/style.css'), 404, 'there is no unhashed stylesheet to go stale');
  } finally { child.kill(); }
});

test('the Security page is built from security.json: plain HTML with no scripts, linked from every page, with the contact address and the honest "not yet" note', () => {
  execFileSync(process.execPath, [fileURLToPath(new URL('../../showcase/build.mjs', import.meta.url))], { stdio: 'ignore' });
  const dist = fileURLToPath(new URL('../../showcase/dist/', import.meta.url));
  const read = (p) => readFileSync(dist + p, 'utf8');
  const page = read('security/index.html');
  assert.match(page, /<title>Security \| /); assert.match(page, /How we keep your demo safe/);
  assert.doesNotMatch(page, /<script|onclick=|javascript:/i);
  assert.match(page, /We have not had an independent penetration test/);
  assert.match(page, /mailto:[^"]+\?subject=Security%20question/);
  assert.match(page, /Last reviewed \d{4}-\d\d-\d\d/);
  const sec = JSON.parse(readFileSync(fileURLToPath(new URL('../../showcase/security.json', import.meta.url)), 'utf8'));
  for (const i of sec.sections.flatMap((s) => s.items)) assert.ok(page.includes(i.label.replaceAll("'", '&#39;')), 'shown: ' + i.label);
  assert.doesNotMatch(page, /demo-gateway\/|\.mjs/, 'the internal source names are not published');
  for (const [p, href] of [['index.html', 'security/index.html'], ['crm/index.html', '../security/index.html'], ['security/index.html', '../security/index.html']]) assert.ok(read(p).includes(`href="${href}"`), `${p} links to Security`);
});

test('showcase build: favicon, robots.txt and a sitemap that lists every page (and no demo hostnames)', () => {
  execFileSync(process.execPath, [fileURLToPath(new URL('../../showcase/build.mjs', import.meta.url))], { stdio: 'ignore' });
  const dist = fileURLToPath(new URL('../../showcase/dist/', import.meta.url));
  const read = (p) => readFileSync(dist + p, 'utf8');
  const site = JSON.parse(readFileSync(fileURLToPath(new URL('../../showcase/site.json', import.meta.url)), 'utf8'));
  assert.match(read('favicon.svg'), /^<svg /, 'the favicon is an SVG');
  assert.match(read('index.html'), /<link rel="icon" href="favicon\.svg"/);
  assert.match(read('crm/index.html'), /<link rel="icon" href="\.\.\/favicon\.svg"/, 'product pages point one level up');
  assert.match(read('robots.txt'), /^User-agent: \*\nAllow: \//);
  const base = site.siteUrl.replace(/\/+$/, '');
  const map = read('sitemap.xml');
  assert.ok(read('robots.txt').includes(`Sitemap: ${base}/sitemap.xml`), 'robots.txt points at the sitemap');
  for (const p of ['/', '/crm/', '/security/']) assert.ok(map.includes(`<loc>${base}${p}</loc>`), `sitemap lists ${p}`);
  assert.doesNotMatch(map, /\.demo\./, 'demo hostnames are not listed');
});
