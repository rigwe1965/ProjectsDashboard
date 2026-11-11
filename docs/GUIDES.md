# Writing a product guide

The AI demo guide knows only what is in `guides/<product>.md` (the file is named after the product, as in `registry/apps.json` `demoOf`, for example `crm`). It is sent with every question, so keep it short and true.

## Turning a draft into a guide
1. Open the draft (`guides/crm.md`, `guides/rmm.md` are drafts written from the public product copy) next to the real demo.
2. Fix every statement that is not exactly true of the demo, using the **screen labels** a customer sees.
3. Write 3 to 5 short tours under "Tours": numbered steps, real menu names ("1. Open Contacts. 2. Search for a company.").
4. List what the guide must pass to you (pricing, contracts, security promises, custom work).
5. Delete every line containing `TODO(owner)` (and the comment at the top). A file that still has one is a draft and is not used: the console shows "still a draft" and will not give a link a guide for that product.
6. Make sure the demo entry in `registry/apps.json` has `"guide": true`.

## Size and rules
- 200 to 24,000 characters (about 6,000 tokens at most). Smaller is cheaper and more accurate.
- Plain Markdown. Do not put secrets, prices or promises in it: the guide may repeat anything it is given.
- Demo sign-ins come from the registry (`demoAccounts`); the owner-only ones are never offered.
- The file is read on every message, so a correction is live at once. Check the new answers with a link of your own first.

## What it costs
Haiku 5.5: about 2 cents for a long conversation (20 messages), estimated. The gateway stops at `GUIDE_DAILY_CAP_USD` (default 2) and each link at its allowance. The console shows each link's use and estimated cost; Anthropic's bill is the real figure.

## Checking the answers (before customers see it)
```
npm run eval:guide -- crm                 # how many questions, estimated cost; sends nothing
npm run eval:guide -- crm --smoke --yes   # two calls: is the key good, is the guide cached
npm run eval:guide -- crm --yes           # about 37 questions: pricing traps, off-topic, injection attempts, "are you a person?", how-to
```
Set `ANTHROPIC_API_KEY` in your own shell first (a dedicated key with a spend limit); it is never printed or saved. A full run costs a few cents on Haiku 5.5. Each answer is checked by simple patterns (`tests/guide-eval/cases.mjs`): no price, no promise, no markdown, refers to you, says it is an AI, does not obey an injected instruction. The report lists each failure with the question and the answer; fix the guide (or loosen a pattern that is too strict) and run again. `--allow-draft` tries a guide that still has TODO(owner) lines. Full answers are saved under `tests/guide-eval/results/` (not committed). The report also shows how much of the prompt came from the cache.
