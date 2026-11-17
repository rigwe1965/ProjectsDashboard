# The Facyke / ProjectsDashboard Onboarding Book

**Everything a new person needs to understand, run, support and manage this project, from day one.**

*Written 17 November 2026 and fully updated the same evening with everything changed that day (see chapters 21 and 22). It is for the repository `rigwe1965/ProjectsDashboard`. It contains no passwords, keys or private addresses, and you must never add any. When this book and the live system disagree, the live system wins: check it, then fix the book.*

---

## How to use this book

This book is written for people who have **never seen the project**. You do not need to know programming to read Parts 1, 2 and 3. Every idea is explained in plain words first, then shown with examples.

Pick your path:

| You are… | Read first | Then | Keep open while working |
| --- | --- | --- | --- |
| **A manager / owner** | Part 1 (the idea), Part 3 (management) | Part 2 chapter 6 (hosting in plain words), chapter 12 (risks) | Appendix A (checklists) |
| **A technical person** (developer, operator) | Part 1, Part 2 | Part 4 (technical handbook) | Appendix B (cheat sheet) |
| **A support person** | Part 1 chapters 1–3, Part 5 (support playbook) | Part 4 chapters 13–14 when you need more | Part 5 issue catalogue |

**The rule of five examples.** Wherever this book explains a problem or an idea, it gives **three to five worked examples**, each in the same shape, so you can recognise your own situation:

> **Situation** (what someone says or sees) → **Cause** (why it happens) → **Fix** (what you do) → **Lesson** (what to remember)

**Your first day in one list**

1. Read chapters 1 and 2 (20 minutes). You will know what the company sells and why this project exists.
2. Read chapter 3 (the glossary) and chapter 4 (the picture). Now the words in the rest of the book make sense.
3. Do the "Day 1 walk-through" in chapter 9. You will create a demo link and revoke it yourself.
4. Skim Part 5's table of contents so you know where to look when something breaks.

---

## Contents

