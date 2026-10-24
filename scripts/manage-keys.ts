/**
 * scripts/manage-keys.ts
 * 
 * Administrator CLI tool for API key inventory, revocation, and balance top-up.
 * 
 * Usage:
 *   npm run key:list
 *   npm run key:list -- --status active
 *   npm run key:revoke -- --key "key_6db5d05407f6"
 *   npm run key:topup -- --key "key_6db5d05407f6" --amount 500
 */

import dotenv from "dotenv";

dotenv.config();

interface CliArgs {
  action: "list" | "revoke" | "topup";
  status?: string;
  target?: string;
  amount?: number;
  url: string;
  masterKey?: string;
}

function parseArgs(args: string[]): CliArgs {
  let action: "list" | "revoke" | "topup" = "list";
  let status: string | undefined = undefined;
  let target: string | undefined = undefined;
  let amount: number | undefined = undefined;
  let url = process.env.TARGET_URL || "https://mcpx.harrykrauze.com";
  let masterKey = process.env.MCPX_MASTER_KEY || process.env.MCPX_API_KEY;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--action" && args[i + 1]) {
      const a = args[++i];
      if (a === "list" || a === "revoke" || a === "topup") action = a;
    } else if (arg.startsWith("--action=")) {
      const a = arg.split("=")[1];
      if (a === "list" || a === "revoke" || a === "topup") action = a as any;
    } else if (arg === "--status" && args[i + 1]) {
      status = args[++i];
    } else if (arg.startsWith("--status=")) {
      status = arg.split("=")[1];
    } else if (arg === "--amount" && args[i + 1]) {
      amount = parseInt(args[++i], 10);
      action = "topup";
    } else if (arg.startsWith("--amount=")) {
      amount = parseInt(arg.split("=")[1], 10);
      action = "topup";
    } else if ((arg === "--key" || arg === "--keyId" || arg === "--id" || arg === "--tenant" || arg === "--tenantId" || arg === "-k") && args[i + 1]) {
      target = args[++i];
    } else if (arg.startsWith("--key=") || arg.startsWith("--keyId=") || arg.startsWith("--id=") || arg.startsWith("--tenant=") || arg.startsWith("--tenantId=")) {
      target = arg.split("=")[1];
    } else if (arg === "--url" && args[i + 1]) {
      url = args[++i];
    } else if (arg === "--masterKey" && args[i + 1]) {
      masterKey = args[++i];
    } else if (!arg.startsWith("-")) {
      if (!target && !/^\d+$/.test(arg)) {
        target = arg;
      } else if (/^\d+$/.test(arg) && !amount) {
        amount = parseInt(arg, 10);
      } else if (!target) {
        target = arg;
      }
    }
  }

  return { action, status, target, amount, url, masterKey };
}

