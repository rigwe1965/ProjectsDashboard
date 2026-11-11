# Plan: an AI guide inside the demos

Status: decided 2026-11-11 by the owner: Haiku 5.5 first, split view, opt-in per link (the other decisions take the recommendations below until changed). Step 1 built. Written 2026-11-11 (HEAD 97eccac). Prices are from the Claude API model table as cached on 2026-11-03; confirm with `count_tokens` and real `usage` before relying on them.

## What it is, and what it is not

A chat helper next to a customer's demo that answers "how do I...?", suggests what to try first, and points to the owner for anything it cannot know (pricing, contracts, custom work). It is a **guide to the product**, not an agent: it has **no tools**, **no access to the demo's data**, and no memory of other customers. That keeps the worst case small: it can say something off-topic or wrong, not do anything.

Why it is worth building: it is the "agentic demo" idea from the research (the demo as the buyer's first sales agent), it makes a self-serve demo work without the owner on a call, and the activity analytics already built (engagement, pages) will show whether it helps.

## Decisions I need from the owner (recommendations marked)

1. **Model.** Per heavy session (20 messages, about 4,000-token product guide, answers up to 500 tokens), estimated worst case:

   | Model | Input / output per 1M | About per session |
   |---|---|---|
   | Claude Haiku 5.5 `claude-haiku-5-5` | $0.10 / $0.50 | **$0.02** |
   | Claude Sonnet 5.5 `claude-sonnet-5-5` | $2 / $10 | $0.38 |
   | Claude Opus 5.5 `claude-opus-5-5` | $4 / $20 | $0.76 |

   Estimate: about 140K input tokens (guide plus recent history, resent every message) and 10K output per session; prompt caching of the guide lowers input further. Recommendation: start with Haiku 5.5 (fast, cheap, good enough for product Q&A) and judge it on the eval in step 7; move to Sonnet 5.5 only if answers are weak. The model is one setting (`GUIDE_MODEL`).
2. **Where it appears.** Recommendation: a **split view** (`/_pd/guide`: the demo in a same-origin frame on one side, the guide on the other; stacked on a phone). It needs no change to any app and no injection into their pages. Alternative: a separate tab. Rejected: injecting a widget into the apps' HTML (breaks their security headers, and the rule is never to modify the apps).
3. **Who gets it.** Recommendation: **opt-in per link** with a message allowance (default 20), chosen when creating the link (console and MCP), so you decide who costs money.
4. **Daily spending cap** for the whole gateway (default suggestion: $2/day) and a **dedicated API key** with a spend limit set in the Anthropic Console as the hard backstop.
5. **New dependency.** Calling the API from the gateway means adding `@anthropic-ai/sdk` (the gateway has only `pg` today). Recommendation: yes, use the official SDK rather than hand-written HTTP.
6. **Questions asked.** Recommendation: **do not store what customers type**, only counts. Storing the questions would be a strong sales signal ("they asked about invoicing") but is personal data; if you want it, it must be a clearly-announced, default-off setting.

## Design

### Pieces (all in the gateway; no app is touched)
- `demo-gateway/guide/` (new): `content.mjs` loads `guides/<product>.md`; `prompt.mjs` builds the system prompt; `client.mjs` wraps the SDK (streaming, refusals, usage); `budget.mjs` the limits; `routes.mjs` the HTTP side.
- **Guide content**: one Markdown file per product, written by the owner (I draft from `showcase/products.json`, you correct): what the product does, 3-5 short tours ("first, open Contacts..."), the demo accounts to use, and a list of things the guide must not answer ("pricing, discounts, contracts, security promises: ask {brand}" with the booking link). 3-6K tokens. A product with no file has no guide.
- **Registry**: `guide: true` on a demo app entry turns it on for that product.

### Requests
- `GET /_pd/guide`: the split page (needs the customer's session cookie; same checks as any request: live grant, right product). Scripts come from `/_pd/guide.js` (same origin) under its own CSP (`script-src 'self'`, `connect-src 'self'`, `frame-src 'self'`); the rest of the gateway's pages keep `default-src 'none'`.
- `POST /_pd/guide/chat`: `{ message }` in, server-sent events out (streamed answer, then a final `usage`-free `done`). Checks in order: session and grant live; link has guide allowance left; per-minute rate limit (6/min/link); daily budget; message at most 500 characters.
- The conversation is held **in gateway memory only** (last 10 turns, per grant session, expires with the session), never written to disk or logs.
- The browser renders the answer with `textContent` only (no HTML, no markdown links), so a hostile answer cannot become markup.

### The model call
- System prompt: fixed rules + the product guide, placed first and marked for prompt caching so repeated messages read it from cache (about 0.1x price). Check `usage.cache_read_input_tokens` > 0; if the guide is below the model's minimum cacheable size it silently will not cache, so measure.
- `max_tokens` 600, `output_config.effort: "low"`, streaming. No tools, no web, no thinking shown.
- Handle `stop_reason: "refusal"` with a friendly line; `max_tokens` ends with "ask us for more".
- Usage (`input_tokens`, `cache_read_input_tokens`, `output_tokens`) is recorded per link per day, plus an estimated cost from a price table in config.

### Limits and abuse
- Per link: allowance (default 20 messages), input cap, history cap, per-minute rate. Per gateway: daily estimated-cost cap, kill switch `DEMO_GUIDE=off`.
- The API key lives only in the gateway's environment (the supervisor's per-process environment list, F-06, must name `ANTHROPIC_API_KEY` for the gateway; no other process gets it).
- Prompt injection: customer text is untrusted, but there is nothing to steal or call: no tools, no demo data, no other customers' text in the prompt. Remaining risk is off-topic or wrong answers, bounded by the rules, the length cap and the eval.
- If the API is down or the key is rejected, the guide says so and the demo keeps working.

### Privacy and honesty
- What the customer types is sent to Anthropic's API to get the answer. The landing page must say so ("the guide is AI; what you type to it is processed by Anthropic; we do not keep it"), the Security page items change (the "what we do not record" text must stay true: the test that ties the page to the code must be extended), and `demo-gateway/README.md` documents it. The guide must say it is an AI and not a person.
- Counts only are stored: messages per link per day, tokens, estimated cost.

### Console, MCP, analytics
- Create-link form: "Guide messages allowed" (0 = no guide). MCP `create_demo_link`: `guideMessages`.
- Activity detail: guide messages used and spend per link; engagement could count guide use as activity.

## Steps (one commit each, tests gating every commit)
1. **Usage store**: `guide_usage` table (grant, day, messages, tokens, estimated cost) in both stores, `budget.mjs` (allowance, rate, daily cap, price table), contract tests.
2. **Content and prompt**: loader, prompt builder, registry flag, first guide files (drafted for you to correct), tests (missing file = no guide; size limits; rules text present).
3. **Client wrapper**: SDK dependency, streaming, refusal and error handling, usage extraction; tested against a fake client so no test spends money.
4. **Gateway routes**: `/_pd/guide`, `/chat`, `/guide.js`, CSP, auth, allowances, rate limit, in-memory history; tests with the fake client (no content persisted, over-limit answers, expired link, wrong product, SSE format, kill switch).
5. **Split view and landing**: "open with the guide" on the landing page, frame handling (an app that sends `X-Frame-Options: DENY` will not frame; check each product, and decide per product whether the gateway may relax it for the guide page only), mobile layout, browser test with the fake client.
6. **Owner side**: console form and detail, MCP field, README, Security page and notice updates (and their tests).
7. **Quality check**: build an eval set of about 30 questions per product (including pricing traps, off-topic, injection attempts, "are you a person?"), judge with a rubric, run it once on the chosen model (a few cents, with your approval), then tune the guide text; one live smoke test with the real key.

## Risks
- **Wrong or invented answers** about the product: mitigated by a guide written from facts you confirm, an instruction to say "I don't know, ask {brand}", and the eval.
- **Cost surprises**: allowance, per-minute and daily caps, Console spend limit on a dedicated key.
- **Framing breaks some demo apps** (frame-busting scripts, DENY headers): found per product in step 5; fallback is the separate-tab mode.
- **Trust**: customers must know it is an AI and where their text goes; this is stated on the page they see first.
- **Dependency and image size**: one new package; the Docker image and CI need it.

## Not in scope
Tools or actions inside the demo, reading the demo's data, voice, remembering customers between links, storing questions (unless you decide so), injecting anything into the apps.
