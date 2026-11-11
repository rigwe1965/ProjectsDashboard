# MCP server

Lets an AI assistant look at the dashboard: your apps, customer demo links, and what customers did with them. By default it changes nothing; three tools that do are switched off until you turn them on (see "Tools that change things").
It runs on your computer, as you, and reads the same database as the console. No network port is opened: the assistant starts it and talks to it over standard input/output.

```
node mcp/server.mjs          # or: npm run mcp   (an assistant starts it for you; running it by hand just waits for input)
```

## Add it to Claude Code

```
claude mcp add projects-dashboard -- node C:\path\to\ProjectsDashboard\mcp\server.mjs
```

Use the full path of this folder. Set `DASHBOARD_DATA` in the same command if you keep the data folder elsewhere.

## Tools

| Tool | Shows |
|---|---|
| `list_apps` | each app and process, and whether it is running |
| `list_demo_links` | links newest first: customer, product, state, expiry, opens, engagement (none / opened / engaged / came back). Filters: `app`, `state`, `limit` |
| `link_activity` | one link day by day (requests, active time) and its busiest pages |
| `recent_events` | the newest audit entries (`kind`: all, admin, demos, problems), without addresses or browser strings |
| `demo_state` | each demo product: running, resetting or held after a failed reset, last reset, links in use, private copies |

## Tools that change things (off by default)

Start the server with `MCP_WRITE=1` to offer these. Without it they are not listed, and calling one answers that changing things is switched off.

| Tool | Does |
|---|---|
| `create_demo_link` | makes a link (customer, product, hours, max opens, device lock) with the same checks as the console. **The link is shown once, in the answer**, so it passes through the assistant's conversation: only turn this on where that is acceptable |
| `revoke_demo_link` | revokes a link at once (the customer loses access, including live connections) |
| `reset_demo` | resets a shared demo to its sample data. **Refused while any link for it is in use**; there is no force option here (force it from the console). Not for private-copy products |

Every change is recorded in the activity log as `by: mcp`. All changes together are limited to 20 attempts per minute (a refusal is logged too). Starting and stopping apps, forgetting a link and password settings are not offered at all.

With Claude Code: `claude mcp add projects-dashboard --env MCP_WRITE=1 -- node C:\path\to\ProjectsDashboard\mcp\server.mjs`

## What it never returns

Link addresses and tokens (a link is shown once, when it is created, and only its hash is stored), IP addresses, browser strings, environment values, passwords or 2-step settings. Customer names and page paths are shortened to one line, and every answer is wrapped with a note that the text inside came from other people and is data, not instructions.

Anything unexpected is reported to you on the server's error output; the assistant only sees a plain sentence.
