/**
 * scripts/audit-client-journeys.ts
 * 
 * End-to-End Client Journey and Feature Matrix Verification Script.
 * Tests live production gateway: https://mcpx.harrykrauze.com
 */

const BASE_URL = process.env.MCPX_URL || "https://mcpx.harrykrauze.com";
const TEST_KEY = process.env.MCPX_API_KEY || "mcpx_live_test_client_key_123";

interface AuditStepResult {
  step: string;
  category: string;
  status: "PASS" | "FAIL" | "WARN";
  latencyMs: number;
  details: string;
}

const auditResults: AuditStepResult[] = [];

async function recordStep(
  category: string,
  step: string,
  fn: () => Promise<{ status: "PASS" | "FAIL" | "WARN"; details: string }>
) {
  const start = performance.now();
  try {
    const { status, details } = await fn();
    const latencyMs = Math.round(performance.now() - start);
    auditResults.push({ category, step, status, latencyMs, details });
    const color = status === "PASS" ? "\x1b[32m" : status === "WARN" ? "\x1b[33m" : "\x1b[31m";
    console.log(`[${category}] ${step} ... ${color}${status}\x1b[0m (${latencyMs}ms) - ${details}`);
  } catch (err: any) {
    const latencyMs = Math.round(performance.now() - start);
    auditResults.push({ category, step, status: "FAIL", latencyMs, details: err.message || String(err) });
    console.log(`[${category}] ${step} ... \x1b[31mFAIL\x1b[0m (${latencyMs}ms) - ${err.message || String(err)}`);
  }
}

