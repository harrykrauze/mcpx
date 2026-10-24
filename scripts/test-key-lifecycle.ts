/**
 * scripts/test-key-lifecycle.ts
 * 
 * AHP GATE 3 (/test) Key Lifecycle Management & Revocation Test:
 * 1. Provision new temporary tenant key via POST /keys/provision.
 * 2. Verify GET /keys with Master key — new key must be listed with status 'active'.
 * 3. Verify GET /keys and DELETE /keys/:keyId without Master key -> 401 Unauthorized.
 * 4. Verify with tenant key -> 403 Forbidden (insufficient_scope).
 * 5. Call DELETE /keys/:keyId with Master key -> 200 OK (revoked).
 * 6. Call POST /mcp/messages with revoked key -> 401 Unauthorized (error="token_revoked").
 * 7. Verify deletion for non-existent key -> 404 Not Found.
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
  console.log(`  AHP GATE 3: MCPX KEY LIFECYCLE MANAGEMENT SECURITY TEST        `);
  console.log(`  Target Gateway: ${BASE_URL}`);
  console.log(`  Timestamp: ${new Date().toISOString()}`);
  console.log(`================================================================\n`);

  const baseUrlClean = BASE_URL.replace(/\/+$/, "");
  let tempApiKey = "";
  let tempKeyId = "";

  // Step 1: Provision temporary tenant key via POST /keys/provision
  await runStep("L.1", "Temporary tenant key provisioning (POST /keys/provision)", async () => {
    const res = await fetch(`${baseUrlClean}/keys/provision`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${MASTER_KEY}`,
      },
      body: JSON.stringify({
        tenantId: `lifecycle-test-${Date.now().toString().slice(-6)}`,
        description: "Temporary Key for Lifecycle Revocation Test",
        rateLimit: 15,
      }),
      redirect: "manual",
    });

    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`Expected HTTP 200/201, received ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as any;
    if (!data.success || !data.apiKey || !data.keyId) {
      throw new Error(`Response missing 'apiKey' or 'keyId': ${JSON.stringify(data)}`);
    }

    tempApiKey = data.apiKey;
    tempKeyId = data.keyId;
    return `Created key: ${tempKeyId} (${tempApiKey.slice(0, 14)}...)`;
  });

  // Step 2: Verify GET /keys with Master key — new key must appear in active list
  await runStep("L.2", "Key inventory query (GET /keys with Master key)", async () => {
    const res = await fetch(`${baseUrlClean}/keys`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${MASTER_KEY}`,
        "Accept": "application/json",
      },
      redirect: "manual",
    });

    if (res.status !== 200) {
      throw new Error(`Expected HTTP 200 OK, received ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as any;
    if (!data.success || !Array.isArray(data.keys)) {
      throw new Error(`Invalid response format: ${JSON.stringify(data)}`);
    }

    const found = data.keys.find((k: any) => k.keyId === tempKeyId);
    if (!found) {
      throw new Error(`Newly created key ${tempKeyId} was not found in key list!`);
    }

    if (found.status !== "active") {
      throw new Error(`Key status is not 'active': ${found.status}`);
    }

    // Verify secret key is masked and not leaked
    if (JSON.stringify(data).includes(tempApiKey)) {
      throw new Error(`SECURITY VIOLATION: Full secret API key exposed in GET /keys list!`);
    }

    return `Found key ${tempKeyId} with status '${found.status}', masked value: ${found.maskedKey}`;
  });

  // Step 3: Verify GET /keys and DELETE /keys/:keyId without Master key -> 401 Unauthorized
  await runStep("L.3", "Unauthorized access to GET /keys and DELETE /keys/:id (401 Unauthorized)", async () => {
    // GET /keys without header
    const resGet = await fetch(`${baseUrlClean}/keys`, { redirect: "manual" });
    if (resGet.status !== 401) {
      throw new Error(`GET /keys without header: expected 401, received ${resGet.status}`);
    }

    // DELETE /keys/:id without header
    const resDel = await fetch(`${baseUrlClean}/keys/${tempKeyId}`, {
      method: "DELETE",
      redirect: "manual",
    });
    if (resDel.status !== 401) {
      throw new Error(`DELETE /keys/:id without header: expected 401, received ${resDel.status}`);
    }

    const wwwAuth = resGet.headers.get("www-authenticate") || "";
    return `GET and DELETE successfully blocked with HTTP 401 | WWW-Authenticate: ${wwwAuth}`;
  });

  // Step 4: Verify with tenant key -> 403 Forbidden (insufficient_scope)
  await runStep("L.4", "Tenant privilege escalation prevention (403 Forbidden)", async () => {
    // Tenant attempts to retrieve all keys
    const resGet = await fetch(`${baseUrlClean}/keys`, {
      method: "GET",
      headers: { "Authorization": `Bearer ${TENANT_KEY}` },
      redirect: "manual",
    });

    if (resGet.status !== 403) {
      throw new Error(`Tenant GET /keys: expected 403, received ${resGet.status}`);
    }

    // Tenant attempts to delete a key
    const resDel = await fetch(`${baseUrlClean}/keys/${tempKeyId}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${TENANT_KEY}` },
      redirect: "manual",
    });

    if (resDel.status !== 403) {
      throw new Error(`Tenant DELETE /keys: expected 403, received ${resDel.status}`);
    }

    return `Tenant key management attempt intercepted with HTTP 403 Forbidden`;
  });

  // Step 5: Call DELETE /keys/:keyId with Master key -> 200 OK (revoked)
  await runStep("L.5", "Immediate key revocation (DELETE /keys/:keyId with Master key)", async () => {
    const res = await fetch(`${baseUrlClean}/keys/${tempKeyId}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${MASTER_KEY}` },
      redirect: "manual",
    });

    if (res.status !== 200) {
      throw new Error(`Expected HTTP 200 OK, received ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as any;
    if (!data.success || data.status !== "revoked") {
      throw new Error(`Invalid response: ${JSON.stringify(data)}`);
    }

    return `HTTP 200 OK | Key ${data.keyId} revoked at timestamp ${data.revokedAt}`;
  });

  // Step 6: Call POST /mcp/messages with revoked key -> 401 Unauthorized (error="token_revoked")
  await runStep("L.6", "Immediate blocking of revoked key (expected 401 error=token_revoked)", async () => {
    const payload = {
      jsonrpc: "2.0",
      id: 201,
      method: "tools/list",
      params: {},
    };

    const res = await fetch(`${baseUrlClean}/mcp/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${tempApiKey}`,
      },
      body: JSON.stringify(payload),
      redirect: "manual",
    });

    if (res.status !== 401) {
      throw new Error(`Expected HTTP 401 Unauthorized, received ${res.status}: ${await res.text()}`);
    }

    const wwwAuth = res.headers.get("www-authenticate") || "";
    if (!wwwAuth.includes("token_revoked")) {
      throw new Error(`WWW-Authenticate header missing 'token_revoked': '${wwwAuth}'`);
    }

    return `HTTP 401 Unauthorized | WWW-Authenticate: ${wwwAuth}`;
  });

  // Step 7: Deletion of non-existent key -> 404 Not Found
  await runStep("L.7", "Deletion attempt of non-existent keyId (expected 404 Not Found)", async () => {
    const res = await fetch(`${baseUrlClean}/keys/key_nonexistent_999999`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${MASTER_KEY}` },
      redirect: "manual",
    });

    if (res.status !== 404) {
      throw new Error(`Expected HTTP 404 Not Found, received ${res.status}: ${await res.text()}`);
    }

    return `HTTP 404 Not Found returned successfully`;
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
  console.error("Critical error during lifecycle test execution:", err);
  process.exit(1);
});
