// mursa-mcp setup — zero-friction installer.
//
//   npx mursa-mcp setup --key=mursa_mcp_…           # all defaults
//   npx mursa-mcp setup --key=… --client=claude-code # specific client only
//   npx mursa-mcp setup                              # interactive (prompts for key)
//
// Detects which MCP clients you have installed, safely merges the `mursa`
// entry into each one's config (preserving anything else already there), then
// runs a `whoami` call to verify the chain works end-to-end. Idempotent —
// re-running just updates the key.

const fs = require("fs");
const path = require("path");
const os = require("os");
const readline = require("readline");

const ENDPOINT = process.env.MURSA_API_URL || "https://www.mursa.me/api/mcp";

// ───────────────────────────── colors ─────────────────────────────
const c = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", blue: "\x1b[34m", cyan: "\x1b[36m",
};
const ok = (m) => console.log(`${c.green}✓${c.reset} ${m}`);
const warn = (m) => console.log(`${c.yellow}!${c.reset} ${m}`);
const err = (m) => console.log(`${c.red}✗${c.reset} ${m}`);
const info = (m) => console.log(`${c.dim}${m}${c.reset}`);
const heading = (m) => console.log(`\n${c.bold}${m}${c.reset}`);

// ───────────────────────────── clients ─────────────────────────────

const HOME = os.homedir();
const PLATFORM = process.platform;

const CLIENTS = [
  {
    id: "claude-code",
    name: "Claude Code",
    path: path.join(HOME, ".claude.json"),
    root: "mcpServers",
    style: "stdio",
  },
  {
    id: "claude-desktop",
    name: "Claude Desktop",
    path: PLATFORM === "darwin"
      ? path.join(HOME, "Library", "Application Support", "Claude", "claude_desktop_config.json")
      : PLATFORM === "win32"
        ? path.join(process.env.APPDATA || "", "Claude", "claude_desktop_config.json")
        : path.join(HOME, ".config", "Claude", "claude_desktop_config.json"),
    root: "mcpServers",
    style: "stdio",
  },
  {
    id: "cursor",
    name: "Cursor",
    path: path.join(HOME, ".cursor", "mcp.json"),
    root: "mcpServers",
    style: "stdio",
  },
];

function clientEntryFor(apiKey) {
  const env = { MURSA_API_KEY: apiKey };
  if (process.env.MURSA_API_URL) env.MURSA_API_URL = process.env.MURSA_API_URL;
  return {
    command: "npx",
    args: ["-y", "mursa-mcp"],
    env,
  };
}

// ───────────────────────────── safe JSON merge ─────────────────────────────

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, "utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
}

function backup(p) {
  if (!fs.existsSync(p)) return null;
  const bak = `${p}.bak.${Date.now()}`;
  fs.copyFileSync(p, bak);
  return bak;
}

function installInto(client, apiKey) {
  let existed = fs.existsSync(client.path);
  let cfg = existed ? readJson(client.path) : {};
  cfg = cfg || {};
  cfg[client.root] = cfg[client.root] || {};

  const had = !!cfg[client.root].mursa;
  const bak = existed ? backup(client.path) : null;

  cfg[client.root].mursa = clientEntryFor(apiKey);
  writeJson(client.path, cfg);

  return {
    path: client.path,
    created: !existed,
    updated: existed && had,
    added: existed && !had,
    backupAt: bak,
  };
}

// ───────────────────────────── verify ─────────────────────────────

async function verify(apiKey) {
  try {
    const r = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "whoami", args: {} }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || j?.error) {
      return { ok: false, message: j?.error || `HTTP ${r.status}` };
    }
    return { ok: true, userId: j?.data?.userId };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

// ───────────────────────────── prompt ─────────────────────────────

function prompt(question, { mask = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (!mask) {
      rl.question(question, (a) => { rl.close(); resolve(a.trim()); });
    } else {
      // Best-effort masking for the key.
      const orig = rl._writeToOutput;
      rl._writeToOutput = function (s) { orig.call(rl, s.replace(/./g, (ch) => (ch === "\n" || ch === "\r" ? ch : "*"))); };
      rl.question(question, (a) => { rl.close(); process.stdout.write("\n"); resolve(a.trim()); });
    }
  });
}

