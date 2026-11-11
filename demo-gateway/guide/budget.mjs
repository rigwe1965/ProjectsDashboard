// The AI guide's limits: how many messages a link may use, how fast, and what the whole gateway may spend in a day.
// It counts and prices only (never what was typed or answered). Money is kept in millionths of a dollar ("micro"), whole numbers, so sums never drift.
//
// begin(grantId, allowance) answers whether one more message may be sent and reserves room for it, so two messages sent at the same moment
// cannot both pass when only one is left. Call done(usage) with the API's usage when the answer is finished, or done() when nothing was
// spent (the call failed before any answer), and the reservation is released either way.
import { MINUTE } from '../../lib/util.mjs';

// Price per million tokens, in dollars (Claude API model table). A model that is not listed cannot be used: its cost could not be capped.
export const PRICES = {
  'claude-haiku-5-5': { in: 0.10, out: 0.50 },
  'claude-sonnet-5-5': { in: 2, out: 10 },
  'claude-opus-5-5': { in: 4, out: 20 },
};
export const GUIDE_DEFAULTS = { model: 'claude-haiku-5-5', allowance: 20, perMinute: 6, dailyCapUsd: 2, maxInputTokens: 8000, maxOutputTokens: 1500 }; // the API counts the model's thinking in this too, so it is more than the visible answer needs
const CACHE_READ = 0.1, CACHE_WRITE = 1.25; // as multiples of the input price

const whole = (n) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Math.floor(Number(n)) : 0);
export const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

// The API's usage ({ input_tokens, cache_read_input_tokens, cache_creation_input_tokens, output_tokens }) -> what is stored and what it cost.
// input_tokens does not include cache reads; cache writes cost more than plain input, cache reads far less. Rounded up, never down.
export function priceUsage(model, usage = {}) {
  const p = PRICES[model];
  if (!p) throw new Error(`no price known for model "${model}"`);
  const input = whole(usage.input_tokens), read = whole(usage.cache_read_input_tokens), write = whole(usage.cache_creation_input_tokens), output = whole(usage.output_tokens);
  const costMicro = Math.ceil(input * p.in + write * p.in * CACHE_WRITE + read * p.in * CACHE_READ + output * p.out); // $ per 1M tokens = micro-$ per token
  return { messages: 1, inputTokens: input + write, cachedTokens: read, outputTokens: output, costMicro };
}

export function createBudget({ store, model = GUIDE_DEFAULTS.model, perMinute = GUIDE_DEFAULTS.perMinute, dailyCapUsd = GUIDE_DEFAULTS.dailyCapUsd,
  maxInputTokens = GUIDE_DEFAULTS.maxInputTokens, maxOutputTokens = GUIDE_DEFAULTS.maxOutputTokens, now = Date.now } = {}) {
  const p = PRICES[model];
  if (!p) throw new Error(`no price known for model "${model}"`);
  const dailyCapMicro = Math.round(Number(dailyCapUsd) * 1e6);
  if (!Number.isFinite(dailyCapMicro) || dailyCapMicro < 0) throw new Error('the daily cap must be a number of dollars, 0 or more');
  const worstCase = Math.ceil(maxInputTokens * p.in * CACHE_WRITE + maxOutputTokens * p.out); // what one message could cost at most
  const inFlight = new Map(); // grantId -> messages being answered now
  let flying = 0; // all of them

  // The room is reserved before anything is awaited, so two messages sent at the same moment see each other; a refusal gives it back.
  async function begin(grantId, allowance) {
    const allowed = whole(allowance);
    if (allowed === 0) return { ok: false, why: 'no-guide' };
    inFlight.set(grantId, (inFlight.get(grantId) ?? 0) + 1); flying++;
    let finished = false;
    const release = () => {
      if (finished) return false; finished = true;
      const left = (inFlight.get(grantId) ?? 1) - 1; if (left > 0) inFlight.set(grantId, left); else inFlight.delete(grantId);
      flying--; return true;
    };
    try {
      const total = await store.guideUsage.totalForGrant(grantId);
      if (total.messages + inFlight.get(grantId) > allowed) { release(); return { ok: false, why: 'allowance', used: total.messages, allowed }; }
      const spent = (await store.guideUsage.totalForDay(dayOf(now()))).costMicro;
      if (spent + flying * worstCase > dailyCapMicro) { release(); return { ok: false, why: 'daily' }; }
      // The per-minute check is last: it records the attempt, so a refusal above must not use up the customer's minute.
      if ((await store.rateLimit.hit('guide:' + grantId, MINUTE, perMinute)) > perMinute) { release(); return { ok: false, why: 'rate' }; }
    } catch (err) { release(); throw err; }
    return {
      ok: true,
      done: async (usage) => {
        if (!release()) return;
        if (usage) await store.guideUsage.add(grantId, dayOf(now()), priceUsage(model, usage));
      },
    };
  }

  return { begin, model, dailyCapMicro, worstCaseMicro: worstCase, pending: () => flying };
}
