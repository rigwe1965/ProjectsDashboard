// Static site generator: reads site.json + products.json, writes showcase/dist/.
// Output is plain HTML/CSS (inline SVG, no scripts) and has no links to any running app.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const site = JSON.parse(readFileSync(join(here, 'site.json'), 'utf8'));
const products = JSON.parse(readFileSync(join(here, 'products.json'), 'utf8')).products.filter((p) => p.published);
const dist = join(here, 'dist');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mail = (subject) => (site.contactEmail ? `mailto:${esc(site.contactEmail)}?subject=${encodeURIComponent(subject)}` : null);
const demoLink = (subject) => mail(subject) || '#contact';

// ---------------------------------------------------------------------------------------------------------------
// Specimens: one line-art illustration per product, drawn in white so it sits on the product's colour.
// They show what the product does (a board, a device grid, a timeline ...) and carry no invented figures.
// ---------------------------------------------------------------------------------------------------------------
const R = (x, y, w, h, r, o = 0.2, fill = '#fff') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" fill-opacity="${o}"/>`;
const C = (x, y, r, o = 1) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" fill-opacity="${o}"/>`;
const ACC = 'var(--accent)';
const svg = (inner, h = 340) => `<svg class="spec" viewBox="0 0 480 ${h}" aria-hidden="true" focusable="false">${inner}</svg>`;

