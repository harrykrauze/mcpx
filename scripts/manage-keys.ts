/**
 * scripts/manage-keys.ts
 * 
 * Administratora CLI rīks API atslēgu inventarizācijai un tūlītējai atsaukšanai.
 * 
 * Lietošana:
 *   npm run key:list
 *   npm run key:list -- --status active
 *   npm run key:revoke -- --key "key_6db5d05407f6"
 */

import dotenv from "dotenv";

dotenv.config();

interface CliArgs {
  action: "list" | "revoke";
  status?: string;
  target?: string;
  url: string;
  masterKey?: string;
}

function parseArgs(args: string[]): CliArgs {
  let action: "list" | "revoke" = "list";
  let status: string | undefined = undefined;
  let target: string | undefined = undefined;
  let url = process.env.TARGET_URL || "https://mcpx.harrykrauze.com";
  let masterKey = process.env.MCPX_MASTER_KEY || process.env.MCPX_API_KEY;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--action" && args[i + 1]) {
      const a = args[++i];
      if (a === "list" || a === "revoke") action = a;
    } else if (arg.startsWith("--action=")) {
      const a = arg.split("=")[1];
      if (a === "list" || a === "revoke") action = a;
    } else if (arg === "--status" && args[i + 1]) {
      status = args[++i];
    } else if (arg.startsWith("--status=")) {
      status = arg.split("=")[1];
    } else if ((arg === "--key" || arg === "--keyId" || arg === "--id" || arg === "-k") && args[i + 1]) {
      target = args[++i];
      action = "revoke";
    } else if (arg.startsWith("--key=") || arg.startsWith("--keyId=") || arg.startsWith("--id=")) {
      target = arg.split("=")[1];
      action = "revoke";
    } else if (arg === "--url" && args[i + 1]) {
      url = args[++i];
    } else if (arg === "--masterKey" && args[i + 1]) {
      masterKey = args[++i];
    } else if (!arg.startsWith("-")) {
      if (!target) {
        target = arg;
        action = "revoke";
      }
    }
  }

  return { action, status, target, url, masterKey };
}

async function listKeys(args: CliArgs) {
  let endpoint = `${args.url.replace(/\/+$/, "")}/keys`;
  if (args.status) {
    endpoint += `?status=${encodeURIComponent(args.status)}`;
  }

  console.log(`Izgūstam reģistrēto atslēgu sarakstu no ${endpoint}...`);

  const res = await fetch(endpoint, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${args.masterKey}`,
      "Accept": "application/json",
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`Kļūda izgūstot atslēgas (HTTP ${res.status}): ${errText}`);
    process.exit(1);
  }

  const data = (await res.json()) as any;
  console.log(`\nKopā reģistrētas atslēgas: ${data.total}\n`);

  if (!data.keys || data.keys.length === 0) {
    console.log("Neviena atslēga netika atrasta.");
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
    "RATE".padEnd(6) +
    " | " +
    "CREATED AT".padEnd(24) +
    " |"
  );
  console.log("|" + "-".repeat(110) + "|");

  for (const k of data.keys) {
    const statusLabel = k.status === "active" ? "\x1b[32mactive\x1b[0m" : "\x1b[31mrevoked\x1b[0m";
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
    console.error("KĻŪDA: Atslēgas atsaukšanai jānorāda --key <keyId vai apiKey>.");
    process.exit(1);
  }

  const endpoint = `${args.url.replace(/\/+$/, "")}/keys/${encodeURIComponent(args.target)}`;
  console.log(`Sūtām atsaukšanas pieprasījumu: DELETE ${endpoint}...`);

  const res = await fetch(endpoint, {
    method: "DELETE",
    headers: {
      "Authorization": `Bearer ${args.masterKey}`,
      "Accept": "application/json",
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`Kļūda atsaucot atslēgu (HTTP ${res.status}): ${errText}`);
    process.exit(1);
  }

  const data = (await res.json()) as any;
  console.log("\n✅ ATSLĒGA VEIKSMĪGI ANULĒTA!\n");
  console.log(`  Key ID:     ${data.keyId}`);
  console.log(`  Statuss:    ${data.status}`);
  console.log(`  Anulēta:    ${data.revokedAt}`);
  console.log(`  Paziņojums: ${data.message}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log(`================================================================`);
  console.log(`  MCPX API ATSLĒGU PĀRVALDĪBAS CLI (LIFECYCLE MANAGEMENT)       `);
  console.log(`  Darbība: ${args.action.toUpperCase()}`);
  console.log(`  Mērķa vārteja: ${args.url}`);
  console.log(`================================================================\n`);

  if (!args.masterKey) {
    console.error("KĻŪDA: Trūkst administratora noslēpuma.");
    console.error("Lūdzu, iestatiet vides mainīgo MCPX_MASTER_KEY vai norādiet --masterKey.");
    process.exit(1);
  }

  if (args.action === "list") {
    await listKeys(args);
  } else if (args.action === "revoke") {
    await revokeKey(args);
  }
}

main().catch((err) => {
  console.error("Kritiska kļūda izpildot CLI:", err);
  process.exit(1);
});