async function listKeys(args: CliArgs) {
  let endpoint = `${args.url.replace(/\/+$/, "")}/keys`;
  if (args.status) {
    endpoint += `?status=${encodeURIComponent(args.status)}`;
  }

  console.log(`Fetching registered keys list from ${endpoint}...`);

  const res = await fetch(endpoint, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${args.masterKey}`,
      "Accept": "application/json",
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`Error fetching keys (HTTP ${res.status}): ${errText}`);
    process.exit(1);
  }

  const data = (await res.json()) as any;
  console.log(`\nTotal registered keys: ${data.total}\n`);

  if (!data.keys || data.keys.length === 0) {
    console.log("No keys found.");
    return;
  }

  console.log(
    "| " +
    "KEY ID".padEnd(18) +
    " | " +
    "MASKED KEY".padEnd(20) +
    " | " +
    "TENANT ID".padEnd(20) +
    " | " +
    "STATUS".padEnd(10) +
    " | " +
    "MODE".padEnd(10) +
    " | " +
    "BALANCE (USD)".padEnd(14) +
    " | " +
    "SPENT (USD)".padEnd(12) +
    " | " +
    "RATE".padEnd(6) +
    " | " +
    "CREATED AT".padEnd(24) +
    " |"
  );
  console.log("|" + "-".repeat(154) + "|");

  for (const k of data.keys) {
    const statusLabel = k.status === "active" ? "\x1b[32mactive\x1b[0m" : "\x1b[31mrevoked\x1b[0m";
    const mode = k.billing?.mode || "prepaid";
    const balance = typeof k.billing?.balanceCents === "number"
      ? `$${(k.billing.balanceCents / 100).toFixed(2)}`
      : "N/A";
    const spent = typeof k.billing?.totalSpentCents === "number"
      ? `$${(k.billing.totalSpentCents / 100).toFixed(2)}`
      : "$0.00";

    console.log(
      "| " +
      (k.keyId || "").padEnd(18) +
      " | " +
      (k.maskedKey || "").padEnd(20) +
      " | " +
      (k.tenantId || "").padEnd(20) +
      " | " +
      statusLabel.padEnd(19) +
      " | " +
      mode.padEnd(10) +
      " | " +
      balance.padEnd(14) +
      " | " +
      spent.padEnd(12) +
      " | " +
      String(k.rateLimit || 10).padEnd(6) +
      " | " +
      (k.createdAt || "N/A").slice(0, 24).padEnd(24) +
      " |"
    );
  }
  console.log("");
}

async function revokeKey(args: CliArgs) {
  if (!args.target) {
    console.error("ERROR: Must specify --key <keyId or apiKey> to revoke key.");
    process.exit(1);
  }

  const endpoint = `${args.url.replace(/\/+$/, "")}/keys/${encodeURIComponent(args.target)}`;
  console.log(`Sending revocation request: DELETE ${endpoint}...`);

  const res = await fetch(endpoint, {
    method: "DELETE",
    headers: {
      "Authorization": `Bearer ${args.masterKey}`,
      "Accept": "application/json",
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`Error revoking key (HTTP ${res.status}): ${errText}`);
    process.exit(1);
  }

  const data = (await res.json()) as any;
  console.log("\n✅ KEY SUCCESSFULLY REVOKED!\n");
  console.log(`  Key ID:     ${data.keyId}`);
  console.log(`  Status:     ${data.status}`);
  console.log(`  Revoked At: ${data.revokedAt}`);
  console.log(`  Message:    ${data.message}\n`);
}

async function topupKey(args: CliArgs) {
  if (!args.target) {
    console.error("ERROR: Must specify --key <keyId, apiKey or tenantId> for balance top-up.");
    process.exit(1);
  }

  if (!args.amount || args.amount <= 0 || !Number.isInteger(args.amount)) {
    console.error("ERROR: Must specify a positive amount of cents via --amount <cents> (e.g., --amount 500 for $5.00).");
    process.exit(1);
  }

  const endpoint = `${args.url.replace(/\/+$/, "")}/keys/topup`;
  console.log(`Sending top-up request to ${endpoint}...`);

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${args.masterKey}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({
      keyId: args.target,
      amountCents: args.amount,
      reason: "Manual CLI Topup",
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`Error topping up balance (HTTP ${res.status}): ${errText}`);
    process.exit(1);
  }

  const data = (await res.json()) as any;
  console.log("\n✅ BALANCE SUCCESSFULLY TOPPED UP!\n");
  console.log(`  Key ID:          ${data.keyId}`);
  console.log(`  Tenant ID:       ${data.tenantId}`);
  console.log(`  Added:           $${(data.addedCents / 100).toFixed(2)} (${data.addedCents} cents)`);
  console.log(`  New Balance:     $${(data.billing?.balanceCents / 100).toFixed(2)} (${data.billing?.balanceCents} cents)`);
  console.log(`  Total Spent:     $${(data.billing?.totalSpentCents / 100).toFixed(2)}`);
  console.log(`  Mode:            ${data.billing?.mode}`);
  console.log(`  Last Topup:      ${data.billing?.lastTopupAt}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log(`================================================================`);
  console.log(`  MCPX API KEY MANAGEMENT CLI (LIFECYCLE MANAGEMENT)           `);
  console.log(`  Action: ${args.action.toUpperCase()}`);
  console.log(`  Target Gateway: ${args.url}`);
  console.log(`================================================================\n`);

  if (!args.masterKey) {
    console.error("ERROR: Missing master administrator key.");
    console.error("Please set the MCPX_MASTER_KEY environment variable or specify --masterKey.");
    process.exit(1);
  }

  if (args.action === "list") {
    await listKeys(args);
  } else if (args.action === "revoke") {
    await revokeKey(args);
  } else if (args.action === "topup") {
    await topupKey(args);
  }
}

main().catch((err) => {
  console.error("Critical error executing CLI:", err);
  process.exit(1);
});