const specimens = {
  // Pipeline board: columns of deal cards, one card lifted out and being moved.
  crm() {
    const counts = [3, 2, 3, 1];
    let s = '';
    counts.forEach((n, i) => {
      const x = 24 + i * 112;
      s += R(x, 24, 64, 10, 5, 0.75);
      for (let j = 0; j < n; j++) {
        const y = 52 + j * 66;
        s += R(x, y, 100, 54, 10, 0.16) + R(x + 10, y + 12, 56, 7, 3.5, 0.55) + R(x + 10, y + 28, 76, 6, 3, 0.3);
      }
    });
    s += `<g transform="rotate(-5 300 150)">${R(256, 120, 112, 64, 12, 1)}${R(268, 136, 60, 8, 4, 0.9, ACC)}${R(268, 154, 84, 7, 3.5, 0.4, ACC)}</g>`;
    s += `<path d="M236 232 q22 18 46 6" stroke="#fff" stroke-opacity=".7" stroke-width="3" fill="none" stroke-linecap="round" stroke-dasharray="1 9"/>`;
    return svg(s, 276);
  },
  // Device grid with one tile raising an alert, and a health line underneath.
  rmm() {
    let s = '';
    const fills = [0.5, 0.8, 0.35, 0.65, 0.9, 0.4, 0.55, 0.7, 0.3, 0.6, 0.85, 0.45];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
      const x = 24 + c * 112, y = 24 + r * 70, alert = r === 1 && c === 2, i = r * 4 + c;
      s += R(x, y, 100, 60, 12, alert ? 1 : 0.14);
      s += C(x + 16, y + 17, 5, alert ? 1 : 0.8).replace('fill="#fff"', alert ? `fill="${ACC}"` : 'fill="#fff"');
      s += R(x + 28, y + 12, 48, 8, 4, alert ? 0.7 : 0.5, alert ? ACC : '#fff');
      s += R(x + 12, y + 38, 76, 8, 4, alert ? 0.25 : 0.2, alert ? ACC : '#fff') + R(x + 12, y + 38, 76 * fills[i], 8, 4, alert ? 1 : 0.85, alert ? ACC : '#fff');
    }
    s += `<path d="M24 306 L90 286 L150 298 L210 268 L270 280 L330 246 L390 264 L456 230 L456 322 L24 322 Z" fill="#fff" fill-opacity=".12"/>`;
    s += `<path d="M24 306 L90 286 L150 298 L210 268 L270 280 L330 246 L390 264 L456 230" fill="none" stroke="#fff" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`;
    return svg(s);
  },
  // Fleet timeline: one lane per vehicle, booking bars across the days, a marker for today.
  claudeworkspace() {
    const lanes = [[[120, 110], [250, 90, 1]], [[160, 150]], [[118, 70], [210, 120], [350, 90]], [[240, 200, 1]], [[130, 100], [300, 130]]];
    let s = '';
    lanes.forEach((bars, i) => {
      const y = 28 + i * 52;
      s += R(24, y + 4, 70, 12, 6, 0.55) + R(24, y + 24, 44, 8, 4, 0.25) + R(108, y, 348, 40, 12, 0.1);
      bars.forEach(([x, w, solid]) => {
        s += R(x, y + 6, w, 28, 9, solid ? 1 : 0.36);
        if (solid) s += R(x + 12, y + 16, Math.min(60, w - 24), 8, 4, 0.8, ACC);
      });
    });
    for (let d = 0; d < 14; d++) s += R(112 + d * 25, 296, 14, 6, 3, 0.35);
    s += `<path d="M272 16 V284" stroke="#fff" stroke-width="2.5" stroke-dasharray="2 7" stroke-linecap="round"/>`;
    return svg(s);
  },
  // Route across a dotted map and three fare rows, the cheapest one lit.
  airfinder() {
    let s = '';
    for (let r = 0; r < 6; r++) for (let c = 0; c < 18; c++) s += C(34 + c * 24.5, 30 + r * 24, 2.6, 0.2);
    s += `<path d="M70 150 Q240 8 410 100" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="1 10"/>`;
    s += C(70, 150, 9) + C(70, 150, 18, 0.2) + C(410, 100, 9) + C(410, 100, 18, 0.2);
    [[198, 0.14], [240, 1], [282, 0.14]].forEach(([y, o]) => {
      const hot = o === 1;
      s += R(24, y, 432, 34, 11, o) + R(40, y + 11, 96, 12, 6, hot ? 0.8 : 0.55, hot ? ACC : '#fff') + R(150, y + 14, 120, 7, 3.5, hot ? 0.35 : 0.25, hot ? ACC : '#fff') + R(376, y + 9, 68, 16, 8, hot ? 1 : 0.45, hot ? ACC : '#fff');
    });
    return svg(s);
  },
  // Before and after: a blocky heavy image on the left, the same picture clean and light on the right.
  imageapp() {
    let s = `<defs><clipPath id="frame"><rect x="24" y="24" width="432" height="292" rx="20"/></clipPath></defs><g clip-path="url(#frame)">`;
    s += R(24, 24, 432, 292, 20, 0.12);
    for (let r = 0; r < 17; r++) for (let c = 0; c < 12; c++) {
      const v = (Math.sin(r * 12.9898 + c * 78.233) * 43758.5453) % 1;
      s += R(24 + c * 18, 24 + r * 18, 18, 18, 0, 0.1 + Math.abs(v) * 0.4);
    }
    s += `<path d="M240 316 L240 236 Q296 150 342 212 Q384 126 456 206 L456 316 Z" fill="#fff" fill-opacity=".38"/>`;
    s += `<path d="M240 316 L240 270 Q310 224 370 262 Q410 236 456 262 L456 316 Z" fill="#fff" fill-opacity=".5"/>`;
    s += C(408, 92, 27, 0.85) + `</g>`;
    s += `<path d="M240 24 V316" stroke="#fff" stroke-width="3"/>` + C(240, 170, 16) + `<path d="M234 164 l-6 6 6 6 M246 164 l6 6 -6 6" stroke="${ACC}" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    s += R(40, 40, 76, 28, 14, 0.92) + `<text x="78" y="59" text-anchor="middle" font-size="14" font-weight="700" fill="${ACC}" font-family="inherit">4.2 MB</text>`;
    s += R(364, 40, 76, 28, 14, 0.92) + `<text x="402" y="59" text-anchor="middle" font-size="14" font-weight="700" fill="${ACC}" font-family="inherit">640 KB</text>`;
    return svg(s);
  },
  // Control centre: a command bar and a stack of running tasks with progress.
  claudeos() {
    let s = R(24, 24, 432, 46, 15, 0.16) + R(42, 41, 130, 12, 6, 0.6) + R(408, 34, 36, 26, 9, 1) + R(418, 44, 16, 6, 3, 0.9, ACC);
    [0.92, 0.64, 0.4, 0.16].forEach((p, i) => {
      const y = 92 + i * 60, on = i === 0;
      s += R(24, y, 432, 50, 14, on ? 1 : 0.12);
      s += on ? `<circle cx="50" cy="${y + 25}" r="11" fill="${ACC}"/>` : `<circle cx="50" cy="${y + 25}" r="11" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="3"/>`;
      s += R(76, y + 11, 150, 10, 5, on ? 0.8 : 0.6, on ? ACC : '#fff');
      s += R(76, y + 30, 300, 8, 4, on ? 0.2 : 0.2, on ? ACC : '#fff') + R(76, y + 30, 300 * p, 8, 4, on ? 1 : 0.85, on ? ACC : '#fff');
      s += R(392, y + 14, 52, 22, 11, on ? 0.22 : 0.3, on ? ACC : '#fff');
    });
    return svg(s);
  },
};
const specimen = (id) => (specimens[id] ? specimens[id]() : svg(R(24, 24, 432, 292, 20, 0.12)));

// ---------------------------------------------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------------------------------------------
const css = `
:root{--paper:#EEF1F6;--surface:#fff;--ink:#0F1B2D;--mute:#4F5E78;--line:#D3DAE5;--accent:#2b4acb;
--display:"Bahnschrift","Segoe UI Variable Display","SF Pro Display","Avenir Next","Helvetica Neue",system-ui,sans-serif;
--text:"Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,"Helvetica Neue",sans-serif}
@media (prefers-color-scheme:dark){:root{--paper:#0A1020;--surface:#111A2E;--ink:#EAF0FA;--mute:#9DAAC4;--line:#202C44}}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--paper);color:var(--ink);font:17px/1.6 var(--text);-webkit-font-smoothing:antialiased}
a{color:inherit}
:focus-visible{outline:3px solid var(--accent);outline-offset:3px;border-radius:8px}
.hero :focus-visible,.cta :focus-visible,.tab:focus-visible{outline-color:#fff}
.wrap{max-width:1160px;margin:0 auto;padding:0 24px}
h1,h2,h3{font-family:var(--display);margin:0;text-wrap:balance}

.top{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px 0}
.brand{display:flex;align-items:center;gap:12px;font:700 23px/1 var(--display);letter-spacing:-.02em;text-decoration:none}
.mark{display:grid;grid-template-columns:repeat(3,7px);gap:3px}
.mark i{width:7px;height:7px;border-radius:50%}
.links{display:flex;flex-wrap:wrap;gap:4px 6px;margin-left:auto}
.links a{display:flex;align-items:center;gap:8px;padding:7px 12px;border-radius:999px;font-size:15px;color:var(--mute);text-decoration:none}
.links a:before{content:"";width:8px;height:8px;border-radius:50%;background:var(--dot)}
.links a:hover{background:var(--surface);color:var(--ink)}
.nav-cta{padding:9px 18px;border-radius:999px;background:var(--ink);color:var(--paper);font-weight:600;font-size:15px;text-decoration:none;white-space:nowrap}
.nav-cta:hover{opacity:.88}

.btn{display:inline-block;padding:14px 26px;border-radius:999px;font-weight:600;font-size:16px;text-decoration:none;border:1.5px solid transparent}
.btn.solid{background:var(--ink);color:var(--paper)}
.btn.outline{border-color:var(--line);color:var(--ink)}
.btn.light{background:#fff;color:var(--accent)}
.btn.line{border-color:rgba(255,255,255,.6);color:#fff}
.btn:hover{transform:translateY(-1px)}
.btn.outline:hover{border-color:var(--ink)}
.row{display:flex;flex-wrap:wrap;gap:12px}

.home{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:22px 40px;align-items:end;padding:28px 0 36px}
.home h1{grid-column:1/-1;font-size:clamp(40px,6.6vw,96px);line-height:.96;letter-spacing:-.045em;font-weight:700}
.home p{font-size:clamp(17px,1.7vw,21px);color:var(--mute);max-width:46ch;margin:0}

.strip{display:flex;gap:10px;height:min(580px,74vh);min-height:460px;margin:0 0 72px}
.tab{position:relative;flex:1 1 0;min-width:0;overflow:hidden;border-radius:30px;background:var(--accent);color:#fff;text-decoration:none;transition:flex-grow .55s cubic-bezier(.2,.7,.2,1)}
.tab:first-child{flex-grow:3.4}
.tab:hover,.tab:focus-visible{flex-grow:3.4}
.strip:hover .tab:first-child:not(:hover){flex-grow:1}
.tab .in{position:relative;z-index:1;padding:26px;display:flex;flex-direction:column;gap:12px}
.tab h2{font-size:30px;line-height:1.05;letter-spacing:-.03em;font-weight:700;white-space:nowrap}
.tab p{margin:0;font-size:16px;line-height:1.45;max-width:34ch}
.tab .more{font-weight:600;font-size:15px}
.tab .spec{position:absolute;right:-70px;bottom:-26px;width:540px;height:auto;pointer-events:none}
/* shut: a flat colour with the name set upright along the side */
.tab h2{writing-mode:vertical-rl;transform:rotate(180deg);align-self:flex-start;font-size:26px}
.tab p,.tab .more,.tab .spec{opacity:0;visibility:hidden}
/* open: the first panel at rest, then whichever one is hovered or focused */
.tab:first-child h2,.tab:hover h2,.tab:focus-visible h2{writing-mode:horizontal-tb;transform:none;font-size:clamp(28px,3vw,38px);white-space:normal}
.tab:first-child p,.tab:first-child .more,.tab:first-child .spec,.tab:hover p,.tab:hover .more,.tab:hover .spec,.tab:focus-visible p,.tab:focus-visible .more,.tab:focus-visible .spec{opacity:1;visibility:visible;transition:opacity .4s .15s,visibility 0s}
.strip:hover .tab:first-child:not(:hover) h2{writing-mode:vertical-rl;transform:rotate(180deg);font-size:26px;white-space:nowrap}
.strip:hover .tab:first-child:not(:hover) p,.strip:hover .tab:first-child:not(:hover) .more,.strip:hover .tab:first-child:not(:hover) .spec{opacity:0;visibility:hidden}

.hero{margin:6px 0 0;background:var(--accent);color:#fff;border-radius:38px;padding:60px 56px;display:grid;grid-template-columns:minmax(0,1.02fr) minmax(0,1fr);gap:44px;align-items:center;overflow:hidden}
.hero h1{font-size:clamp(38px,5.6vw,76px);line-height:.98;letter-spacing:-.04em;font-weight:700}
.hero p{font-size:clamp(17px,1.8vw,20px);line-height:1.5;margin:22px 0 30px;max-width:44ch;opacity:.93}
.window{border-radius:24px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.3);box-shadow:0 36px 60px -34px rgba(0,0,0,.5);overflow:hidden;transform:rotate(-1deg);animation:rise .8s cubic-bezier(.2,.7,.2,1) both}
.window .bar{display:flex;gap:6px;padding:12px 16px}
.window .bar i{width:9px;height:9px;border-radius:50%;background:rgba(255,255,255,.5)}
.window .spec{display:block;width:100%;height:auto}
@keyframes rise{from{opacity:0;transform:translateY(22px) rotate(1.8deg)}to{opacity:1;transform:rotate(-1deg)}}

.sec{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2.1fr);gap:20px 56px;padding:84px 0 0}
.sec h2{font-size:clamp(26px,3vw,36px);letter-spacing:-.03em;font-weight:700}
.lead{font:500 clamp(24px,3vw,36px)/1.28 var(--display);letter-spacing:-.02em;margin:0;max-width:30ch}
.sheet{list-style:none;margin:0;padding:0}
.sheet li{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.5fr);gap:6px 32px;padding:24px 0;border-top:1px solid var(--line)}
.sheet li:last-child{border-bottom:1px solid var(--line)}
.sheet h3{font-size:22px;letter-spacing:-.02em;font-weight:600}
.sheet p{margin:0;color:var(--mute)}
.benefits{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:28px}
.benefits div{border-left:3px solid var(--accent);padding:2px 0 2px 20px;font:600 clamp(20px,2.2vw,26px)/1.25 var(--display);letter-spacing:-.02em}

.cta{margin:96px 0 0;border-radius:38px;background:var(--accent);color:#fff;padding:60px 56px;display:flex;flex-wrap:wrap;gap:28px 40px;align-items:flex-end;justify-content:space-between}
.cta.ink{background:var(--ink);color:var(--paper)}
.cta h2{font-size:clamp(32px,4.8vw,62px);line-height:1;letter-spacing:-.04em;font-weight:700;max-width:14ch}
.cta p{margin:16px 0 0;max-width:46ch;opacity:.92;font-size:18px}
.cta .btn.light{background:#fff;color:var(--accent)}
.cta.ink .btn.light{color:var(--ink)}

.more-from{padding:64px 0 0}
.more-from h2{font-size:22px;letter-spacing:-.02em;margin-bottom:16px;font-weight:700}
.pills{display:flex;flex-wrap:wrap;gap:10px}
.pill{display:flex;align-items:center;gap:10px;padding:10px 18px;border:1px solid var(--line);border-radius:999px;text-decoration:none;font-weight:600;font-size:15px;background:var(--surface)}
.pill:before{content:"";width:10px;height:10px;border-radius:50%;background:var(--dot)}
.pill:hover{border-color:var(--ink)}

#contact{scroll-margin-top:20px;padding:64px 0 0}
#contact h2{font-size:26px;letter-spacing:-.02em;font-weight:700;margin-bottom:8px}
.who{color:var(--mute);margin:0}
footer{margin-top:72px;border-top:1px solid var(--line);padding:26px 0 44px;color:var(--mute);font-size:14px;display:flex;flex-wrap:wrap;gap:8px 24px;justify-content:space-between;align-items:center}

@media (max-width:900px){
  .links{display:none}.nav-cta{margin-left:auto}
  .strip{display:grid;height:auto;min-height:0;margin-bottom:56px}
  .tab{display:flex;flex-direction:column;min-height:0}
  .tab h2,.strip:hover .tab:first-child:not(:hover) h2{writing-mode:horizontal-tb;transform:none;font-size:30px;white-space:normal}
  .tab p,.tab .more,.tab .spec,.strip:hover .tab:first-child:not(:hover) p,.strip:hover .tab:first-child:not(:hover) .more,.strip:hover .tab:first-child:not(:hover) .spec{opacity:1;visibility:visible}
  .tab .spec{position:static;width:100%;margin:4px 0 -26px}
  .tab p{max-width:30ch}
  .home{grid-template-columns:minmax(0,1fr);padding-top:16px}
  .hero{grid-template-columns:minmax(0,1fr);padding:40px 26px;border-radius:30px;gap:34px}
  .window{transform:none}
  @keyframes rise{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:none}}
  .sec{grid-template-columns:minmax(0,1fr);padding-top:60px}
  .sheet li{grid-template-columns:minmax(0,1fr)}
  .cta{padding:40px 26px;border-radius:30px;margin-top:72px}
}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{animation:none!important;transition:none!important}}
`;

// ---------------------------------------------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------------------------------------------
const brandMark = (root) => `<a class="brand" href="${root}index.html"><span class="mark" aria-hidden="true">${products.map((p) => `<i style="background:${esc(p.accent)}"></i>`).join('')}</span>${esc(site.brand)}</a>`;
const navLinks = (root) => `<div class="links">${products.map((p) => `<a style="--dot:${esc(p.accent)}" href="${root}${p.id}/index.html">${esc(p.name)}</a>`).join('')}</div>`;

const shell = (title, desc, accent, body, root) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">
<link rel="icon" href="data:,"><link rel="stylesheet" href="${root}style.css"><style>:root{--accent:${esc(accent)}}</style></head>
<body><div class="wrap">
<div class="top">${brandMark(root)}${navLinks(root)}<a class="nav-cta" href="${demoLink('Demo request')}">Request a demo</a></div>
${body}
<footer><span>&copy; ${new Date().getFullYear()} ${esc(site.brand)}. Each product is a separate application.</span><span class="mark" aria-hidden="true">${products.map((p) => `<i style="background:${esc(p.accent)}"></i>`).join('')}</span></footer>
</div></body></html>`;

const contactBlock = () => `<section id="contact"><h2>Get in touch</h2><p class="who">${site.contactEmail ? `Email <a href="mailto:${esc(site.contactEmail)}">${esc(site.contactEmail)}</a> and tell us which product you're interested in.` : 'Contact details coming soon.'}</p></section>`;

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
writeFileSync(join(dist, 'style.css'), css);

// Home: the tagline, then one colour panel per product. The panel under the pointer opens to show its pitch.
writeFileSync(join(dist, 'index.html'), shell(`${site.brand}: ${site.tagline}`, site.intro, '#2b4acb', `
<header class="home"><h1>${esc(site.tagline)}</h1><p>${esc(site.intro)}</p><div class="row"><a class="btn solid" href="#products">See the products</a><a class="btn outline" href="${demoLink('Demo request')}">Request a demo</a></div></header>
<section id="products" class="strip" aria-label="Products">${products.map((p) => `
<a class="tab" style="--accent:${esc(p.accent)}" href="${p.id}/index.html"><div class="in"><h2>${esc(p.name)}</h2><p>${esc(p.summary)}</p><span class="more">See ${esc(p.name)} &rarr;</span></div>${specimen(p.id)}</a>`).join('')}
</section>
<section class="cta ink"><div><h2>Not sure which one fits?</h2><p>Tell us what your business does and we'll point you to the right product.</p></div><a class="btn light" href="${demoLink('Which product fits my business?')}">Email us</a></section>
${contactBlock()}`, ''));

for (const p of products) {
  const others = products.filter((o) => o.id !== p.id);
  mkdirSync(join(dist, p.id), { recursive: true });
  writeFileSync(join(dist, p.id, 'index.html'), shell(`${p.name} | ${site.brand}`, p.summary, p.accent, `
<header class="hero"><div><h1>${esc(p.headline)}</h1><p>${esc(p.summary)}</p><div class="row"><a class="btn light" href="${demoLink(`Demo request: ${p.name}`)}">Request a demo</a><a class="btn line" href="#features">See features</a></div></div>
<div class="window"><div class="bar" aria-hidden="true"><i></i><i></i><i></i></div>${specimen(p.id)}</div></header>
<section class="sec"><h2>Who it's for</h2><p class="lead">${esc(p.audience)}</p></section>
<section class="sec" id="features"><h2>What you get</h2><ul class="sheet">${p.features.map(([t, d]) => `<li><h3>${esc(t)}</h3><p>${esc(d)}</p></li>`).join('')}</ul></section>
<section class="sec"><h2>Why teams choose it</h2><div class="benefits">${p.benefits.map((b) => `<div>${esc(b)}</div>`).join('')}</div></section>
<section class="cta"><div><h2>See ${esc(p.name)} in action</h2><p>We'll set up a private demo with sample data, so you can explore it without any risk.</p></div><a class="btn light" href="${demoLink(`Demo request: ${p.name}`)}">Request a demo</a></section>
<section class="more-from"><h2>More from ${esc(site.brand)}</h2><div class="pills">${others.map((o) => `<a class="pill" style="--dot:${esc(o.accent)}" href="../${o.id}/index.html">${esc(o.name)}</a>`).join('')}</div></section>
${contactBlock()}`, '../'));
}
console.log(`Built ${products.length + 1} pages into ${dist}`);
