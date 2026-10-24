/**
 * scripts/test-x402-billing.ts
 * 
 * AHP GATE 3 (/test) — Sprint 3: x402 M2M Monetization & Credit Balance Verification Test.
 * 
 * Verifies:
 *   [B.1] Key provisioning with 3 cents initial balance (POST /keys/provision with initialBalanceCents: 3)
 *   [B.2] Free operations (tools/list -> 200 OK, balance unchanged = 3 cents)
 *   [B.3] 1 cent tool (evaluate_fraud_transaction -> 200 OK, balance becomes 2 cents)
 *   [B.4] 2 cents tool (calculate_u_value_iso6946 -> 200 OK, balance becomes 0 cents, X-MCPX-Low-Balance: true)
 *   [B.5] x402 interception (analyze_jev_semantic_ast with 0 balance -> HTTP 402 Payment Required, L402 headers)
 *   [B.6] Unauthorized top-up (POST /keys/topup without Master key -> HTTP 401 Unauthorized)
 *   [B.7] Master top-up (POST /keys/topup with Master key for 500 cents -> 200 OK, balance = 500)
 *   [B.8] Execution resumption (generate_mcp_server with fee 5 cents -> 200 OK, balance = 495)
 */

import dotenv from "dotenv";

dotenv.config();

const BASE_URL = process.env.TARGET_URL || "https://mcpx.harrykrauze.com";
const MASTER_KEY = process.env.MCPX_MASTER_KEY || process.env.MCPX_API_KEY || "mcpx_master_sec_2026_enterprise";

interface TestResult {
  step: string;
  name: string;
  status: "PASS" | "FAIL";
  details?: string;
  error?: string;
}

const results: TestResult[] = [];

