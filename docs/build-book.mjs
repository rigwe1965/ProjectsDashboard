// Rebuilds docs/ONBOARDING-BOOK.html from docs/ONBOARDING-BOOK.md. Run after every edit of the Markdown:
//   npm i --no-save marked@14.1.4     (once; "marked" is deliberately not a project dependency)
//   npm run docs:book                 (or: node docs/build-book.mjs [book.md] [template.html] [out.html])
// The existing HTML file is the template: everything before the contents list (head, styles) and from the footer on (scripts) is kept;
// the contents list and the body are regenerated from the Markdown headings. Headings "# ..." become parts, "## ..." chapters.
import { readFileSync, writeFileSync } from 'node:fs';
let Marked;
try { ({ Marked } = await import('marked')); } catch { console.error('Missing the "marked" package. Run once: npm i --no-save marked@14.1.4'); process.exit(1); }

const [, , mdArg, tplArg, outArg] = process.argv;
const mdPath = mdArg || 'docs/ONBOARDING-BOOK.md', tplPath = tplArg || 'docs/ONBOARDING-BOOK.html', outPath = outArg || tplPath;
const md = readFileSync(mdPath, 'utf8');
const tpl = readFileSync(tplPath, 'utf8');

const used = new Map();
const slug = (t) => {
  let s = t.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s/g, '-').replace(/-+/g, '-');
  const n = used.get(s) || 0; used.set(s, n + 1);
  return n ? `${s}-${n}` : s;
};
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const heads = []; // {level, text, id}
const marked = new Marked({ gfm: true });
marked.use({
  renderer: {
    heading({ tokens, depth }) {
      const inner = this.parser.parseInline(tokens);
      const text = tokens.map((t) => t.raw ?? t.text ?? '').join('').replace(/[`*_]/g, '');
      const id = slug(text);
      heads.push({ depth, text: text.trim(), id });
      return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
    },
    table(tok) {
      const head = '<thead>\n<tr>\n' + tok.header.map((c) => `<th>${this.parser.parseInline(c.tokens)}</th>`).join('\n') + '\n</tr>\n</thead>\n';
      const body = '<tbody>\n' + tok.rows.map((r) => '<tr>\n' + r.map((c) => `<td>${this.parser.parseInline(c.tokens)}</td>`).join('\n') + '\n</tr>').join('\n') + '\n</tbody>\n';
      return `<div class="tablewrap"><table>\n${head}${body}</table></div>\n`;
    },
    code({ text, lang }) {
      if (lang === 'mermaid') return `<pre class="mermaid">${esc(text)}</pre>\n`;
      return `<pre><code${lang ? ` class="language-${lang}"` : ''}>${esc(text)}\n</code></pre>\n`;
    },
    paragraph({ tokens }) {
      const inner = this.parser.parseInline(tokens);
      return /^<strong>Example \d/.test(inner) ? `<p class="ex">${inner}</p>\n` : `<p>${inner}</p>\n`;
    },
  },
});

// Split the markdown into: cover (h1 title + intro), then blocks starting at "## " or "# " headings.
const tokens = marked.lexer(md);
let out = '';
let open = false;
const close = () => { if (open) { out += '</section>\n'; open = false; } };
let coverDone = false;
let buf = [];
const flush = () => { if (buf.length) { out += marked.parser(Object.assign(buf, { links: tokens.links })); buf = []; } };

for (const t of tokens) {
  if (t.type === 'heading' && t.depth === 1 && !coverDone) {
    coverDone = true;
    heads.length = 0;
    const title = t.text;
    out += `<div class="cover"><h1>${title}</h1><p>Everything a new person needs to understand, run, support and manage this project, from day one.</p></div>\n`;
    continue;
  }
  if (t.type === 'heading' && (t.depth === 1 || t.depth === 2)) {
    flush(); close();
    out += `<section class="${t.depth === 1 ? 'l1' : 'l2'}">\n`; open = true;
  }
  buf.push(t);
  if (t.type === 'heading' && t.depth === 1) { flush(); out += '</section>\n'; open = false; }
}
flush(); close();
out = out.replace(/<hr>/g, '<hr />').replace(/&#39;/g, "'").replace(/&quot;/g, '"');

// Sticky table of contents from the headings.
let nav = '<li><a href="#how-to-use-this-book">How to use this book</a></li>\n<li><a href="#contents">Contents</a></li>\n';
let inPart = false;
for (const h of heads) {
  if (h.depth === 1) {
    if (inPart) nav += '</ol></li>\n';
    const label = h.text === 'Appendices' ? 'Appendices' : h.text;
    const href = h.text === 'Appendices' ? '#appendix-a-checklists' : '#' + h.id;
    nav += `<li><a class="part" href="${href}">${label}</a><ol>\n`; inPart = true;
  } else if (h.depth === 2 && inPart) {
    nav += `<li><a href="#${h.id}">${h.text}</a></li>\n`;
  }
}
if (inPart) nav += '</ol></li>\n';

const head = tpl.slice(0, tpl.indexOf('<details open>'));
const tail = tpl.slice(tpl.indexOf('<footer>'));
const html = head.replace(/Management [^<]*Technical [^<]*Support/, 'Management · Technical · Support')
  + `<details open><summary>Contents</summary><ol>\n${nav}</ol></details>\n</nav>\n<main>\n${out}${tail}`;
writeFileSync(outPath, html.replace(/\r?\n/g, '\r\n'));
console.log('headings', heads.length, 'bytes', html.length);
