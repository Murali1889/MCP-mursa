# Mursa MCP — Integration Guide

Connect Claude, Cursor, Zed, Windsurf, or any MCP-compatible client to your
Mursa data: tasks, calendar, goals, notes, habits, projects, and Gmail.

- **Package:** [`mursa-mcp`](https://www.npmjs.com/package/mursa-mcp) on npm
- **Source:** [github.com/Murali1889/MCP-mursa](https://github.com/Murali1889/MCP-mursa)
- **Docs:** [mursa.me/mcp](https://www.mursa.me/mcp)
- **Dashboard:** [dashboard.mursa.me](https://dashboard.mursa.me)

---

## 1. Get an API key

1. Sign in to [dashboard.mursa.me](https://dashboard.mursa.me)
2. **Settings → API keys → New key**
3. Pick label, expiry (2 / 10 / 15 / 30 / 90 days · never), and scopes
4. Copy the key (starts with `mursa_mcp_…`) — you see it once

We store only `sha256(key)`. Lost = mint another. Per-key scopes + expiry + hard
revocation.

---

## 2. Add to your client

### Claude Code (`~/.claude.json`)

```json
{
  "mcpServers": {
    "mursa": {
      "command": "npx",
      "args": ["-y", "mursa-mcp"],
      "env": { "MURSA_API_KEY": "mursa_mcp_PASTE_HERE" }
    }
  }
}
```

Restart Claude Code. `/mcp` should list `mursa`.

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
or `%APPDATA%/Claude/claude_desktop_config.json` (Windows). Same JSON block.
Restart the app.

### Cursor

Settings → MCP → **Add new MCP server** → same JSON block.

### Zed (`~/.config/zed/settings.json`)

```json
{
  "context_servers": {
    "mursa": {
      "command": { "path": "npx", "args": ["-y", "mursa-mcp"] },
      "settings": { "MURSA_API_KEY": "mursa_mcp_PASTE_HERE" }
    }
  }
}
```

### Windsurf / Codex / any stdio MCP client

Same shape: `command: npx`, `args: ["-y", "mursa-mcp"]`, env carries the key.

---

## 3. What your agent can do (28 tools)

| Tool | Required scope | Purpose |
|---|---|---|
| `whoami` | (any key) | Returns userId — sanity check |
| `list_inbox` | `tasks:read` | Open, unscheduled, personal |
| `list_myday` | `tasks:read` | Scheduled for a day (default today) |
| `list_schedule` | `tasks:read` | All scheduled in a date range |
| `search_tasks` | `tasks:read` | ILIKE title search |
| `create_task` | `tasks:write` | Inbox or MyDay if `scheduled_date` set |
| `update_task` | `tasks:write` | Patch any editable field |
| `complete_task` | `tasks:write` | Mark completed |
| `defer_task` | `tasks:write` | Change due_date |
| `schedule_task` | `tasks:write` | Set scheduled_date + time block |
| `list_calendar` | `calendar:read` | Time-blocked tasks in range |
| `create_calendar_event` | `calendar:write` | Time-blocked task (meeting) |
| `list_goals` | `goals:read` | Your goals |
| `create_goal` | `goals:write` | Create a goal |
| `update_goal` | `goals:write` | Patch a goal |
| `delete_goal` | `goals:write` | Delete + unlink its tasks |
| `list_notes` | `notes:read` | Pinned first, then recent |
| `search_notes` | `notes:read` | ILIKE title + content |
| `create_note` | `notes:write` | Create a note |
| `update_note` | `notes:write` | Patch a note |
| `list_habits` | `habits:read` | Active habits |
| `list_projects` | `projects:read` | Your projects |
| `list_emails` | `email:read` | Gmail threads (default INBOX) |
| `get_email` | `email:read` | Full body + attachment metadata |
| `get_attachment` | `email:read` | Download attachment as base64 |
| `search_emails` | `email:read` | Gmail query syntax |
| `send_email` | `email:send` | New email (attachments ≤3MB each, ≤10MB total) |
| `reply_email` | `email:send` | Reply preserving thread headers |

`*` as a scope grants everything. Email actions require Gmail connected in
Mursa Settings first.

---

## 4. Try it

```
"What's on my Mursa Inbox? Top 5 by urgency."
"Summarize my MyDay and tell me what to focus on first."
"Read the 3 most recent unread emails and turn anything actionable into
 Mursa tasks scheduled for tomorrow morning."
"What goals do I have? Which ones haven't moved this week?"
"Find every email from <person>@<domain> in the last 30 days, summarize
 each thread, and save it as a note."
"Reply to the most recent email from <name> with: <draft>."
"Create a meeting on my calendar for tomorrow 2-3pm titled <topic>."
```

---

## 5. Security (built-in)

- API keys sha256-hashed at rest — raw value never stored
- Per-key scopes + expiry, set at mint time
- Hard revocation from the dashboard — next call fails instantly
- Per-action rate limits: 60/min reads, 30/min writes, **5/min email send**
- 90-day audit log (action, status, latency, IP — no payload)
- Email attachments capped: 3 MB per file, 10 MB total per email
- Single public endpoint (`www.mursa.me/api/mcp`); Supabase function gated by
  shared proxy secret — direct hits get 403

---

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| MCP server not loaded after restart | Check `~/.claude.json` JSON is valid (`jq . ~/.claude.json`) and the entry is inside `"mcpServers"` |
| `Network error calling https://www.mursa.me/api/mcp: fetch failed` | Upgrade to ≥0.4.1 (`mursa-mcp@latest`). Earlier versions used apex URL that 307-redirected and stripped the auth header |
| `Invalid, expired, or revoked API key` | Mint fresh in dashboard, swap value, restart client |
| `This API key is missing the required scope: …` | Key wasn't granted that scope at mint time. Mint a new one with the scope checked |
| `Gmail is not connected. Connect Gmail in Mursa Settings first.` | Connect Gmail from the Mursa app first |
| `Rate limit exceeded (5/min for send_email)` | Slow down — strict throttle on outbound mail |
| Calls work in one client but not in claude.ai web | claude.ai web only supports remote HTTP MCPs. This is stdio-only today. |

---

## 7. Run from source (advanced)

```bash
git clone https://github.com/Murali1889/MCP-mursa.git
cd MCP-mursa
npm install
echo 'MURSA_API_KEY=mursa_mcp_…' > .env
```

Point your client at the absolute path:

```json
{
  "mcpServers": {
    "mursa": {
      "command": "node",
      "args": ["/absolute/path/to/MCP-mursa/server.js"]
    }
  }
}
```

Override the endpoint (preview deploys, local dev):

```
MURSA_API_URL=https://your-preview.vercel.app/api/mcp
```

Default is `https://www.mursa.me/api/mcp`.
