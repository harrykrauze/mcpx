/**
 * scripts/telemetry-metrics.ts
 * 
 * mcpx KV daily audit (stats:daily:*) and Cloudflare Analytics Engine (mcpx_telemetry)
 * integrated telemetry and financial metrics analysis tool.
 * 
 * Usage:
 *   npm run metrics
 *   or:
 *   npx tsx scripts/telemetry-metrics.ts [--account <id>] [--token <token>] [--namespace <id>]
 */

import fs from "fs";
import path from "path";
import os from "os";
import dotenv from "dotenv";

dotenv.config();

// ANSI color codes for terminal
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
  white: "\x1b[37m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightCyan: "\x1b[96m",
  brightRed: "\x1b[91m",
};

interface LowBalanceRecord {
  keyId: string;
  tenantId: string;
  balanceCents: number;
}

interface DailyAuditSummary {
  timestamp: string;
  date: string;
  previousDate?: string;
  totalActiveKeys: number;
  lowBalanceCount: number;
  lowBalanceKeys: LowBalanceRecord[];
  status: "HEALTHY" | "DEGRADED";
}

interface CliArgs {
  accountId?: string;
  apiToken?: string;
  namespaceId?: string;
  help: boolean;
}

function parseArgs(args: string[]): CliArgs {
  const parsed: CliArgs = {
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--account" || arg === "-a") {
      parsed.accountId = args[++i];
    } else if (arg.startsWith("--account=")) {
      parsed.accountId = arg.split("=")[1];
    } else if (arg === "--token" || arg === "-t") {
      parsed.apiToken = args[++i];
    } else if (arg.startsWith("--token=")) {
      parsed.apiToken = arg.split("=")[1];
    } else if (arg === "--namespace" || arg === "-n") {
      parsed.namespaceId = args[++i];
    } else if (arg.startsWith("--namespace=")) {
      parsed.namespaceId = arg.split("=")[1];
    }
  }

  return parsed;
}

function printHelp(): void {
  console.log(`
${C.bold}mcpx KV Daily Audit & Telemetry Metrics Tool${C.reset}
======================================================

Usage:
  npm run metrics
  or:
  npx tsx scripts/telemetry-metrics.ts [OPTIONS]

Options:
  --account, -a <id>      Cloudflare Account ID (default: from env or wrangler session)
  --token, -t <token>     Cloudflare API token (with KV and Analytics Engine read permissions)
  --namespace, -n <id>    KV MCPX_KEYS namespace ID (default: 10a9a338595d40a5b424d3be11e26860)
  --help, -h              Display this help message
`);
}

async function resolveCredentials(args: CliArgs): Promise<{
  accountId: string;
  apiToken: string;
  namespaceId: string;
}> {
  let accountId = args.accountId || process.env.CLOUDFLARE_ACCOUNT_ID;
  let apiToken = args.apiToken || process.env.CLOUDFLARE_API_TOKEN;
  let namespaceId =
    args.namespaceId ||
    process.env.CLOUDFLARE_KV_NAMESPACE_ID ||
    "10a9a338595d40a5b424d3be11e26860";

  // 1. Check .dev.vars file if any variable is missing
  if ((!accountId || !apiToken) && fs.existsSync(".dev.vars")) {
    try {
      const devVars = fs.readFileSync(".dev.vars", "utf8");
      const accMatch = devVars.match(/CLOUDFLARE_ACCOUNT_ID=(.+)/);
      const tokMatch = devVars.match(/CLOUDFLARE_API_TOKEN=(.+)/);
      const nsMatch = devVars.match(/CLOUDFLARE_KV_NAMESPACE_ID=(.+)/);
      if (!accountId && accMatch) accountId = accMatch[1].trim();
      if (!apiToken && tokMatch) apiToken = tokMatch[1].trim();
      if (args.namespaceId === undefined && nsMatch) namespaceId = nsMatch[1].trim();
    } catch {
      // Ignore read error
    }
  }

  // 2. Attempt reading from local Wrangler configuration (default.toml)
  if (!accountId || !apiToken) {
    try {
      const tomlPath = path.join(
        os.homedir(),
        "AppData",
        "Roaming",
        "xdg.config",
        ".wrangler",
        "config",
        "default.toml"
      );
      if (fs.existsSync(tomlPath)) {
        const tomlContent = fs.readFileSync(tomlPath, "utf8");
        const tokenMatch = tomlContent.match(/oauth_token\s*=\s*"([^"]+)"/);
        if (tokenMatch && tokenMatch[1]) {
          if (!apiToken) {
            apiToken = tokenMatch[1];
          }

          if (!accountId) {
            // Default mcpx Cloudflare Account ID
            accountId = "8d6dc8b97f645453c0aa7f3fac62535d";
          }
        }
      }
    } catch {
      // Ignore read error
    }
  }

  // 3. Fallback to known mcpx account ID if token is available
  if (!accountId && apiToken) {
    accountId = "8d6dc8b97f645453c0aa7f3fac62535d";
  }

  if (!accountId || !apiToken) {
    console.error(`
${C.red}${C.bold}[ERROR: Missing Cloudflare credentials]${C.reset}
CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must be specified:
  1. In .env or .dev.vars file
  2. Or via CLI arguments: npm run metrics -- --account <id> --token <token>
`);
    process.exit(1);
  }

  return { accountId, apiToken, namespaceId };
}