async function confirm(question, def = true) {
  const a = (await prompt(`${question} ${def ? "[Y/n]" : "[y/N]"} `)).toLowerCase();
  if (!a) return def;
  return a === "y" || a === "yes";
}

// ───────────────────────────── args ─────────────────────────────

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--yes" || a === "-y") out.yes = true;
    else if (a.startsWith("--key=")) out.key = a.slice(6);
    else if (a.startsWith("--client=")) out.client = a.slice(9);
  }
  return out;
}

function printHelp() {
  console.log(`
${c.bold}mursa-mcp setup${c.reset} — install the Mursa MCP into your AI client

${c.bold}Usage${c.reset}
  npx mursa-mcp setup --key=<key>                  # auto-detect + install
  npx mursa-mcp setup --key=<key> --client=<id>    # install into one client
  npx mursa-mcp setup --key=<key> -y               # no prompts

${c.bold}Clients${c.reset}
  claude-code      Claude Code (~/.claude.json)
  claude-desktop   Claude Desktop
  cursor           Cursor

Get a key at ${c.cyan}https://dashboard.mursa.me${c.reset} → Settings → API keys.
`);
}

// ───────────────────────────── main ─────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(3));
  if (args.help) { printHelp(); process.exit(0); }

  heading("Mursa MCP setup");
  info(`Endpoint: ${ENDPOINT}`);
  info(`Platform: ${PLATFORM}`);

  // 1. Resolve API key
  let apiKey = args.key || process.env.MURSA_API_KEY;
  if (!apiKey) {
    console.log();
    info("Get a key at https://dashboard.mursa.me → Settings → API keys");
    apiKey = await prompt("Paste your MURSA_API_KEY: ", { mask: true });
  }
  if (!apiKey || !apiKey.startsWith("mursa_mcp_")) {
    err("That doesn't look like a Mursa MCP key (should start with 'mursa_mcp_').");
    process.exit(1);
  }

  // 2. Verify key before touching any files
  heading("Verifying key");
  const v = await verify(apiKey);
  if (!v.ok) {
    err(`Key check failed: ${v.message}`);
    err("Aborting without changing any config.");
    process.exit(1);
  }
  ok(`Key valid — userId ${v.userId}`);

  // 3. Pick target clients
  heading("Detecting installed clients");
  const detected = CLIENTS.filter((c) => fs.existsSync(c.path));
  const missing = CLIENTS.filter((c) => !fs.existsSync(c.path));

  for (const c of detected) ok(`${c.name}  ${info("("+c.path+")")}`);
  for (const c of missing) warn(`${c.name} not detected  ${info("("+c.path+")")}`);

  let targets;
  if (args.client) {
    const t = CLIENTS.find((c) => c.id === args.client);
    if (!t) { err(`Unknown --client=${args.client}. Use one of: ${CLIENTS.map((c)=>c.id).join(", ")}`); process.exit(1); }
    targets = [t];
  } else if (args.yes) {
    targets = detected.length > 0 ? detected : [];
  } else if (detected.length === 1) {
    targets = detected;
  } else if (detected.length > 1) {
    heading("Install into?");
    targets = [];
    for (const c of detected) {
      const y = await confirm(`  Install Mursa MCP into ${c.name}?`, true);
      if (y) targets.push(c);
    }
  } else {
    warn("No MCP-compatible clients detected.");
    const y = await confirm("Create config for Claude Code anyway?", true);
    if (y) targets = [CLIENTS[0]];
  }

  if (!targets || targets.length === 0) {
    warn("Nothing to install.");
    process.exit(0);
  }

  // 4. Install
  heading("Installing");
  for (const t of targets) {
    try {
      const r = installInto(t, apiKey);
      if (r.created) ok(`Created ${t.name} config  ${info(r.path)}`);
      else if (r.updated) ok(`Updated mursa entry in ${t.name}  ${info("backup: " + r.backupAt)}`);
      else ok(`Added mursa to ${t.name}  ${info("backup: " + r.backupAt)}`);
    } catch (e) {
      err(`${t.name}: ${e.message}`);
    }
  }

  heading("Done");
  console.log(`Restart your client. The next session will have Mursa tools available.`);
  console.log(`${c.dim}Try: "list my Mursa inbox" or call mursa.whoami${c.reset}`);
}

main().catch((e) => { err(e.message); process.exit(1); });
