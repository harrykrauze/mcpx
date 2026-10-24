/**
 * scripts/test-analytics-telemetry.ts
 * 
 * AHP GATE 3 (/test) Cloudflare Workers Analytics Engine Integration Verification Test:
 * 1. Unit verification: `detectClientType`, `recordTelemetry` data format, and graceful degradation.
 * 2. Verify `/health` endpoint — must contain `analyticsConfigured`.
 * 3. Invoke `tools/call` (`evaluate_fraud_transaction`) with active key -> HTTP 200 OK.
 * 4. Provision and revoke a temporary tenant key, invoke `tools/call` -> HTTP 401 `token_revoked`.
 * 5. Invoke unknown method / tool -> JSON-RPC error -32601 (telemetry `client_error`).
 */

import dotenv from "dotenv";
import workerDefault, { detectClientType, recordTelemetry, TelemetryPoint } from "../src/index";
import { Env, AnalyticsEngineDataset, AnalyticsEngineDataPoint } from "../src/auth";

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
  console.log(`  AHP GATE 3: CLOUDFLARE ANALYTICS ENGINE INTEGRATION TEST       `);
  console.log(`  Target Gateway: ${BASE_URL}`);
  console.log(`  Timestamp: ${new Date().toISOString()}`);
  console.log(`================================================================\n`);

  const baseUrlClean = BASE_URL.replace(/\/+$/, "");

  // Step 1: detectClientType logic
  await runStep("T.1", "Unit test: detectClientType classification", async () => {
    const cases = [
      { ua: "Claude-Code/1.0.0 (darwin-arm64)", expected: "claude-code" },
      { ua: "Mozilla/5.0 Cursor/0.42.3", expected: "cursor" },
      { ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0", expected: "browser" },
      { ua: "node-fetch/3.3.0", expected: "custom-agent" },
      { ua: "python-requests/2.31.0", expected: "custom-agent" },
      { ua: null, expected: "unknown" },
    ];

    for (const c of cases) {
      const detected = detectClientType(c.ua);
      if (detected !== c.expected) {
        throw new Error(`UA '${c.ua}' detected as '${detected}', expected '${c.expected}'`);
      }
    }
    return `All ${cases.length} User-Agent patterns successfully classified`;
  });

  // Step 2: recordTelemetry data point schema and Graceful Degradation
  await runStep("T.2", "Unit test: recordTelemetry schema and graceful degradation", async () => {
    const captured: AnalyticsEngineDataPoint[] = [];
    const mockDataset: AnalyticsEngineDataset = {
      writeDataPoint(point: AnalyticsEngineDataPoint) {
        captured.push(point);
      },
    };

    const mockCtx = {
      waitUntil(promise: Promise<unknown>) {
        // Execute synchronously in unit test
        promise.catch(() => {});
      },
      passThroughOnException() {},
    };

    const mockEnvWithAnalytics: Env = {
      GEMINI_API_KEY: "fake_gemini",
      MCPX_KEYS: null as any,
      ANALYTICS: mockDataset,
    };

    const testPoint: TelemetryPoint = {
      tenantId: "tenant_alpha",
      method: "tools/call",
      toolName: "evaluate_fraud_transaction",
      status: "success",
      clientType: "claude-code",
      executionTimeMs: 45.2,
      statusCode: 200,
      payloadSizeBytes: 512,
    };

    recordTelemetry(mockEnvWithAnalytics, mockCtx, testPoint);

    // Allow asynchronous microtask queue to process
    await new Promise((resolve) => setTimeout(resolve, 50));

    if (captured.length !== 1) {
      throw new Error(`Expected 1 entry in mock Analytics dataset, got ${captured.length}`);
    }

    const item = captured[0];
    if (!item.indexes || item.indexes[0] !== "tenant_alpha") {
      throw new Error(`Invalid index1: ${item.indexes?.[0]}`);
    }
    if (!item.blobs || item.blobs[0] !== "tenant_alpha" || item.blobs[1] !== "tools/call" || item.blobs[2] !== "evaluate_fraud_transaction" || item.blobs[3] !== "success" || item.blobs[4] !== "claude-code") {
      throw new Error(`Invalid blobs: ${JSON.stringify(item.blobs)}`);
    }
    if (!item.doubles || item.doubles[0] !== 45 || item.doubles[1] !== 200 || item.doubles[2] !== 512) {
      throw new Error(`Invalid doubles: ${JSON.stringify(item.doubles)}`);
    }

    // Graceful degradation test without env.ANALYTICS (must not throw)
    const mockEnvWithoutAnalytics: Env = {
      GEMINI_API_KEY: "fake_gemini",
      MCPX_KEYS: null as any,
    };
    recordTelemetry(mockEnvWithoutAnalytics, mockCtx, testPoint);

    return `Schema verified: indexes=[tenant], blobs=[tenant, method, tool, status, clientType], doubles=[time, status, size]`;
  });

  // Step 3: /health endpoint (analytics configuration status)
  await runStep("T.3", "Health check (GET /health)", async () => {
    const res = await fetch(`${baseUrlClean}/health`);
    if (res.status !== 200) {
      throw new Error(`Expected 200 OK, got ${res.status}`);
    }
    const data = await res.json() as any;
    if (typeof data.analyticsConfigured !== "boolean") {
      throw new Error(`Field 'analyticsConfigured' not found in response: ${JSON.stringify(data)}`);
    }
    return `HTTP 200 OK | status: ${data.status} | analyticsConfigured: ${data.analyticsConfigured}`;
  });

  let tempTenantKey = "";
  let tempKeyId = "";

  // Step 4: Key provisioning with Master key (POST /keys/provision)
  await runStep("T.4", "Provision new key with Master key (POST /keys/provision)", async () => {
    const testTenantId = `telemetry-test-${Date.now().toString().slice(-6)}`;
    const res = await fetch(`${baseUrlClean}/keys/provision`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${MASTER_KEY}`,
      },
      body: JSON.stringify({
        tenantId: testTenantId,
        description: "Analytics Telemetry Automated Verification Key",
        plan: "pro",
      }),
    });

    if (res.status !== 200) {
      const errText = await res.text();
      throw new Error(`Failed to provision temporary key: HTTP ${res.status} | ${errText}`);
    }

    const data = await res.json() as any;
    if (!data.apiKey || !data.keyId) {
      throw new Error(`Response missing apiKey or keyId: ${JSON.stringify(data)}`);
    }

    tempTenantKey = data.apiKey;
    tempKeyId = data.keyId;
    return `Provisioned temporary key ${data.apiKey.slice(0, 14)}... with keyId: ${tempKeyId}`;
  });

  // Step 5: Successful tool invocation with active key (tools/call -> 200 OK)
  await runStep("T.5", "MCP tool invocation with active key (tools/call -> 200 OK)", async () => {
    const res = await fetch(`${baseUrlClean}/mcp/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${tempTenantKey}`,
        "User-Agent": "Claude-Code/1.0.0",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "telemetry-rpc-1",
        method: "tools/call",
        params: {
          name: "evaluate_fraud_transaction",
          arguments: {
            amount: 1500,
            currency: "EUR",
            userRiskScore: 0.12,
          },
        },
      }),
    });

    if (res.status !== 200) {
      const err = await res.text();
      throw new Error(`Expected HTTP 200 OK, got ${res.status}: ${err}`);
    }

    const data = await res.json() as any;
    if (!data.result || !data.result.content) {
      throw new Error(`Invalid JSON-RPC response: ${JSON.stringify(data)}`);
    }

    return `HTTP 200 OK | evaluate_fraud_transaction executed | User-Agent: Claude-Code`;
  });

  // Step 6: Unknown JSON-RPC method (method not found -> client_error telemetry)
  await runStep("T.6", "Unknown JSON-RPC method (client_error telemetry capture)", async () => {
    const res = await fetch(`${baseUrlClean}/mcp/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${tempTenantKey}`,
        "User-Agent": "Cursor/0.42.0",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "telemetry-rpc-err",
        method: "unsupported_method_test",
      }),
    });

    if (res.status !== 200) {
      throw new Error(`Expected HTTP 200 JSON-RPC error, got ${res.status}`);
    }

    const data = await res.json() as any;
    if (!data.error || data.error.code !== -32601) {
      throw new Error(`Expected JSON-RPC error code -32601, got: ${JSON.stringify(data)}`);
    }

    return `HTTP 200 OK (JSON-RPC -32601 Method not found) | telemetry status: client_error`;
  });

  // Step 7: Key revocation and blocked access (telemetry status: revoked)
  await runStep("T.7", "Key revocation and blocked telemetry (HTTP 401 token_revoked)", async () => {
    // 1. Revoke key via DELETE /keys/:keyId
    const delRes = await fetch(`${baseUrlClean}/keys/${tempKeyId}`, {
      method: "DELETE",
      headers: {
        "Authorization": `Bearer ${MASTER_KEY}`,
      },
    });

    if (delRes.status !== 200) {
      const err = await delRes.text();
      throw new Error(`Failed to revoke key: HTTP ${delRes.status} | ${err}`);
    }

    // 2. Attempt to invoke tool with revoked key
    const testRevokedRes = await fetch(`${baseUrlClean}/mcp/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${tempTenantKey}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "telemetry-rpc-revoked",
        method: "tools/call",
        params: { name: "evaluate_fraud_transaction", arguments: { amount: 10, currency: "EUR" } },
      }),
    });

    if (testRevokedRes.status !== 401) {
      throw new Error(`Expected HTTP 401 Unauthorized with revoked key, got ${testRevokedRes.status}`);
    }

    const wwwAuth = testRevokedRes.headers.get("WWW-Authenticate") || "";
    if (!wwwAuth.includes("token_revoked")) {
      throw new Error(`Missing 'token_revoked' in WWW-Authenticate header: ${wwwAuth}`);
    }

    return `HTTP 401 Unauthorized | WWW-Authenticate: ${wwwAuth} | telemetry status: revoked`;
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

  console.log(`\n[GATE OPEN] All Analytics Engine telemetry tests passed successfully!\n`);
}

main().catch((err) => {
  console.error("Critical error during test execution:", err);
  process.exit(1);
});
