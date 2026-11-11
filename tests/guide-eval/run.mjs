// Runs the AI guide quality check against the real Claude API. It spends real (small) money, so it does nothing without --yes.
//
//   npm run eval:guide -- crm                  shows how many questions and the estimated cost, then stops (no key needed, nothing spent)
//   npm run eval:guide -- crm --yes            runs them
//   npm run eval:guide -- crm --smoke --yes    two calls only: checks the key works and whether the guide is cached
// Options: --allow-draft (try a guide that still has TODO(owner) lines), --model <id>, --max-usd <n> (refuse a run estimated above n; default 0.50),
//          --dir <folder of guides>, --out <file> (default tests/guide-eval/results/<product>-<time>.json; the folder is not committed).
// The key is read from ANTHROPIC_API_KEY in your own shell. It is never printed or written anywhere. Use a dedicated key with a spend limit.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGuideClient } from '../../demo-gateway/guide/client.mjs';
import { GUIDE_DEFAULTS, priceUsage } from '../../demo-gateway/guide/budget.mjs';
import { GUIDES_DIR } from '../../demo-gateway/guide/content.mjs';
import { casesFor, knownProducts } from './cases.mjs';
import { systemFor, estimateRun, runEval, report } from './eval.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n) => args.includes('--' + n);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const product = args.find((a, i) => !a.startsWith('--') && !(args[i - 1] ?? '').match(/^--(model|max-usd|dir|out)$/));
const die = (msg) => { console.error(msg); process.exit(1); };

if (!product || !knownProducts().includes(product)) die(`Usage: npm run eval:guide -- <${knownProducts().join('|')}> [--yes] [--smoke] [--allow-draft] [--model id] [--max-usd n]`);
const model = opt('model', GUIDE_DEFAULTS.model);
const dir = opt('dir', GUIDES_DIR);
const maxUsd = Number(opt('max-usd', 0.5));

let built;
try { built = systemFor(product, { dir, allowDraft: flag('allow-draft'), productName: product.toUpperCase() }); } catch (err) { die(err.message); }
const cases = flag('smoke') ? [{ id: 'smoke', kind: 'basic', ask: 'How do I get started with the demo?', checks: [] }] : casesFor(product);
const est = estimateRun({ system: built.system, cases, model });
console.log(`${product}: ${cases.length} question(s), guide about ${est.systemTokens} tokens, model ${model}. Estimated cost at most $${est.usd.toFixed(4)}${built.draft ? ' (DRAFT guide)' : ''}.`);
if (est.usd > maxUsd) die(`That is above the limit of $${maxUsd}. Pass --max-usd to allow more.`);
if (!flag('yes')) { console.log('Nothing was sent. Add --yes to run it.'); process.exit(0); }
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey?.trim()) die('ANTHROPIC_API_KEY is not set in this shell. Set it yourself (a dedicated key with a spend limit); do not paste it anywhere else.');

const client = createGuideClient({ apiKey, model, baseUrl: process.env.ANTHROPIC_BASE_URL || undefined });
if (flag('smoke')) {
  // The same call twice: the second should read the first one's prompt cache, if the guide is long enough to be cached.
  for (const n of [1, 2]) {
    const r = await client.ask({ system: built.system, message: cases[0].ask });
    if (r.outcome !== 'ok') die(`Call ${n} failed: ${r.outcome}` + (r.outcome === 'auth' ? ' (the key was refused)' : ''));
    console.log(`Call ${n}: ok, ${JSON.stringify(r.usage)}, $${(priceUsage(model, r.usage).costMicro / 1e6).toFixed(5)}`);
    if (n === 1) console.log('Answer: ' + r.text.replace(/\s+/g, ' ').slice(0, 400));
    if (n === 2) console.log(r.usage.cache_read_input_tokens > 0 ? `Caching works: ${r.usage.cache_read_input_tokens} tokens were read from the cache.` : 'Nothing was read from the cache: the guide is probably too short to be cached, so every message pays the full input price (the budget already assumes this).');
  }
  process.exit(0);
}

const summary = await runEval({ client, system: built.system, cases, onProgress: (r, i, n) => process.stdout.write(`\r${i}/${n} `) });
console.log('\n' + report(summary, { draft: built.draft }));
const out = opt('out', join(here, 'results', `${product}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ product, draft: built.draft, ...summary }, null, 2));
console.log(`\nFull answers: ${out}`);
process.exit(summary.failed ? 1 : 0);
