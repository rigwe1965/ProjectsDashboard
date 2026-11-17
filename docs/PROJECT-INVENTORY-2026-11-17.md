# Project inventory (read-only, 2026-11-17)

Measured on the folders as checked out on the Desktop (branch in brackets), and on GitHub. Nothing was changed. Compare with `PROJECT-STANDARD.md`.

| Product (branch checked out) | README | CHANGELOG | LICENSE | CLAUDE.md | .env.example | CI | Dependabot | PR template | SECURITY | tests | docs | tags | main protected |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ClaudeOS (`fix/eval-scoring`) | yes | yes | yes (MIT) | yes | yes | not on this branch | no | no | no | yes | yes | 0 | no |
| RMM (`feat/ai-model-allowlist`) | yes | no | no | yes | yes | yes | yes | no | no | yes | yes | 0 | yes |
| CRM (`feat/included-ai-ledger`) | yes | no | no | yes | yes | yes | yes | no | no | yes | no | 0 | no (default branch renamed to `main` 2026-11-17) |
| Airfinder (`main`) | **no** | no | no | yes | yes | no | no | no | no | no | no | 0 | no |
| ImageApp (`main`) | yes | no | no | no | no | yes | no | no | no | yes | no | 0 | no (default branch renamed to `main` 2026-11-17) |
| ProjectsDashboard (`main`) | yes | no | no | no | no | yes | yes | no | no | yes | yes | 0 | no |
| RECI (`main`) | **no** | no | no | yes | yes | yes | no | no | no | no (in apps) | yes | 0 | no |

## Findings

1. **No repo has a version tag, a release, a PR template or a SECURITY.md.** The version process does not exist yet anywhere.
2. **Only RMM has a protected `main`.** The others allow direct pushes.
3. **Default branch is now `main` everywhere** (CRM, ImageApp and Learn were renamed from `master` on 2026-11-17; open PRs and old links redirect; CI files already listed both names).
4. **Three missing READMEs/licences that staff would hit first:** Airfinder and RECI have no README; only ClaudeOS has a LICENSE.
5. **Three local folders are not on `main`:** ClaudeOS, RMM, CRM (feature branches), so what is on the Desktop is not what is merged. ClaudeOS also has 6 uncommitted changes.
6. **Local `origin` URL is dead for Airfinder** (old `Obinwanne1` account), so pushing from that folder fails or goes elsewhere. ImageApp was fixed on 2026-11-17 (now `rigwe1965/ImageApp`).
7. **Dashboard has 3 uncommitted items** (README change, onboarding book .md and .html).
8. **Clutter:** leftover worktrees (`crm-prisma7`, `rmm-licence`, `crm-upgrade`), `RAG system` and `Start` (git, no remote), about 40 loose files on the Desktop including credential-type files.
9. **Visibility today:** public = RMM, ClaudeOS, Airfinder, ImageApp, RAG-system, CleanUpDashboard, Learn, AI-Billing, ResumeAnalyzer, SupportChatbot. Private = RECI, ProjectsDashboard, CRM.
10. **CI on private repos fails** (billing), so RECI and CRM have workflows that cannot run today.
