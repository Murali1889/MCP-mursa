#!/usr/bin/env node
/**
 * Mursa MCP server (stdio).
 *
 * Architecture:
 *   Claude/Cursor/etc.  ─stdio─>  this Node process
 *                                       │
 *                                       │  fetch() with
 *                                       │  Authorization: Bearer <api key>
 *                                       ▼
 *                          Supabase Edge Function: mcp
 *                                       │ resolves key -> user_id + scopes
 *                                       ▼
 *                                Supabase Postgres
 *
 * The MCP server holds NO Supabase secrets. It only knows:
 *   - SUPABASE_URL   (public)
 *   - MURSA_API_KEY  (opaque per-user key with scopes + expiry)
 *
 * Every tool below just maps to one edge-function action.
 */

// Subcommand: `npx mursa-mcp setup [...]` runs the installer instead of the
// MCP server. Detected before pulling in the SDK so setup stays fast.
if (process.argv[2] === "setup") {
  require("./setup.js");
  return;
}

require("dotenv").config({ path: require("path").join(__dirname, ".env") });

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const {
  StdioServerTransport,
} = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");

// Default to the public Mursa proxy. Override only if you're self-hosting or
// pointing at a preview deployment.
const MURSA_API_URL = process.env.MURSA_API_URL || "https://www.mursa.me/api/mcp";
const MURSA_API_KEY = process.env.MURSA_API_KEY;

if (!MURSA_API_KEY) {
  console.error("[mursa-mcp] MURSA_API_KEY is not set in .env");
  process.exit(1);
}

const ENDPOINT = MURSA_API_URL.replace(/\/$/, "");

// ───────────────────────────── call() ─────────────────────────────

async function call(action, args = {}) {
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MURSA_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action, args }),
    });
  } catch (e) {
    throw new Error(`Network error calling ${ENDPOINT}: ${e.message}`);
  }

  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error(`Non-JSON response (HTTP ${res.status})`);
  }

  if (!res.ok || body.error) {
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return body.data;
}

