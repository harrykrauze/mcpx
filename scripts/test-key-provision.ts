/**
 * scripts/test-key-provision.ts
 * 
 * AHP GATE 3 (/test) Security Verification Test:
 * 1. POST /keys/provision without authorization -> 401 Unauthorized with RFC 9728 header.
 * 2. POST /keys/provision with invalid token -> 401 Unauthorized.
 * 3. POST /keys/provision with standard tenant API key -> 403 Forbidden (insufficient_scope).
 * 4. POST /keys/provision with valid MCPX_MASTER_KEY -> 200 OK (returns new key).
 * 5. Use new key -> POST /mcp/messages (tools/list) -> 200 OK and tool listing.
 */

import dotenv from "dotenv";

dotenv.config();

const BASE_URL = process.env.TARGET_URL || "https://mcpx.harrykrauze.com";
const MASTER_KEY = process.env.MCPX_MASTER_KEY || process.env.MCPX_API_KEY || "mcpx_master_sec_2026_enterprise";
const TENANT_KEY = process.env.TEST_TENANT_KEY || "mcpx_live_test_client_key_123";

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
  console.log(`  AHP GATE 3: KEY PROVISIONING SECURITY & PERMISSIONS TEST      `);
  console.log(`  Target Gateway: ${BASE_URL}`);
  console.log(`  Timestamp: ${new Date().toISOString()}`);
  console.log(`================================================================\n`);

  const provisionEndpoint = `${BASE_URL.replace(/\/+$/, "")}/keys/provision`;
  let newlyCreatedApiKey = "";

  // 1. Test: POST /keys/provision without authorization header -> 401 Unauthorized
  await runStep("P.1", "Unauthorized POST /keys/provision (expected 401 Unauthorized)", async () => {
    const res = await fetch(provisionEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: "attacker-tenant" }),
      redirect: "manual",
    });

    if (res.status !== 401) {
      throw new Error(`Expected HTTP 401 Unauthorized, received ${res.status}`);
    }

    const wwwAuth = res.headers.get("www-authenticate") || "";
    if (!wwwAuth.includes("unauthorized") && !wwwAuth.includes("invalid_token")) {
      throw new Error(`Missing WWW-Authenticate header with error description: '${wwwAuth}'`);
    }

    if (!wwwAuth.includes(".well-known/oauth-protected-resource")) {
      throw new Error(`Missing RFC 9728 resource_metadata indicator: '${wwwAuth}'`);
    }

    return `HTTP 401 Unauthorized | WWW-Authenticate: ${wwwAuth}`;
  });

  // 2. Test: POST /keys/provision with invalid token -> 401 Unauthorized
  await runStep("P.2", "Invalid token POST /keys/provision (expected 401 Unauthorized)", async () => {
    const res = await fetch(provisionEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer invalid_random_fake_token_999",
      },
      body: JSON.stringify({ tenantId: "attacker-tenant" }),
      redirect: "manual",
    });

    if (res.status !== 401) {
      throw new Error(`Expected HTTP 401 Unauthorized, received ${res.status}`);
    }

    const wwwAuth = res.headers.get("www-authenticate") || "";
    if (!wwwAuth.includes("invalid_token")) {
      throw new Error(`Expected error="invalid_token", received: '${wwwAuth}'`);
    }

    return `HTTP 401 Unauthorized | WWW-Authenticate: ${wwwAuth}`;
  });

  // 3. Test: POST /keys/provision with standard tenant API key -> 403 Forbidden
  await runStep("P.3", "Tenant key without admin scope on /keys/provision (expected 403 Forbidden)", async () => {
    const res = await fetch(provisionEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${TENANT_KEY}`,
      },
      body: JSON.stringify({ tenantId: "privilege-escalation-attempt" }),
      redirect: "manual",
    });

    if (res.status !== 403) {
      throw new Error(`Expected HTTP 403 Forbidden, received ${res.status}: ${await res.text()}`);
    }

    const wwwAuth = res.headers.get("www-authenticate") || "";
    const bodyText = await res.text();
    if (!wwwAuth.includes("insufficient_scope") && !bodyText.includes("Insufficient scope")) {
      throw new Error(`Missing 'insufficient_scope' in 403 response: ${bodyText}`);
    }

    return `HTTP 403 Forbidden intercepted | error="insufficient_scope"`;
  });

  // 4. Test: POST /keys/provision with valid Master key -> 200 OK
  await runStep("P.4", "Master key authorization and new key provisioning (200 OK)", async () => {
    const testTenantId = `tenant-test-${Date.now().toString().slice(-6)}`;
    const res = await fetch(provisionEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${MASTER_KEY}`,
      },
      body: JSON.stringify({
        tenantId: testTenantId,
        description: "AHP Automated Test Key",
        plan: "pro",
        rateLimit: 25,
        scopes: ["mcp:read", "mcp:write", "mcp:generate"],
        expiresInDays: 30,
      }),
      redirect: "manual",
    });

    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`Expected HTTP 200/201, received ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as any;
    if (!data.success || !data.apiKey || !data.apiKey.startsWith("mcpx_live_")) {
      throw new Error(`Response missing valid apiKey: ${JSON.stringify(data)}`);
    }

    if (data.tenantId !== testTenantId) {
      throw new Error(`TenantId mismatch: ${data.tenantId} != ${testTenantId}`);
    }

    if (data.rateLimit !== 25) {
      throw new Error(`RateLimit mismatch: ${data.rateLimit} != 25`);
    }

    newlyCreatedApiKey = data.apiKey;
    return `HTTP 200 OK | Created key: ${newlyCreatedApiKey.slice(0, 16)}... | Tenant: ${data.tenantId} | Expires: ${data.expiresAt}`;
  });

  // 5. Test: Verify newly created key can call tools/list
  await runStep("P.5", "Newly created key verification (POST /mcp/messages tools/list)", async () => {
    if (!newlyCreatedApiKey) {
      throw new Error("Previous step did not provision a key");
    }

    const messageEndpoint = `${BASE_URL.replace(/\/+$/, "")}/mcp/messages`;
    const payload = {
      jsonrpc: "2.0",
      id: 101,
      method: "tools/list",
      params: {},
    };

    const res = await fetch(messageEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${newlyCreatedApiKey}`,
      },
      body: JSON.stringify(payload),
      redirect: "manual",
    });

    if (res.status !== 200) {
      throw new Error(`Expected HTTP 200 OK, received ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as any;
    if (data.jsonrpc !== "2.0" || data.id !== 101) {
      throw new Error(`Invalid JSON-RPC response: ${JSON.stringify(data)}`);
    }

    const tools = data.result?.tools;
    if (!Array.isArray(tools) || tools.length === 0) {
      throw new Error(`Tools array is empty: ${JSON.stringify(data)}`);
    }

    return `HTTP 200 OK | Authentication with new key successful | Available tools: ${tools.map((t: any) => t.name).join(", ")}`;
  });

  console.log(`\n================================================================`);
  console.log(`  VERIFICATION SUMMARY:`);
  const failed = results.filter((r) => r.status === "FAIL");
  const passed = results.filter((r) => r.status === "PASS");
  console.log(`  Total steps: ${results.length} | Passed: ${passed.length} | Failed: ${failed.length}`);
  console.log(`================================================================\n`);

  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Critical error during test execution:", err);
  process.exit(1);
});
