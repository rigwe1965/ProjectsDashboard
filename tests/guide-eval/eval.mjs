// The AI guide's quality check: grade answers against cases.mjs, estimate what a run will cost, and run the cases through the real client.
// Nothing here talks to the network by itself: runEval() is given a client (the same createGuideClient() the gateway uses, or a fake).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { casesFor, GLOBAL_CHECKS, MAX_ANSWER_CHARS } from './cases.mjs';
import { priceUsage, PRICES, GUIDE_DEFAULTS } from '../../demo-gateway/guide/budget.mjs';
import { loadGuide, DRAFT_MARK } from '../../demo-gateway/guide/content.mjs';
import { buildSystemPrompt } from '../../demo-gateway/guide/prompt.mjs';

// -> [] when the answer is good, else the reasons it is not.
export function grade(testCase, result) {
  const fails = [];
  if (result.outcome === 'refused') return []; // the model declined on its own: safe, and no answer to grade
  if (result.outcome !== 'ok') return [`no usable answer (${result.outcome})`];
  const text = String(result.text ?? '');
  if (text.length > MAX_ANSWER_CHARS) fails.push(`too long (${text.length} characters, at most ${MAX_ANSWER_CHARS})`);
  for (const ck of [...GLOBAL_CHECKS, ...testCase.checks]) {
    if (ck.need && !ck.need.test(text)) fails.push(`missing: ${ck.why}`);
    if (ck.not && ck.not.test(text)) fails.push(`found: ${ck.why}`);
  }
  return fails;
}

// A rough, deliberately pessimistic estimate of a run, in dollars: no prompt caching, and each answer assumed to be 300 tokens long.
export function estimateRun({ system, cases, model = GUIDE_DEFAULTS.model, answerTokens = 300 }) {
  if (!PRICES[model]) throw new Error(`no price known for model "${model}"`);
  const systemTokens = Math.ceil(system.length / 3); // generous: English is nearer 4 characters a token
  const perCall = priceUsage(model, { input_tokens: systemTokens + 80, output_tokens: answerTokens }).costMicro;
  return { calls: cases.length, systemTokens, usd: (perCall * cases.length) / 1e6 };
}

// The system prompt for a product, built the way the gateway builds it. allowDraft lets the eval run on a guide that still has TODO(owner)
// lines (the gateway never serves such a file): it is for trying a draft, and the report says so.
export function systemFor(product, { dir, allowDraft = false, productName = product } = {}) {
  let r = loadGuide(product, dir);
  let draft = false;
  if (!r.ok && r.why === 'draft' && allowDraft) {
    const raw = readFileSync(join(dir, product + '.md'), 'utf8').replace(/\r\n?/g, '\n');
    r = { ok: true, text: raw.split('\n').filter((l) => !l.includes(DRAFT_MARK)).join('\n').trim() };
    draft = true;
  }
  if (!r.ok) throw new Error(`guides/${product}.md cannot be used for the check: ${r.why}` + (r.why === 'draft' ? ' (finish it, or pass --allow-draft to try the draft)' : ''));
  return { system: buildSystemPrompt({ productName, guide: r.text }), draft };
}

// Runs every case (one call each, no history) and grades it. The first call goes alone so the rest can read the prompt cache it writes.
export async function runEval({ client, system, cases, concurrency = 4, onProgress = () => {} }) {
  const results = new Array(cases.length);
  const one = async (i) => {
    const t = Date.now();
    const r = await client.ask({ system, message: cases[i].ask });
    results[i] = { id: cases[i].id, kind: cases[i].kind, ask: cases[i].ask, outcome: r.outcome, answer: r.text, usage: r.usage, ms: Date.now() - t, fails: grade(cases[i], r) };
    onProgress(results[i], i + 1, cases.length);
  };
  if (cases.length) await one(0);
  let next = 1;
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(cases.length - 1, 0)) }, async () => { while (next < cases.length) await one(next++); }));
  return summarise(results, client.model);
}

export function summarise(results, model = GUIDE_DEFAULTS.model) {
  const total = { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 };
  for (const r of results) for (const k of Object.keys(total)) total[k] += r.usage?.[k] ?? 0;
  const failed = results.filter((r) => r.fails.length);
  const byKind = {};
  for (const r of results) { const k = (byKind[r.kind] ??= { total: 0, failed: 0 }); k.total++; if (r.fails.length) k.failed++; }
  const prompt = total.input_tokens + total.cache_read_input_tokens + total.cache_creation_input_tokens;
  return {
    model, total: results.length, passed: results.length - failed.length, failed: failed.length, byKind, usage: total,
    // The share of all prompt tokens that were read from the cache: near 0 means the guide is too short to be cached and every message pays in full.
    cacheShare: prompt ? total.cache_read_input_tokens / prompt : 0,
    costUsd: priceUsage(model, total).costMicro / 1e6,
    results,
  };
}

export function report(s, { draft = false } = {}) {
  const out = [];
  out.push(`Model ${s.model}: ${s.passed} of ${s.total} answers passed, ${s.failed} need a look.${draft ? ' (A DRAFT guide was used: this is not what customers would get.)' : ''}`);
  out.push('By kind: ' + Object.entries(s.byKind).map(([k, v]) => `${k} ${v.total - v.failed}/${v.total}`).join(', '));
  out.push(`Tokens: ${s.usage.input_tokens} new input, ${s.usage.cache_creation_input_tokens} written to the cache, ${s.usage.cache_read_input_tokens} read from the cache, ${s.usage.output_tokens} output.`);
  out.push(`Cache: ${Math.round(s.cacheShare * 100)}% of prompt tokens came from the cache` + (s.cacheShare < 0.5 ? ' (low: the guide may be too short to be cached, so each message costs the full input price; the budget already assumes that)' : ''));
  out.push(`Estimated cost of this run: $${s.costUsd.toFixed(4)}`);
  for (const r of s.results.filter((x) => x.fails.length)) {
    out.push('', `FAIL ${r.id} [${r.kind}]: ${r.fails.join('; ')}`, `  asked:  ${r.ask}`, `  answer: ${String(r.answer ?? '').replace(/\s+/g, ' ').slice(0, 300)}`);
  }
  return out.join('\n');
}

export { casesFor };