function jsonContent(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

function errorContent(err) {
  return {
    isError: true,
    content: [{ type: "text", text: `Error: ${err.message || String(err)}` }],
  };
}

const server = new McpServer({ name: "mursa", version: "0.4.1" });

function tool(name, description, schema, action) {
  server.tool(name, description, schema, async (args) => {
    try {
      const data = await call(action, args ?? {});
      return jsonContent(data);
    } catch (err) {
      return errorContent(err);
    }
  });
}

// ───────────────────────────── tools ─────────────────────────────

// Meta
tool("whoami", "Show which Mursa user this API key belongs to.", {}, "whoami");

// Tasks: read
tool(
  "list_inbox",
  "List Inbox tasks (unscheduled, personal, not completed by default).",
  {
    status: z.string().optional(),
    limit: z.number().int().positive().max(200).optional(),
    includeScheduled: z.boolean().optional(),
  },
  "list_inbox"
);

tool(
  "list_myday",
  "List tasks scheduled for a specific day (default today). Date: YYYY-MM-DD.",
  { date: z.string().optional() },
  "list_myday"
);

tool(
  "list_schedule",
  "List all scheduled tasks between startDate and endDate inclusive. Dates: YYYY-MM-DD.",
  { startDate: z.string(), endDate: z.string() },
  "list_schedule"
);

tool(
  "search_tasks",
  "Search task titles by ILIKE match. Returns most recently updated first.",
  { query: z.string().min(1), limit: z.number().int().positive().max(100).optional() },
  "search_tasks"
);

// Calendar (= time-blocked scheduled tasks)
tool(
  "list_calendar",
  "List calendar events (scheduled tasks with start_time) between two dates. Dates: YYYY-MM-DD.",
  { startDate: z.string(), endDate: z.string() },
  "list_calendar"
);

tool(
  "create_calendar_event",
  "Create a calendar event (a task with scheduled_date + start_time/end_time, task_type='meeting' by default).",
  {
    title: z.string().min(1),
    scheduled_date: z.string(),
    start_time: z.string().optional(),
    end_time: z.string().optional(),
    duration_minutes: z.number().int().positive().optional(),
    description: z.string().optional(),
    why: z.string().optional(),
    task_type: z.enum(["deep", "shallow", "admin", "meeting"]).optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  },
  "create_calendar_event"
);

// Tasks: write
tool(
  "create_task",
  "Create a task. With scheduled_date -> MyDay; without -> Inbox.",
  {
    title: z.string().min(1),
    description: z.string().optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    due_date: z.string().optional(),
    labels: z.array(z.string()).optional(),
    category: z.string().optional(),
    estimated_hours: z.number().nonnegative().optional(),
    goal_id: z.string().optional(),
    project_id: z.string().optional(),
    scheduled_date: z.string().optional(),
    start_time: z.string().optional(),
    end_time: z.string().optional(),
    duration_minutes: z.number().int().positive().optional(),
    task_type: z.enum(["deep", "shallow", "admin", "meeting"]).optional(),
    why: z.string().optional(),
  },
  "create_task"
);

tool(
  "update_task",
  "Patch any subset of editable fields on a task.",
  {
    task_id: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    status: z.string().optional(),
    priority: z.string().optional(),
    due_date: z.string().nullable().optional(),
    labels: z.array(z.string()).optional(),
    category: z.string().optional(),
    estimated_hours: z.number().nonnegative().optional(),
    goal_id: z.string().nullable().optional(),
    project_id: z.string().nullable().optional(),
    scheduled_date: z.string().nullable().optional(),
    start_time: z.string().nullable().optional(),
    end_time: z.string().nullable().optional(),
    duration_minutes: z.number().int().positive().optional(),
    task_type: z.string().optional(),
    why: z.string().optional(),
    sort_order: z.number().int().optional(),
  },
  "update_task"
);

tool(
  "complete_task",
  "Mark a task as completed.",
  { task_id: z.string() },
  "complete_task"
);

tool(
  "defer_task",
  "Set a task's due_date to a new date (does not change scheduled_date).",
  { task_id: z.string(), new_date: z.string() },
  "defer_task"
);

tool(
  "schedule_task",
  "Move a task onto a specific date (MyDay). Optionally set start/end time and duration.",
  {
    task_id: z.string(),
    scheduled_date: z.string(),
    start_time: z.string().optional(),
    end_time: z.string().optional(),
    duration_minutes: z.number().int().positive().optional(),
    task_type: z.enum(["deep", "shallow", "admin", "meeting"]).optional(),
  },
  "schedule_task"
);

// Goals
tool(
  "list_goals",
  "List your goals, optionally filtered by status ('active', 'completed', ...).",
  { status: z.string().optional() },
  "list_goals"
);

tool(
  "create_goal",
  "Create a goal.",
  {
    title: z.string().min(1),
    description: z.string().optional(),
    color: z.string().optional(),
    target_date: z.string().optional(),
    timeline_days: z.number().int().positive().optional(),
    project_id: z.string().optional(),
    status: z.string().optional(),
    priority: z.number().int().min(1).max(5).optional(),
    tags: z.array(z.string()).optional(),
    horizon: z.string().optional(),
    area: z.string().optional(),
  },
  "create_goal"
);

tool(
  "update_goal",
  "Patch a goal.",
  {
    goal_id: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    color: z.string().optional(),
    progress: z.number().min(0).max(100).optional(),
    target_date: z.string().nullable().optional(),
    timeline_days: z.number().int().positive().optional(),
    status: z.string().optional(),
    priority: z.number().int().min(1).max(5).optional(),
    is_archived: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
    sort_order: z.number().int().optional(),
    horizon: z.string().nullable().optional(),
    area: z.string().nullable().optional(),
  },
  "update_goal"
);

tool(
  "delete_goal",
  "Delete a goal. Tasks that reference it are unlinked first (goal_id set to null).",
  { goal_id: z.string() },
  "delete_goal"
);

// Notes
tool(
  "list_notes",
  "List notes, pinned first, then most recently updated.",
  { limit: z.number().int().positive().max(200).optional() },
  "list_notes"
);

tool(
  "search_notes",
  "Search note titles and content by ILIKE.",
  { query: z.string().min(1), limit: z.number().int().positive().max(100).optional() },
  "search_notes"
);

tool(
  "create_note",
  "Create a note.",
  {
    title: z.string().optional(),
    content: z.string().optional(),
    tags: z.array(z.string()).optional(),
    color: z.string().optional(),
  },
  "create_note"
);

tool(
  "update_note",
  "Patch a note.",
  {
    note_id: z.string(),
    title: z.string().optional(),
    content: z.string().optional(),
    tags: z.array(z.string()).optional(),
    color: z.string().optional(),
    isPinned: z.boolean().optional(),
  },
  "update_note"
);

// Habits & projects (read-only for v1)
tool("list_habits", "List your active (non-archived) habits.", {}, "list_habits");
tool("list_projects", "List your projects, most recently updated first.", {}, "list_projects");

// ───────────────────────────── EMAIL (Gmail) ─────────────────────────────

const sendAttachmentSchema = z.object({
  filename: z.string().min(1),
  mimeType: z.string().optional(),
  contentBase64: z.string().min(1),
});

tool(
  "list_emails",
  "List Gmail threads in a label (default INBOX). Returns thread previews (subject/from/snippet/labels/unread).",
  {
    maxResults: z.number().int().min(1).max(50).optional(),
    pageToken: z.string().optional(),
    q: z.string().optional(),
    label: z.string().optional(),
  },
  "list_emails"
);

tool(
  "get_email",
  "Get the full content of a thread or single message. Returns body text + HTML + attachment metadata (use get_attachment to download).",
  {
    threadId: z.string().optional(),
    messageId: z.string().optional(),
  },
  "get_email"
);

tool(
  "get_attachment",
  "Download a single attachment from an email. Returns { size, contentBase64 } — decode the base64 to get the bytes.",
  {
    messageId: z.string(),
    attachmentId: z.string(),
  },
  "get_attachment"
);

tool(
  "search_emails",
  "Search Gmail using Gmail's query syntax (e.g. 'from:alice has:attachment newer_than:7d'). Returns message ids; use get_email to fetch.",
  {
    query: z.string().min(1),
    maxResults: z.number().int().min(1).max(50).optional(),
  },
  "search_emails"
);

tool(
  "send_email",
  "Send a new email. Attachments are base64-encoded; ≤3MB each, ≤10MB total. Rate-limited to 5/min.",
  {
    to: z.union([z.string(), z.array(z.string())]),
    cc: z.union([z.string(), z.array(z.string())]).optional(),
    bcc: z.union([z.string(), z.array(z.string())]).optional(),
    subject: z.string().min(1),
    bodyText: z.string().optional(),
    bodyHtml: z.string().optional(),
    attachments: z.array(sendAttachmentSchema).optional(),
  },
  "send_email"
);

tool(
  "reply_email",
  "Reply to an existing thread. Subject and recipient default to the last message's. Rate-limited to 5/min.",
  {
    threadId: z.string(),
    to: z.union([z.string(), z.array(z.string())]).optional(),
    cc: z.union([z.string(), z.array(z.string())]).optional(),
    bcc: z.union([z.string(), z.array(z.string())]).optional(),
    subject: z.string().optional(),
    bodyText: z.string().optional(),
    bodyHtml: z.string().optional(),
    attachments: z.array(sendAttachmentSchema).optional(),
  },
  "reply_email"
);

// ───────────────────────────── main ─────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("[mursa-mcp] fatal:", err);
  process.exit(1);
});