async function fetchLatestDailyAudit(
  accountId: string,
  apiToken: string,
  namespaceId: string
): Promise<{ summary: DailyAuditSummary | null; keyName: string | null; isToday: boolean }> {
  try {
    const listUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/keys?prefix=stats:daily:&limit=10`;
    const res = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });

    if (!res.ok) {
      console.warn(`${C.yellow}[Warning] Failed to list KV keys (HTTP ${res.status})${C.reset}`);
      return { summary: null, keyName: null, isToday: false };
    }

    const json = (await res.json()) as any;
    if (!json.success || !Array.isArray(json.result) || json.result.length === 0) {
      return { summary: null, keyName: null, isToday: false };
    }

    // Sort keys descending by name (date)
    const sortedKeys = json.result
      .map((item: any) => item.name as string)
      .sort()
      .reverse();

    const latestKey = sortedKeys[0];
    const todayStr = new Date().toISOString().slice(0, 10);
    const isToday = latestKey.includes(todayStr);

    const valUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(latestKey)}`;
    const valRes = await fetch(valUrl, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });

    if (!valRes.ok) {
      console.warn(`${C.yellow}[Warning] Failed to retrieve value for key ${latestKey} (HTTP ${valRes.status})${C.reset}`);
      return { summary: null, keyName: latestKey, isToday };
    }

    const text = await valRes.text();
    const cleaned = text.replace(/^\uFEFF/, "").trim();
    const summary = JSON.parse(cleaned) as DailyAuditSummary;

    return { summary, keyName: latestKey, isToday };
  } catch (err: any) {
    console.warn(`${C.yellow}[Warning] Error reading KV daily audit: ${err.message}${C.reset}`);
    return { summary: null, keyName: null, isToday: false };
  }
}

async function executeSql(
  accountId: string,
  apiToken: string,
  sql: string
): Promise<any[]> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "text/plain; charset=utf-8",
    },
    body: sql,
  });

  if (!res.ok) {
    const errorText = await res.text();
    let parsedMessage = errorText;
    try {
      const parsed = JSON.parse(errorText);
      if (parsed.errors && parsed.errors.length > 0) {
        parsedMessage = parsed.errors.map((e: any) => e.message || JSON.stringify(e)).join("; ");
      }
    } catch {
      // Ignore
    }
    throw new Error(`Analytics Engine SQL API error (HTTP ${res.status}): ${parsedMessage}`);
  }

  const json = (await res.json()) as any;
  return json.data || [];
}

