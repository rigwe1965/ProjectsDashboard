// The AI guide's connection to the Claude API (official SDK, streaming). One question in, the answer streamed out through onText, and a plain
// result back: { outcome, text, usage }. It never throws for an API problem and never passes an API error message on: what the customer may be
// told is one of the fixed sentences in MESSAGES, and the real reason goes to the log only.
//
// No tools, no web, no stored conversation: every call carries only the system prompt (rules + product guide), the recent turns it is given,
// and the new message. The system prompt is marked for prompt caching, because it is the same for every message of a product.
import { logger } from '../../lib/log.mjs';
import { GUIDE_DEFAULTS } from './budget.mjs';

export const MAX_MESSAGE_CHARS = 2000; // a safety net; the route allows far fewer
export const MAX_HISTORY = 20; // messages (10 turns)

// What the customer sees for each outcome that is not a normal answer.
export const MESSAGES = {
  off: 'The guide is not available right now. The demo itself works as usual.',
  rate: 'The guide is busy at the moment. Please try again in a minute.',
  down: 'The guide could not answer just now. Please try again, or ask the person who sent you this demo.',
  refused: 'I cannot help with that one. Is there something in the demo I can show you?',
  empty: 'The guide could not answer just now. Please try again, or ask the person who sent you this demo.',
  truncated: 'That answer got too long to finish. Please ask a smaller question, or ask the person who sent you this demo for more.',
};

// An API failure -> one of: 'auth' (the key was refused), 'rate', 'aborted' (the customer left, or we cancelled), 'bad-request', 'down'.
export function classifyError(err, signal) {
  if (signal?.aborted || err?.name === 'APIUserAbortError' || err?.name === 'AbortError') return 'aborted';
  const status = Number(err?.status);
  if (status === 401 || status === 403) return 'auth';
  if (status === 429 || status === 529) return 'rate';
  if (status === 400 || status === 404 || status === 413 || status === 422) return 'bad-request';
  return 'down'; // 5xx, network, timeout, anything unexpected
}

const cleanHistory = (history) => {
  const out = [];
  for (const m of Array.isArray(history) ? history.slice(-MAX_HISTORY) : []) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string' || !m.content.trim()) continue;
    if (out.length === 0 && m.role !== 'user') continue; // the API needs the first message to be the customer's
    if (out.at(-1)?.role === m.role) out[out.length - 1] = { role: m.role, content: m.content }; // keep the later of two in a row
    else out.push({ role: m.role, content: m.content });
  }
  if (out.at(-1)?.role === 'user') out.pop(); // the new message is added below, after an assistant turn
  return out;
};

const num = (n) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Math.floor(Number(n)) : 0);
const toUsage = (u) => ({ input_tokens: num(u?.input_tokens), cache_read_input_tokens: num(u?.cache_read_input_tokens),
  cache_creation_input_tokens: num(u?.cache_creation_input_tokens), output_tokens: num(u?.output_tokens) });

// apiKey: from the gateway's environment only. client: for tests (anything with messages.stream); otherwise the SDK is loaded when first needed,
// so a gateway with no key (the guide off) never loads it.
export function createGuideClient({ apiKey, model = GUIDE_DEFAULTS.model, maxTokens = GUIDE_DEFAULTS.maxOutputTokens, timeoutMs = 60_000, baseUrl, client = null } = {}) {
  let sdk = client;
  const available = Boolean(client || (typeof apiKey === 'string' && apiKey.trim()));
  const getClient = async () => {
    if (sdk) return sdk;
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    sdk = new Anthropic({ apiKey: apiKey.trim(), timeout: timeoutMs, maxRetries: 1, ...(baseUrl ? { baseURL: baseUrl } : {}) });
    return sdk;
  };

  // system: the prompt text; history: [{ role, content }] of earlier turns; message: the customer's new words; onText: called with each piece of the answer.
  async function ask({ system, history = [], message, onText = () => {}, signal } = {}) {
    if (!available) return { outcome: 'off', text: '', usage: null };
    if (typeof message !== 'string' || !message.trim() || message.length > MAX_MESSAGE_CHARS || typeof system !== 'string' || !system) return { outcome: 'bad-input', text: '', usage: null };
    let text = '', seen = null; // seen: the usage so far, so a call that breaks half way is still counted
    try {
      const api = await getClient();
      const stream = api.messages.stream({
        model, max_tokens: maxTokens,
        output_config: { effort: 'low' }, // the model thinks by default; a product Q&A needs very little of it
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [...cleanHistory(history), { role: 'user', content: message }],
      }, { signal });
      for await (const ev of stream) {
        if (ev.type === 'message_start') seen = { ...toUsage(ev.message?.usage) };
        else if (ev.type === 'message_delta' && ev.usage) seen = { ...(seen ?? toUsage()), output_tokens: num(ev.usage.output_tokens) || (seen?.output_tokens ?? 0) };
        else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) { text += ev.delta.text; onText(ev.delta.text); }
      }
      const final = await stream.finalMessage();
      const usage = toUsage(final?.usage ?? seen);
      if (final?.stop_reason === 'refusal') return { outcome: 'refused', text, usage, category: final.stop_details?.category ?? null };
      if (final?.stop_reason === 'max_tokens') return { outcome: text.trim() ? 'truncated' : 'empty', text, usage };
      if (!text.trim()) return { outcome: 'empty', text, usage };
      return { outcome: 'ok', text, usage };
    } catch (err) {
      const outcome = classifyError(err, signal);
      if (outcome !== 'aborted') logger.warn('guide: the API call failed', { outcome, status: err?.status, name: err?.name }); // never the message: it may quote the request
      if (outcome === 'auth') logger.error('guide: the API key was refused; check ANTHROPIC_API_KEY');
      return { outcome, text, usage: seen ? toUsage(seen) : null };
    }
  }

  return { ask, available, model };
}
