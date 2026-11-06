// Static site generator: reads site.json + products.json, writes showcase/dist/.
// Output is plain HTML/CSS with no scripts and no links to any running app.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const site = JSON.parse(readFileSync(join(here, 'site.json'), 'utf8'));
const products = JSON.parse(readFileSync(join(here, 'products.json'), 'utf8')).products.filter((p) => p.published);
const dist = join(here, 'dist');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mail = (subject) => (site.contactEmail ? `mailto:${esc(site.contactEmail)}?subject=${encodeURIComponent(subject)}` : null);

const css = `
:root{--bg:#fafaf8;--card:#fff;--ink:#1b1b19;--mute:#64635e;--line:#e6e4de;--accent:#2b4acb}
@media (prefers-color-scheme:dark){:root{--bg:#121211;--card:#1c1c1a;--ink:#efede8;--mute:#a09d95;--line:#33322e}}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:inherit}
.wrap{max-width:1040px;margin:0 auto;padding:0 20px}
nav{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px 20px;padding:18px 0}
nav .brand{font-weight:700;text-decoration:none;letter-spacing:-.01em}
nav .links{display:flex;flex-wrap:wrap;gap:4px 18px;font-size:15px;color:var(--mute)}
nav .links a{text-decoration:none}nav .links a:hover{color:var(--accent)}
.hero{padding:56px 0 40px}
.hero h1{font-size:clamp(34px,6vw,56px);line-height:1.08;letter-spacing:-.03em;margin:0 0 16px;max-width:16ch}
.hero p{font-size:19px;color:var(--mute);max-width:56ch;margin:0 0 26px}
.btn{display:inline-block;background:var(--accent);color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600;font-size:16px}
.btn.alt{background:transparent;color:var(--ink);border:1px solid var(--line);margin-left:8px}
.btn:hover{filter:brightness(1.08)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;padding-bottom:56px}
.card{background:var(--card);border:1px solid var(--line);border-top:4px solid var(--accent);border-radius:12px;padding:22px;text-decoration:none;display:flex;flex-direction:column;gap:6px}
.card:hover{border-color:var(--accent)}
.card h3{margin:0;font-size:20px}.card p{margin:0;color:var(--mute);font-size:15px}
.card .more{margin-top:8px;color:var(--accent);font-weight:600;font-size:15px}
h2{font-size:28px;letter-spacing:-.02em;margin:48px 0 18px}
.features{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:14px}
.feat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px}
.feat h3{margin:0 0 4px;font-size:17px}.feat p{margin:0;color:var(--mute);font-size:15px}
.panel{background:var(--accent);color:#fff;border-radius:16px;padding:40px 28px;margin:40px 0}
.panel h2{margin:0 0 8px}.panel p{margin:0 0 20px;opacity:.9}
.panel .btn{background:#fff;color:#111}
ul.ticks{list-style:none;padding:0;margin:0;display:grid;gap:8px}
ul.ticks li:before{content:"\\2713";color:var(--accent);font-weight:700;margin-right:10px}
.who{color:var(--mute)}
footer{border-top:1px solid var(--line);padding:26px 0 40px;color:var(--mute);font-size:14px;margin-top:40px}
#contact{scroll-margin-top:20px}
`;

const shell = (title, desc, accent, body, root) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">
<link rel="stylesheet" href="${root}style.css"><style>:root{--accent:${esc(accent)}}</style></head>
<body><div class="wrap">
<nav><a class="brand" href="${root}index.html">${esc(site.brand)}</a><div class="links">${products.map((p) => `<a href="${root}${p.id}/index.html">${esc(p.name)}</a>`).join('')}</div></nav>
${body}
<footer>&copy; ${new Date().getFullYear()} ${esc(site.brand)}. Each product is a separate application.</footer>
</div></body></html>`;

const demoLink = (subject) => mail(subject) || '#contact';
const contactBlock = () => `<section id="contact"><h2>Get in touch</h2><p class="who">${site.contactEmail ? `Email <a href="mailto:${esc(site.contactEmail)}">${esc(site.contactEmail)}</a> and tell us which product you're interested in.` : 'Contact details coming soon.'}</p></section>`;

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
writeFileSync(join(dist, 'style.css'), css);

writeFileSync(join(dist, 'index.html'), shell(`${site.brand}: ${site.tagline}`, site.intro, '#2b4acb', `
<header class="hero"><h1>${esc(site.tagline)}</h1><p>${esc(site.intro)}</p><a class="btn" href="#products">See the products</a></header>
<section id="products"><div class="grid">${products.map((p) => `
<a class="card" style="--accent:${esc(p.accent)}" href="${p.id}/index.html"><h3>${esc(p.name)}</h3><p>${esc(p.summary)}</p><span class="more">Learn more &rarr;</span></a>`).join('')}</div></section>
${contactBlock()}`, ''));

for (const p of products) {
  mkdirSync(join(dist, p.id), { recursive: true });
  writeFileSync(join(dist, p.id, 'index.html'), shell(`${p.name} | ${site.brand}`, p.summary, p.accent, `
<header class="hero"><h1>${esc(p.headline)}</h1><p>${esc(p.summary)}</p><a class="btn" href="${demoLink(`Demo request: ${p.name}`)}">Request a demo</a><a class="btn alt" href="#features">See features</a></header>
<section><h2>Who it's for</h2><p class="who">${esc(p.audience)}</p></section>
<section id="features"><h2>What you get</h2><div class="features">${p.features.map(([t, d]) => `<div class="feat"><h3>${esc(t)}</h3><p>${esc(d)}</p></div>`).join('')}</div></section>
<section><h2>Why teams choose it</h2><ul class="ticks">${p.benefits.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></section>
<section class="panel"><h2>See ${esc(p.name)} in action</h2><p>We'll set up a private demo with sample data, so you can explore it without any risk.</p><a class="btn" href="${demoLink(`Demo request: ${p.name}`)}">Request a demo</a></section>
${contactBlock()}`, '../'));
}
console.log(`Built ${products.length + 1} pages into ${dist}`);
