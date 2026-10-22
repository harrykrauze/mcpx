/**
 * scripts/query-telemetry.ts
 * 
 * Cloudflare Workers Analytics Engine SQL Vaicājumu un Telemetrijas Analīzes Rīks.
 * Nolasa un vizualizē mcpx_telemetry datu kopas metriku, veiktspēju un incidentus.
 * 
 * Izsaukums:
 *   npx tsx scripts/query-telemetry.ts [--window 24h] [--tenant <id>] [--tool <name>] [--errors] [--limit 50]
 */

import fs from "fs";
import path from "path";
import os from "os";
import dotenv from "dotenv";

dotenv.config();

interface CliArgs {
  window: string;
  tenant?: string;
  tool?: string;
  errorsOnly: boolean;
  limit: number;
  help: boolean;
  accountId?: string;
  apiToken?: string;
}

function parseArgs(args: string[]): CliArgs {
  const parsed: CliArgs = {
    window: "24h",
    errorsOnly: false,
    limit: 50,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--window" || arg === "-w") {
      parsed.window = args[++i] || "24h";
    } else if (arg.startsWith("--window=")) {
      parsed.window = arg.split("=")[1] || "24h";
    } else if (arg === "--tenant" || arg === "-t") {
      parsed.tenant = args[++i];
    } else if (arg.startsWith("--tenant=")) {
      parsed.tenant = arg.split("=")[1];
    } else if (arg === "--tool") {
      parsed.tool = args[++i];
    } else if (arg.startsWith("--tool=")) {
      parsed.tool = arg.split("=")[1];
    } else if (arg === "--errors" || arg === "-e") {
      parsed.errorsOnly = true;
    } else if (arg === "--limit" || arg === "-l") {
      const parsedLimit = parseInt(args[++i], 10);
      if (!isNaN(parsedLimit) && parsedLimit > 0) {
        parsed.limit = parsedLimit;
      }
    } else if (arg.startsWith("--limit=")) {
      const parsedLimit = parseInt(arg.split("=")[1], 10);
      if (!isNaN(parsedLimit) && parsedLimit > 0) {
        parsed.limit = parsedLimit;
      }
    } else if (arg === "--account") {
      parsed.accountId = args[++i];
    } else if (arg.startsWith("--account=")) {
      parsed.accountId = arg.split("=")[1];
    } else if (arg === "--token") {
      parsed.apiToken = args[++i];
    } else if (arg.startsWith("--token=")) {
      parsed.apiToken = arg.split("=")[1];
    }
  }

  return parsed;
}

function printHelp() {
  console.log(`
mcpx Telemetry SQL Query Tool (Cloudflare Analytics Engine)
===========================================================

Lietošana:
  npm run telemetry:query -- [OPCIJAS]
  vai:
  npx tsx scripts/query-telemetry.ts [OPCIJAS]

Opcijas:
  --window, -w <logs>   Laika logs (noklusējums: '24h'):
                        Pieejamās vērtības: '1h', '6h', '24h', '7d'
  --tenant, -t <id>     Filtrēt konkrēta nomnieka / lietotāja pieprasījumus
  --tool <nosaukums>    Filtrēt konkrēta MCP rīka izsaukumus (piem., evaluate_fraud_transaction)
  --errors, -e          Rādīt tikai kļūdas un incidentus (HTTP >= 400 vai status != 'success')
  --limit, -l <skaits>  Ierobežot rindu skaitu detalizētajā sarakstā (noklusējums: 50)
  --account <id>        Pārrakstīt CLOUDFLARE_ACCOUNT_ID
  --token <token>       Pārrakstīt CLOUDFLARE_API_TOKEN
  --help, -h            Parādīt šo palīdzības paziņojumu

Nepieciešamie vides mainīgie (.env vai Wrangler sesija):
  CLOUDFLARE_ACCOUNT_ID=<32_simbolu_account_id>
  CLOUDFLARE_API_TOKEN=<cloudflare_api_token_ar_analytics_read_tiesibam>
`);
}

function getInterval(windowStr: string): string {
  const lower = windowStr.toLowerCase().trim();
  switch (lower) {
    case "1h":
      return "INTERVAL '1' HOUR";
    case "6h":
      return "INTERVAL '6' HOUR";
    case "24h":
    case "1d":
      return "INTERVAL '24' HOUR";
    case "7d":
    case "1w":
      return "INTERVAL '7' DAY";
    case "30d":
      return "INTERVAL '30' DAY";
    default:
      return "INTERVAL '24' HOUR";
  }
}