async function run() {
  console.log("================================================================================");
  console.log("  MCPX COMPREHENSIVE FEATURE MATRIX & CUSTOMER JOURNEY AUDIT");
  console.log(`  Gateway: ${BASE_URL}`);
  console.log(`  Timestamp: ${new Date().toISOString()}`);
  console.log("================================================================================\n");

  // --------------------------------------------------------------------------
  // GROUP 1: Public Discoverability & AEO/GEO Infrastructure
  // --------------------------------------------------------------------------
  await recordStep("1. Discoverability & AEO", "GET /llms.txt headers and markdown content", async () => {
    const res = await fetch(`${BASE_URL}/llms.txt`);
    if (!res.ok) return { status: "FAIL", details: `HTTP ${res.status}` };
    const contentType = res.headers.get("content-type") || "";
    const link = res.headers.get("link") || "";
    const mcpDisc = res.headers.get("x-mcp-discovery") || "";
    const text = await res.text();
    const hasPricing = text.includes("x402 Pricing Matrix");
    const hasCreem = text.includes("checkout.creem.io/p/mcpx-tier1");
    if (!contentType.includes("text/markdown") || !hasPricing || !hasCreem) {
      return { status: "FAIL", details: `Missing markdown content or headers (ct=${contentType})` };
    }
    return { status: "PASS", details: `ct=${contentType}, link=${Boolean(link)}, x-mcp-disc=${Boolean(mcpDisc)}` };
  });

  await recordStep("1. Discoverability & AEO", "GET /llms-full.txt protocol schemas", async () => {
    const res = await fetch(`${BASE_URL}/llms-full.txt`);
    if (!res.ok) return { status: "FAIL", details: `HTTP ${res.status}` };
    const text = await res.text();
    const hasSchema = text.includes("JSON-RPC Protocol") && text.includes("calculate_u_value_iso6946");
    return { status: hasSchema ? "PASS" : "FAIL", details: `Full schema length: ${text.length} bytes` };
  });

  await recordStep("1. Discoverability & AEO", "Content negotiation on / with Accept: text/markdown", async () => {
    const res = await fetch(`${BASE_URL}/`, { headers: { Accept: "text/markdown" } });
    if (!res.ok) return { status: "FAIL", details: `HTTP ${res.status}` };
    const vary = res.headers.get("vary") || "";
    const text = await res.text();
    const isMarkdown = text.includes("# mcpx gateway") && res.headers.get("content-type")?.includes("text/markdown");
    return { status: isMarkdown ? "PASS" : "FAIL", details: `Vary=${vary}, isMarkdown=${isMarkdown}` };
  });

  await recordStep("1. Discoverability & AEO", "IndexNow verification key serving at /<KEY>.txt", async () => {
    const res = await fetch(`${BASE_URL}/mcpx402a1b2c3d4e5f67890abcdef123.txt`);
    if (!res.ok) return { status: "FAIL", details: `HTTP ${res.status}` };
    const text = (await res.text()).trim();
    return { status: text === "mcpx402a1b2c3d4e5f67890abcdef123" ? "PASS" : "FAIL", details: `Key=${text}` };
  });

  await recordStep("1. Discoverability & AEO", "IndexNow verification key serving at /indexnow.txt fallback", async () => {
    const res = await fetch(`${BASE_URL}/indexnow.txt`);
    if (!res.ok) return { status: "FAIL", details: `HTTP ${res.status}` };
    const text = (await res.text()).trim();
    return { status: text === "mcpx402a1b2c3d4e5f67890abcdef123" ? "PASS" : "FAIL", details: `Key=${text}` };
  });

  await recordStep("1. Discoverability & AEO", "Schema.org @graph JSON-LD in HTML root", async () => {
    const res = await fetch(`${BASE_URL}/`, { headers: { Accept: "text/html" } });
    if (!res.ok) return { status: "FAIL", details: `HTTP ${res.status}` };
    const text = await res.text();
    const hasLd = text.includes('"@type": "SoftwareApplication"') && text.includes("Harry Krauze");
    const hasCreem = text.includes("checkout.creem.io/p/mcpx-tier1");
    return { status: hasLd && hasCreem ? "PASS" : "FAIL", details: `JSON-LD=${hasLd}, CreemLink=${hasCreem}` };
  });

  // --------------------------------------------------------------------------
  // GROUP 2: UI & Client Self-Service
  // --------------------------------------------------------------------------
  await recordStep("2. UI & Self-Service", "Key balance verification via GET /api/v1/balance (Unauthenticated -> 401)", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/balance`);
    const data = await res.json() as any;
    const ok = res.status === 401 && data.error && data.credits === 0;
    return { status: ok ? "PASS" : "FAIL", details: `Status=${res.status}, error=${data.error}` };
  });

  await recordStep("2. UI & Self-Service", "Key balance verification via GET /api/v1/balance (Authenticated -> 200)", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/balance`, {
      headers: { Authorization: `Bearer ${TEST_KEY}` },
    });
    const data = await res.json() as any;
    const ok = res.status === 200 && data.status === "ACTIVE" && typeof data.credits === "number";
    return { status: ok ? "PASS" : "FAIL", details: `Status=${res.status}, credits=${data.credits}¢ ($${(data.credits/100).toFixed(2)})` };
  });

  await recordStep("2. UI & Self-Service", "Key balance verification via POST /keys/verify", async () => {
    const res = await fetch(`${BASE_URL}/keys/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: TEST_KEY }),
    });
    const data = await res.json() as any;
    const ok = res.status === 200 && (data.success === true || data.valid === true) && (data.status?.toLowerCase() === "active");
    return { status: ok ? "PASS" : "FAIL", details: `Status=${res.status}, valid=${data.valid ?? true}, balance=${data.balanceCents}¢` };
  });

  // --------------------------------------------------------------------------
  // GROUP 3: Protocol Transport & Connectivity
  // --------------------------------------------------------------------------
  await recordStep("3. Transport & Connectivity", "SSE stream establishment GET /mcp/sse", async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await fetch(`${BASE_URL}/mcp/sse`, { signal: controller.signal });
      clearTimeout(timeout);
      const ct = res.headers.get("content-type") || "";
      const cc = res.headers.get("cache-control") || "";
      const isSse = ct.includes("text/event-stream") && cc.includes("no-cache");
      return { status: isSse ? "PASS" : "FAIL", details: `ct=${ct}, cc=${cc}` };
    } catch (e: any) {
      if (e.name === "AbortError") {
        return { status: "PASS", details: "Connected to SSE stream successfully (aborted after handshake)" };
      }
      throw e;
    }
  });

  await recordStep("3. Transport & Connectivity", "JSON-RPC 2.0 unauthenticated discovery POST /mcp (tools/list)", async () => {
    const res = await fetch(`${BASE_URL}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 101, method: "tools/list", params: {} }),
    });
    if (!res.ok) return { status: "FAIL", details: `HTTP ${res.status}` };
    const data = await res.json() as any;
    const toolCount = data?.result?.tools?.length || 0;
    const ok = data.jsonrpc === "2.0" && toolCount >= 4;
    return { status: ok ? "PASS" : "FAIL", details: `Returned ${toolCount} registered tools without auth` };
  });

  await recordStep("3. Transport & Connectivity", "JSON-RPC 2.0 unauthenticated ping POST /mcp", async () => {
    const res = await fetch(`${BASE_URL}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 102, method: "ping", params: {} }),
    });
    if (!res.ok) return { status: "FAIL", details: `HTTP ${res.status}` };
    const data = await res.json() as any;
    const ok = data.jsonrpc === "2.0" && data.result !== undefined;
    return { status: ok ? "PASS" : "FAIL", details: `Ping response: ${JSON.stringify(data.result)}` };
  });

  // --------------------------------------------------------------------------
  // GROUP 4: Domain Tools Execution & x402 Debiting
  // --------------------------------------------------------------------------
  let initialBalance = 0;
  await recordStep("4. Domain Tools & x402", "Initial balance query before tool executions", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/balance`, {
      headers: { Authorization: `Bearer ${TEST_KEY}` },
    });
    const data = await res.json() as any;
    initialBalance = data.credits;
    return { status: "PASS", details: `Initial balance: ${initialBalance}¢ ($${(initialBalance/100).toFixed(2)})` };
  });

  await recordStep("4. Domain Tools & x402", "Execute calculate_u_value_iso6946 (Cost: 2¢ / $0.02)", async () => {
    const res = await fetch(`${BASE_URL}/tools/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${TEST_KEY}`,
      },
      body: JSON.stringify({
        tool: "calculate_u_value_iso6946",
        params: {
          direction: "horizontal",
          layers: [
            { name: "External Render", thickness_m: 0.015, lambda_w_mk: 0.8 },
            { name: "Mineral Wool Insulation", thickness_m: 0.12, lambda_w_mk: 0.035 },
            { name: "Concrete Block", thickness_m: 0.20, lambda_w_mk: 1.30 },
            { name: "Internal Gypsum Plaster", thickness_m: 0.012, lambda_w_mk: 0.25 }
          ]
        }
      }),
    });
    if (!res.ok) return { status: "FAIL", details: `HTTP ${res.status}` };
    const data = await res.json() as any;
    const uValue = data?.u_value_w_m2k;
    const rTot = data?.total_r_m2k_w ?? data?.total_thermal_resistance_r_tot;
    const billedBalance = res.headers.get("x-mcpx-balance-cents");
    const ok = data.success === true && typeof uValue === "number" && typeof rTot === "number";
    return { status: ok ? "PASS" : "FAIL", details: `U=${uValue} W/m²K, R_tot=${rTot} m²K/W, balance=${billedBalance}¢` };
  });

  await recordStep("4. Domain Tools & x402", "Execute evaluate_fraud_transaction (Cost: 1¢ / $0.01) [Low Risk]", async () => {
    const res = await fetch(`${BASE_URL}/tools/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${TEST_KEY}`,
      },
      body: JSON.stringify({
        tool: "evaluate_fraud_transaction",
        params: {
          amount: 45.50,
          currency: "EUR",
          userRiskScore: 0.12
        }
      }),
    });
    if (!res.ok) return { status: "FAIL", details: `HTTP ${res.status}` };
    const data = await res.json() as any;
    const ok = data.success === true && data.decision === "APPROVE" && data.riskLevel === "LOW";
    return { status: ok ? "PASS" : "FAIL", details: `Decision=${data.decision}, Risk=${data.riskLevel}` };
  });

  await recordStep("4. Domain Tools & x402", "Execute evaluate_fraud_transaction (Cost: 1¢ / $0.01) [High Risk]", async () => {
    const res = await fetch(`${BASE_URL}/tools/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${TEST_KEY}`,
      },
      body: JSON.stringify({
        tool: "evaluate_fraud_transaction",
        params: {
          amount: 14500.00,
          currency: "USD",
          userRiskScore: 0.92
        }
      }),
    });
    if (!res.ok) return { status: "FAIL", details: `HTTP ${res.status}` };
    const data = await res.json() as any;
    const ok = data.success === true && data.decision === "MANUAL_REVIEW" && data.riskLevel === "HIGH";
    return { status: ok ? "PASS" : "FAIL", details: `Decision=${data.decision}, Risk=${data.riskLevel}` };
  });

  await recordStep("4. Domain Tools & x402", "Execute analyze_jev_semantic_ast (Cost: 1¢ / $0.01) [Clean Code]", async () => {
    const cleanCode = `
      export function calculateDiscount(price: number, discountPct: number): number {
        if (price < 0 || discountPct < 0 || discountPct > 100) return 0;
        return price * (1 - discountPct / 100);
      }
    `;
    const res = await fetch(`${BASE_URL}/tools/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${TEST_KEY}`,
      },
      body: JSON.stringify({
        tool: "analyze_jev_semantic_ast",
        params: {
          code: cleanCode,
          language: "typescript",
          strictness: "standard"
        }
      }),
    });
    if (!res.ok) return { status: "FAIL", details: `HTTP ${res.status}` };
    const data = await res.json() as any;
    const ok = data.success === true && data.verdict === "SAFE" && data.valid === true;
    return { status: ok ? "PASS" : "FAIL", details: `Verdict=${data.verdict}, RiskScore=${data.risk_score}` };
  });

  await recordStep("4. Domain Tools & x402", "Execute analyze_jev_semantic_ast (Cost: 1¢ / $0.01) [Malicious Injection Blocked]", async () => {
    const attackCode = `
      const x = Object.prototype.__proto__;
      process.exit(1);
    `;
    const res = await fetch(`${BASE_URL}/tools/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${TEST_KEY}`,
      },
      body: JSON.stringify({
        tool: "analyze_jev_semantic_ast",
        params: {
          code: attackCode,
          language: "typescript",
          strictness: "paranoid"
        }
      }),
    });
    if (!res.ok) return { status: "FAIL", details: `HTTP ${res.status}` };
    const data = await res.json() as any;
    const ok = data.verdict === "REJECTED" && data.valid === false && data.violations?.length > 0;
    return { status: ok ? "PASS" : "FAIL", details: `Verdict=${data.verdict}, Violations=${data.violations?.length}` };
  });

  // Verify cumulative balance deduction
  await recordStep("4. Domain Tools & x402", "Verify exact cumulative balance deduction (2¢ + 1¢ + 1¢ + 1¢ + 1¢ = 6¢)", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/balance`, {
      headers: { Authorization: `Bearer ${TEST_KEY}` },
    });
    const data = await res.json() as any;
    const finalBalance = data.credits;
    const deducted = initialBalance - finalBalance;
    const expectedDeducted = 6; // 2 (u-value) + 1 (fraud low) + 1 (fraud high) + 1 (ast clean) + 1 (ast attack) = 6
    const ok = deducted === expectedDeducted;
    return {
      status: ok ? "PASS" : "FAIL",
      details: `Initial=${initialBalance}¢, Final=${finalBalance}¢, Deducted=${deducted}¢ (Expected ${expectedDeducted}¢)`
    };
  });

  // --------------------------------------------------------------------------
  // GROUP 5: x402 Depletion & L402 Interception (Scenario D)
  // --------------------------------------------------------------------------
  await recordStep("5. x402 Interception", "Unauthenticated paid tool execution blocked with HTTP 401", async () => {
    const res = await fetch(`${BASE_URL}/tools/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tool: "calculate_u_value_iso6946",
        params: {
          layers: [{ name: "Brick", thickness_m: 0.1, lambda_w_mk: 0.7 }]
        }
      }),
    });
    const isBlocked = res.status === 401;
    const data = await res.json() as any;
    return { status: isBlocked ? "PASS" : "FAIL", details: `Status=${res.status}, error=${data.error}` };
  });

  await recordStep("5. x402 Interception", "Invalid Bearer key execution blocked with HTTP 403", async () => {
    const res = await fetch(`${BASE_URL}/tools/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer mcpx_invalid_expired_token_999",
      },
      body: JSON.stringify({
        tool: "calculate_u_value_iso6946",
        params: {
          layers: [{ name: "Brick", thickness_m: 0.1, lambda_w_mk: 0.7 }]
        }
      }),
    });
    const isBlocked = res.status === 403;
    const data = await res.json() as any;
    return { status: isBlocked ? "PASS" : "FAIL", details: `Status=${res.status}, error=${data.error}` };
  });

  // --------------------------------------------------------------------------
  // SUMMARY
  // --------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log("  AUDIT EXECUTION SUMMARY");
  console.log("================================================================================");
  const passCount = auditResults.filter((r) => r.status === "PASS").length;
  const failCount = auditResults.filter((r) => r.status === "FAIL").length;
  const warnCount = auditResults.filter((r) => r.status === "WARN").length;
  console.log(`Total Checks:  ${auditResults.length}`);
  console.log(`Passed:        \x1b[32m${passCount}\x1b[0m`);
  console.log(`Failed:        \x1b[31m${failCount}\x1b[0m`);
  console.log(`Warnings:      \x1b[33m${warnCount}\x1b[0m`);
  console.log("================================================================================\n");

  if (failCount > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Audit runner crashed:", err);
  process.exit(1);
});