function renderTable(headers: string[], rows: string[][]): void {
  if (rows.length === 0) {
    console.log(`${C.dim}  (No data)${C.reset}`);
    return;
  }

  const colWidths = headers.map((h, i) => {
    let max = h.length;
    for (const r of rows) {
      const cell = r[i] || "";
      const stripped = cell.replace(/\x1b\[[0-9;]*m/g, "");
      if (stripped.length > max) {
        max = stripped.length;
      }
    }
    return max;
  });

  const sepLine = "+" + colWidths.map((w) => "-".repeat(w + 2)).join("+") + "+";
  const headerLine =
    "|" +
    headers
      .map((h, i) => ` ${C.bold}${h.padEnd(colWidths[i])}${C.reset} `)
      .join("|") +
    "|";

  console.log(C.gray + sepLine + C.reset);
  console.log(headerLine);
  console.log(C.gray + sepLine + C.reset);

  for (const row of rows) {
    const rowLine =
      "|" +
      row
        .map((cell, i) => {
          const stripped = cell.replace(/\x1b\[[0-9;]*m/g, "");
          const pad = " ".repeat(Math.max(0, colWidths[i] - stripped.length));
          return ` ${cell}${pad} `;
        })
        .join("|") +
      "|";
    console.log(rowLine);
  }

  console.log(C.gray + sepLine + C.reset);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const { accountId, apiToken, namespaceId } = await resolveCredentials(args);

  const nowIso = new Date().toISOString();

  console.log(`
${C.cyan}${C.bold}================================================================${C.reset}
${C.white}${C.bold}  MCPX KV DAILY AUDIT & ANALYTICS ENGINE TELEMETRY              ${C.reset}
  Account ID:    ${C.dim}${accountId}${C.reset}
  KV Namespace:  ${C.dim}${namespaceId}${C.reset}
  Report Time:   ${C.dim}${nowIso}${C.reset}
${C.cyan}${C.bold}================================================================${C.reset}
`);

  // =========================================================================
  // [1] SYSTEM HEALTH & KV DAILY AUDIT
  // =========================================================================
  console.log(`${C.bold}[1] SYSTEM HEALTH & KV DAILY AUDIT${C.reset}`);
  console.log(`${C.dim}────────────────────────────────────────────────────────────────${C.reset}`);

  const { summary, keyName, isToday } = await fetchLatestDailyAudit(
    accountId,
    apiToken,
    namespaceId
  );

  if (!summary) {
    console.log(
      `  ${C.yellow}⚠ KV entry 'stats:daily:*' not yet found.${C.reset}`
    );
    console.log(
      `    ${C.dim}(Cron schedule '0 8 * * *' will record audit on next cycle at 08:00 UTC)${C.reset}`
    );
  } else {
    const statusColor = summary.status === "HEALTHY" ? C.brightGreen : C.brightRed;
    const dateLabel = isToday
      ? `${summary.date} ${C.brightGreen}(today)${C.reset}`
      : `${summary.date} ${C.yellow}(latest available)${C.reset}`;

    console.log(`  * System Status:          ${statusColor}${C.bold}● ${summary.status}${C.reset}`);
    console.log(`  * Audit Date:             ${dateLabel}`);
    console.log(`  * Latest Timestamp:       ${C.dim}${summary.timestamp}${C.reset}`);
    console.log(`  * Active API Keys:        ${C.bold}${summary.totalActiveKeys}${C.reset}`);
    console.log(
      `  * Low-Balance Keys:       ${
        summary.lowBalanceCount > 0 ? C.brightYellow : C.green
      }${C.bold}${summary.lowBalanceCount}${C.reset} (< $1.00 / 100¢)`
    );

    if (summary.lowBalanceKeys && summary.lowBalanceKeys.length > 0) {
      console.log(`\n  ${C.yellow}${C.bold}Clients with low balance:${C.reset}`);
      const headers = ["Tenant ID", "Key ID", "Balance (Cents)", "Balance (USD)"];
      const rows = summary.lowBalanceKeys.map((k) => [
        k.tenantId,
        k.keyId,
        `${k.balanceCents}¢`,
        `$${(k.balanceCents / 100).toFixed(2)}`,
      ]);
      renderTable(headers, rows);
    } else {
      console.log(
        `  ${C.green}✓ All active clients have sufficient balance (>= $1.00 / 100¢).${C.reset}`
      );
    }
  }

  console.log();

  // =========================================================================
  // [2] MONETIZATION & CREEM REVENUE (30d)
  // =========================================================================
  console.log(`${C.bold}[2] MONETIZATION & CREEM REVENUE (30d)${C.reset}`);
  console.log(`${C.dim}────────────────────────────────────────────────────────────────${C.reset}`);

  try {
    const creemSql = `SELECT blob4 AS currency, COUNT() AS orders, SUM(double2) AS revenue_usd, AVG(double2) AS avg_order_usd
FROM mcpx_telemetry
WHERE blob1 = 'creem.topup' AND timestamp >= NOW() - INTERVAL '30' DAY
GROUP BY currency;`;

    const creemRows = await executeSql(accountId, apiToken, creemSql);

    if (creemRows.length === 0) {
      console.log(`  ${C.dim}(No Creem top-up orders recorded in the last 30 days)${C.reset}`);
    } else {
      const headers = ["Currency", "Orders", "Total Revenue (USD)", "Avg Order (USD)"];
      let grandTotalUsd = 0;
      let totalOrders = 0;

      const rows = creemRows.map((r: any) => {
        const currency = r.currency || "USD";
        const orders = Number(r.orders || 0);
        const rev = Number(r.revenue_usd || 0);
        const avg = Number(r.avg_order_usd || 0);

        grandTotalUsd += rev;
        totalOrders += orders;

        return [
          currency,
          String(orders),
          `$${rev.toFixed(2)}`,
          `$${avg.toFixed(2)}`,
        ];
      });

      renderTable(headers, rows);
      console.log(
        `  ${C.brightGreen}${C.bold}Total Creem Revenue (30d): $${grandTotalUsd.toFixed(2)} USD${C.reset} across ${totalOrders} orders`
      );
    }
  } catch (err: any) {
    console.error(`  ${C.red}Error querying Creem telemetry: ${err.message}${C.reset}`);
  }

  console.log();

  // =========================================================================
  // [3] X402 CONSUMPTION BY TOOL (30d)
  // =========================================================================
  console.log(`${C.bold}[3] X402 CONSUMPTION BY TOOL (30d)${C.reset}`);
  console.log(`${C.dim}────────────────────────────────────────────────────────────────${C.reset}`);

  try {
    // 1. Try primary query (blob1 = 'mcp.tool_call')
    const primarySql = `SELECT blob4 AS tool_name, COUNT() AS calls, SUM(double1) AS total_cents, SUM(double2) AS total_usd
FROM mcpx_telemetry
WHERE blob1 = 'mcp.tool_call' AND timestamp >= NOW() - INTERVAL '30' DAY
GROUP BY tool_name
ORDER BY calls DESC;`;

    let toolData = await executeSql(accountId, apiToken, primarySql);

    // 2. If 0 rows returned, execute fallback query (blob2 in tools/call / tools/execute)
    if (toolData.length === 0) {
      const fallbackSql = `SELECT blob3 AS tool_name, COUNT() AS calls, SUM(double3) AS total_cents, SUM(double3) / 100.0 AS total_usd
FROM mcpx_telemetry
WHERE blob2 IN ('tools/call', 'tools/execute') AND blob3 != 'none' AND timestamp >= NOW() - INTERVAL '30' DAY
GROUP BY tool_name
ORDER BY calls DESC;`;

      toolData = await executeSql(accountId, apiToken, fallbackSql);
    }

    if (toolData.length === 0) {
      console.log(`  ${C.dim}(No tool call telemetry found in the last 30 days)${C.reset}`);
    } else {
      const headers = ["Tool Name", "Calls", "Consumption (Cents)", "Consumption (USD)"];
      let totalCalls = 0;
      let totalCents = 0;
      let totalUsd = 0;

      const rows = toolData.map((r: any) => {
        const name = r.tool_name || "unknown";
        const calls = Number(r.calls || 0);
        const cents = Math.round(Number(r.total_cents || 0));
        const usd = Number(r.total_usd || cents / 100);

        totalCalls += calls;
        totalCents += cents;
        totalUsd += usd;

        return [
          name,
          String(calls),
          `${cents}¢`,
          `$${usd.toFixed(2)}`,
        ];
      });

      renderTable(headers, rows);
      console.log(
        `  ${C.brightCyan}${C.bold}Total x402 Consumption (30d): ${totalCents}¢ ($${totalUsd.toFixed(2)} USD)${C.reset} from ${totalCalls} tool calls`
      );
    }
  } catch (err: any) {
    console.error(`  ${C.red}Error querying x402 tool telemetry: ${err.message}${C.reset}`);
  }

  console.log(`
${C.green}[✓] Telemetry and audit report successfully generated.${C.reset}
`);
}

main().catch((err) => {
  console.error(`\n${C.red}${C.bold}[Fatal Error]${C.reset} ${err.message}`);
  process.exit(1);
});
