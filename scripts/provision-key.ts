/**
 * scripts/provision-key.ts
 * 
 * Administrator CLI tool for provisioning scoped API keys on mcpx gateway.
 * 
 * Usage:
 *   npm run key:provision -- --tenant "client-alpha" --desc "Claude Code Enterprise" --rate 30
 */

import dotenv from "dotenv";

dotenv.config();

interface CliArgs {
  tenant: string;
  desc?: string;
  plan: "free" | "pro" | "enterprise";
  rate: number;
  scopes: string[];
  expires?: number;
  balance?: number;
  url: string;
  masterKey?: string;
}

function parseArgs(args: string[]): CliArgs {
  let tenant = "";
  let desc: string | undefined = undefined;
  let plan: "free" | "pro" | "enterprise" = "pro";
  let rate = 10;
  let scopes = ["mcp:read", "mcp:write", "mcp:generate"];
  let expires: number | undefined = undefined;
  let balance: number | undefined = undefined;
  let url = process.env.TARGET_URL || "https://mcpx.harrykrauze.com";
  let masterKey = process.env.MCPX_MASTER_KEY || process.env.MCPX_API_KEY;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === "--name" || arg === "-n") && args[i + 1]) {
      const n = args[++i];
      if (!tenant) tenant = n;
      if (!desc) desc = n;
    } else if (arg.startsWith("--name=")) {
      const n = arg.split("=")[1];
      if (!tenant) tenant = n;
      if (!desc) desc = n;
    } else if ((arg === "--balance" || arg === "-b" || arg === "--initialBalance") && args[i + 1]) {
      balance = parseInt(args[++i], 10);
    } else if (arg.startsWith("--balance=")) {
      balance = parseInt(arg.split("=")[1], 10);
    } else if ((arg === "--tenant" || arg === "-t") && args[i + 1]) {
      tenant = args[++i];
    } else if (arg.startsWith("--tenant=")) {
      tenant = arg.split("=")[1];
    } else if ((arg === "--desc" || arg === "-d") && args[i + 1]) {
      desc = args[++i];
    } else if (arg.startsWith("--desc=")) {
      desc = arg.slice(7);
    } else if (arg === "--plan" && args[i + 1]) {
      const p = args[++i];
      if (p === "free" || p === "pro" || p === "enterprise") {
        plan = p;
      }
    } else if (arg.startsWith("--plan=")) {
      const p = arg.split("=")[1];
      if (p === "free" || p === "pro" || p === "enterprise") {
        plan = p;
      }
    } else if ((arg === "--rate" || arg === "-r") && args[i + 1]) {
      rate = parseInt(args[++i], 10) || 10;
    } else if (arg.startsWith("--rate=")) {
      rate = parseInt(arg.split("=")[1], 10) || 10;
    } else if (arg === "--scopes" && args[i + 1]) {
      scopes = args[++i].split(",").map((s) => s.trim());
    } else if (arg.startsWith("--scopes=")) {
      scopes = arg.split("=")[1].split(",").map((s) => s.trim());
    } else if (arg === "--expires" && args[i + 1]) {
      expires = parseInt(args[++i], 10) || undefined;
    } else if (arg.startsWith("--expires=")) {
      expires = parseInt(arg.split("=")[1], 10) || undefined;
    } else if (arg === "--url" && args[i + 1]) {
      url = args[++i];
    } else if (arg.startsWith("--url=")) {
      url = arg.split("=")[1];
    } else if (arg === "--key" && args[i + 1]) {
      masterKey = args[++i];
    } else if (arg.startsWith("--key=")) {
      masterKey = arg.split("=")[1];
    } else if (!arg.startsWith("-")) {
      // Positional fallback support
      if (!tenant) tenant = arg;
      else if (!desc) desc = arg;
      else if (rate === 10 && !isNaN(parseInt(arg, 10))) rate = parseInt(arg, 10);
    }
  }

  if (!tenant) {
    // If unspecified, generate a random test tenant
    const randomSuffix = Math.floor(Math.random() * 10000);
    tenant = `tenant-cli-${randomSuffix}`;
  }

  return { tenant, desc, plan, rate, scopes, expires, balance, url, masterKey };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log(`================================================================`);
  console.log(`  MCPX ADMINISTRATOR KEY PROVISIONING CLI                       `);
  console.log(`  Target Gateway: ${args.url}`);
  console.log(`  Tenant: ${args.tenant}`);
  if (args.desc) console.log(`  Description: ${args.desc}`);
  console.log(`  Plan: ${args.plan} | Rate Limit: ${args.rate} req/min`);
  if (typeof args.balance === "number") {
    console.log(`  Initial Balance: $${(args.balance / 100).toFixed(2)} (${args.balance} cents)`);
  }
  console.log(`  Scopes: ${args.scopes.join(", ")}`);
  if (args.expires) console.log(`  Expires: ${args.expires} days`);
  console.log(`================================================================\n`);

  if (!args.masterKey) {
    console.error("ERROR: Missing master administrator key.");
    console.error("Please set the MCPX_MASTER_KEY environment variable or specify --key <MASTER_KEY>.");
    process.exit(1);
  }

  const payload: any = {
    tenantId: args.tenant,
    description: args.desc,
    plan: args.plan,
    rateLimit: args.rate,
    scopes: args.scopes,
    expiresInDays: args.expires,
  };
  if (typeof args.balance === "number") {
    payload.initialBalanceCents = args.balance;
  }

  const endpoint = `${args.url.replace(/\/+$/, "")}/keys/provision`;
  console.log(`Sending request to: ${endpoint}...`);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${args.masterKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`Failed to provision key (HTTP ${res.status}): ${errorText}`);
      process.exit(1);
    }

    const data = (await res.json()) as any;
    console.log("\n✅ KEY SUCCESSFULLY CREATED!\n");
    console.log(`  API Key:      ${data.apiKey}`);
    if (data.keyId) console.log(`  Key ID:       ${data.keyId}`);
    console.log(`  Tenant ID:    ${data.tenantId || data.userId}`);
    if (data.billing) {
      console.log(`  Balance:      $${(data.billing.balanceCents / 100).toFixed(2)} (${data.billing.balanceCents} cents)`);
    }
    console.log(`  Plan:         ${data.plan}`);
    console.log(`  Status:       ${data.status}`);
    console.log(`  Rate Limit:   ${data.rateLimit} req/min`);
    console.log(`  Created At:   ${data.createdAt}`);
    if (data.expiresAt) console.log(`  Expires At:   ${data.expiresAt}`);
    console.log("\nTo use with Claude Code, run:");
    console.log(`  claude mcp add --transport sse mcpx ${args.url}/mcp/sse --header "Authorization: Bearer ${data.apiKey}"\n`);
  } catch (err: any) {
    console.error("Network error during provisioning:", err.message || err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Critical error:", err);
  process.exit(1);
});