// ANSI krāsu kodi terminālim
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
};

function formatStatus(status: string, code: number): string {
  if (code >= 500 || status === "server_error" || status === "security_violation") {
    return `${C.red}${status} (${code})${C.reset}`;
  }
  if (code >= 400 || status === "client_error" || status === "revoked") {
    return `${C.yellow}${status} (${code})${C.reset}`;
  }
  return `${C.green}${status} (${code})${C.reset}`;
}

async function resolveCredentials(args: CliArgs): Promise<{ accountId: string; apiToken: string }> {
  let accountId = args.accountId || process.env.CLOUDFLARE_ACCOUNT_ID;
  let apiToken = args.apiToken || process.env.CLOUDFLARE_API_TOKEN;

  // Ja trūkst kāda vērtība, mēģinām nolasīt no lokālās Wrangler konfigurācijas
  if (!accountId || !apiToken) {
    try {
      const tomlPath = path.join(os.homedir(), "AppData", "Roaming", "xdg.config", ".wrangler", "config", "default.toml");
      if (fs.existsSync(tomlPath)) {
        const tomlContent = fs.readFileSync(tomlPath, "utf8");
        const tokenMatch = tomlContent.match(/oauth_token\s*=\s*"([^"]+)"/);
        if (tokenMatch && tokenMatch[1]) {
          if (!apiToken) {
            apiToken = tokenMatch[1];
          }

          if (!accountId) {
            // Izgūstam account_id caur Cloudflare API izmantojot tokenu
            const accRes = await fetch("https://api.cloudflare.com/client/v4/accounts", {
              headers: { Authorization: `Bearer ${apiToken}` },
            });
            if (accRes.ok) {
              const accData = (await accRes.json()) as any;
              if (accData.result && accData.result.length > 0) {
                accountId = accData.result[0].id;
              }
            }
          }
        }
      }
    } catch {
      // Ignorē lasīšanas kļūdu un turpina uz validācijas pārbaudi zemāk
    }
  }

  if (!accountId || !apiToken) {
    console.error(`
${C.red}${C.bold}[KĻŪDA: Trūkst Cloudflare akreditācijas datu]${C.reset}

Lai veiktu SQL vaicājumus pret Analytics Engine, nepieciešams norādīt Cloudflare konta ID un API tokenu:
  1. Iestatiet .env failā:
     ${C.cyan}CLOUDFLARE_ACCOUNT_ID${C.reset}=<jūsu_32_simbolu_account_id>
     ${C.cyan}CLOUDFLARE_API_TOKEN${C.reset}=<api_token_ar_analytics_read_tiesibam>

  2. Vai nododiet kā CLI parametrus:
     npm run telemetry:query -- --account <id> --token <token>

Tokena ģenerēšana: Cloudflare Dashboard -> My Profile -> API Tokens -> Create Token -> Read Analytics Engine.
`);
    process.exit(1);
  }

  return { accountId, apiToken };
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
      "Authorization": `Bearer ${apiToken}`,
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
      // Izmanto raw text
    }
    throw new Error(`Cloudflare Analytics Engine SQL API kļūda (HTTP ${res.status}): ${parsedMessage}`);
  }

  const json = (await res.json()) as any;
  return json.data || [];
}

