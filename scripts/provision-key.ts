/**
 * scripts/provision-key.ts
 * 
 * Administratora CLI rīks jaunu Scoped API atslēgu drošai ģenerēšanai mcpx vārtejā.
 * 
 * Lietošana:
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
  let url = process.env.TARGET_URL || "https://mcpx.harrykrauze.com";
  let masterKey = process.env.MCPX_MASTER_KEY || process.env.MCPX_API_KEY;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === "--tenant" || arg === "-t") && args[i + 1]) {
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
      // Positional fallback atbalsts
      if (!tenant) tenant = arg;
      else if (!desc) desc = arg;
      else if (rate === 10 && !isNaN(parseInt(arg, 10))) rate = parseInt(arg, 10);
    }
  }

  if (!tenant) {
    // Ja nav norādīts, ģenerējam nejaušu testa tenantu
    const randomSuffix = Math.floor(Math.random() * 10000);
    tenant = `tenant-cli-${randomSuffix}`;
  }

  return { tenant, desc, plan, rate, scopes, expires, url, masterKey };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log(`================================================================`);
  console.log(`  MCPX ADMINISTRATORA ATSLĒGU PROVISIONĒŠANAS CLI              `);
  console.log(`  Mērķa vārteja: ${args.url}`);
  console.log(`  Tenants: ${args.tenant}`);
  if (args.desc) console.log(`  Apraksts: ${args.desc}`);
  console.log(`  Plāns: ${args.plan} | Rate Limit: ${args.rate} req/min`);
  console.log(`  Tiesības: ${args.scopes.join(", ")}`);
  if (args.expires) console.log(`  Termiņš: ${args.expires} dienas`);
  console.log(`================================================================\n`);

  if (!args.masterKey) {
    console.error("KĻŪDA: Trūkst administratora noslēpuma.");
    console.error("Lūdzu, iestatiet vides mainīgo MCPX_MASTER_KEY vai norādiet parametru --key <MASTER_KEY>.");
    process.exit(1);
  }

  const payload = {
    tenantId: args.tenant,
    description: args.desc,
    plan: args.plan,
    rateLimit: args.rate,
    scopes: args.scopes,
    expiresInDays: args.expires,
  };

  const endpoint = `${args.url.replace(/\/+$/, "")}/keys/provision`;
  console.log(`Sūtām pieprasījumu uz: ${endpoint}...`);

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
      console.error(`Neizdevās izsniegt atslēgu (HTTP ${res.status}): ${errorText}`);
      process.exit(1);
    }

    const data = (await res.json()) as any;
    console.log("\n✅ ATSLĒGA VEIKSMĪGI IZVEIDOTA!\n");
    console.log(`  API Atslēga:  ${data.apiKey}`);
    console.log(`  Tenant ID:    ${data.tenantId || data.userId}`);
    console.log(`  Plāns:        ${data.plan}`);
    console.log(`  Statuss:      ${data.status}`);
    console.log(`  Rate Limit:   ${data.rateLimit} req/min`);
    console.log(`  Izveidota:    ${data.createdAt}`);
    if (data.expiresAt) console.log(`  Derīga līdz:  ${data.expiresAt}`);
    console.log("\nLai izmantotu Claude Code, palaidiet:");
    console.log(`  claude mcp add --transport sse mcpx ${args.url}/mcp/sse --header "Authorization: Bearer ${data.apiKey}"\n`);
  } catch (err: any) {
    console.error("Tīkla kļūda izpildot provisionēšanu:", err.message || err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Kritiska kļūda:", err);
  process.exit(1);
});
