/**
 * scripts/test-domain-tools.ts
 * 
 * AHP GATE 3 (/test) Domēna Rīku Matemātiskā un Drošības Verifikācija:
 * 1. EN ISO 6946 Būvfizikas Kalkulatora etalona pārbaude (R_tot ≈ 4.581, U ≈ 0.218).
 * 2. Plūsmas virzienu (horizontal, upwards, downwards) un kondensācijas riska heuristika.
 * 3. Jev semantiskās AST koda analīzes pārbaude (Safe vs Rejected injekcijas).
 * 4. MCP JSON-RPC attālinātā integrācija: tools/list un tools/call pret serveri.
 */

import dotenv from "dotenv";
import { calculateUValueIso6946, analyzeJevSemanticAst } from "../src/tools/domainTools";

dotenv.config();

const BASE_URL = process.env.TARGET_URL || "https://mcpx.harrykrauze.com";
const API_KEY = process.env.MCPX_API_KEY || "mcpx_live_test_client_key_123";

interface TestStepResult {
  step: string;
  name: string;
  status: "PASS" | "FAIL";
  details?: string;
  error?: string;
}

const results: TestStepResult[] = [];

async function step(
  code: string,
  name: string,
  fn: () => Promise<string | void>
): Promise<void> {
  process.stdout.write(`[${code}] ${name}... `);
  try {
    const details = await fn();
    console.log("PASS");
    if (details) {
      console.log(`       ${details}`);
    }
    results.push({ step: code, name, status: "PASS", details: details || undefined });
  } catch (err: any) {
    console.log("FAIL");
    console.error(`       Kļūda: ${err.message || String(err)}`);
    results.push({ step: code, name, status: "FAIL", error: err.message || String(err) });
  }
}

