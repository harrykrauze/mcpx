/**
 * scripts/test-domain-tools.ts
 * 
 * AHP GATE 3 (/test) Domain Tools Mathematical & Security Verification:
 * 1. EN ISO 6946 Building Physics Calculator benchmark verification (R_tot ≈ 4.581, U ≈ 0.218).
 * 2. Heat flow directions (horizontal, upwards, downwards) and condensation risk heuristic.
 * 3. Jev semantic AST code analysis verification (Safe vs Rejected injections).
 * 4. MCP JSON-RPC remote integration: tools/list and tools/call against the gateway.
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
    console.error(`       Error: ${err.message || String(err)}`);
    results.push({ step: code, name, status: "FAIL", error: err.message || String(err) });
  }
}

async function main() {
  console.log(`================================================================`);
  console.log(`  AHP GATE 3: DOMAIN TOOLS MATHEMATICAL & SECURITY VERIFICATION `);
  console.log(`  Target Gateway: ${BASE_URL}`);
  console.log(`  Timestamp: ${new Date().toISOString()}`);
  console.log(`================================================================\n`);

  // Step 1: EN ISO 6946 benchmark calculation (Unit Level)
  await step("U.1", "EN ISO 6946 Benchmark calculation (Wall: Concrete + Mineral Wool + Plaster)", async () => {
    // Benchmark:
    // 200 mm reinforced concrete (lambda = 2.0) -> R = 0.100 m²K/W
    // 150 mm mineral wool (lambda = 0.035) -> R = 4.2857 m²K/W
    // 20 mm exterior plaster (lambda = 0.80) -> R = 0.025 m²K/W
    // Horizontal heat flow: Rsi = 0.13, Rse = 0.04
    // R_tot = 0.13 + 0.100 + 4.2857 + 0.025 + 0.04 = 4.5807 ≈ 4.581 m²K/W
    // U = 1 / 4.5807 ≈ 0.21828 ≈ 0.218 W/(m²K)
    const result = calculateUValueIso6946({
      direction: "horizontal",
      layers: [
        { name: "Reinforced Concrete", thickness_m: 0.2, lambda_w_mk: 2.0 },
        { name: "Mineral Wool", thickness_m: 0.15, lambda_w_mk: 0.035 },
        { name: "Plaster", thickness_m: 0.02, lambda_w_mk: 0.8 },
      ],
    });

    if (Math.abs(result.total_r_m2k_w - 4.581) > 0.01) {
      throw new Error(`R_tot does not match benchmark! Expected ~4.581, got ${result.total_r_m2k_w}`);
    }

    if (Math.abs(result.u_value_w_m2k - 0.218) > 0.005) {
      throw new Error(`U-value does not match benchmark! Expected ~0.218, got ${result.u_value_w_m2k}`);
    }

    if (result.condensation_risk_warning !== false) {
      throw new Error(`False positive condensation risk warning for properly insulated external wall!`);
    }

    return `R_tot = ${result.total_r_m2k_w} m²K/W | U = ${result.u_value_w_m2k} W/(m²K) (Insulation share: ${result.layer_resistances[1].percentage}%)`;
  });

  // Step 2: Flow directions and condensation risk warning
  await step("U.2", "EN ISO 6946 Flow directions and internal insulation condensation warning", async () => {
    // Verification on roof (upwards flow: Rsi = 0.10)
    const roof = calculateUValueIso6946({
      direction: "upwards",
      layers: [{ name: "Roof Insulation", thickness_m: 0.25, lambda_w_mk: 0.037 }],
    });

    if (roof.rsi !== 0.1 || roof.rse !== 0.04) {
      throw new Error(`Invalid surface resistances for roof: Rsi=${roof.rsi}, Rse=${roof.rse}`);
    }

    // Verification with risky internal insulation (insulation inside, concrete outside)
    const riskyWall = calculateUValueIso6946({
      direction: "horizontal",
      layers: [
        { name: "Internal Mineral Wool", thickness_m: 0.1, lambda_w_mk: 0.035 },
        { name: "Solid Concrete Wall", thickness_m: 0.2, lambda_w_mk: 2.0 },
      ],
    });

    if (!riskyWall.condensation_risk_warning) {
      throw new Error(`Condensation risk warning was not triggered for hazardous internal insulation!`);
    }

    return `Roof R_tot=${roof.total_r_m2k_w} | Internal insulation condensation warning successfully captured`;
  });

  // Step 3: Jev Semantic AST analysis (Unit Level)
  await step("U.3", "Jev AST Code Analysis Security Check (Safe vs Attack Patterns)", async () => {
    // A: Safe code
    const safeRes = analyzeJevSemanticAst({
      code: "export function multiply(a: number, b: number) { return a * b; }",
      language: "typescript",
    });

    if (safeRes.verdict !== "SAFE" || safeRes.risk_score !== 0) {
      throw new Error(`Safe code incorrectly classified as ${safeRes.verdict} (Risk: ${safeRes.risk_score})`);
    }

    // B: Malicious injection code (__proto__ + process.env)
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
      throw new Error(`Malicious code was not rejected! Verdict: ${malRes.verdict}`);
    }

    if (!malRes.detected_patterns.prototype_manipulation) {
      throw new Error(`Prototype manipulation was not detected!`);
    }
    if (!malRes.detected_patterns.process_or_env_access) {
      throw new Error(`process.env access was not detected!`);
    }

    // C: Paranoid mode timer check
    const paranoidRes = analyzeJevSemanticAst({
      code: "setTimeout(() => console.log('delayed'), 500);",
      strictness: "paranoid",
    });

    if (paranoidRes.violations.length === 0) {
      throw new Error(`setTimeout was not intercepted in paranoid mode!`);
    }

    return `Safe code -> SAFE (0) | Injection code -> REJECTED (${malRes.risk_score}) with 2 security patterns`;
  });

  // Step 4: Remote MCP Server tools/list check
  await step("C.1", "MCP tools/list contains domain tools", async () => {
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
      throw new Error(`Expected HTTP 200, got ${res.status}`);
    }

    const data = (await res.json()) as any;
    const tools = data.result?.tools;
    if (!Array.isArray(tools)) {
      throw new Error(`Response missing tools array: ${JSON.stringify(data)}`);
    }

    const toolNames = tools.map((t: any) => t.name);
    if (!toolNames.includes("calculate_u_value_iso6946")) {
      throw new Error(`Missing tool 'calculate_u_value_iso6946'! Available: ${toolNames.join(", ")}`);
    }
    if (!toolNames.includes("analyze_jev_semantic_ast")) {
      throw new Error(`Missing tool 'analyze_jev_semantic_ast'! Available: ${toolNames.join(", ")}`);
    }

    return `All tools discovered: ${toolNames.join(", ")}`;
  });

  // Step 5: Remote call to calculate_u_value_iso6946
  await step("C.2", "MCP tools/call invocation of calculate_u_value_iso6946", async () => {
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
              { name: "Mineral Wool", thickness_m: 0.15, lambda_w_mk: 0.035 },
              { name: "Aerated Concrete", thickness_m: 0.2, lambda_w_mk: 0.12 },
            ],
          },
        },
      }),
    });

    if (res.status !== 200) {
      throw new Error(`Expected HTTP 200, got ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as any;
    if (!data.result || !data.result.content || !data.result.content[0]) {
      throw new Error(`Invalid MCP response format: ${JSON.stringify(data)}`);
    }

    const parsed = JSON.parse(data.result.content[0].text);
    if (!parsed.u_value_w_m2k || !parsed.total_r_m2k_w) {
      throw new Error(`Response missing u_value_w_m2k or total_r_m2k_w: ${data.result.content[0].text}`);
    }

    return `U = ${parsed.u_value_w_m2k} W/(m²K) | R_tot = ${parsed.total_r_m2k_w} m²K/W`;
  });

  // Step 6: Remote call to analyze_jev_semantic_ast
  await step("C.3", "MCP tools/call invocation of analyze_jev_semantic_ast", async () => {
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
      throw new Error(`Expected HTTP 200, got ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as any;
    const parsed = JSON.parse(data.result.content[0].text);
    if (parsed.verdict !== "SAFE") {
      throw new Error(`Expected SAFE for safe code, got ${parsed.verdict}`);
    }

    return `Verdict: ${parsed.verdict} | Risk score: ${parsed.risk_score}`;
  });

  console.log(`\n================================================================`);
  console.log(`                       TEST SUMMARY                             `);
  console.log(`================================================================`);

  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;

  console.log(`Total steps:  ${results.length}`);
  console.log(`Passed:       ${passed}`);
  console.log(`Failed:       ${failed}`);

  if (failed > 0) {
    console.error(`\n[GATE FAILURE] Some tests failed:`);
    results
      .filter((r) => r.status === "FAIL")
      .forEach((r) => console.error(` - [${r.step}] ${r.name}: ${r.error}`));
    process.exit(1);
  }

  console.log(`\n[GATE OPEN] All domain tools tests passed successfully!\n`);
}

main().catch((err) => {
  console.error("Critical error during test execution:", err);
  process.exit(1);
});
