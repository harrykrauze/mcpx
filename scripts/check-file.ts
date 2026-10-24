import { readFileSync, existsSync } from "node:fs";
import { resolve, relative } from "node:path";

const DEFAULT_URL = process.env.MCPX_URL || "https://mcpx.harrykrauze.com";
const DEFAULT_FALLBACK_KEY = "mcpx_live_test_client_key_123";

/**
 * Mēģina izgūt API atslēgu no vides vai lokālajiem konfigurācijas failiem (.dev.vars, .env)
 */
function resolveApiKey(): string {
  if (process.env.MCPX_API_KEY) {
    return process.env.MCPX_API_KEY.trim();
  }

  for (const filename of [".dev.vars", ".env"]) {
    const fullPath = resolve(process.cwd(), filename);
    if (existsSync(fullPath)) {
      try {
        const content = readFileSync(fullPath, "utf-8");
        for (const line of content.split("\n")) {
          const trimmed = line.trim();
          if (trimmed.startsWith("MCPX_API_KEY=") || trimmed.startsWith("MCPX_CLIENT_KEY=")) {
            const val = trimmed.split("=")[1]?.replace(/["']/g, "").trim();
            if (val) return val;
          }
        }
      } catch {
        // Ignorē lasīšanas kļūdas
      }
    }
  }

  return DEFAULT_FALLBACK_KEY;
}

async function main() {
  const targetFileArg = process.argv[2];

  if (!targetFileArg) {
    console.error("\x1b[31m[KĻŪDA]\x1b[0m Trūkst faila ceļa arguments.");
    console.log("\x1b[33mPielietojums:\x1b[0m npm run check -- <ceļš/uz/failu>");
    console.log("Piemērs:      npm run check -- src/index.ts");
    process.exit(1);
  }

  const filePath = resolve(process.cwd(), targetFileArg);

  if (!existsSync(filePath)) {
    console.error(`\x1b[31m[KĻŪDA]\x1b[0m Fails netika atrasts: ${filePath}`);
    process.exit(1);
  }

  const fileContent = readFileSync(filePath, "utf-8");
  const relPath = relative(process.cwd(), filePath);
  const apiKey = resolveApiKey();

  console.log(`\n\x1b[38;2;16,185,129m[MCPX AUDITOR]\x1b[0m Pārbauda: \x1b[1m${relPath}\x1b[0m (${fileContent.length} baiti)`);
  console.log(`Mērķis: \x1b[90m${DEFAULT_URL}\x1b[0m | Atslēga: \x1b[90m${apiKey.slice(0, 14)}...\x1b[0m`);

  const startTime = performance.now();

  try {
    // Sūta pieprasījumu uz vārteju (pārbaudi atbalstīto galapunktu: /tools/execute vai JSON-RPC)
    const response = await fetch(`${DEFAULT_URL}/tools/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        tool: "ast_check",
        parameters: {
          code: fileContent,
          filename: relPath,
        },
      }),
    });

    const elapsedMs = Math.round(performance.now() - startTime);
    const balanceCents = response.headers.get("X-MCPX-Balance-Cents");

    if (response.status === 402) {
      console.error(`\n\x1b[31m[402 PAYMENT REQUIRED]\x1b[0m Kredītu bilance ir iztērēta.`);
      console.log(`Papildini kontu: \x1b[36mhttps://mcpx.harrykrauze.com\x1b[0m`);
      process.exit(1);
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error(`\n\x1b[31m[HTTP ${response.status}]\x1b[0m Pieprasījums noraidīts: ${errText}`);
      process.exit(1);
    }

    const result = (await response.json()) as any;

    console.log("\n------------------------------------------------------------");
    console.log(`\x1b[32m✔ AST Audits pabeigts\x1b[0m (${elapsedMs} ms)`);
    if (balanceCents !== null) {
      console.log(`Atlikusī bilance: \x1b[33m$${(Number(balanceCents) / 100).toFixed(2)}\x1b[0m (${balanceCents} c)`);
    }
    console.log("------------------------------------------------------------");

    if (result.valid === true && (result.verdict === "SAFE" || result.success === true)) {
      console.log("\x1b[32m[PASS]\x1b[0m Sintakse un AST drošības struktūra ir korekta. Nav konstatēta koda injekcija.");
    } else {
      console.log("\x1b[31m[NORAIDĪTS / BRĪDINĀJUMI]:\x1b[0m");
      console.log(JSON.stringify(result, null, 2));
      process.exit(1);
    }
  } catch (err: any) {
    console.error(`\n\x1b[31m[TĪKLA KĻŪDA]\x1b[0m Neizdevās savienoties ar mcpx:`, err.message);
    process.exit(1);
  }
}

main();