**Part 1: Understanding the project**
1. [The idea in plain words](#1-the-idea-in-plain-words)
2. [The company and its six products](#2-the-company-and-its-six-products)
3. [Glossary: the words you will hear](#3-glossary-the-words-you-will-hear)
4. [The big picture: how the parts fit](#4-the-big-picture-how-the-parts-fit)

**Part 2: Where it runs (hosting)**
5. [Two places it can run: your PC and the server](#5-two-places-it-can-run-your-pc-and-the-server)
6. [The hosted setup explained](#6-the-hosted-setup-explained)
7. [Money: what things cost](#7-money-what-things-cost)

**Part 3: For management**
8. [What management needs to know](#8-what-management-needs-to-know)
9. [Day 1 walk-through](#9-day-1-walk-through)
10. [Reading the numbers: who is really interested?](#10-reading-the-numbers-who-is-really-interested)
11. [Selling per deployment: licences](#11-selling-per-deployment-licences)
12. [Risks and open decisions](#12-risks-and-open-decisions)

**Part 4: Technical handbook**
13. [The parts in detail](#13-the-parts-in-detail)
14. [Everyday commands](#14-everyday-commands)
15. [Updating the live server safely](#15-updating-the-live-server-safely)
16. [Security: how the project protects itself](#16-security-how-the-project-protects-itself)
17. [Tests, CI and the way we change code](#17-tests-ci-and-the-way-we-change-code)
18. [The AI features and keys](#18-the-ai-features-and-keys)

**Part 5: Support playbook**
19. [How to handle any support request](#19-how-to-handle-any-support-request)
20. [Issue catalogue (with 3–5 examples each)](#20-issue-catalogue)

**Part 6: Where each project stands**
21. [Project by project (state at the end of 17 November 2026)](#21-project-by-project-state-at-the-end-of-17-november-2026)
22. [What changed on 17 November 2026](#22-what-changed-on-17-november-2026)

**Appendices**
- [A. Checklists](#appendix-a-checklists)
- [B. Cheat sheet](#appendix-b-cheat-sheet)
- [C. Where to find things](#appendix-c-where-to-find-things)
- [D. The golden rules](#appendix-d-the-golden-rules)
- [E. Frequently asked questions](#appendix-e-frequently-asked-questions)

---

# Part 1: Understanding the project

## 1. The idea in plain words

### The problem

The owner builds software products: a CRM, a car-rental system, an IT-management tool and others. To sell software, people must be able to **try it**. But you cannot hand a stranger the keys to the real system that holds your own data. And you cannot spend every day setting up a private test copy by hand.

### The solution: a showroom with a doorman

Think of a car dealership.

- The **cars you drive every day** are your *real apps*. Nobody else touches them.
- The **showroom cars** are *demo copies*: same model, sample data, safe to be sat in and fiddled with.
- The **doorman** (the *gateway*) checks each visitor's *appointment card* (a *demo link*): is it valid, has it expired, has it been used too often? Only then does the visitor get into the showroom, and only into the one car they came for.
- The **manager's office** (the *admin console*) is where you see which cars are running, hand out appointment cards, and read who visited.
- The **shop window** (the *showcase*) is the public website that shows what you sell.
- The **mechanic** (the *supervisor*) starts and stops the cars.
- The **list on the wall** (the *registry*) says which cars exist, where they are parked, and how to start each one.

**ProjectsDashboard is all of those parts together.** It does not contain the products themselves. It *points at them*, starts them, protects them, and lets customers try them.

### The one sentence to remember

> ProjectsDashboard lets the owner give a customer a **time-limited, safe link** to try one product's **sample-data copy**, watch whether they use it, and then close it, all without ever touching the real apps.

### Five everyday examples of the idea at work

**Example 1: The prospect.** A sales lead, Dana at Acme Ltd, wants to see the CRM. The owner creates a link for 48 hours and at most 3 visits, and writes "Prepared for Dana at Acme". Dana clicks it, reads a short notice that this is a demo with sample data, clicks a button, and is inside the CRM demo. After two days the link stops working by itself.

**Example 2: The forwarded link.** Dana forwards the link to a colleague. The owner had switched on "lock to first browser". The colleague's browser is refused, and the refusal shows up in the Activity list. The owner sees the forwarding attempt and can decide whether to send the colleague their own link.

**Example 3: The nosy email scanner.** Many companies' email systems automatically open links in emails to check them for viruses. If that used up a visit, Dana's link would be spent before she read the email. So **just looking at the link page never uses a visit**. Only clicking the button does.

**Example 4: The owner's own data stays safe.** While Acme tries the CRM demo and types in fake contacts, the owner's real CRM (different port, different database) never changes. Even if Acme deleted every record in the demo, the real CRM is untouched.

**Example 5: Closing early.** Acme says "no thanks" on day one. The owner presses *Revoke*. At that instant the link dies, even for a page that is currently open, because the gateway re-checks the link on every request.

### What this project is NOT

- It is **not** the products. Each product (CRM etc.) is a separate project with its own folder, settings, database and repository.
- It is **not** a place to store customer data. The only personal data it keeps is a customer label you type, plus the address and browser type of people who opened a link (kept 90 days).
- It is **not** secure by magic. Chapter 16 explains what is protected and what is not.

---

## 2. The company and its six products

The brand is **Facyke**. The website is `facyke.com`. (The brand used to be spelled *faiyke*; some internal names such as `faiyke-ai` still use the old spelling on purpose. Do not "fix" them without checking.)

### The six products

| Product | Internal id | What it is, in one sentence | Who buys it | How the demo works |
| --- | --- | --- | --- | --- |
| **CRM** | `crm` | Contacts, companies, deals and tasks in one place for small sales and support teams | Small businesses | One shared demo, reset between customers |
| **Remote Management (RMM)** | `rmm` | Monitor devices, patch them, answer alerts and support users | IT service providers | One shared demo with *simulated* devices; pages that would need a real agent explain this instead of pretending (chapter 21) |
| **CarRental** (internal name *ClaudeWorkspace*, code name *RECI*) | `claudeworkspace` | A booking site where customers rent cars, plus an admin portal for the team | Car-hire companies | One shared demo on a separate demo database |
| **Airfinder** | `airfinder` | Flight search and booking, with search by plain-language request | Travel agencies | A private copy for every link |
| **Image Optimizer** (*ImageApp*) | `imageapp` | Upload an image, tune quality/format/size with live preview | Anyone | A private copy for every link |
| **ClaudeOS** | `claudeos` | One dashboard for AI skills, agents and workflows, with shared memory and client workspaces | Teams using Claude | A private copy for every link |

> **Why three names for one product?** *CarRental* is the name on the website. *ClaudeWorkspace* is the name of the folder and the registry id. *RECI* is the name of the code repository and of the first customer's brand. When someone says "RECI", they mean CarRental. Always check which one a document means.

### How the company makes money (the business idea)

1. **Showcase + demo links** bring in interest. A prospect sees the public page, asks for a demo, and gets a link.
2. **Activity numbers** (chapter 10) tell the owner who actually used the demo, so sales time goes to people who are really interested.
3. **Two ways to sell**
   - **CRM** is sold as a service with plans and included AI.
   - **RMM, CarRental and ClaudeOS** are sold *one copy per customer* ("per deployment"): each customer gets their own copy that they (or Facyke) run. They bring their own Anthropic key and choose their own Claude model, so the AI cost is theirs. Chapter 11 explains the licence idea.

### Five examples: "which product would I show?"

1. *A florist with three staff wants to keep track of customers and follow-ups.* → **CRM**.
2. *An IT shop looks after 200 office computers for local firms and drowns in alert emails.* → **Remote Management**.
3. *A man owns 12 cars and wants customers to book online.* → **CarRental**.
4. *A travel agent wants customers to type "cheapest flight to Lagos in March" and get answers.* → **Airfinder**.
5. *A designer keeps shrinking pictures for a website and wants quality never to degrade.* → **Image Optimizer**.

---

## 3. Glossary: the words you will hear

Keep this page handy. Words are in the order you will meet them.

| Word | Plain meaning | Example |
| --- | --- | --- |
| **App / product** | One of the six things we sell | "The CRM" |
| **Real app** | Your own copy with your own data. Customers never see it | CRM on port 3101 on the owner's PC |
| **Demo instance / demo copy** | A separate copy with its own database and sample data | `crm-demo` on port 3111 |
| **Registry** | The list of all apps and demos: where, how to start, which port | `registry/apps.json` |
| **Supervisor** | The command-line tool that starts, stops and checks apps | `node supervisor/index.mjs status` |
| **Admin console** | The owner-only web page for controlling everything | `admin.facyke.com` |
| **Gateway** | The doorman: checks demo links and passes customers through | Port 4300 locally |
| **Showcase** | The public product website | `facyke.com` |
| **Link / grant** | The time-limited ticket for one customer and one product (the code calls it a *grant*) | "Grant a1b2c3d4 for Acme Ltd" |
| **Token** | The long random secret part of the link. Shown once; only a *hash* is stored | `/d/<long-random-token>` |
| **Revoke** | Cancel a link immediately | Button in console |
| **Shared demo** | One demo copy used by every customer of that product, reset to sample data between customers | CRM, RMM, CarRental |
| **Private copy per link** | Each link gets its own fresh copy, deleted afterwards | ImageApp, Airfinder, ClaudeOS |
| **Seat** | One private copy slot. If all seats are in use, new visitors wait | ImageApp has 4 seats locally |
| **Reset** | Put a shared demo back to its sample data | `reset-demos.sh` |
| **demoReady** | Registry flag meaning "this demo has its own data; the gateway may serve it" | Never set to true without checking |
| **Process** | One running program of an app (an app can have several) | ClaudeOS has `api` and `ui` |
| **Health check** | A web address that answers "I'm alive" | `/api/health` |
| **Port** | A numbered door on a computer. Each program uses its own | 4100 console, 4200 showcase, 4300 gateway |
| **Audit log** | The permanent diary of who did what and when | Link created, opened, refused |
| **Activity** | Per-link usage counts (requests, active minutes) with no personal content | "Engaged", "Came back" |
| **2-step code (TOTP)** | The 6-digit code from an authenticator app, needed with the password | Console sign-in |
| **ADMIN_DATA_KEY** | A secret that locks the stored 2-step secret in the database | Lose it → re-enrol 2-step |
| **Environment variable (env)** | A setting given to a program from outside its code | `ALERT_WEBHOOK_URL` |
| **.env file** | A file of secret settings. Never committed to git | `deploy/.env` |
| **Docker / container** | A sealed box that holds a program and everything it needs | `crm-demo` container |
| **Docker Compose** | One file (`docker-compose.yml`) that describes and starts all containers | `docker compose up -d` |
| **Caddy** | The front door of the server: gets HTTPS certificates and routes traffic | Needs no manual certificate work |
| **Postgres** | The database used on the server | Holds links, sessions, audit |
| **SQLite** | The simple one-file database used on the owner's PC | `data/dashboard.db` |
| **Hetzner** | The company whose server we rent in Helsinki | Server `facyke-prod` |
| **Cloudflare** | Where the domain `facyke.com` is registered and its DNS is managed | DNS-only records |
| **DNS** | The internet's phone book: turns `admin.facyke.com` into a server address | A records |
| **MCP server** | A helper that lets an AI assistant look at the dashboard | `npm run mcp` |
| **AI guide** | The chat box beside a demo that answers "how do I…?" | Opt-in per link |
| **CI** | Automatic checks that run on GitHub when code is pushed | Lint + tests |
| **PR (pull request)** | A proposed code change that others can review before it is merged | "PR #50" |
| **Licence (FKL1)** | A signed line of text that switches on a product copy for one customer | Chapter 11 |

---

## 4. The big picture: how the parts fit

### The parts

```mermaid
flowchart TD
  R["Registry<br/>registry/apps.json<br/>(the list of apps)"]
  R --> S["Supervisor<br/>start · stop · check"]
  R --> C["Admin console<br/>owner only"]
  R --> G["Demo gateway<br/>checks customer links"]
  S --> A["Real apps<br/>your data"]
  S --> D["Demo copies<br/>sample data"]
  G --> D
  C --> S
  C --> DB[("Store<br/>SQLite locally<br/>Postgres on server")]
  G --> DB
  SH["Showcase<br/>public product pages"]
  M["MCP server<br/>for an AI assistant"] --> DB
```

### A customer's journey, step by step

```text
 Owner                    Gateway                      Demo copy
   |  1. create link         |                              |
   |------------------------>|  (stores a HASH of token)    |
   |  2. sends link by email |                              |
   |                         |                              |
 Customer                    |                              |
   |  3. opens link (GET)    |                              |
   |------------------------>|  shows notice + button       |
   |                         |  (spends NOTHING)            |
   |  4. clicks button (POST)|                              |
   |------------------------>|  checks: valid? expired?     |
   |                         |  uses left? right browser?   |
   |                         |  → gives a random session    |
   |                         |    cookie (not the link)     |
   |  5. uses the demo       |  re-checks every request     |
   |------------------------>|----------------------------->|
   |                         |                              |
   |  6. link expires/revoked: next request is refused      |
```

### Ports at a glance (on the owner's PC)

| Part | Port |
| --- | --- |
| Admin console | 4100 |
| Showcase preview | 4200 |
| Demo gateway | 4300 |
| Real CRM / demo CRM | 3101 / 3111 |
| Real CarRental web, admin / demo | 3102, 3103 / 3112, 3113 |
| Real Airfinder / demo | 5200 / 5210 |
| Real ImageApp / demo | 5400 / 5410 |
| Real ClaudeOS api, ui / demo | 5100, 8601 / 5110, 8611 |
| Real RMM api, ui / demo | 5300, 8701 / 5310, 8711 |

Port **3000** is reserved because an unrelated program on the PC uses it. The dashboard never starts anything there.

### The folders

| Folder | What is inside | Touch it? |
| --- | --- | --- |
| `registry/` | `apps.json` (local) and an example for hosting | Yes, to add/change an app |
| `supervisor/` | Start/stop code, backup and alert commands, demo reset helpers | Developers |
| `admin-console/` | The owner web page and sign-in tools | Developers |
| `demo-gateway/` | The doorman, link manager, AI guide | Developers |
| `showcase/` | Public site text (`site.json`, `products.json`, `security.json`) and the builder | Yes, to change public text |
| `mcp/` | The assistant helper | Developers |
| `lib/` | Shared code: storage, sign-in, backups, alerts, licence checks | Developers |
| `licensing/` | Licence format, issuing tool | Owner/developer |
| `deploy/` | Docker Compose, Caddy, per-app recipes, server helper scripts | Operators |
| `guides/` | The AI guide texts (`crm.md`, `rmm.md`) | Yes, to improve the guide |
| `docs/` | Plans and books (this book lives here) | Yes |
| `audits/` | Written security and code reviews | Read |
| `tests/` | Automatic tests | Developers |
| `data/` | Runtime data (database, logs, demo copies). **Ignored by git. Never commit.** | No (except via tools) |

> **Important.** The folders inside this project with the same names as the apps (`CRM`, `ClaudeOS`, …) are **old stale copies**, ignored by git. The real source for each app is its own folder on the Desktop (`C:\Users\rigwe\Desktop\<App>`).

---

# Part 2: Where it runs (hosting)

## 5. Two places it can run: your PC and the server

| | **Owner's PC (local)** | **The server (hosted)** |
| --- | --- | --- |
| Who can reach it | Only this PC (`localhost`) | Anyone on the internet, with a valid link |
| Database | SQLite file `data/dashboard.db` | Postgres container |
| How it starts | Double-click `start-console.bat` etc., or `npm run …` | `docker compose up -d` (always on) |
| Customer links look like | `http://crm.localhost:4300/d/<token>` (this PC only) | `https://crm.demo.facyke.com/d/<token>` (public) |
| Demos run as | Programs on the PC, started by the supervisor | Sealed Docker containers |
| When the PC is off | Everything stops | The server keeps running |
| Used for | Development, testing, the owner's real apps | Customers |

### Five examples: "which one is this about?"

1. *"My link says the site can't be reached."* → The link was made locally (`localhost`). It only works on the owner's PC. Create the link in the **hosted** console (`admin.facyke.com`).
2. *"I changed the showcase text but the public site did not change."* → You changed local files. The public site changes only after the new code reaches the server (chapter 15).
3. *"The alert says the database is down."* → Which console sent it? The PC's console checks the PC's processes; the server's console checks the server's.
4. *"I forgot the PC off and the demo died."* → The demo was on the PC. Hosted demos do not depend on the PC.
5. *"I need to test a risky change."* → Do it locally first. Never experiment on the live server.

---

## 6. The hosted setup explained

This chapter explains the live system, step by step, with the reason for each choice.

### 6.1 The shape of it

```text
                        the internet
                             |
                   Caddy  (ports 80 and 443)    ← automatic HTTPS
        ┌────────────────────┼──────────────────────┐
   facyke.com        admin.facyke.com       <product>.demo.facyke.com
   (showcase)        (owner console)        (customer demos)
                             |                      |
                          console               gateway ──► demo containers
                             └────── Postgres ──────┘          (one per product,
                                                               each on its own network)
```

Everything runs on **one rented server** using Docker Compose. Only Caddy's ports 80 and 443 are open to the world.

### 6.2 The ingredients and why each exists

| Ingredient | What we use | Why |
| --- | --- | --- |
| **Domain** | `facyke.com`, registered at **Cloudflare** (2 years, auto-renew on) | One name for everything. Cloudflare has honest pricing and good DNS |
| **DNS records** | `@` (the site), `admin`, `*.demo` (wildcard), `www`, all **DNS-only (grey cloud)** pointing to the server | Wildcard means every product gets its own address without new setup. Grey cloud means Cloudflare only gives addresses and does *not* sit in front of the traffic, so Caddy handles certificates itself |
| **Server** | **Hetzner Cloud**, server name `facyke-prod`, type CPX22 (2 CPU, 4 GB RAM, 80 GB disk), Helsinki, Ubuntu 24.04 | The owner is in Germany; Hetzner is cheap, European and reliable. About €20 a month, billed hourly |
| **Front door** | **Caddy** | Gets and renews free HTTPS certificates automatically |
| **Containers** | **Docker Compose** | One file describes the whole system; easy to rebuild or move |
| **Database** | **Postgres** (container) | Holds links, sessions, audit log; backed up daily |
| **Email alerts** | **Resend**, sender `alerts@facyke.com` | The server emails the owner when something is down |
| **AI key** | A dedicated key from the Anthropic workspace **`facyke-demos`** with a **$5 per month limit** | Demo visitors' AI actions cost money; the limit caps the damage |

### 6.3 Where things live on the server

| Place | What |
| --- | --- |
| `/home/deploy/ProjectsDashboard` | **The live copy.** `deploy/.env` (secrets) and `registry/apps.hosted.json` live here. Compose project name `projects-dashboard` |
| `/srv/apps/*` | Clones of every repository. These are the *build source* for the demo containers (`APPS_ROOT=/srv/apps`) |
| `/home/deploy` | Home of the non-root user `deploy` (the one we log in as) |
| `/etc/pd-ctl.env` | The token for the small helper that powers the console's Start/Stop buttons |

**Every repository is now public** (CRM, RMM, ClaudeOS, ImageApp, Airfinder, ProjectsDashboard and, since 17 Nov 2026, RECI/CarRental). Public means GitHub's automatic checks run for free, and it means nothing secret may ever be committed (chapter 16). The CarRental source on the server was copied over separately (a tarball), not pulled from git, so making its repository public changed nothing on the server.

### 6.4 How HTTPS works for demos (and a classic failure)

The first time anyone visits `crm.demo.facyke.com`, Caddy asks the certificate authority for a certificate for exactly that name. But first Caddy asks the gateway "is this a real demo product?" (`/_pd/tls-ask`). The gateway says yes **only** for registry demos marked `demoReady`. This stops attackers from making the server request certificates for made-up names.

> **Real example from our history (14 Nov 2026).** The `claudeos` and `rmm` addresses failed with a TLS error. The live server was running old code that did not yet know those two demos were ready, so Caddy refused to get certificates for them. Updating the server fixed it. *Lesson: a TLS error on a new demo address usually means "the gateway does not think this is a ready demo", not "HTTPS is broken".*

### 6.5 Why each demo has its own sealed box

A demo is *untrusted ground*: strangers click around in it. So every demo container is locked down:

- **Read-only root filesystem.** It can only write to its own small volumes.
- **No special powers** (no capabilities) and **limits** on CPU, memory and process count.
- **Its own network.** A demo cannot talk to the other demos, to Postgres, or to the internet at large.
- **No path to the server itself.** Containers cannot reach the cloud provider's metadata address or the server's SSH port (a small service, `docker-egress-guard`, enforces this).
- **No real secrets.** Each app recipe excludes real `.env` files, databases and caches from the build. Demos start empty and have no email, payment or monitoring keys.
- **The gateway and console listen on fixed private addresses** only, so a demo cannot call them.

### 6.6 What keeps the server healthy

| Mechanism | What it does |
| --- | --- |
| **Daily database backup** (`db-backup` service) | `pg_dump` every day, 14 newest kept, inside a Docker volume on the same machine. Copy some off the server now and then |
| **Console alerts** | Every minute the console checks the database and the processes. After 2 failures in a row it sends a message (ntfy phone push **and** email), repeats every 6 hours, and says when it recovers |
| **Reset timer** | `deploy/reset-demos.sh` puts shared demos back to sample data when no customer link is active. It must be run on a schedule (every ten minutes). Verify the timer exists after any server rebuild |
| **Auto-restart** | After a reboot all containers come back by themselves (tested 14 Nov 2026) |
| **SSH is key-only** | No passwords, root login off, 3 attempts maximum |
| **Firewall (`ufw`)** | Only the needed ports are open |
| **Swap space** | 4 GB of swap, because six demos together use most of the 4 GB RAM |

### 6.7 The Start / Stop / Restart / Log buttons on the hosted console

The console runs *inside* a container and must not control Docker directly (that would hand a web-facing program control of the whole server). Instead a tiny helper on the host, **`pd-ctl`**, offers exactly four actions (start, stop, restart, logs), only for the demo containers named in the registry, never for the gateway, console, Caddy or database, and only to the console through a private socket with a shared token.

### 6.8 Examples: "what does hosting mean for…?"

1. **Power cut at the owner's house.** The hosted demos keep working. Only the local console and local apps stop.
2. **A customer in Lagos opens a link at 3 a.m. German time.** Works. The gateway checks the link and starts or serves the demo. The owner is not needed.
3. **Someone tries `https://madeup.demo.facyke.com`.** The wildcard DNS sends them to Caddy, Caddy asks the gateway, the gateway says "not a product", and no certificate is requested.
4. **A demo is hacked by a visitor.** The visitor finds themselves in a read-only box with no network and no secrets. The worst case is that one demo is broken until the next reset.
5. **The server is rebuilt from scratch.** Everything is recreated from the repository plus `deploy/.env`. That is why `deploy/.env` must be backed up somewhere private, and why Postgres backups matter.

---

## 7. Money: what things cost

| Item | Cost | Notes |
| --- | --- | --- |
| Hetzner server `facyke-prod` | about **€20 / month** (incl. VAT), billed hourly | Biggest regular cost |
| Domain `facyke.com` | Paid at Cloudflare for 2 years; auto-renew on | Renewal date: check Cloudflare |
| Anthropic demo key | **Hard limit $5 / month** (workspace `facyke-demos`) | Used by ClaudeOS and RMM demos. When it runs out, AI features in those demos fail until the next month or a raised limit |
| AI guide | About **$0.003 per product per full test run** on Haiku 5.5; per-link cost shown in the console | Off unless a link opts in and a key is set on the gateway |
| Resend email | Free tier is enough for alerts | Domain verified in the EU region |
| GitHub | Free plan. Every repository is public, so **Actions run free**. (The earlier problem, private-repository minutes running out on 15 Nov 2026, no longer matters: nothing is private.) | See chapter 17 |

### Five examples of money questions

1. *"Why did the ClaudeOS demo suddenly say its AI is unavailable?"* → The $5 monthly Anthropic limit may be used up. Check the Anthropic Console (workspace `facyke-demos`) before assuming a bug.
2. *"Can we run more demos on this server?"* → RAM is the limit. After all six demos about 2.4 GB were available and 0.8 GB of swap was in use. Another heavy demo means a larger server (hourly billing makes upgrading cheap to try).
3. *"Is the site down because we didn't pay?"* → Hetzner bills monthly for hourly use; a failed payment emails the account owner first. The domain auto-renews. Check both billing pages before panicking.
4. *"We want to give a prospect the AI guide."* → Each guided link has a message allowance and a daily cap (`$2/day` by default), and the console shows the estimated cost per link.
5. *"Do customers cost us anything while they browse the CRM demo?"* → Only server capacity. The CRM demo has no AI key, so no per-click cost.

---

# Part 3: For management

## 8. What management needs to know

### 8.1 The five things the system gives you

| You get… | Which means… | Where |
| --- | --- | --- |
| **A public shop window** | Six product pages and a Security page, always online | `facyke.com` |
| **Safe trials** | A customer can try a product with no risk to real data | Demo links |
| **Evidence of interest** | You can see who opened a link and who really used it | Console → "Links you have sent" |
| **A first sales helper** | An optional AI chat beside the demo answers "how do I…?" and sends pricing questions to you | AI guide |
| **Early warning** | A phone push and an email when something stops working | Alerts |

### 8.2 Who does what (roles)

| Role | Does | Needs access to |
| --- | --- | --- |
| **Owner** | Creates and revokes links, reads activity, decides who gets a demo, signs licences | Console (password + 2-step code), Cloudflare, Hetzner, Anthropic, GitHub, Resend |
| **Operator / developer** | Updates the server, fixes bugs, runs tests | Server SSH key, GitHub, the repository |
| **Support person** | Answers customers, checks links and demo state, escalates | Console (view and create/revoke links if allowed) |
| **Customer / prospect** | Opens a link, tries a demo | Only their link |

> Never share the owner's logins. Give each person their own access where the service allows it, and take access away the day someone leaves (checklist in Appendix A).

### 8.3 The weekly management routine (20 minutes)

1. **Open the console** → look at app status. Everything green?
2. **Links you have sent** → who is *Not opened* for more than two days (send a nudge), who is *Engaged* or *Came back* (call them).
3. **Activity** → any refusals or repeated bad links? (Someone may be probing, or a customer is confused.)
4. **Backups** → is there a recent backup? (Console on the PC: the newest file in the backup folder; server: `db-backup` volume.)
5. **Money** → the Anthropic workspace `facyke-demos` spending against its $5 limit; Hetzner invoice.
6. **Open items** → read chapter 12 and tick off anything that has been done.

### 8.4 Management examples

**Example 1: "Which prospect should I call today?"**
- *Situation:* Five links were sent last week.
- *What you see:* Console shows Acme *Came back* (used on 3 days, 42 active minutes), Beta *Opened* (1 minute), Gamma *Not opened*, Delta *Engaged* (14 minutes, 1 day), Echo *Not opened* and expired.
- *Decision:* Call Acme first (strong interest), follow up Delta, send Beta a "need help getting started?" note, send Gamma a reminder, offer Echo a fresh link.
- *Lesson:* The Activity column turns a guess into a ranking.

**Example 2: "A prospect says they never got the link."**
- *Situation:* Gamma says they did not receive anything.
- *What you check:* Console shows "Not opened". The link exists and is active.
- *Cause:* Likely the email went to spam, or it was sent to the wrong address.
- *Fix:* Revoke the old link, create a new one, send it by another route (chat message). Because links can never be recovered, creating a new one is always the right move.
- *Lesson:* A link is shown once. If lost, replace it; never try to "find" it.

**Example 3: "How much does a prospect's AI chat cost me?"**
- *Situation:* You turned on the AI guide for a big prospect (200 messages).
- *What you see:* The console shows messages used and an estimated cost per link, typically a fraction of a cent per few messages on Haiku 5.5.
- *Decision:* Keep it on for serious prospects; leave it off (0 messages) for casual ones.
- *Lesson:* The guide is opt-in per link, with a daily cap and a monthly spending limit on the key, so cost can never run away.

**Example 4: "A competitor is poking at our demos."**
- *Situation:* The Activity feed shows many refused opens from one address.
- *Cause:* The gateway limits opens per address and bans addresses that keep presenting bad links.
- *What happens by itself:* After 10 bad links in 10 minutes the address is refused for a while; the audit log summarises repeats instead of filling up.
- *Management action:* None needed. Note it; if it continues, an operator can block the address at the server firewall.
- *Lesson:* The system defends itself; management's job is to notice and decide.

**Example 5: "May I give a customer the real app instead?"**
- *Situation:* A customer is impatient and wants "just the real thing".
- *Answer:* No, never. Real apps hold the owner's real data. For a customer who has bought, the right path is a **separate deployment** with its own data (and, for RMM / CarRental / ClaudeOS, a licence, chapter 11).
- *Lesson:* The golden rule (Appendix D) exists to protect the owner's data and to keep promises made on the Security page.

---

## 9. Day 1 walk-through

Do this once, in order. It teaches you the whole system by using it. Allow one hour. Use the **local** setup first (your PC) unless someone has given you access to the hosted console.

### Step 0: What you need

- Windows with **Node.js 22 or newer** (the project uses Node's built-in SQLite).
- The repository cloned, then `npm install` run once in its folder.
- The apps in their Desktop folders (only needed for demos you want to run locally).
- Docker Desktop only for the RMM demo.

### Step 1: Prove the tools work

```text
npm test
npm run lint
npm run status
```

`npm test` runs the unit tests (should all pass; see a known exception in chapter 17). `npm run status` is read-only: it shows which registered apps are answering.

### Step 2: Open the console

Double-click `start-console.bat`. Your browser opens `http://127.0.0.1:4100/`. Sign in with the password and the 6-digit code. If you have no password yet, the owner sets one:

```text
npm run console:auth -- set-password
npm run console:auth -- enable-totp
```

You see a **card for each app** and buttons: Start, Stop, Restart, Open, Log.

### Step 3: Start a demo and the gateway

In the *Demos* panel start the **gateway** and one **demo** (ImageApp is the simplest: no accounts, no AI key).

### Step 4: Create a link for a pretend customer

Fill in: customer "Training Test", product ImageApp, 2 hours, max uses 2. Copy the link. **It is shown once.**

### Step 5: Be the customer

Open the link in a private browser window. Read the notice, press the button, try the demo.

### Step 6: Watch yourself

Back in the console, open **Activity**. You will see "link created" and "demo opened". The *Links you have sent* table shows *Opened*.

### Step 7: Revoke it

Press **Revoke**. Reload the customer window: access is gone immediately.

### Step 8: Look at the logs

The **Log** button on an app card, or the folder `data\logs\`. Remember where it is: this is where every investigation starts.

### Step 9: Read one real report

Open `audits/prod-audit-2026-11-16-dashboard.md`. It shows how the project is checked and what a finding looks like.

### Day-1 examples of "what if I get stuck?"

1. *`npm run status` shows everything red.* → Nothing is running. That is normal on a fresh start. Start an app in the console.
2. *`start-console.bat` says "Already running" but the page looks old.* → A console was already running with old code. Stop it (close its minimised window) and start again.
3. *`start-console.bat` hangs for a minute and fails.* → A stray second console is holding the launcher's log file. Close the extra console window.
4. *The demo link opens a page saying "being prepared".* → Normal for a few seconds while a copy starts. Wait and it refreshes by itself.
5. *Your 2-step code is always rejected.* → Phone clock wrong, or the `ADMIN_DATA_KEY` is missing after a restore. See issue F in chapter 20.

---

## 10. Reading the numbers: who is really interested?

### What the system counts

For each link and each day the gateway counts: **number of requests, first and last time, active minutes, the ten busiest pages** (only the first two parts of each address, with numbers hidden). The console turns this into a label:

| Label | Meaning |
| --- | --- |
| **Not opened** | They never clicked the button |
| **Opened** | They came in, but used it for less than a minute |
| **Engaged** | A minute or more of real use |
| **Came back** | Used on two or more different days |

### What is deliberately *not* kept

The customer's address and browser type in the activity counts, the query string (it may contain names or emails), anything typed into forms, cookies, and files such as images and scripts. What customers type into the AI guide goes to Anthropic to get an answer, and is **not** stored by us (only counts). The customer is told all this on the page where they open the link.

### Five examples of reading the signals

1. **Engaged + Came back + busiest pages are "/deals" and "/contacts"** → They are testing the real workflow. Offer a call.
2. **Opened, 1 minute, busiest page is the sign-in page** → They could not log in. Check they know the demo user and password (chapter 20, issue C).
3. **Not opened for 3 days** → The email likely never arrived or sat unread. Resend by another route.
4. **Many opens from different addresses for one link** → The link was forwarded. If the link had "lock to first browser", extra opens were refused; otherwise decide whether that is fine.
5. **Engaged on a link with the AI guide, few pages visited** → They are asking the guide a lot but not clicking. Read the guide texts (`guides/*.md`) for gaps; the evaluation suite (`npm run eval:guide`) tells you whether the guide answers correctly.

### Asking an AI assistant instead

The **MCP server** lets an assistant such as Claude Code answer questions like *"Who opened their demo link this week?"* or *"Is the CRM demo running?"* from the same database. By default it only reads. It never returns link addresses, tokens, environment values or passwords. Setup is one command (chapter 18).

---

## 11. Selling per deployment: licences

### The idea in plain words

CRM earns money through plans. The other products are not "one big service for everyone". Each customer gets **their own copy**. The question is: how do we sell a copy and make sure it only works as paid for, without checking every minute?

**Answer: a signed licence.** It is one line of text, for example `FKL1.eyJ2…abc.Zm9v…xyz`:

- `FKL1` = format version.
- The middle = a small description: licence id, product (`rmm`, `reci`), customer name, tier, limits (for example 250 devices, 25 users), start and end dates.
- The last part = a **signature** made with the owner's **private key**.

The product contains the matching **public key** and checks the signature **by itself, offline**. Change a single character (a higher limit, a later date) and the check fails. Think of it as a wax seal: anyone can look, only the owner can make a valid one.

### What happens as a licence ends (and why it is gentle)

Status moves through **active → expiring → grace → lapsed**. The licence only ever refuses to **add** new things (a new device, a new staff user). It never switches off a customer's existing work. That is deliberate: a customer who forgets to renew must not wake up to a dead system.

### Who sells what

| Product | How it is sold | Counted by |
| --- | --- | --- |
| CRM | A service with plans and included AI | Plan |
| RMM | Licence per deployment (or hosted by Facyke) | Managed devices and staff users |
| CarRental (RECI) | Per deployment; brand setting and vehicle limit are built and live (enforcement off) | Active vehicles |
| ClaudeOS | Stays MIT (free, public); paid support or hosting rather than a lock | None |

### The owner's three duties

1. **Generate the signing key once** (`node licensing/cli.mjs keygen`). It is stored outside the repository (default `~/.facyke-licence/signing-key.pem`). **Back it up privately.** If it is lost, no new licence can be issued that the products already out there accept.
2. **Put the printed public key** into the product that checks it.
3. **Issue licences:**

```text
node licensing/cli.mjs issue --product rmm --customer "Acme IT" --tier premium --limit devices=250 --limit users=25 --until 2027-11-30
node licensing/cli.mjs inspect <text or file> --public-key <key> --use devices=262
```

Renewal is just issuing a new licence. Early revocation is not part of version one: a licence ends on its date.

### Examples

1. **Normal sale.** Acme IT buys RMM for 250 devices for one year. The owner issues a licence ending 2027-11-30. Acme pastes it in. RMM shows a green status.
2. **Growing customer.** Acme hits 262 devices. RMM refuses to *enrol the 251st*, but all 250 existing devices keep working. Acme buys a bigger band; the owner issues a new licence.
3. **Forgot to renew.** The licence passes its end date. Status becomes *grace*, then *lapsed*. Staff see a banner. Nothing already running stops; only additions are blocked.
4. **Cheating attempt.** Someone edits the licence text to say 5000 devices. The signature no longer matches; the product rejects the licence.
5. **Lost signing key.** The owner's laptop dies without a backup. Existing licences keep working (they only need the public key), but no new ones can be issued. Products can carry **two** public keys so a replacement key can be introduced without breaking old licences.

> **Status as of the evening of 17 Nov 2026.**
> - The licence library and tool are merged here (PR #50). The owner's signing key exists outside the repository and is **backed up offline**; its public half is built into RMM.
> - **RMM** checks licences (merged, PR #62). It is **off** unless `LICENCE_ENFORCEMENT=1`, and it refuses only to add a *new* device or staff user.
> - **CarRental (RECI)** has the brand module (name, city, footer text from settings), a vehicle limit and an admin banner. All of it is **deployed to the live site with enforcement off**. It was tested end to end (next section).
> - ClaudeOS licensing and the legal customer agreement are not started. Read `docs/PLAN-licensing.md`.

### How the CarRental vehicle licence works and how it was tested

The limit counts **active vehicles**. At the limit the admin portal refuses to *add* a vehicle or *reactivate* one (error code `LICENCE_LIMIT`) and shows a banner; editing a vehicle, retiring one, and everything customers do keep working. To switch it on for a customer deployment set `LICENCE_ENFORCEMENT=1` and `LICENCE_KEY=<the licence line>` in the **admin** app, then issue the licence with `node licensing/cli.mjs issue --product reci --customer "<name>" --tier standard --limit vehicles=20 --until <date>`. The licence lives only in the admin app; the public website has no licence code.

The 17 Nov test (against the demo database, never the live one) proved: no licence = everything allowed; limit 20 with 20 active = add refused and banner shown; limit 21 = add allowed; expired = no new vehicles; tampered or missing licence = no new vehicles; edit and retire still work at the limit. It also found and fixed a real bug (the banner asked the wrong web address and never appeared; RECI PR #23).

Every licence you issue is appended to `issued.jsonl` next to the signing key. Three lines labelled "E2E TEST (delete)" there are test entries; leave them or annotate them, do not delete the file.

---

## 12. Risks and open decisions

Be honest with yourself about what is *not* finished. This list reflects what is known on 17 Nov 2026; re-check each item before relying on it.

### Risks (and what reduces them)

| Risk | How bad | What reduces it |
| --- | --- | --- |
| One server holds all demos | A server failure takes every demo offline | Daily backups; the whole stack can be rebuilt from the repo plus `deploy/.env`. Keep that file backed up privately |
| One person knows the system | Knowledge risk | This book; the handover checklist; the written audits |
| Demo AI costs | An abusive visitor could burn the key | $5/month limit on the key; per-link rate limits; seat limits |
| A secret committed to a now-public repository | Leak to the whole internet | History of every repo was scanned before it went public; a secret scanner runs in CI; never commit `.env` files or keys |
| The licence signing key is lost or leaks | No new licences, or forged ones | Offline backup exists; products can carry two public keys so a replacement can be introduced (chapter 11) |
| Secrets in the wrong place | Leak | Never in repo or chat; `.env` is git-ignored; a secret scanner runs in CI |
| Shared demos hold other visitors' typing | A visitor could see another's sample entries | Demos reset after each customer; visitors told not to enter real data |

### Open items (not done yet)

- A **`info@facyke.com`** mailbox must exist before the public contact email changes from the owner's address.
- **cal.com** booking event rename from `/faiyke` to `/facyke`; then update `DEMO_BOOKING_URL`.
- **RECI payment and email settings** (Stripe, Resend) are **not set in the production site**, so paying and email cannot work yet. The owner does this personally, after everything else; the Stripe webhook must point at the production domain.
- **RECI security audit (9 Oct 2026)**: re-check its open findings before launch (pending bookings, clear-reset, paid vision call, corporate approvals, unbounded AI input).
- **RECI database**: free Supabase plan, **no automated backups**; decide on a backup before real bookings arrive.
- **RMM CI audit step**: the dependency check only blocks on *shipped* packages because a development-tool package (`picomatch`) has no fix yet; remove the exception once a fixed version exists (chapter 17).
- **Licence setup left**: first real customer licence not issued; ClaudeOS licensing decision (MIT conflicts with the agency licence text).
- **CRM `TRUSTED_PROXY_COUNT`** on the server is unresolved (two proxy hops: Caddy and the gateway).
- **RMM** on the server has no scheduled-jobs worker and no device can enrol into the hosted demo.
- **Customer licence agreement**: needs a lawyer.
- **Uptime check from outside**: the built-in alerts cannot report the *server* or the *console itself* being gone. An external uptime monitor would.

### Decisions already taken (do not re-argue without a reason)

| Decision | Why |
| --- | --- |
| Never edit the apps from the dashboard | Protects real data; keeps one clear owner per project |
| Demo links are shown once, only a hash is stored | A database leak cannot leak working links |
| Customers bring their own AI key and model for per-deployment products | AI cost is not the owner's |
| Hetzner (Helsinki) over a US cloud | Owner in Germany; cost; EU data |
| Demos have no real secrets, email or payment keys | A demo is untrusted ground |
| Keep internal name slugs `faiyke` after the rename to Facyke | Renaming them risked breaking things for no benefit |

---

# Part 4: Technical handbook

## 13. The parts in detail

### 13.1 The registry (`registry/apps.json`)

The single source of truth. To add or change an app you edit this file. One entry:

```jsonc
{
  "id": "airfinder",
  "name": "Airfinder",
  "path": "${APPS_ROOT}\\Airfinder",     // where the app lives
  "processes": [{
    "name": "app",
    "cmd": "python run.py",              // how to start it
    "port": 5200,                        // dashboard-chosen port
    "health": "/",                       // the address that proves it is alive
    "env": { "PORT": "{port}" }          // settings for this process only
  }]
}
```

- `${APPS_ROOT}` is the Desktop; `${DASHBOARD_ROOT}` is this project.
- `{port}`, `{url}` and `{port:NAME}` are filled in at start.
- A process marked `optional` starts only when asked with `--only=`.
- An entry with `demoOf` is a demo instance; the gateway serves it only when `demoReady` is `true`.
- On the server the equivalent file is `registry/apps.hosted.json` (git-ignored): a process is either a host process (`cmd`) or an existing container (`container`, `host`, `port`).

> **Rule:** set `demoReady: true` only after confirming the demo shares no data with the real app.

**Examples of registry changes**

1. *Add a new product.* Copy an existing entry, give a new id, path, command, port (not 3000, 5000, 8501 which are reserved), and a health address. Run `npm run status`.
2. *Change a port.* Edit `port`. Check nothing else on the PC uses it; the supervisor refuses to start if the port is taken.
3. *Hide a half-finished demo.* Set `demoReady` to `false`. The gateway stops serving it and it disappears from the demo menu.
4. *Pass a setting to one process only.* Put it under that process's `env`. It never touches the app's own `.env`.
5. *Link two processes.* ClaudeOS's UI needs the API's port: `"FLASK_PORT": "{port:api}"` fills it in.

### 13.2 The supervisor (`supervisor/`)

```text
node supervisor/index.mjs status
node supervisor/index.mjs start   <app> [--only=proc]
node supervisor/index.mjs stop    <app> [--only=proc]
node supervisor/index.mjs restart <app> [--only=proc]
node supervisor/index.mjs build   <app>          # production build of a demo
node supervisor/index.mjs reset   <demo>         # back to seeded state
node supervisor/index.mjs instance-start|instance-stop <app> <slot>   # a private copy
```

Built-in safety: it never reads or writes an app's `.env`; it refuses to start when a port is taken or reserved; it records the process ID of everything it starts and **only** stops those (and only if the start time still matches, so a reused ID is never killed); it never kills by port or by name. Logs: `data\logs\<app>-<process>.log`. An unknown command exits with code 2.

### 13.3 The admin console (`admin-console/`, port 4100)

The owner-only web page. It has two sign-in modes: **token mode** (a one-time address on each launch) and **password mode** (password + 2-step code, recommended; on the server it is *required*).

```text
npm run console:auth -- set-password | enable-totp | disable-totp | remove-password
npm run console:auth -- status | sign-out-all | gen-key
```

Sign-in attempts are limited (8 per address and 40 overall per 15 minutes). Every sign-in, failed sign-in and credential change is in the audit log. The console refuses to listen beyond localhost until a password is set.

### 13.4 The demo gateway (`demo-gateway/`, port 4300)

The doorman. Key behaviours (full list: `demo-gateway/README.md`):

- The link token is used **once**, at the button press. The browser then gets a separate random **session cookie**; the link can never be replayed as a cookie.
- The session is checked on **every request**; open WebSockets are re-checked every few seconds, so revocation cuts live connections.
- A link works on its **own product address only**.
- Limits: link opens per address per minute (20), bad links per address per 10 minutes (10), requests per link per minute (600), WebSockets per link (20), upload size (50 MB).
- A demo that stays silent 60 seconds gets a 504.

**Two kinds of demo**

| Kind | Behaviour | Products |
| --- | --- | --- |
| **Private copy per link** | First request starts a fresh copy ("Preparing your demo" page); deleted when the link ends or sits idle (120 minutes). If all seats are taken, the customer is told and **no use is spent** | ImageApp, Airfinder, ClaudeOS |
| **Shared demo** | One instance for all of that product's customers; reset to sample data once all opened links have ended; during the reset customers see "being prepared" | CRM, RMM, CarRental |

### 13.5 The showcase (`showcase/`)

A small static website with no scripts. Edit `site.json` (brand, contact), `products.json` (text; `"published": false` hides a product), `security.json` (the Security page, written only from what the software truly does), then `npm run showcase` builds into `showcase/dist/` and previews at port 4200. Keep ports, folder paths and vendor internals out of the text and never put credentials in it. The style sheet filename includes a fingerprint and is cached for a year; pages are re-checked on every visit so text changes appear at once.

### 13.6 The store (database)

`data/dashboard.db` (SQLite locally) holds process records, customer links, the audit log, the admin password hash and the 2-step secret. On the server it is Postgres (`DASHBOARD_DB=postgres`). Both implement the same "store contract" so the same tests prove both.

### 13.7 The deploy folder (`deploy/`)

| File | Purpose |
| --- | --- |
| `docker-compose.yml` | Describes every container, network and volume |
| `Caddyfile`, `Caddy.Dockerfile` | The front door and its build |
| `Dockerfile` | The dashboard image (console + gateway + showcase) |
| `apps/<app>/Dockerfile` | A recipe to build each demo from the app's own folder, owned by the dashboard (the app folder is only read) |
| `check-apps-env.sh` | Refuses to continue if a secret an app container needs is empty |
| `reset-demos.sh` | Reset shared demos (`--dry-run`, `--force <app>`) |
| `set-demo-key.sh` | Install the Anthropic demo key (reads it hidden, validates it, backs up `.env`, recreates only the affected demo) |
| `db-backup.sh` | The daily Postgres backup |
| `ctl/` | The `pd-ctl` host helper for console buttons |

---

## 14. Everyday commands

### On the owner's PC (PowerShell or Git Bash, in the project folder)

| I want to… | Command |
| --- | --- |
| See what is running | `npm run status` |
| Start the console | double-click `start-console.bat` (or `npm run console`) |
| Start the gateway | `npm run gateway` |
| Create a link | `npm run demo -- create --customer "Acme Ltd" --app crm --hours 48 --max-uses 3 --device-lock` |
| List links | `npm run demo -- list` |
| Revoke a link | `npm run demo -- revoke <id>` |
| Backup now | `npm run backup` |
| Test the alert message | `npm run alert:test` |
| Preview the showcase | `npm run showcase` |
| Run all unit tests | `npm test` |
| Run style checks | `npm run lint` |
| Run the browser tests (real Chrome) | `npm run test:browser` |
| Test the AI guide answers | `npm run eval:guide -- <crm\|rmm> --yes` |
| Start the assistant helper | `npm run mcp` |

### On the server (SSH as `deploy`, then `cd /home/deploy/ProjectsDashboard/deploy`)

| I want to… | Command |
| --- | --- |
| Health of every service | `docker compose ps` |
| Follow the gateway log | `docker compose logs -f gateway` |
| Is a demo busy? | `docker compose --profile apps exec -T gateway node supervisor/demo-reset-state.mjs due <product>` |
| What would reset? | `./reset-demos.sh --dry-run` |
| Reset one demo now | `./reset-demos.sh --force crm` |
| Rebuild some demos | `docker compose --profile apps up -d --build claudeos-demo rmm-demo-api rmm-demo` |
| Check secrets are filled | `./check-apps-env.sh` |
| Send a test alert mail | `docker compose exec -T console node supervisor/alert-cli.mjs` |

### Reaching the server from Windows (important gotchas)

- Use the **PowerShell** tool or a normal PowerShell window; Git Bash's `ssh` cannot see the Windows SSH agent and gives "Permission denied (publickey)".
- The key is a private file in your `.ssh` folder with a passphrase. **Never share it or the passphrase.**
- Typical connect: `ssh -i "$env:USERPROFILE\.ssh\hetzner_facyke" -o IdentitiesOnly=yes deploy@<server address>` (the address is in the Hetzner console).
- Sending a script through PowerShell adds an invisible byte-order mark, so line 1 fails. Start the script with a dummy `echo start`, end it with `exit 0`.
- `docker compose exec` swallows the script from stdin; add `</dev/null` to those lines.

### Five command examples with expected results

1. `npm run status` → a list of apps with up/down. *Down is fine for an app you did not start.*
2. `npm run demo -- create ...` → prints `Grant a1b2c3d4 for "Acme Ltd" -> crm, expires ...` and the link once. *Copy it now.*
3. `./reset-demos.sh --dry-run` → lists each demo and why it would or would not reset ("busy: an opened link is still active").
4. `docker compose ps` → every service "running" or "healthy". *Anything "restarting" needs the log (`docker compose logs <service>`).*
5. `node supervisor/index.mjs foo` → exits with code 2 (unknown command). *This is a safe test that the tool is installed.*

---

## 15. Updating the live server safely

### The principles

1. **Test locally first**, with the same commands CI runs (chapter 17).
2. **Back up before you change**: copy `deploy/.env` to a dated backup, and keep a database backup.
3. **Change one thing at a time** and verify it as a customer would (open a real link).
4. **Know your rollback** before you start (the previous git commit, the previous image tag).
5. **Never put secrets in chat, tickets or commits.**

### The update recipe (no GitHub token on the server)

The server pulls code from clones in `/srv/apps` and the live copy in `/home/deploy/ProjectsDashboard`. When there is no token to pull from a private repository, move the code in a **git bundle**:

```text
# on your machine
git bundle create x.bundle <commit-or-branch>
scp x.bundle deploy@<server>:/home/deploy/

# on the server
cd /home/deploy/ProjectsDashboard
git fetch /home/deploy/x.bundle <branch>
git merge --ff-only FETCH_HEAD
cd /srv/apps/ProjectsDashboard && git fetch /home/deploy/x.bundle <branch> && git merge --ff-only FETCH_HEAD

# rebuild only what changed, naming services explicitly
cd /home/deploy/ProjectsDashboard/deploy
docker compose --profile apps build <service...>
docker compose --profile apps up -d <service...>
```

`--ff-only` is a safety catch: it refuses if the server has drifted from what you expect. The console image is built via `docker compose build gateway` (the console service has no `build:` of its own); then recreate it with `docker compose up -d --no-deps console`.

### What to check after an update

1. `docker compose ps`: all healthy.
2. The public page loads; the console loads and signs in.
3. Create a test link named "UI test ...", open it as a customer, then **revoke it**.
4. If a demo changed, check it with a real login as the demo user.

### Five update examples

**Example 1: A text change on the showcase.** Edit `showcase/products.json`, run the tests, commit, bundle, fast-forward on the server, rebuild the image that contains the showcase, refresh the page. *Risk: very low.*

**Example 2: A new demo user password.** Change the value in `deploy/.env` on the server, then recreate **only** that demo container. *Never print the password in chat; read it from the file.*

**Example 3: Updating ClaudeOS demo code.** Pull the app clone in `/srv/apps/ClaudeOS` (keep the server's local patch commits, merge `origin/main` rather than reset), run `docker compose --profile apps up -d --build claudeos-demo`. Before rebuilding check `demo-reset-state.mjs due claudeos`: if "busy", a customer is mid-demo, so wait or ask the owner.

**Example 4: The server reboots after a kernel update.** Containers restart by themselves. After the reboot run `docker compose ps` and open one link. *All 17 containers came back by themselves on 14 Nov 2026.*

**Example 5: A bad deploy.** The console shows "unhealthy" after an update. Roll back: `git reset --hard` on the live copy is risky, so instead fast-forward to a fixed commit (ask the owner before any `git reset --hard` on the live copy), or re-tag the previous image (for example `pd-imageapp:rollback-20261116`) and recreate. *Always create a rollback image tag before a risky rebuild.*

**Example 6: Rebuilding one demo from GitHub `main` (RMM, 17 Nov 2026 pattern).**
1. Check nobody is mid-demo: `node supervisor/demo-reset-state.mjs due rmm` (if "busy", note whose link is active; wait or ask the owner).
2. On the server, in the clone under `/srv/apps`, `git fetch` and `git merge --ff-only origin/main` (a server-local patch commit stays; merge, never reset).
3. Tag the current image as a rollback (`docker tag pd-rmm-ui:latest pd-rmm-ui:rollback-<what>`).
4. `docker compose --profile apps up -d --build --no-deps rmm-demo` (name **only** the service that changed; `--no-deps` stops its neighbours being touched).
5. Check: container healthy, the new file is inside the container, the eight public hosts unchanged (home 200, console 302, six demos 401).

If a server-side `git cherry-pick` says CONFLICT but shows no files, the server simply has no git identity: pass `-c user.name=... -c user.email=...` for that one command.

**Example 7: Changing one line of the compose file (RMM production mode).** `deploy/docker-compose.yml` is CRLF on Windows. Edit with a tool that keeps line endings, merge with `--ff-only` into **both** the `/srv/apps` copy and the live directory, run `docker compose --profile apps up -d --no-deps rmm-demo-api` as a **dry run first**, then for real. Only that container is recreated.

**Example 8: Fixing demo data in place.** `supervisor/demo-fixes/seed-rmm-demo.py` can be run against the live demo: `docker exec -i -w /app pd-rmm-demo-api python - < .../seed-rmm-demo.py`. It only adds what is missing (run it twice: the second adds 0) and supports `DRY_RUN=1` to report without writing.

### Gotchas learned the hard way

- A stray character in `deploy/.env` (an `i` typed before `POSTGRES_PASSWORD`) broke every `docker compose` command. After editing `.env` always run `docker compose config > /dev/null` to check it parses.
- `${VAR:?}` settings are read by compose even for services outside the profile, so empty ones are defaulted and `check-apps-env.sh` does the strictness.
- Public values for CarRental are **baked into its build**: changing `DEMO_DOMAIN` or its Supabase project needs a rebuild, not a restart.
- **Git Bash on Windows rewrites paths** that start with `/` (for example `vercel curl /`): prefix the command with `MSYS_NO_PATHCONV=1`.
- **Windows cannot delete deep `node_modules` folders** (path too long): use PowerShell `Remove-Item -LiteralPath` with a `\\?\` long-path prefix.
- **Do not record "applied" or "done" from memory.** Run the read-only check first (a 17 Nov note said a database migration was applied when it was not).
- Demo containers have a **read-only** root. If an app writes elsewhere, give it a `tmpfs` or volume; do not remove `read_only`.

---

## 16. Security: how the project protects itself

### The layers (outside to inside)

1. **Network:** only 80/443 are open. Firewall on. SSH key-only, root login off.
2. **Front door:** Caddy with automatic HTTPS; certificates only for names the gateway confirms.
3. **Console:** password + 2-step code (required on the server), rate-limited, audited.
4. **Gateway:** links shown once and stored as hashes; session cookies; per-request re-checks; limits; strict headers.
5. **Demos:** sealed containers, own networks, no real secrets, no cloud-metadata access.
6. **Data:** customer activity is counts only; audit events kept 90 days; owner sign-ins 365 days.
7. **Process:** written audits in `audits/`; a secret scanner and image scan in CI.

### Five security examples

1. **Stolen database backup.** Links are stored as hashes, so no link can be reconstructed. The 2-step secret is encrypted with `ADMIN_DATA_KEY`, which is *not* in the backup.
2. **A visitor tries to read the server's secrets from inside a demo.** The container has none (real `.env` files are excluded from the build) and cannot reach the cloud metadata address.
3. **A forged "real client address" header.** The gateway believes `X-Forwarded-For` only from Caddy's fixed address (`TRUSTED_PROXIES`), so nobody can pretend to be a different address to dodge rate limits.
4. **A revoked customer keeps a tab open.** The next request, or the next WebSocket re-check, is refused within seconds.
5. **A link in a mail scanner.** A GET shows a notice and spends nothing; only the button (a POST) opens the demo.

### What is *not* protected (be honest)

- Shared demos are shared. Visitors are told not to enter real personal data.
- "Lock to first browser" deters forwarding but is not a guarantee; someone who copies the cookie can get in.
- The built-in alerts cannot report the console or server being off.
- Demo copies on the owner's PC run as the PC's user and are separated by data and ports, not sandboxed.

---

## 17. Tests, CI and the way we change code

### The checks

| Command | What it proves |
| --- | --- |
| `npm run lint` | Style and common mistakes. **Runs first in CI**; run it before you push |
| `npm test` | About 400 unit tests: storage, sign-in, gateway, backups, alerts, supervisor, licences, MCP |
| `npm run test:browser` | Real Chrome: the console loads, create a link, a customer opens it, revoke, sign-in and sign-out, console and showcase on desktop and phone, the AI guide against a fake API |
| `npm run test:e2e` | The real demo apps end to end (owner's PC only; they must be running) |
| `TEST_DATABASE_URL=postgres://… npm test` | The same store tests against Postgres (14 extra tests that otherwise skip) |

CI (`.github/workflows/ci.yml`) runs on Windows and Linux plus a secret scan and an image scan. A pull request skips the Windows job and cancels superseded runs.

**All repositories are public with a protected `main`** (set up 17 Nov 2026): changes need a pull request and the named checks to pass; force-push and deletion are blocked; the owner can override (admin) when needed.

| Repository | Required checks on `main` |
| --- | --- |
| ProjectsDashboard | linux, secrets, images |
| CRM | verify, security |
| RMM | Backend Tests, Agent Tests, Dashboard Tests, Frontend Build |
| RECI | Lint · Type-check · Unit Tests; Build (web + admin); E2E Tests (Playwright) |
| ClaudeOS | Tests |
| ImageApp | test |
| Airfinder | tests |

**RECI's end-to-end tests run in "mock mode"**: when the Supabase address is the placeholder `https://placeholder.supabase.co`, the vehicle API serves built-in sample vehicles so a browser test can run without a database. The real site never has that placeholder. RECI's tests need pnpm 9.15; on Windows build with `--config.node-linker=hoisted` and test the admin with `next build` then `next start` (the dev server fails).

**RMM's dashboard tests** use Streamlit's `AppTest`; run them as `cd dashboard && pytest tests/` (about 9 minutes). The dependency audit is split in two: `npm audit --omit=dev --audit-level=high` **blocks** (shipped code), and a second audit of development tools is informational because one advisory (`picomatch`) has no fix yet.

### The way we change code

1. Make a branch (never commit straight to `main`).
2. Edit; run `node --check` on JavaScript files you changed, then `npm run lint` and `npm test`.
3. **Gate the commit on the tests.** Do not chain `git commit` after a test run with `;` (it will commit even when tests fail). Use `&&` or run them separately and read the result.
4. Open a PR; wait for CI; merge. If CI is unavailable, say so in the PR and show your local run.
5. Deploy to the server by the recipe in chapter 15.

### Known quirks

- **`npm test` fails one test if `DEMO_BRAND_NAME` or `DEMO_BOOKING_URL` is set** in your shell. Run with those unset (`env -u DEMO_BRAND_NAME -u DEMO_BOOKING_URL npm test`).
- **Older note (obsolete since 17 Nov 2026):** Actions on private repositories failed when the free minutes ran out. Nothing is private any more, so CI runs everywhere. If a run fails in two seconds again, check GitHub billing and the repository's visibility first.
- **`tests/unit/branding.test.mjs` fails on `main`** in ProjectsDashboard (known, pre-existing, not caused by recent changes).
- **CRM timestamps are UTC without a time zone.** When writing directly to its database use `now() at time zone 'UTC'`, or sign-ins are rejected.
- **`npm audit`** may list moderate warnings in the development-only tool chain (ESLint); they do not affect the running dashboard.

### Five examples of testing judgement

1. *I changed only a sentence in `products.json`.* → Run `npm test` (a test checks the showcase content) and `npm run showcase` to look at it.
2. *I changed the gateway.* → Run `npm test` **and** `npm run test:browser`; the browser tests catch what unit tests cannot.
3. *I changed how Postgres is used.* → Run the unit suite with `TEST_DATABASE_URL` pointing at a throwaway container so the Postgres tests actually run.
4. *The lint step fails in CI but passes on my PC.* → CI may use a newer rule or a different OS; read the exact message and run `npm run lint` again after pulling.
5. *I want to prove a fix on the live server.* → Use a temporary link named "UI test …" with Chrome automation, then revoke it. Don't use a real customer's link.

---

## 18. The AI features and keys

### Three separate AI things (do not confuse them)

| Feature | What it is | Whose key | Default model |
| --- | --- | --- | --- |
| **Demo AI inside ClaudeOS and RMM** | The products' own AI assistant, usable in the demo | The dedicated `facyke-demos` key ($5/month limit) | Per product |
| **The AI guide** | A chat beside a demo that answers "how do I…?" | A key on the **gateway** only (`ANTHROPIC_API_KEY`) | Claude Haiku 5.5 |
| **MCP server** | Lets *the owner's* assistant read the dashboard | None (local, reads the database) | n/a |

The hosted RMM demo (the Streamlit UI) **does have an AI assistant** in the sidebar ("Ask anything about this page"). It was tested in a browser on 17 Nov 2026 and answers about the page being shown. (An earlier version of this book said it had none; that was wrong.)

### The AI guide

Opt-in per link (`guideMessages`, 0 to 200). It needs `"guide": true` on the product's demo entry in the registry, a **checked** `guides/<product>.md` (a file still holding the draft marker is not used), and an `ANTHROPIC_API_KEY` on the gateway. It has **no tools** and cannot see the demo or other customers. The customer's words are only ever the user message; the rules and your guide text form the system prompt. Limits: the link's allowance, a per-minute cap, a daily cap ($2/day default), 500 characters a message. **Stored:** counts per link per day (messages, tokens, estimated cost). **Not stored:** what customers type or the answers. A guide exists for CRM and RMM only.

Test the guide's answers: `npm run eval:guide -- crm --yes` (37 cases per product, costs about $0.003; 37/37 passed for both on 11 Nov 2026). Re-run whenever you change a guide. The grader is pattern-based, so a new failure may be a false positive: read the answer before editing the guide.

### Choosing a model

Per-deployment products let the customer choose Haiku, Sonnet or Opus. **A model switch can silently break a feature**, so each product has a checked allowlist. Findings from live calls on 16 Nov 2026: every current model rejects the `temperature` setting; Sonnet 5.5 and Opus 5.5 reject a *forced* tool choice (use automatic plus an instruction); Haiku 4.5 has no `effort` setting. *Before offering a new model, run the product's real request shape against it.*

### The MCP server

```text
claude mcp add projects-dashboard -- node C:\path\to\ProjectsDashboard\mcp\server.mjs
```

Read tools: apps and whether they run, demo links with engagement, one link's activity, recent audit events, the state of each demo. It never returns link addresses, tokens, environment values or passwords. Three change tools exist but are **off** unless the server is started with `MCP_WRITE=1`: create a link (shown once in the assistant's answer), revoke a link, reset a shared demo (refused while a customer is using it). Every change is logged `by: mcp` and limited to 20 a minute.

### How the demo AI was tested on 17 Nov 2026

After rebuilding the ClaudeOS and RMM demos the AI was tested two ways. **From inside the containers** over SSH: log in as the demo user, then call the chat/agent endpoint (RMM `/api/assistant/chat`, ClaudeOS agent run); both answered. **In a real browser** through a temporary gateway link named "UI test ..." (ClaudeOS chat answered in about 1.4 seconds; the RMM assistant answered on its Software Patches page), then the link was revoked. Rules learned: every open of a link spends one use, so never script retries against a link; the Streamlit login lives in the browser *page*, not in cookies, so automation must keep one real headless Chrome open; and a URL ending `?tok=...` contains a live session token, so **never share screenshots or URLs of the RMM dashboard**.

### CarRental's own AI model setting

CarRental's admin has **Settings, AI model** (Built-in, or the customer's own choice). It is stored in the table `app_settings` (database migration 015). If the card says the "database update has not been applied", the migration is missing: run the prepared read-only check, then the migration, on the **production** project (Issue L).

### Five AI examples

1. **"The guide says it cannot help with pricing."** Correct by design: it refers pricing and anything it cannot know to you.
2. **"The ClaudeOS demo shows 'API unreachable'."** A historic bug in the demo image (fixed in our recipe, PR #15). If it returns, check the container log first, then the key.
3. **"A visitor pasted a prompt-injection into the guide."** The guide has no tools and no access to other data; the worst result is a silly answer, and the daily cap limits cost.
4. **"We rotated the Anthropic key."** Use `deploy/set-demo-key.sh claudeos|rmm|both`. It reads the key hidden, validates it, backs up `.env`, and recreates only the affected demo. Afterwards delete old `.env` backups on the server. *Never paste a key in chat.*
5. **"The assistant created a link and I can't see it."** The link is shown once in the assistant's answer. If it is lost, revoke and create another.

---

# Part 5: Support playbook

## 19. How to handle any support request

### The six steps

1. **Listen and write it down.** Who (customer label), which product, what they did, what they saw, what time (and time zone).
2. **Reproduce or locate it.** Look up their link in the console: state, expiry, uses, activity. Check the product's health.
3. **Classify it** using the table below. Most problems fall into ten families (A to J).
4. **Fix the smallest thing first.** A new link, a reset, a restart. Not a rebuild.
5. **Confirm as the customer would.** Open a real link; do not assume.
6. **Record it** (what, cause, fix) and tell the customer in plain words. If it is a new kind of problem, add it to this book.

### Escalation: who handles what

| Level | Who | Can do | Hand over when |
| --- | --- | --- | --- |
| **L1** | Support person | Check link state, create a new link, revoke, explain the notice, check status | Anything that needs the server, a restart, a key, or a code change |
| **L2** | Operator | Restart or reset a demo, read logs, check disk/RAM, update, rebuild | A code bug, a security concern, any secret, or data loss |
| **L3** | Owner / developer | Fix code, rotate keys, restore backups, decide policy | |

### Never do this while supporting

- Never ask the customer for a password, key or private data, and never paste one in chat or tickets.
- Never promise a date for an AI or payment feature that is not live.
- Never open the real app for a customer (Appendix D).
- Never delete a link, a log or a backup "to tidy up" without the owner's say-so.
- Never restart a shared demo while a customer is using it unless the owner agrees (check with the *busy* command first).

### A quick triage table

| The customer says… | Family | Go to |
| --- | --- | --- |
| "My link doesn't work / expired / refused" | A | issue A |
| "It's slow, stuck, or says preparing / seats taken" | B | issue B |
| "I can't sign in to the demo" | C | issue C |
| "The AI part doesn't answer / guide error" | D | issue D |
| "We got an alert / something is down" | E | issue E |
| "I (the owner) can't get into the console" | F | issue F |
| "The site / TLS / server is wrong after an update" | G | issue G |
| "Data is missing / need a restore / reset" | H | issue H |
| "No email alerts / wrong emails" | I | issue I |
| "CI is red / can't merge / tests fail" | J | issue J |

---

## 20. Issue catalogue

Each issue family has **five worked examples** in the same shape: **Situation → Cause → Fix → Lesson**. Find the one that looks like yours; if none fits exactly, the closest cause is usually right.

---

### Issue A: "My demo link does not work"

*The customer clicks the link and gets a refusal page, an error, or nothing.* **First check, always:** console → *Links you have sent* → find the customer → look at **state, expiry, opens used, device lock**.

**A1. The link has expired**
- *Situation:* "It worked yesterday, now it says the link ended."
- *Cause:* Links stop after the hours set when created (default 48). The console shows "expired".
- *Fix:* Create a new link (a link can never be extended or recovered). Choose a sensible length.
- *Lesson:* If the sales conversation is still going, make the first link longer.

**A2. All uses are spent**
- *Situation:* The customer opened the link three times (`--max-uses 3`) and the fourth try is refused.
- *Cause:* Each button press spends one use; reopening later in a new browser session also spends one.
- *Fix:* New link with a higher limit. Remember: just *looking* at the link page spends nothing; only the button does.
- *Lesson:* For a customer who will share it with a team, set 5–10 uses or no limit.

**A3. "Lock to first browser" blocked a colleague (or the same person on a phone)**
- *Situation:* Dana opened the link on her laptop; later on her phone it is refused.
- *Cause:* The device lock pinned the link to the first browser's random cookie.
- *Fix:* If it was legitimate, revoke and create a new link without the lock (or with a separate link for the phone). If it was a forward, the lock did its job.
- *Lesson:* The Activity feed shows refusals. Read it before assuming a fault.

**A4. The link was revoked**
- *Situation:* "It stopped working while I was using it."
- *Cause:* The owner (or the MCP assistant) revoked it. Revocation applies instantly, including to open pages.
- *Fix:* Check the audit log: "link revoked" with the time and who did it (`by: console` / `by: mcp`). If revoked by mistake, issue a new link.
- *Lesson:* Revocation cannot be undone; only a new link helps.

**A5. The link was made on the PC and opened elsewhere**
- *Situation:* "This site can't be reached" on a link that starts with `http://crm.localhost:4300/…`.
- *Cause:* `localhost` links exist only on the owner's PC.
- *Fix:* Create the link in the **hosted** console (`https://admin.facyke.com`) so it starts with `https://crm.demo.facyke.com/…`.
- *Lesson:* Check the link's start before anything else.

**A6 (bonus). The email client mangled the link**
- *Situation:* The link ends with `…` or has a space inside.
- *Cause:* A long token was wrapped or cut by an email program.
- *Fix:* Send it as plain text on its own line, or by a chat message. Do not retype it.
- *Lesson:* Test the link you are about to send by opening it yourself first… then revoke, because the test spends a use. Better: create the link with 2 extra uses.

---

### Issue B: "The demo is slow, stuck, or says it is being prepared"

**B1. "Preparing your demo" appears for a private-copy product**
- *Situation:* First visit to ImageApp, Airfinder or ClaudeOS shows a self-refreshing page.
- *Cause:* The first request starts a fresh private copy (a few seconds; ClaudeOS longer).
- *Fix:* Nothing: wait; it refreshes by itself. If over two minutes, an operator checks the container log.
- *Lesson:* This is normal behaviour, not a fault.

**B2. "All demo seats are taken"**
- *Situation:* A customer cannot get in; no use was spent.
- *Cause:* The product's private-copy seats (for example ImageApp 4, ClaudeOS 3) are in use.
- *Fix:* Ask the customer to try again in a few minutes. Check the console for idle links; revoke an unused one to free a seat. Raise `perLink.max` only if the machine has the memory (each Streamlit copy uses a few hundred MB).
- *Lesson:* Seats free themselves after 120 idle minutes.

**B3. A shared demo says "being prepared" for a long time**
- *Situation:* The CRM demo has said "being prepared" for ten minutes.
- *Cause:* A reset is running (or stuck): the gateway holds customers until it ends.
- *Fix (operator):* `docker compose logs --tail 100 gateway`, then the demo's own log. If the reset script failed, run `./reset-demos.sh --force crm` again and watch the output.
- *Lesson:* A reset is expected between customers; a long one is a fault.

**B4. Everything is slow on the server**
- *Situation:* All demos crawl.
- *Cause:* RAM exhausted. Six demos on a 4 GB server leave little spare and the swap fills.
- *Fix (operator):* `free -h`, `docker stats --no-stream`. Stop a demo nobody needs (console Stop button), or upgrade the Hetzner server size.
- *Lesson:* Capacity is the cost of showing six products at once.

**B5. One product is slow, others fine**
- *Situation:* Only the RMM demo is slow.
- *Cause:* It has the most containers (API, dashboard, Postgres, Redis) and the first load after idle is heavy; also the 60-second upstream timeout returns a 504 if it stays silent.
- *Fix:* Open the demo once yourself to warm it; check `docker compose logs rmm-demo-api`.
- *Lesson:* Warm a demo before a sales call.

**B6 (bonus). Locally, the RMM demo will not start**
- *Cause:* Docker Desktop is starting; the supervisor waits up to three minutes. Wait.

---

### Issue C: "I cannot sign in to the demo"

**C1. Wrong demo password**
- *Situation:* CRM demo says "Invalid email or password".
- *Cause:* The demo users are `admin@crm.test`, `sales@crm.test`, `support@crm.test`; the shared password is the `SEED_USER_PASSWORD` value in the demo's env file (`data/crm-demo.env` locally, `CRM_*` settings on the server).
- *Fix:* Give the customer the right credentials through a safe channel (the opening-page welcome note is visible to the customer, so use it only for non-secret hints such as "Sign in as sales@crm.test").
- *Lesson:* Decide how credentials are shared *before* the first link.

**C2. Signs in, then bounces back to sign-in**
- *Situation:* Login seems to work but the page returns to the sign-in form.
- *Cause:* A password-change time stored in the database is in the **future** (CRM stores timestamps as UTC without a time zone; writing local time directly makes the session look stale).
- *Fix (operator):* Use `now() at time zone 'UTC'` when writing times, or reseed the demo.
- *Lesson:* Direct database edits are a last resort; use the app's tools.

**C3. ClaudeOS demo login rejected**
- *Cause:* The demo login is user `demo` with `CLAUDEOS_DEMO_PASSWORD`, and that password **must not contain the word "demo"**.
- *Fix:* Set a compliant password in `deploy/.env`, recreate `claudeos-demo`, `./reset-demos.sh claudeos`.
- *Lesson:* Passwords with the product's own forbidden words are silently refused.

**C4. The demo user is gone after a customer "cleaned up"**
- *Situation:* A customer deleted the demo admin; nobody can sign in.
- *Cause:* Shared demos let customers change anything.
- *Fix:* `./reset-demos.sh --force crm` puts the demo back (this ends anything the customer was doing; check *busy* first).
- *Lesson:* This is exactly why shared demos reset between customers.

**C5. The RMM sign-in card looks squeezed**
- *Situation:* In the guide's split view the sign-in box is cramped.
- *Cause:* A narrow frame. Fixed in the RMM code (breakpoint raised to 1500 px).
- *Fix:* Make sure the server has the current RMM code; as a workaround use "Hide guide".

---

### Issue D: "The AI part does not work"

First decide **which AI**: the product's own assistant inside the demo, or the guide beside the demo (chapter 18).

**D1. "API unreachable" / "AI unavailable" in ClaudeOS or RMM**
- *Cause:* Usually (a) the monthly $5 limit on the `facyke-demos` workspace is used up, (b) the key was revoked or mistyped, or (c) an old bug in the demo image.
- *Fix (operator):* Check Anthropic Console spend; check the container log for HTTP 401 (bad key) or 429 (limit). Replace the key with `deploy/set-demo-key.sh`. A test call should return 200.
- *Lesson:* Look at spend and key validity before suspecting code.

**D2. "The guide button is missing on the link page"**
- *Cause:* The guide needs *all four*: the link created with `guideMessages` above 0, `"guide": true` on the product, a guide file without the draft marker, and an `ANTHROPIC_API_KEY` on the gateway. Only CRM and RMM have guides.
- *Fix:* Check each of the four. On the server the guide has no key at present (off).
- *Lesson:* "Opt-in per link" means a link made without messages has no guide.

**D3. The guide gave a wrong answer**
- *Cause:* The guide only knows `guides/<product>.md` and its rules. If the guide text is missing or wrong, the answer is.
- *Fix:* Correct the guide file, then run `npm run eval:guide -- <product> --yes`; expect 37/37.
- *Lesson:* Fix the source text, not the individual answer.

**D4. "The guide stopped after N messages"**
- *Cause:* The link's message allowance, the per-minute cap, or the daily cap was reached.
- *Fix:* Create a new link with more messages if the owner agrees, or wait for the day to roll.
- *Lesson:* Each message reserves its worst-case cost first, so limits are firm.

**D5. A model change broke a feature**
- *Cause:* A new model rejects a setting (`temperature`, forced tool choice, `effort`).
- *Fix:* Return to the allowlisted model; run the product's real request against the new one before offering it.
- *Lesson:* "It works in the playground" is not proof for our request shape.

---

### Issue E: "An alert arrived" or "something is down"

An alert means: two checks in a row failed (the database did not answer, or a process the supervisor started stopped answering). It names apps only, never customers or links.

**E1. "The database is not responding" (server)**
- *Fix (operator):* `docker compose ps` (postgres up?), `docker compose logs --tail 80 postgres`, disk space `df -h`. A full disk is the usual cause. Free space (old images: `docker image prune`, after checking), restart postgres.
- *Lesson:* Disk full is the quietest killer.

**E2. A demo process is down**
- *Fix:* In the console press Restart (the `pd-ctl` button), or `docker compose --profile apps up -d <service>`. Read the log if it fails again immediately.
- *Lesson:* A demo you **stopped yourself** is never reported; a report always means something stopped on its own.

**E3. "Recovered" message arrives right after "down"**
- *Cause:* A brief hiccup (restart, deploy).
- *Fix:* None. If it repeats, look at memory use and logs.

**E4. No alert but the site is plainly down**
- *Cause:* The built-in alerts live inside the console; if the *server* or *console* is gone, nothing can send.
- *Fix:* Open the Hetzner console to check the server's state; start it if off. Add an outside uptime check.
- *Lesson:* Monitoring the watcher needs a second watcher.

**E5. The same alert repeats every six hours**
- *Cause:* Designed: it repeats every 6 hours while the problem lasts.
- *Fix:* Fix the cause; the "recovered" message ends it. If the app is intentionally off, stop it from the console so it is not reported.

---

### Issue F: "The owner cannot get into the console"

**F1. 2-step code always rejected**
- *Cause:* Phone clock off by more than 30 seconds, or after a restore the `ADMIN_DATA_KEY` is missing or wrong so the stored secret cannot be read.
- *Fix:* Sync the phone clock. If the key is lost: `npm run console:auth -- disable-totp`, then `enable-totp` and scan a new code. Nothing else is lost.
- *Lesson:* Keep a copy of `ADMIN_DATA_KEY` in a password manager.

**F2. "Too many attempts"**
- *Cause:* The limit (8 per address, 40 overall per 15 minutes).
- *Fix:* Wait 15 minutes. If you did not cause it, look at the audit log for failed sign-ins from other addresses and consider changing the password.

**F3. The console will not start on the server**
- *Cause:* On the server it refuses to start until a password **and** 2-step codes are set (it is reachable from the internet).
- *Fix:* `docker compose run --rm console node admin-console/auth-cli.mjs set-password`, then `enable-totp`, then `docker compose up -d console`.

**F4. Token URL no longer works**
- *Cause:* After a password is set, token mode is off.
- *Fix:* Use the password and the code.

**F5. A forgotten password**
- *Fix:* On the PC `npm run console:auth -- set-password` (this needs access to the PC). On the server run the same command in the console container. `sign-out-all` ends every session afterwards.
- *Lesson:* Anyone with server access can reset it, so protect the server login.

---

### Issue G: "The site or server is wrong" (hosting)

**G1. A TLS / certificate error on one demo address**
- *Cause:* The gateway does not treat that product as `demoReady` (code on the server too old, or `demoReady` false in `registry/apps.hosted.json`). Caddy only asks for certificates for ready demos. (Real case 14 Nov 2026.)
- *Fix:* Update the server code and registry; confirm `demoReady: true`; reload.
- *Lesson:* TLS errors on a *new* demo name usually mean "not ready", not "broken HTTPS".

**G2. Every `docker compose` command fails after editing `.env`**
- *Cause:* A typo (a stray character before a variable name). Real case.
- *Fix:* `docker compose config > /dev/null` shows the parse error; fix the line; restore from the dated backup if needed.
- *Lesson:* Always back up `.env` before editing and check it parses afterwards.

**G3. The new code does not appear on the site**
- *Cause:* The image was not rebuilt, or the wrong service was rebuilt. Containers use the image built at the time.
- *Fix:* `docker compose build <service>` then `up -d <service>`; confirm with `docker compose ps` that the container is newly created.
- *Lesson:* Name the services explicitly.

**G4. The www address or the base domain gives a different page**
- *Cause:* DNS missing or wrong. `www` needs its own CNAME; records must be **DNS-only (grey cloud)**.
- *Fix:* Check Cloudflare DNS: `@`, `www`, `admin`, `*.demo` all pointing to the server.

**G5. I cannot SSH to the server**
- *Cause:* Using Git Bash (cannot see the agent), the key not loaded, the wrong user (use `deploy`, root is disabled), or a passphrase issue.
- *Fix:* Use PowerShell, load the key with the full path to `ssh-add.exe`, use `-o IdentitiesOnly=yes`. If still locked out, use the Hetzner web console (rescue) to check `sshd`. *Never open a password login to get in.*

**G6 (bonus). The server just rebooted**
- *Fix:* Wait a minute; `docker compose ps` should show everything back. All containers returned by themselves in the last reboot test.

---

### Issue H: "Data is missing, or I need a reset or a restore"

**H1. A shared demo has a customer's leftovers**
- *Fix:* `./reset-demos.sh --dry-run` to see why it did not reset (usually a link is still active); `--force <app>` to reset now.
- *Lesson:* Resets wait for all opened links to end; that is by design.

**H2. Restore the dashboard database on the PC**
- *Steps:* Stop the console and gateway → copy the chosen backup over `data/dashboard.db` → **delete `data/dashboard.db-wal` and `data/dashboard.db-shm`** → start again. If the 2-step code fails, the data key is wrong (issue F1).
- *Lesson:* Forgetting to delete the two side files can resurrect old data or corrupt the restore.

**H3. Restore Postgres on the server**
- *Steps:* Copy a backup out of the `db-backup` volume: `docker compose cp db-backup:/backups/<file> .`; restore: `docker compose exec -T postgres pg_restore -U dashboard -d dashboard --clean --if-exists < <file>`.
- *Lesson:* Backups live on the same machine as the database, so also copy some off the server. The `caddy_data` volume holds only certificates (re-issued if lost).

**H4. A customer says "my data vanished" in a demo**
- *Cause:* Demos are temporary: private copies are deleted when the link ends or idles 120 minutes; shared demos reset.
- *Fix:* Explain that demos hold sample data only. Customer data belongs in a real deployment.
- *Lesson:* Say it at the start: "this is a sandbox".

**H5. "Forget" a customer (privacy request)**
- *Fix:* In the console press **Forget** on the finished link. It deletes the audit events, the activity counts and the customer label for that link. (A batch still in the gateway's memory can write one last anonymous row seconds later; normal retention removes it.)
- *Lesson:* Audit events are otherwise kept 90 days.

---

### Issue I: "Email alerts are missing or wrong"

**I1. No emails arrive**
- *Check:* `RESEND_API_KEY`, `ALERT_EMAIL_TO`, `ALERT_EMAIL_FROM` in the console's environment (compose passes them), the Resend domain still verified, and the spam folder. Test: `docker compose exec -T console node supervisor/alert-cli.mjs` (three test mails were received on 15 Nov 2026).

**I2. Phone push but no email (or the reverse)**
- *Cause:* The two channels are independent: ntfy (`ALERT_WEBHOOK_URL`) and Resend email. One can be misconfigured.

**I3. The email comes from the wrong sender or lands in spam**
- *Cause:* DNS records for the sending domain changed or are missing (DKIM/SPF CNAMEs, DNS-only in Cloudflare).
- *Fix:* Re-verify the domain in Resend.

**I4. The ntfy topic leaked**
- *Cause:* Anyone who knows the topic can read it.
- *Fix:* Pick a new long random topic, set it in the console's environment, restart the console, `npm run alert:test`.

**I5. A settings change had no effect**
- *Cause:* Environment variables only reach programs started *after* they were set. Restart the console.
- *Check (PC):* `data\logs\console-launcher.out` should contain `alerts are on`.

---

### Issue J: "CI is red, or I cannot merge"

**J1. The run fails in two seconds**
- *Cause:* Rare now. A repository that is private again, or a GitHub billing or spending-limit problem ("payments failed").
- *Fix:* Check the repository is public and billing is fine; meanwhile run lint and tests locally and quote the results in the PR.

**J2. Lint fails but tests pass**
- *Cause:* CI runs lint first. Typical: a rule such as `no-regex-spaces`.
- *Fix:* `npm run lint` locally, fix, push.

**J3. One test fails only on my PC**
- *Cause:* `DEMO_BRAND_NAME` or `DEMO_BOOKING_URL` set in your shell.
- *Fix:* Run with them unset.

**J4. A shell-script test fails on Windows**
- *Cause:* A test ran `sh -n` on a bash-only script. (Real case, fixed.)
- *Fix:* Use the right checker or skip on the wrong platform.

**J5. Two PRs conflict because one is "stacked" on the other**
- *Fix:* Merge the base first, then update the second branch with `main` before merging.

### Issue K: "A demo device does nothing when I press a button" (RMM)

**K1. Remote Terminal, Disk Management, Maintenance, Scripts, Software Patches or Devices (Reboot, Shutdown) says "This is a demo device, so it is simulated..."**
- *Cause:* The hosted demo's devices are fictional (`agent_version` is `demo-simulated`); no real agent exists to carry out the action. This is correct behaviour since 17 Nov 2026; before that the pages queued tasks nobody would ever run.
- *Fix:* None. Explain it to the customer: on a real device the agent does it on its next check-in.

**K2. A *real* device (enrolled agent) shows the same message**
- *Cause:* Its `agent_version` is wrongly set to the demo marker.
- *Fix:* Check the device record; real agents report their own version.

**K3. I am adding a new page that queues work for devices**
- *Fix:* Use `from utils.demo import is_simulated, demo_note` (file `dashboard/utils/demo.py` in the RMM repository): skip the API call for simulated devices and show `demo_note("what it would do")`. Add a test that fails without the guard (see `dashboard/tests/test_demo_simulated_devices.py`).

**K4. "Software Patches shows No packages found"**
- *Cause:* The demo's installed-software table was empty. Fixed on 17 Nov 2026 (112 rows for 8 devices).
- *Fix:* Re-run the seed script (it adds only what is missing) or `reset-demos.sh`, which reseeds it.

### Issue L: "CarRental admin: AI model says the database update has not been applied"

**L1.** *Cause:* Migration 015 (`app_settings`) is missing on the production project. *Fix:* In the Supabase SQL editor of the **production** project, run `05a_app_settings_check_READONLY.sql` (expects `table_exists = false`), then `05b`, then `05c` to verify. The files live in the owner's `RECI-migrations` folder. Check the editor shows the right project name before running.

**L2.** *Cause:* The SQL ran on the wrong project (the demo one). *Fix:* Re-run on production; the check tells you which one has the table.

**L3.** *Cause:* A migration was assumed to be applied from an old note. *Fix:* Always run the read-only check before recording "applied".

---

# Part 6: Where each project stands

## 21. Project by project (state at the end of 17 November 2026)

### ProjectsDashboard (this repository)
- Default branch `main`, protected; standard files added (LICENSE, SECURITY, CHANGELOG, PR template; PR #52); project standard and inventory published (`docs/PROJECT-STANDARD.md`, `docs/PROJECT-INVENTORY-2026-11-17.md`).
- Licence library and CLI merged (PR #50) and used for real: the owner's signing key exists and is backed up offline.
- Deployment change (PR #53): the hosted RMM demo API now runs with `FLASK_ENV: production` (debug off, secure cookies; the dashboard uses bearer tokens so nothing breaks).
- Demo seed (PR #54): `supervisor/demo-fixes/seed-rmm-demo.py` now seeds installed software for the demo devices.
- This book and a README change were the only uncommitted local files when the book was written.

### RMM (Remote Management)
- **Licence enforcement** merged (PR #62), off by default (`LICENCE_ENFORCEMENT=1` to enable).
- **CI fixed** (PR #65): the dependency audit blocks only on shipped packages; the development-tool audit is informational.
- **Demo honesty (PRs #64, #66, #67):** the dashboard now recognises simulated devices (`dashboard/utils/demo.py`) and explains instead of queueing impossible work on Software Patches, Remote Terminal, Disk Management, Maintenance, Scripts and the Devices page's Reboot/Shutdown. The terminal for a simulated device is a local, clearly labelled mock. Tests cover this; the old pages fail them.
- **Audited and left alone:** OS Patches (database only), MDM actions (no phones in the demo), Network Discovery (the demo's API container has no `ping`, no capabilities and a private network, so a scan finds nothing and cannot reach outward), Automation "Run Now" (message already accurate).
- Hosted demo: production mode, software data present, assistant working. Not done: a browser click-through of the deployed Remote Terminal.

### CarRental / RECI (ClaudeWorkspace)
- **Repository public** (17 Nov), history scanned (no real secrets; only old weak demo passwords for accounts that were deleted). `main` protected (3 required checks). Standard files merged.
- **CI works for the first time:** lint, type-check, unit tests, full build of web and admin, and Playwright end-to-end tests in mock mode (PRs #21, #22).
- **White-label and vehicle licence** (brand module, footer settings, vehicle limit) merged and **deployed to production** after a preview deploy, a licence end-to-end test and a before/after smoke comparison (13 status codes and page texts identical). Enforcement is off on the live site.
- **Banner bug fixed** (PR #23, wrong address for the licence status call).
- **Migration 015 applied** on production (after a wrong-project mistake and a wrong table name in my first check script, both corrected). Built-in AI model chosen; the AI search was re-checked on production (English and German queries correct).
- **Open:** Stripe and Resend environment variables (owner does these personally); October audit findings to re-check; no database backups on the free plan.
- **Production deploy recipe:** from a **clean clone of `main`**, copy the right `.vercel/project.*.json` (web or admin) to `.vercel/project.json`, run `vercel deploy --prod`. The admin app lives under the base path `/admin`. Never promote a preview build (it has placeholder settings). Record the previous deployment so `vercel promote <old>` is a one-step rollback. Run the same smoke script before and after.

### ClaudeOS
- Public, MIT, `main` protected (check: Tests); version tag 17.4.0 released; standard files merged.
- Hosted demo **rebuilt from `main`** plus the server's copy of PR #51; AI chat tested from inside the container and in a browser.
- Open: the MIT licence conflicts with the agency-licence text (owner decision); the skills pack lives on a separate branch (not merged).

### CRM
- Default branch renamed to `main`; protected (verify, security). CI had been broken by the move to Prisma 7 and was fixed in that repository (`SHADOW_DATABASE_URL`, two date-pinned tests). Standard files merged. Demo unchanged today.

### ImageApp and Airfinder
- Default branch `main`, protected (test / tests), standard files merged, CI green. ImageApp's Pillow 13 fix is merged and the server already ran it.

### Hosting (Hetzner)
- Everything stayed up all day: after each rebuild the eight public hosts were checked (home 200, console 302, six demos 401 until a link is used). Rebuilds name only the changed service and tag a rollback image first. The live directory on the server follows `main` by fast-forward only.

## 22. What changed on 17 November 2026

| # | Change | Where | Live effect |
| --- | --- | --- | --- |
| 1 | RECI made public; CI runs free | RECI | None for visitors |
| 2 | RECI mock mode and E2E fixes (#22), docs (#21) | RECI | CI only |
| 3 | RECI branch protection (3 checks) | RECI | Process |
| 4 | Licence end-to-end test; banner fix (#23) | RECI | Admin banner now appears |
| 5 | White-label and vehicle licence deployed to production | RECI | Live, enforcement off |
| 6 | Migration 015 (`app_settings`) applied, AI model chosen | RECI database | AI model setting works |
| 7 | ClaudeOS and RMM demos rebuilt from `main` | Hetzner | New code in both demos |
| 8 | AI chat tested on both demos (containers and browser) | Hetzner | None |
| 9 | RMM demo API in production mode (#53) | Hetzner | Debug off, secure cookies |
| 10 | RMM demo software data seeded (#54) | Hetzner | Software Patches shows packages |
| 11 | RMM CI audit split (#65) | RMM | CI unblocked |
| 12 | Simulated-device handling on six pages (#64, #66, #67) | RMM and Hetzner | No fake "queued" messages |
| 13 | Scratch clones and the Desktop key copy removed | Owner's PC | Tidy |
| 14 | All repositories on `main`, protected, standard files | All | Process |
| 15 | This book rewritten | ProjectsDashboard | None |

**Corrections made the same day (so you do not repeat them):** the RMM demo *does* have an AI assistant; migration 015 was first recorded as applied but was not; a verification script named a table that does not exist; and a deploy "conflict" was only a missing git identity on the server.

**Still the owner's to do:** Stripe and Resend for RECI; confirm the offline key backup opens; optionally annotate the three test lines in the licence log; later, remove the RMM audit exception.

---

# Appendices

## Appendix A: Checklists

### A.1 Handover checklist (new owner)

- [ ] Repository opens; `npm install`, `npm test` and `npm run lint` succeed.
- [ ] Signed in to the console with a password and a 2-step code.
- [ ] A copy of `ADMIN_DATA_KEY` is in a password manager.
- [ ] The alert topic is understood as a secret; a test alert (`npm run alert:test`) arrived.
- [ ] The backup folder contains a recent file; the restore steps were read (issue H2 and H3).
- [ ] You created, opened and revoked a link yourself (chapter 9).
- [ ] You have read the golden rules (Appendix D).
- [ ] You know where logs are (`data\logs\`, `docker compose logs`) and where the written audits are (`audits/`).
- [ ] Access to: Cloudflare, Hetzner (with 2FA), Anthropic (workspace `facyke-demos`), GitHub, Resend, cal.com; each person has their *own* login.
- [ ] The Hetzner SSH key is held by the operator only; the passphrase is not written anywhere shared.
- [ ] A private, backed-up copy of `deploy/.env` exists.
- [ ] The signing key for licences exists and is backed up privately (chapter 11); you have checked the backup opens (it starts with `-----BEGIN PRIVATE KEY-----`).
- [ ] You know every repository is public: before any commit, no keys, passwords, `.env` files or private addresses.

### A.2 Weekly checklist

- [ ] Console green; no unexpected alerts.
- [ ] Links sent: follow up on *Came back*/*Engaged*; remind *Not opened*.
- [ ] Newest backup is recent; one copy exists off the server.
- [ ] Anthropic spend vs the $5 limit; Hetzner invoice.
- [ ] Dependencies/audit notes, if the owner wants them.

### A.3 Before any customer demo

- [ ] The demo product is up (console green) and was opened by you today.
- [ ] You logged in as the demo user and clicked through the main path.
- [ ] You know the demo credentials and how you will share them.
- [ ] The link has a sensible expiry (2+ days), uses (3+), a name and a short welcome note.
- [ ] The AI guide is on only if you want it (and the product has one).
- [ ] Nobody else is using the shared demo (check *busy*).

### A.4 When someone leaves the team

- [ ] Remove their console access / change the shared password and run `sign-out-all`.
- [ ] Remove their SSH public key from `/home/deploy/.ssh/authorized_keys`.
- [ ] Remove them from GitHub, Cloudflare, Hetzner, Anthropic, Resend.
- [ ] Rotate any key they could have seen (`set-demo-key.sh`, Resend key).
- [ ] Review the audit log for their last activity.

---

## Appendix B: Cheat sheet

```text
LOCAL (PC)
  npm run status                       what answers
  start-console.bat                    owner console (4100)
  npm run gateway                      demo gateway (4300)
  npm run demo -- create|list|revoke   customer links
  npm run backup                       backup now
  npm test / lint / test:browser       the checks

SERVER (ssh deploy@..., cd /home/deploy/ProjectsDashboard/deploy)
  docker compose ps
  docker compose logs -f gateway
  docker compose --profile apps up -d --build <service>
  ./reset-demos.sh --dry-run | --force <app>
  ./check-apps-env.sh
  docker compose --profile apps exec -T gateway node supervisor/demo-reset-state.mjs due <product>

URLS
  facyke.com            public site
  admin.facyke.com      owner console (password + 2-step)
  <product>.demo.facyke.com/d/<token>     customer link

PORTS (PC)  4100 console · 4200 showcase · 4300 gateway · 3000/5000/8501 reserved
```

### Where each kind of problem is logged

| Problem | Look here |
| --- | --- |
| An app will not start (PC) | `data\logs\<app>-<process>.log` |
| The console launcher | `data\logs\console-launcher.out` |
| Who did what | Console → Activity (audit log) |
| A demo container (server) | `docker compose logs <service>` |
| Gateway on the server | `docker compose logs gateway` (JSON lines; `LOG_FORMAT=text` for readable) |
| Health | `/_pd/healthz` on gateway and console |

---

## Appendix C: Where to find things

| I want to… | File or place |
| --- | --- |
| Understand the dashboard in short | `README.md` |
| Read the older handover book | `docs/HANDOVER-BOOK.md` (note: its hosting chapter was written before hosting went live) |
| See how the parts fit | `docs/HOW-IT-WORKS.md` |
| Know every gateway setting | `demo-gateway/README.md` |
| Host it | `deploy/README.md` |
| Use the MCP server | `mcp/README.md` |
| Understand licensing | `docs/PLAN-licensing.md`, `licensing/README.md` |
| See the repository standard and inventory | `docs/PROJECT-STANDARD.md`, `docs/PROJECT-INVENTORY-2026-11-17.md` |
| Add a device-dependent RMM page | `dashboard/utils/demo.py` in the RMM repository |
| Seed or repair RMM demo data | `supervisor/demo-fixes/seed-rmm-demo.py` |
| Write or improve an AI guide | `docs/GUIDES.md`, `guides/*.md` |
| See security and code reviews | `audits/` |
| See per-product production audits (16 Nov 2026) | `audits/prod-audit-2026-11-16-*.md` |
| Change public website text | `showcase/*.json` |

---

## Appendix D: The golden rules

1. **Never edit the apps**, their `.env` files, databases or repositories from the dashboard without explicit approval.
2. **Never mark a demo `demoReady`** until it has its own data.
3. **Never put real credentials** in the registry, the showcase, the repository, chat, tickets or this book.
4. **Never commit** `data/`, `deploy/.env` or `registry/apps.hosted.json`.
5. **One console, one port.** A second console blocks the launcher.
6. **The Desktop folders are the source of truth** for each app; same-named folders inside the project are stale.
7. **Real before fast:** verify the live state (`docker compose ps`, the console, a real link) before you say something is broken, fixed, or blocked. Memory and assumptions go stale.
8. **Gate commits on tests.** Do not commit after a failing run.
9. **Ask before anything hard to undo or outward-facing:** deleting data, revoking someone's active link, rotating a key, restarting a demo in use, sending something to a customer.
10. **Demo AI costs money:** keep the key's spending limit in place.
11. **Everything is public:** nothing secret goes into any repository, issue, pull request or screenshot (RMM dashboard URLs carry a session token).
12. **Check before you record:** never write "applied", "deployed" or "fixed" in a note until you have run the check that proves it.
13. **A demo must not pretend:** if a button cannot really work in the demo, say so on the page.

---

## Appendix E: Frequently asked questions

**Is it safe to give a customer the link by email?** Yes. The link is a one-time-shown secret that dies at expiry or revocation. Use the device lock for sensitive prospects.

**Can I extend a link?** No. Create a new one.

**Why did my link lose a use when I didn't open it?** It didn't: looking at the opening page spends nothing. A use is spent on the button press.

**Can customers see each other?** In private-copy products, no. In shared demos, they share the same sample database, which is why they are asked not to enter real data and why the demo resets.

**Why are there six products but a different demo style for each?** Some are light (ImageApp), so a private copy per link is cheap. Others (CRM, RMM, CarRental) have heavy databases, so one shared copy is reset between customers.

**Where does the AI cost go?** Demo AI uses the `facyke-demos` key ($5/month cap). Per-deployment products use the customer's own key.

**What if the owner is unreachable?** The operator can keep demos running and restore from backups, but must not rotate keys or delete data without approval. Keep a sealed "break-glass" note with account recovery information in a safe place.

**What happens if the server dies?** Recreate a Hetzner server, install Docker, restore `deploy/.env` and the repository, run the first-start steps in `deploy/README.md`, restore the Postgres backup, repoint DNS. Everything else is rebuilt from code.

**Where do I add new knowledge?** In this book. When you solve a problem that is not in chapter 20, add it as a new example in the right family, in the same shape (Situation → Cause → Fix → Lesson).

---

*End of the onboarding book. Welcome to the team.*