function sanitizeLiteral(val: string): string {
  return val.replace(/'/g, "''");
}

function renderTable(headers: string[], rows: string[][]): void {
  if (rows.length === 0) {
    console.log(`${C.dim}  (Nav datu)${C.reset}`);
    return;
  }

  // Aprēķina katras kolonnas maksimālo platumu
  const colWidths = headers.map((h, i) => {
    let max = h.length;
    for (const r of rows) {
      const cell = r[i] || "";
      const clean = cell.replace(/\x1b\[[0-9;]*m/g, "");
      if (clean.length > max) max = clean.length;
    }
    return Math.max(max, 4);
  });

  const sep = "+-" + colWidths.map((w) => "-".repeat(w)).join("-+-") + "-+";
  console.log(C.gray + sep + C.reset);
  const headerLine = "| " + headers.map((h, i) => h.padEnd(colWidths[i])).join(" | ") + " |";
  console.log(C.bold + headerLine + C.reset);
  console.log(C.gray + sep + C.reset);

  for (const r of rows) {
    const line = "| " + r.map((cell, i) => {
      const raw = cell || "";
      const clean = raw.replace(/\x1b\[[0-9;]*m/g, "");
      const padding = " ".repeat(Math.max(0, colWidths[i] - clean.length));
      return raw + padding;
    }).join(" | ") + " |";
    console.log(line);
  }
  console.log(C.gray + sep + C.reset);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  const { accountId, apiToken } = await resolveCredentials(args);

  const interval = getInterval(args.window);
  const conditions: string[] = [`timestamp >= NOW() - ${interval}`];

  if (args.tenant) {
    conditions.push(`blob1 = '${sanitizeLiteral(args.tenant)}'`);
  }
  if (args.tool) {
    conditions.push(`blob3 = '${sanitizeLiteral(args.tool)}'`);
  }
  if (args.errorsOnly) {
    conditions.push(`(double2 >= 400 OR blob4 != 'success')`);
  }

  const whereClause = conditions.join(" AND ");

  console.log(`\n${C.bold}================================================================${C.reset}`);
  console.log(`${C.bold}  MCPX CLOUDFLARE ANALYTICS ENGINE TELEMETRIJAS PĀRSKATS        ${C.reset}`);
  console.log(`  Laika logs:      ${C.cyan}${args.window}${C.reset} (${interval})`);
  console.log(`  Nomnieka filtrs: ${args.tenant ? C.cyan + args.tenant + C.reset : C.dim + "Visi" + C.reset}`);
  console.log(`  Rīka filtrs:     ${args.tool ? C.cyan + args.tool + C.reset : C.dim + "Visi" + C.reset}`);
  console.log(`  Kļūdu filtrs:    ${args.errorsOnly ? C.red + "TIKAI KĻŪDAS" + C.reset : C.dim + "Visi izsaukumi" + C.reset}`);
  console.log(`  Laika zīmogs:    ${new Date().toISOString()}`);
  console.log(`${C.bold}================================================================${C.reset}\n`);

  try {
    // 1. Kopsavilkums (Summary KPI)
    const summarySql = `
      SELECT 
        count() AS total_requests,
        round(avg(double1), 1) AS avg_duration_ms,
        max(double1) AS max_duration_ms,
        sum(if(double2 >= 400 OR blob4 != 'success', 1, 0)) AS error_count,
        round(100.0 * sum(if(double2 < 400 AND blob4 = 'success', 1, 0)) / count(), 1) AS success_rate_pct
      FROM mcpx_telemetry
      WHERE ${whereClause}
    `;

    const summaryData = await executeSql(accountId, apiToken, summarySql);
    const kpi = summaryData[0] || {
      total_requests: 0,
      avg_duration_ms: 0,
      max_duration_ms: 0,
      error_count: 0,
      success_rate_pct: 100,
    };

    // 2. Detalizēts izsaukumu saraksts (lai deterministiski aprēķinātu arī p95 veiktspēju)
    const detailSql = `
      SELECT 
        timestamp,
        blob1 AS tenant,
        blob2 AS method,
        blob3 AS tool,
        blob4 AS status,
        blob5 AS client,
        toUInt32(double2) AS code,
        round(double1, 1) AS ms,
        toUInt32(double3) AS bytes
      FROM mcpx_telemetry
      WHERE ${whereClause}
      ORDER BY timestamp DESC
      LIMIT ${Math.max(args.limit, 100)}
    `;

    const detailData = await executeSql(accountId, apiToken, detailSql);

    // Deterministisks p95 aprēķins no ielādētajiem ierakstiem (No Head Math)
    let p95Ms = Number(kpi.max_duration_ms) || 0;
    if (detailData.length > 0) {
      const durations = detailData.map((d: any) => Number(d.ms) || 0).sort((a: number, b: number) => a - b);
      const p95Idx = Math.min(durations.length - 1, Math.floor(durations.length * 0.95));
      p95Ms = durations[p95Idx];
    }

    console.log(`${C.bold}1. KOPSAVILKUMA METRIKA (Executive KPI):${C.reset}`);
    const rateColor = Number(kpi.success_rate_pct) >= 99 ? C.green : Number(kpi.success_rate_pct) >= 90 ? C.yellow : C.red;
    console.log(`  * Kopējie pieprasījumi:    ${C.bold}${kpi.total_requests}${C.reset}`);
    console.log(`  * Vidējais izpildes laiks: ${C.bold}${kpi.avg_duration_ms} ms${C.reset}`);
    console.log(`  * p95 izpildes laiks:      ${C.bold}${p95Ms} ms${C.reset}`);
    console.log(`  * Maksimālais izp. laiks:  ${C.bold}${kpi.max_duration_ms} ms${C.reset}`);
    console.log(`  * Kļūdu / incidentu skaits:${Number(kpi.error_count) > 0 ? C.red : C.green} ${kpi.error_count}${C.reset}`);
    console.log(`  * Veiksmīguma rādītājs:    ${rateColor}${kpi.success_rate_pct}%${C.reset}\n`);

    // 3. Sadalījums pa Nomniekiem (Tenant Breakdown)
    const tenantSql = `
      SELECT 
        blob1 AS tenant_id,
        count() AS req_count,
        sum(if(double2 >= 400 OR blob4 != 'success', 1, 0)) AS errors,
        round(avg(double1), 1) AS avg_ms,
        max(double1) AS max_ms
      FROM mcpx_telemetry
      WHERE ${whereClause}
      GROUP BY blob1
      ORDER BY req_count DESC
      LIMIT 10
    `;

    const tenantData = await executeSql(accountId, apiToken, tenantSql);
    console.log(`${C.bold}2. SADALĪJUMS PA NOMNIEKIEM (Top Tenants):${C.reset}`);
    const tenantRows = tenantData.map((t: any) => [
      String(t.tenant_id || "anonymous"),
      String(t.req_count),
      Number(t.errors) > 0 ? `${C.red}${t.errors}${C.reset}` : `${C.green}0${C.reset}`,
      `${t.avg_ms} ms`,
      `${t.max_ms} ms`,
    ]);
    renderTable(["Nomnieks (tenantId)", "Pieprasījumi", "Kļūdas", "Vid. ms", "Maks. ms"], tenantRows);
    console.log("");

    // 4. Sadalījums pa Metodēm un Rīkiem (Method & Tool Breakdown)
    const methodSql = `
      SELECT 
        blob2 AS method,
        blob3 AS tool_name,
        count() AS calls,
        sum(if(double2 >= 400 OR blob4 != 'success', 1, 0)) AS errors,
        round(avg(double1), 1) AS avg_ms
      FROM mcpx_telemetry
      WHERE ${whereClause}
      GROUP BY blob2, blob3
      ORDER BY calls DESC
      LIMIT 15
    `;

    const methodData = await executeSql(accountId, apiToken, methodSql);
    console.log(`${C.bold}3. SADALĪJUMS PA METODĒM UN RĪKIEM:${C.reset}`);
    const methodRows = methodData.map((m: any) => [
      String(m.method),
      String(m.tool_name),
      String(m.calls),
      Number(m.errors) > 0 ? `${C.red}${m.errors}${C.reset}` : `${C.green}0${C.reset}`,
      `${m.avg_ms} ms`,
    ]);
    renderTable(["Metode", "Rīka Nosaukums", "Izsaukumi", "Kļūdas", "Vid. ms"], methodRows);
    console.log("");

    // 5. Detalizēts pēdējo izsaukumu / incidentu saraksts (ierobežots ar args.limit)
    console.log(`${C.bold}4. PĒDĒJIE IZSAUKUMI UN ŽURNĀLI (Limit: ${args.limit}):${C.reset}`);
    const limitedDetails = detailData.slice(0, args.limit);
    const detailRows = limitedDetails.map((d: any) => [
      String(d.timestamp).slice(0, 19).replace("T", " "),
      String(d.tenant).slice(0, 18),
      String(d.method),
      String(d.tool),
      formatStatus(String(d.status), Number(d.code)),
      String(d.client),
      `${d.ms} ms`,
      `${d.bytes} B`,
    ]);
    renderTable(["Laiks (UTC)", "Nomnieks", "Metode", "Rīks", "Statuss (Kods)", "Klients", "Aizture", "Izmērs"], detailRows);

    console.log(`\n${C.green}[✓] Telemetrijas vaicājumi veiksmīgi izpildīti pret Cloudflare Analytics Engine SQL API.${C.reset}\n`);
  } catch (err: any) {
    console.error(`\n${C.red}${C.bold}[KĻŪDA] Neizdevās iegūt telemetrijas datus:${C.reset}`);
    console.error(`  ${err.message || String(err)}\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Negaidīta kļūda:", err);
  process.exit(1);
});
