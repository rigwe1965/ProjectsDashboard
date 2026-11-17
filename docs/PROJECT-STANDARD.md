# Facyke project standard

One way of setting up and changing every product, so any member of staff can open any repo and know where things are. Status: DRAFT for owner approval (2026-11-17). Nothing in this document has been applied to a repo yet.

## 1. What is a "product" and what is not

| Kind | Lives in | Rules |
| --- | --- | --- |
| **Product** (software we run or sell) | Its own GitHub repo, one folder on the Desktop | Everything in this standard |
| **Dashboard** (`ProjectsDashboard`) | Its own repo; runs and hosts the products | Same rules; also holds company docs and the onboarding book |
| **Documents** (contracts, letters, PDFs, community files) | `Archive\` folder, not in git | No version process |
| **Secrets** (credentials, keys, 2-step files, `.env` backups) | `Secrets\` folder outside every project, never in git | Never in a repo, a chat or an email |
| **Scratch** (logs, test output, worktrees) | Deleted when finished | Not kept |

## 2. Products and their repos

| Product | GitHub repo | Default branch | Visibility (recommended) |
| --- | --- | --- | --- |
| RECI (Car rental / ClaudeWorkspace) | `RECI` | main | private |
| CRM | `CRM` | main | private |
| RMM | `remotemanagementsystem` | main | private |
| ClaudeOS | `claudeOS` | main | public (MIT) |
| Airfinder | `Airfinder` | main | owner decides |
| ImageApp | `ImageApp` | main | owner decides |
| ProjectsDashboard | `ProjectsDashboard` | main | private |

The Desktop folder name should equal the repo name, apart from the known exception: RECI's repo root is `ClaudeWorkspace\reci-transport` (kept as it is on purpose, because the live demo build path depends on it).

## 3. Standard files in every product repo

| File or folder | Purpose |
| --- | --- |
| `README.md` | What it is, how to run it in 5 minutes, where the docs are |
| `CHANGELOG.md` | One entry per released version, newest first |
| `LICENSE` | Present on every repo; MIT only for ClaudeOS, "all rights reserved" notice for the rest |
| `CLAUDE.md` | Rules and gotchas for the AI assistant working in the repo |
| `.env.example` | Every setting with a fake value. Real `.env` is gitignored |
| `.gitignore` | Must cover `.env*`, `node_modules`, logs, build output |
| `docs/` | Architecture, runbook, decisions |
| `tests/` | Automated tests that CI runs |
| `.github/workflows/` | CI: tests and build on every pull request |
| `.github/dependabot.yml` | Weekly dependency update PRs |
| `.github/pull_request_template.md` | Checklist shown on every PR |
| `SECURITY.md` | How to report a problem |

## 4. The version process (same for every product)

1. **`main` is always releasable.** Nobody commits to it directly.
2. **Every change is a branch + pull request.** Names: `feat/…`, `fix/…`, `docs/…`, `chore/…`.
3. **A PR merges only when CI is green and the checklist is done.** Tests must pass before the commit, not after.
4. **Versions are numbers `MAJOR.MINOR.PATCH`** (for example `1.4.2`). PATCH = bug fix, MINOR = new feature that does not break anything, MAJOR = a change that breaks existing customers.
5. **A release = a tag `v1.4.2` + a CHANGELOG entry + a GitHub release.** Done by whoever merges the last PR of that version.
6. **Deploying is separate from merging.** Merging deploys nothing. A person runs the documented deploy step for that product.
7. **Database changes** are numbered migrations in the repo, applied to the live database before the code that needs them is deployed.

## 5. Protecting what is online (facyke.com and customers)

- Local folder renames, moves and file clean-ups never touch the server: the server builds from its own clones in `/srv/apps` and `/home/deploy`.
- These DO affect the online system and need a check first: making a repo private (the server pulls public repos without a key), renaming a repo, changing the registry (`registry/apps.json`), changing Vercel project links.
- Before any such change: confirm no demo link is active (`demo-reset-state.mjs due <product>`), do the change, then test from the server and open the demo as a customer.
- Production for RECI is deployed manually on Vercel; keep it that way until CI works on private repos.

## 6. Folder map for staff

```
Desktop\
  ProjectsDashboard\   control console, hosting, company docs
  ClaudeOS\  CRM\  RemoteManagementSystem\  Airfinder\  ImageApp\
  ClaudeWorkspace\reci-transport\   RECI (car rental)
  Archive\             documents, not in git
  Secrets\             outside every repo, offline backup
```

## 7. Open items before this becomes the rule

- Owner approves sections 2 and 3, and the visibility column.
- Billing fix, so CI runs on private repos.
- Decide who is allowed to merge and tag (needed for branch protection).
