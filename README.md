# Mursa MCP

Connect Claude Code, Claude Desktop, Cursor, or any MCP-compatible client to
your Mursa tasks, calendar, goals, notes, habits, projects, and Gmail.

📖 **Full guide with screenshots:** https://mursa.me/mcp

---

## 60-second install

### 1. Get an API key

1. Open [dashboard.mursa.me](https://dashboard.mursa.me) and sign in.
2. Go to **Settings → API keys**.
3. Click **New key** → pick a label, expiry, and scopes → **Create**.
4. Copy the key (starts with `mursa_mcp_…`). You'll only see it once.

### 2. Add to your client

#### Claude Code (`~/.claude.json`)

```json
{
  "mcpServers": {
    "mursa": {
      "command": "npx",
      "args": ["-y", "mursa-mcp"],
      "env": { "MURSA_API_KEY": "mursa_mcp_…" }
    }
  }
}
```

Restart Claude Code, run `/mcp` to confirm, call `whoami` to verify.

#### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
or `%APPDATA%/Claude/claude_desktop_config.json` (Windows) with the same block,
then restart the app.

#### Cursor

Settings → MCP → Add new MCP server, same JSON block.

### 3. That's it

Your agent now has access to whatever scopes your key has.

---

## Tools (28)

| Group | Tools | Scope |
|---|---|---|
| Meta | `whoami` | (any) |
| Tasks (read) | `list_inbox`, `list_myday`, `list_schedule`, `search_tasks` | `tasks:read` |
| Tasks (write) | `create_task`, `update_task`, `complete_task`, `defer_task`, `schedule_task` | `tasks:write` |
| Calendar | `list_calendar`, `create_calendar_event` | `calendar:*` |
| Goals | `list_goals`, `create_goal`, `update_goal`, `delete_goal` | `goals:*` |
| Notes | `list_notes`, `search_notes`, `create_note`, `update_note` | `notes:*` |
| Habits | `list_habits` | `habits:read` |
| Projects | `list_projects` | `projects:read` |
| Email | `list_emails`, `get_email`, `get_attachment`, `search_emails` | `email:read` |
| Email | `send_email`, `reply_email` | `email:send` |

`*` as a scope grants everything.

---

## Security

- API keys are sha256-hashed at rest — the raw value is never stored.
- Per-key scopes + expiry. Revoke any key instantly from the dashboard.
- Per-action rate limits (60/min reads, 30/min writes, **5/min email send**).
- Every call audit-logged for 90 days (action, status, latency, IP — no payload).
- Email attachments capped at 3 MB each / 10 MB total per email.
- All traffic goes through `mursa.me/api/mcp`; the Supabase function is gated
  by a shared proxy secret so direct hits return 403.

---

## Run from source (advanced)

```bash
git clone https://github.com/Murali1889/Prod-Mursa.git
cd Prod-Mursa/mcp-servers/mursa
npm install
echo 'MURSA_API_KEY=mursa_mcp_…' > .env
```

Then point your client at the absolute path:

```json
{
  "mcpServers": {
    "mursa": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-servers/mursa/server.js"]
    }
  }
}
```

Override the endpoint for preview deployments or local dev:

```
MURSA_API_URL=https://mursa-preview.vercel.app/api/mcp
```

(Default is `https://mursa.me/api/mcp`.)

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Invalid, expired, or revoked API key` | Mint a fresh key in the dashboard, swap `MURSA_API_KEY`, restart your client. |
| `This API key is missing the required scope: …` | Your key wasn't granted that scope at mint time. Revoke and mint a new one with the scope checked. |
| `Gmail is not connected. Connect Gmail in Mursa Settings first.` | Connect Gmail from the Mursa app first. |
| `Rate limit exceeded (5/min for send_email)` | Slow down — strict throttle on outbound mail. |

For server-side deployment (running your own Mursa instance), see `DEPLOY.md`.
