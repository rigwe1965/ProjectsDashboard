# Plan: selling RECI, ClaudeOS and RMM per deployment

Status: proposal of 2026-11-16, for the owner's decisions. Nothing here is built. Facts below come from reading the three codebases and their GitHub settings on that date; each is marked as checked or not.

## What this is for

The CRM earns money through plans and included AI. The other products are not multi-customer web services: each one runs as one copy for one customer. This plan is how to sell those copies without metering anything by the minute. The customer brings their own Anthropic key and picks their own Claude model (already built in all three), so the AI cost is theirs.

## What I found (checked)

| | RMM (remote IT management) | RECI / ClaudeWorkspace (car rental) | ClaudeOS |
|---|---|---|---|
| Who it is for | An IT support company managing devices for its own customers | One car-rental business and its renters | One person or team running Claude agents |
| What a deployment is | Docker stack: API, dashboard, frontend, Postgres, Redis, Celery, nginx, plus an agent installed on each managed device | A Supabase project (15 migrations) plus two Vercel apps (web and admin), Stripe, Resend; also an Expo mobile app | Flask API plus Streamlit dashboard, SQLite, runs on Windows 10 or a server |
| Natural thing to count | Managed devices, staff users | Vehicles in the fleet | Nothing obvious: it is a tool, not a business system |
| Licence in code today | None. A tier table exists (standard 25 devices and 5 users, premium 250 and 25, enterprise unlimited) but no route calls the check and nothing counts devices or users | None | None |
| Repository | **Public on GitHub, no licence file** | Private, no licence file | **Public on GitHub, MIT licence** |
| Where the AI key comes from | `ANTHROPIC_API_KEY` on the server | `ANTHROPIC_API_KEY` on the server | `ANTHROPIC_API_KEY` on the server; it refuses to start without one |
| Brand and business details | Generic | **Hard-coded**: "RECI" appears on about 150 lines of source and there is no brand setting; Berlin and a German phone number are written into pages and AI prompts | Generic |

Two of these decide the design:

1. **ClaudeOS is MIT licensed and public.** Anyone who already has the code may use, copy, change and sell it. The licence file names you as the copyright holder, so you can probably license *future* versions differently (a lawyer should confirm, especially if anyone else has contributed code), but versions already published stay MIT forever. A paid licence cannot be forced onto code that is already free.
2. **RMM is public with no licence file.** Generally, code published without a licence may be read but not freely reused, so a paid licence can work (a lawyer should confirm). But anyone can read all of the code, which weakens any technical lock.

## The recommendation, product by product

**RMM: sell a licence per deployment, counted in managed devices.** It is the best fit: an IT company that runs it for its own customers earns money per device, so paying per device is natural. Two ways to buy:
- *Self-hosted:* the customer runs the Docker stack; yearly licence by device band.
- *Hosted by you:* you run it on your Hetzner server for them; monthly, more margin, more responsibility (backups, updates, security, and a data processing agreement, because it holds their customers' device data).

Use the tier table that already exists as the starting point for the bands. Make the public repository private before selling (see decisions).

**RECI / ClaudeWorkspace: sell a set-up plus a monthly fee per business, counted in vehicles, after a white-label step.** It cannot be given to a second company as it is, because the RECI name and Berlin details are written into the source. The prerequisite build is one brand and business settings file (name, address, phone, currency, language, logo, colours) that the pages and AI prompts read instead. The mobile app is a separate cost per customer (their own store listing); sell the web portal and admin first and treat mobile as an add-on.

**ClaudeOS: do not build a licence lock. Treat it as the free product that brings leads, and sell around it.** Keep the MIT core. Earn from things that are not already free: paid skill packs (the Agensi route you are already exploring), a hosted ClaudeOS you run for a customer, and paid set-up and support. If you later want a closed premium edition, license only new code separately and keep the MIT core as it is. This is a business decision more than a technical one.

## How a licence would work (one small design for all three)

- **A signed licence file.** You sign a small piece of text with a private key only you hold (never in any repository or server the customer controls). It says: product, customer name, tier, limits (devices, users or vehicles), issue date, expiry date. The product holds only the matching public key and checks the signature on its own, with no internet needed.
- **Soft limits, never a shutdown.** Following "don't break a running system": when a licence is near its end or over its limit, the admin sees a banner and gets an email. At the limit you cannot *add* more (a new device, a new vehicle); everything already there keeps working. After expiry there is a 30-day grace period, then the product becomes read-only for changes. Data is never locked or deleted.
- **You issue licences from a command**, like your existing `tenant-admin` tool: `licence issue --product rmm --customer "Acme IT" --devices 250 --until 2027-11-30`. Renewal means issuing a new file. Revocation in version one is expiry only; there is no call home.
- **Honest limit of this:** in a self-hosted product the customer controls the machine and can edit the code, especially where the source is visible. The licence says what they are entitled to; the contract, the support, the updates and the hosting are what make paying worthwhile. Do not over-invest in locks.

## Optional later: AI included for hosted customers

For deployments you host, the CRM's included-AI pattern (allowance, prepaid credit, append-only ledger, spend alert) could be reused so a customer need not have an Anthropic account. Not needed for version one: the customer's own key already works.

## Build order (each step its own PR, each safe on its own)

1. **Licence library**: sign, verify, limits, grace period, banner text; with tests; no product uses it yet. (shared, small)
2. **Licence command** to issue and inspect licence files on your machine.
3. **RMM**: count enrolled devices and users, enforce the soft limit, show the banner. Smallest gap because the tier table exists.
4. **RECI white-label**: brand and business settings, then the same licence check on vehicles.
5. **ClaudeOS**: no licence; instead the hosted-instance recipe and the skill-pack route.
6. **Customer paperwork**: licence agreement and, for hosted deployments, a data processing agreement (needs a lawyer, like the CRM terms).

## Risks

- A public repository (RMM) shows every line to a buyer and a copier alike. A private one costs nothing and keeps the option of selling.
- Every self-hosted copy is a support and update burden. Price for it.
- White-labelling RECI touches about 150 lines of working, live code. It needs the same care as any change to RECI Transport's production site.
- RMM hosted by you makes you a processor of other companies' device data: legal work before the first hosted customer.

## Decisions I need from the owner (recommendation first)

1. **RMM repository:** make it private before selling? *Recommended: yes.* Nothing changes for the running demo.
2. **ClaudeOS:** keep MIT and sell skills, hosting and support, or plan a separate premium edition? *Recommended: keep MIT; sell around it.*
3. **RECI:** go ahead with the white-label build, accepting a change to the live site's source? *Recommended: yes, as its own PR with the full test run first.*
4. **How you want to be paid:** invoices by hand or Stripe invoices for the first few customers, before any automation. *Recommended: Stripe invoices, by hand.*
5. **Prices and bands:** yours to set. No price is assumed here. The RMM tier table (25, 250, unlimited devices) is a starting shape, not a price list.
6. **Self-hosted, hosted by you, or both**, per product. *Recommended: both for RMM, hosted first for RECI.*