async function main() {
  console.log(`================================================================`);
  console.log(`  AHP GATE 3: DOMĒNA RĪKU MATEMĀTISKĀ UN DROŠĪBAS VERIFIKĀCIJA   `);
  console.log(`  Mērķa vārteja: ${BASE_URL}`);
  console.log(`  Laika zīmogs: ${new Date().toISOString()}`);
  console.log(`================================================================\n`);

  // 1. Solis: EN ISO 6946 etalona pārbaude (Unit Level)
  await step("U.1", "EN ISO 6946 Etalona aprēķins (Siena: Betons + Minerālvate + Apmetums)", async () => {
    // Etalons:
    // 200 mm dzelzsbetons (lambda = 2.0) -> R = 0.100 m²K/W
    // 150 mm minerālvate (lambda = 0.035) -> R = 4.2857 m²K/W
    // 20 mm ārējais apmetums (lambda = 0.80) -> R = 0.025 m²K/W
    // Horizontāla plūsma: Rsi = 0.13, Rse = 0.04
    // R_tot = 0.13 + 0.100 + 4.2857 + 0.025 + 0.04 = 4.5807 ≈ 4.581 m²K/W
    // U = 1 / 4.5807 ≈ 0.21828 ≈ 0.218 W/(m²K)
    const result = calculateUValueIso6946({
      direction: "horizontal",
      layers: [
        { name: "Dzelzsbetons", thickness_m: 0.2, lambda_w_mk: 2.0 },
        { name: "Minerālvate", thickness_m: 0.15, lambda_w_mk: 0.035 },
        { name: "Apmetums", thickness_m: 0.02, lambda_w_mk: 0.8 },
      ],
    });

    if (Math.abs(result.total_r_m2k_w - 4.581) > 0.01) {
      throw new Error(`R_tot nesakrīt ar etalonu! Gaidīts ~4.581, iegūts ${result.total_r_m2k_w}`);
    }

    if (Math.abs(result.u_value_w_m2k - 0.218) > 0.005) {
      throw new Error(`U-vērtība nesakrīt ar etalonu! Gaidīts ~0.218, iegūts ${result.u_value_w_m2k}`);
    }

    if (result.condensation_risk_warning !== false) {
      throw new Error(`Nepatiess kondensācijas brīdinājums pareizi nosiltinātai ārsienai!`);
    }

    return `R_tot = ${result.total_r_m2k_w} m²K/W | U = ${result.u_value_w_m2k} W/(m²K) (Izolācijas īpatsvars: ${result.layer_resistances[1].percentage}%)`;
  });

  // 2. Solis: Virzienu un kondensācijas riska brīdinājuma pārbaude
  await step("U.2", "EN ISO 6946 Virzienu un iekšējās siltināšanas kondensācijas brīdinājums", async () => {
    // Pārbaude ar jumtu (upwards plūsma: Rsi = 0.10)
    const roof = calculateUValueIso6946({
      direction: "upwards",
      layers: [{ name: "Jumta vate", thickness_m: 0.25, lambda_w_mk: 0.037 }],
    });

    if (roof.rsi !== 0.1 || roof.rse !== 0.04) {
      throw new Error(`Nepareizas virsmas pretestības jumtam: Rsi=${roof.rsi}, Rse=${roof.rse}`);
    }

    // Pārbaude ar riskanto iekšējo siltināšanu (vata iekšpusē, betons ārpusē)
    const riskyWall = calculateUValueIso6946({
      direction: "horizontal",
      layers: [
        { name: "Iekšējā minerālvate", thickness_m: 0.1, lambda_w_mk: 0.035 },
        { name: "Masīva betona siena", thickness_m: 0.2, lambda_w_mk: 2.0 },
      ],
    });

    if (!riskyWall.condensation_risk_warning) {
      throw new Error(`Kondensācijas riska brīdinājums netika aktivizēts bīstamai iekšējai siltināšanai!`);
    }

    return `Jumta R_tot=${roof.total_r_m2k_w} | Iekšējās siltināšanas kondensāta brīdinājums veiksmīgi fiksēts`;
  });

  // 3. Solis: Jev Semantiskā AST analīze (Unit Level)
  await step("U.3", "Jev AST Koda Analīzes Drošības Pārbaude (Safe vs Attack Patterns)", async () => {
    // A: Drošs kods
    const safeRes = analyzeJevSemanticAst({
      code: "export function multiply(a: number, b: number) { return a * b; }",
      language: "typescript",
    });

    if (safeRes.verdict !== "SAFE" || safeRes.risk_score !== 0) {
      throw new Error(`Drošs kods kļūdaini klasificēts kā ${safeRes.verdict} (Risk: ${safeRes.risk_score})`);
    }

    // B: Ļaunprātīgs injekcijas kods (__proto__ + process.env)
    const maliciousCode = `
      const target = {};
      target.__proto__.isAdmin = true;
      const secret = process.env.SECRET_TOKEN;
    `;
    const malRes = analyzeJevSemanticAst({
      code: maliciousCode,
      language: "typescript",
    });

    if (malRes.verdict !== "REJECTED") {
      throw new Error(`Kaitīgs kods netika noraidīts! Spriedums: ${malRes.verdict}`);
    }

    if (!malRes.detected_patterns.prototype_manipulation) {
      throw new Error(`Netika detektēta prototipa manipulācija!`);
    }
    if (!malRes.detected_patterns.process_or_env_access) {
      throw new Error(`Netika detektēta piekļuve process.env!`);
    }

    // C: Paranoid režīma taimeru pārbaude
    const paranoidRes = analyzeJevSemanticAst({
      code: "setTimeout(() => console.log('delayed'), 500);",
      strictness: "paranoid",
    });

    if (paranoidRes.violations.length === 0) {
      throw new Error(`Paranoid režīmā netika pārtverts setTimeout!`);
    }

    return `Safe kods -> SAFE (0) | Injekcijas kods -> REJECTED (${malRes.risk_score}) ar 2 aizsardzības šabloniem`;
  });

  // 4. Solis: Attālinātā MCP Servera tools/list pārbaude
  await step("C.1", "MCP tools/list satur jaunos domēna rīkus", async () => {
    const res = await fetch(`${BASE_URL}/mcp/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "test-tools-list",
        method: "tools/list",
        params: {},
      }),
    });

    if (res.status !== 200) {
      throw new Error(`Gaidīts HTTP 200, saņemts ${res.status}`);
    }

    const data = (await res.json()) as any;
    const tools = data.result?.tools;
    if (!Array.isArray(tools)) {
      throw new Error(`Atbildē trūkst tools masīva: ${JSON.stringify(data)}`);
    }

    const toolNames = tools.map((t: any) => t.name);
    if (!toolNames.includes("calculate_u_value_iso6946")) {
      throw new Error(`Trūkst rīka 'calculate_u_value_iso6946'! Pieejamie: ${toolNames.join(", ")}`);
    }
    if (!toolNames.includes("analyze_jev_semantic_ast")) {
      throw new Error(`Trūkst rīka 'analyze_jev_semantic_ast'! Pieejamie: ${toolNames.join(", ")}`);
    }

    return `Atrasti visi rīki: ${toolNames.join(", ")}`;
  });

  // 5. Solis: Attālināts izsaukums uz calculate_u_value_iso6946
  await step("C.2", "MCP tools/call izsaukums uz calculate_u_value_iso6946", async () => {
    const res = await fetch(`${BASE_URL}/mcp/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "call-u-val",
        method: "tools/call",
        params: {
          name: "calculate_u_value_iso6946",
          arguments: {
            direction: "horizontal",
            layers: [
              { name: "Akmens vate", thickness_m: 0.15, lambda_w_mk: 0.035 },
              { name: "Gāzbetons", thickness_m: 0.2, lambda_w_mk: 0.12 },
            ],
          },
        },
      }),
    });

    if (res.status !== 200) {
      throw new Error(`Gaidīts HTTP 200, saņemts ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as any;
    if (!data.result || !data.result.content || !data.result.content[0]) {
      throw new Error(`Nepareizs MCP atbildes formāts: ${JSON.stringify(data)}`);
    }

    const parsed = JSON.parse(data.result.content[0].text);
    if (!parsed.u_value_w_m2k || !parsed.total_r_m2k_w) {
      throw new Error(`Atbildē trūkst u_value_w_m2k vai total_r_m2k_w: ${data.result.content[0].text}`);
    }

    return `U = ${parsed.u_value_w_m2k} W/(m²K) | R_tot = ${parsed.total_r_m2k_w} m²K/W`;
  });

  // 6. Solis: Attālināts izsaukums uz analyze_jev_semantic_ast
  await step("C.3", "MCP tools/call izsaukums uz analyze_jev_semantic_ast", async () => {
    const res = await fetch(`${BASE_URL}/mcp/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "call-ast",
        method: "tools/call",
        params: {
          name: "analyze_jev_semantic_ast",
          arguments: {
            code: "function add(a, b) { return a + b; }",
            strictness: "standard",
          },
        },
      }),
    });

    if (res.status !== 200) {
      throw new Error(`Gaidīts HTTP 200, saņemts ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as any;
    const parsed = JSON.parse(data.result.content[0].text);
    if (parsed.verdict !== "SAFE") {
      throw new Error(`Drošam kodam gaidīts SAFE, saņemts ${parsed.verdict}`);
    }

    return `Spriedums: ${parsed.verdict} | Riska rādītājs: ${parsed.risk_score}`;
  });

  console.log(`\n================================================================`);
  console.log(`                      TESTU KOPSAVILKUMS                        `);
  console.log(`================================================================`);

  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;

  console.log(`Kopā soļi:    ${results.length}`);
  console.log(`Veiksmīgi:    ${passed}`);
  console.log(`Neveiksmīgi:  ${failed}`);

  if (failed > 0) {
    console.error(`\n[VĀRTU KĻŪDA] Daži testi neizdevās:`);
    results
      .filter((r) => r.status === "FAIL")
      .forEach((r) => console.error(` - [${r.step}] ${r.name}: ${r.error}`));
    process.exit(1);
  }

  console.log(`\n[VĀRTI ATVĒRTI] Visi domēna rīku testi sekmīgi izturēti!\n`);
}

main().catch((err) => {
  console.error("Kritiska kļūda testa izpildē:", err);
  process.exit(1);
});