async function runStep(
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
  console.log(`  AHP GATE 3: SPRINT 3 x402 M2M MONETIZATION VERIFICATION        `);
  console.log(`  Target Gateway: ${BASE_URL}`);
  console.log(`  Timestamp: ${new Date().toISOString()}`);
  console.log(`================================================================\n`);

  const baseUrlClean = BASE_URL.replace(/\/+$/, "");
  const messageUrl = `${baseUrlClean}/message`;

  let createdApiKey = "";
  let createdKeyId = "";
  const testTenant = `billing-test-${Math.floor(100000 + Math.random() * 900000)}`;

  // [B.1] Key provisioning with fixed 3 cents balance
  await runStep("B.1", "Key provisioning (POST /keys/provision with initialBalanceCents: 3)", async () => {
    const res = await fetch(`${baseUrlClean}/keys/provision`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${MASTER_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tenantId: testTenant,
        description: "Sprint 3 x402 M2M test key",
        plan: "pro",
        initialBalanceCents: 3,
        billingMode: "prepaid",
      }),
    });

    if (res.status !== 200) {
      const errText = await res.text();
      throw new Error(`Failed to create key (HTTP ${res.status}): ${errText}`);
    }

    const data = (await res.json()) as any;
    if (!data.apiKey || !data.keyId) {
      throw new Error("Missing apiKey or keyId in response");
    }

    createdApiKey = data.apiKey;
    createdKeyId = data.keyId;

    if (!data.billing || data.billing.balanceCents !== 3) {
      throw new Error(`Expected balance 3 cents, received: ${JSON.stringify(data.billing)}`);
    }

    return `Created key ${createdApiKey.slice(0, 14)}... with keyId: ${createdKeyId} | Initial balance: $${(data.billing.balanceCents / 100).toFixed(2)} (${data.billing.balanceCents} c)`;
  });

  // [B.2] Free operations (tools/list)
  await runStep("B.2", "Free operations (tools/list -> 200 OK, balance unchanged = 3 c)", async () => {
    const listRes = await fetch(messageUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${createdApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "req-list",
        method: "tools/list",
      }),
    });

    if (listRes.status !== 200) {
      const errText = await listRes.text();
      throw new Error(`tools/list error (HTTP ${listRes.status}): ${errText}`);
    }

    const listData = (await listRes.json()) as any;
    if (!listData.result?.tools || !Array.isArray(listData.result.tools)) {
      throw new Error(`tools/list did not return a valid tools array: ${JSON.stringify(listData)}`);
    }

    // Check status and balance via /keys/status
    const statusRes = await fetch(`${baseUrlClean}/keys/status`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${createdApiKey}`,
      },
    });

    if (statusRes.status !== 200) {
      throw new Error(`GET /keys/status error (HTTP ${statusRes.status})`);
    }

    const statusData = (await statusRes.json()) as any;
    if (statusData.billing?.balanceCents !== 3) {
      throw new Error(`tools/list deducted credits! Balance is ${statusData.billing?.balanceCents}, expected 3`);
    }

    return `tools/list successful (${listData.result.tools.length} tools available) | Balance unchanged: $0.03 (3 c)`;
  });

  // [B.3] 1 cent tool invocation (evaluate_fraud_transaction)
  await runStep("B.3", "1 cent tool (evaluate_fraud_transaction -> 200 OK, balance becomes 2 c)", async () => {
    const callRes = await fetch(messageUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${createdApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "req-call-1",
        method: "tools/call",
        params: {
          name: "evaluate_fraud_transaction",
          arguments: {
            amount: 150,
            currency: "EUR",
            userRiskScore: 0.1,
          },
        },
      }),
    });

    if (callRes.status !== 200) {
      const errText = await callRes.text();
      throw new Error(`tools/call error (HTTP ${callRes.status}): ${errText}`);
    }

    const balanceHeader = callRes.headers.get("X-MCPX-Balance-Cents");
    if (balanceHeader !== "2") {
      throw new Error(`Expected header X-MCPX-Balance-Cents: 2, received: '${balanceHeader}'`);
    }

    const callData = (await callRes.json()) as any;
    if (callData.error) {
      throw new Error(`JSON-RPC error: ${JSON.stringify(callData.error)}`);
    }

    return `evaluate_fraud_transaction executed (fee 1 c) | X-MCPX-Balance-Cents: ${balanceHeader}`;
  });

  // [B.4] 2 cents tool invocation (calculate_u_value_iso6946)
  await runStep("B.4", "2 cent tool (calculate_u_value_iso6946 -> 200 OK, balance becomes 0 c, Low-Balance)", async () => {
    const callRes = await fetch(messageUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${createdApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "req-call-2",
        method: "tools/call",
        params: {
          name: "calculate_u_value_iso6946",
          arguments: {
            direction: "horizontal",
            layers: [
              { name: "Concrete", thickness_m: 0.2, lambda_w_mk: 2.0 },
              { name: "Insulation", thickness_m: 0.15, lambda_w_mk: 0.035 },
            ],
          },
        },
      }),
    });

    if (callRes.status !== 200) {
      const errText = await callRes.text();
      throw new Error(`tools/call error (HTTP ${callRes.status}): ${errText}`);
    }

    const balanceHeader = callRes.headers.get("X-MCPX-Balance-Cents");
    const lowBalanceHeader = callRes.headers.get("X-MCPX-Low-Balance");

    if (balanceHeader !== "0") {
      throw new Error(`Expected header X-MCPX-Balance-Cents: 0, received: '${balanceHeader}'`);
    }

    if (lowBalanceHeader !== "true") {
      throw new Error(`Expected header X-MCPX-Low-Balance: true, received: '${lowBalanceHeader}'`);
    }

    return `calculate_u_value_iso6946 executed (fee 2 c) | Balance: 0 c | X-MCPX-Low-Balance: ${lowBalanceHeader}`;
  });

  // [B.5] x402 interception on 0 balance (analyze_jev_semantic_ast)
  await runStep("B.5", "x402 interception (analyze_jev_semantic_ast with 0 balance -> HTTP 402, L402 headers)", async () => {
    const callRes = await fetch(messageUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${createdApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "req-call-blocked",
        method: "tools/call",
        params: {
          name: "analyze_jev_semantic_ast",
          arguments: {
            code: "const x = 1;",
          },
        },
      }),
    });

    if (callRes.status !== 402) {
      const body = await callRes.text();
      throw new Error(`Expected HTTP 402 Payment Required, received ${callRes.status}: ${body}`);
    }

    const authHeader = callRes.headers.get("WWW-Authenticate") || "";
    const balanceHeader = callRes.headers.get("X-MCPX-Balance-Cents");
    const requiredHeader = callRes.headers.get("X-MCPX-Required-Cents");
    const tenantHeader = callRes.headers.get("X-MCPX-Tenant");

    if (!authHeader.includes("L402") || !authHeader.includes("invoice=")) {
      throw new Error(`Missing valid WWW-Authenticate L402 header: '${authHeader}'`);
    }

    if (balanceHeader !== "0") {
      throw new Error(`Expected X-MCPX-Balance-Cents: 0, received: '${balanceHeader}'`);
    }

    if (requiredHeader !== "1") {
      throw new Error(`Expected X-MCPX-Required-Cents: 1, received: '${requiredHeader}'`);
    }

    if (tenantHeader !== testTenant) {
      throw new Error(`Expected X-MCPX-Tenant: ${testTenant}, received: '${tenantHeader}'`);
    }

    const json = (await callRes.json()) as any;
    if (json.error?.code !== 402) {
      throw new Error(`Expected JSON-RPC error.code 402, received: ${JSON.stringify(json.error)}`);
    }

    return `Intercepted HTTP 402 Payment Required | L402 invoice attached | code: ${json.error.code}`;
  });

  // [B.6] Unauthorized balance top-up (POST /keys/topup without Master key)
  await runStep("B.6", "Unauthorized top-up (POST /keys/topup without Master key -> HTTP 401)", async () => {
    const topupRes = await fetch(`${baseUrlClean}/keys/topup`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${createdApiKey}`, // Tenant key, not Master
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        keyId: createdKeyId,
        amountCents: 500,
      }),
    });

    if (topupRes.status !== 401 && topupRes.status !== 403) {
      const body = await topupRes.text();
      throw new Error(`Expected HTTP 401 or 403, received ${topupRes.status}: ${body}`);
    }

    return `Perimeter protection active (HTTP ${topupRes.status} Unauthorized / Forbidden)`;
  });

  // [B.7] Master credit top-up (POST /keys/topup with Master key)
  await runStep("B.7", "Master top-up (POST /keys/topup for 500 cents -> 200 OK, balance = 500 c)", async () => {
    const topupRes = await fetch(`${baseUrlClean}/keys/topup`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${MASTER_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        keyId: createdKeyId,
        amountCents: 500,
        reason: "Sprint 3 Verification Topup",
      }),
    });

    if (topupRes.status !== 200) {
      const errText = await topupRes.text();
      throw new Error(`Topup failed (HTTP ${topupRes.status}): ${errText}`);
    }

    const data = (await topupRes.json()) as any;
    if (data.billing?.balanceCents !== 500) {
      throw new Error(`Expected balance 500 cents, received: ${data.billing?.balanceCents}`);
    }

    return `Topped up by $${(data.addedCents / 100).toFixed(2)} (${data.addedCents} c) | New balance: $${(data.billing.balanceCents / 100).toFixed(2)} (${data.billing.balanceCents} c)`;
  });

  // [B.8] Resumed execution with paid tool (generate_mcp_server, fee 5 cents)
  await runStep("B.8", "Execution resumption (generate_mcp_server with fee 5 c -> 200 OK, balance = 495 c)", async () => {
    const callRes = await fetch(messageUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${createdApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "req-call-gen",
        method: "tools/call",
        params: {
          name: "generate_mcp_server",
          arguments: {
            prompt: "Create a simple calculator MCP server with add and subtract tools.",
          },
        },
      }),
    });

    if (callRes.status !== 200) {
      const errText = await callRes.text();
      throw new Error(`tools/call error after top-up (HTTP ${callRes.status}): ${errText}`);
    }

    const balanceHeader = callRes.headers.get("X-MCPX-Balance-Cents");
    if (balanceHeader !== "495") {
      throw new Error(`Expected header X-MCPX-Balance-Cents: 495, received: '${balanceHeader}'`);
    }

    const callData = (await callRes.json()) as any;
    if (callData.error) {
      throw new Error(`JSON-RPC error: ${JSON.stringify(callData.error)}`);
    }

    return `generate_mcp_server successfully executed (fee 5 c) | Balance: $${(Number(balanceHeader) / 100).toFixed(2)} (${balanceHeader} c)`;
  });

  // Cleanup
  if (createdKeyId) {
    try {
      await fetch(`${baseUrlClean}/keys/${createdKeyId}`, {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${MASTER_KEY}`,
        },
      });
    } catch {
      // Ignore cleanup errors
    }
  }

  // Summary
  console.log(`\n================================================================`);
  console.log(`                       TEST SUMMARY                             `);
  console.log(`================================================================`);
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  console.log(`Total steps:  ${results.length}`);
  console.log(`Passed:       ${passed}`);
  console.log(`Failed:       ${failed}\n`);

  if (failed > 0) {
    console.error(`[GATE CLOSED] ${failed} test(s) failed!`);
    process.exit(1);
  } else {
    console.log(`[GATE OPEN] All x402 M2M monetization and balance tests passed successfully!`);
  }
}

main().catch((err) => {
  console.error("Critical error during test execution:", err);
  process.exit(1);
});
