## What and why

<!-- One or two sentences: what changes, and the problem it solves. -->

## Checklist

- [ ] Branch is `feat/…`, `fix/…`, `docs/…` or `chore/…`; nothing committed straight to `main`
- [ ] `npm test` and `npm run lint` pass (CI also runs the Windows tests, the image build and the secret scan)
- [ ] No secrets, keys, personal data, customer names or server addresses in the diff
- [ ] `CHANGELOG.md` updated under `[Unreleased]` if users will notice the change
- [ ] Changes an app's registry entry or a deploy recipe? Say how the live server is affected, and check no demo link is active first
- [ ] Deploy needed? Say what to run, because merging deploys nothing
