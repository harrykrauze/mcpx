/**
 * scripts/test-key-provision.ts
 * 
 * AHP GATE 3 (/test) Drošības Verifikācijas Tests:
 * 1. POST /keys/provision bez autorizācijas -> 401 Unauthorized ar RFC 9728 galveni.
 * 2. POST /keys/provision ar nederīgu marķieri -> 401 Unauthorized.
 * 3. POST /keys/provision ar parasta nomnieka API atslēgu -> 403 Forbidden (insufficient_scope).
 * 4. POST /keys/provision ar derīgu MCPX_MASTER_KEY -> 200 OK (atgriež jaunu atslēgu).
 * 5. Izmantot jauno atslēgu -> POST /mcp/messages (tools/list) -> 200 OK un rīku saraksts.
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
    console.error(`       Kļūda: ${err.message || String(err)}`);
    results.push({ step: code, name, status: "FAIL", error: err.message || String(err) });
  }
}

async function main() {
  console.log(`================================================================`);
  console.log(`  AHP GATE 3: KEY PROVISIONING DROŠĪBAS UN ATĻAUJU VERIFIKĀCIJA `);
  console.log(`  Mērķa vārteja: ${BASE_URL}`);
  console.log(`  Laika zīmogs: ${new Date().toISOString()}`);
  console.log(`================================================================\n`);

  const provisionEndpoint = `${BASE_URL.replace(/\/+$/, "")}/keys/provision`;
  let newlyCreatedApiKey = "";

  // 1. Tests: POST /keys/provision bez autorizācijas galvenes -> 401 Unauthorized
  await runStep("P.1", "Neautorizēts POST /keys/provision (gaidīts 401 Unauthorized)", async () => {
    const res = await fetch(provisionEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: "attacker-tenant" }),
      redirect: "manual",
    });

    if (res.status !== 401) {
      throw new Error(`Gaidīts HTTP 401 Unauthorized, saņemts ${res.status}`);
    }

    const wwwAuth = res.headers.get("www-authenticate") || "";
    if (!wwwAuth.includes("unauthorized") && !wwwAuth.includes("invalid_token")) {
      throw new Error(`Trūkst WWW-Authenticate galvene ar kļūdas aprakstu: '${wwwAuth}'`);
    }

    if (!wwwAuth.includes(".well-known/oauth-protected-resource")) {
      throw new Error(`Trūkst RFC 9728 resource_metadata norādes: '${wwwAuth}'`);
    }

    return `HTTP 401 Unauthorized | WWW-Authenticate: ${wwwAuth}`;
  });

  // 2. Tests: POST /keys/provision ar nederīgu marķieri -> 401 Unauthorized
  await runStep("P.2", "Nederīgs tokens POST /keys/provision (gaidīts 401 Unauthorized)", async () => {
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
      throw new Error(`Gaidīts HTTP 401 Unauthorized, saņemts ${res.status}`);
    }

    const wwwAuth = res.headers.get("www-authenticate") || "";
    if (!wwwAuth.includes("invalid_token")) {
      throw new Error(`Gaidīts error="invalid_token", saņemts: '${wwwAuth}'`);
    }

    return `HTTP 401 Unauthorized | WWW-Authenticate: ${wwwAuth}`;
  });

  // 3. Tests: POST /keys/provision ar parasta nomnieka API atslēgu -> 403 Forbidden
  await runStep("P.3", "Parasta nomnieka atslēga uz /keys/provision (gaidīts 403 Forbidden)", async () => {
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
      throw new Error(`Gaidīts HTTP 403 Forbidden, saņemts ${res.status}: ${await res.text()}`);
    }

    const wwwAuth = res.headers.get("www-authenticate") || "";
    const bodyText = await res.text();
    if (!wwwAuth.includes("insufficient_scope") && !bodyText.includes("Insufficient scope")) {
      throw new Error(`Trūkst 'insufficient_scope' norādes 403 atbildē: ${bodyText}`);
    }

    return `HTTP 403 Forbidden pārtverts | error="insufficient_scope"`;
  });

  // 4. Tests: POST /keys/provision ar derīgu Master atslēgu -> 200 OK
  await runStep("P.4", "Master atslēgas autorizācija un jaunas atslēgas izveide (200 OK)", async () => {
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
      throw new Error(`Gaidīts HTTP 200/201, saņemts ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as any;
    if (!data.success || !data.apiKey || !data.apiKey.startsWith("mcpx_live_")) {
      throw new Error(`Atbildē trūkst derīgas apiKey: ${JSON.stringify(data)}`);
    }

    if (data.tenantId !== testTenantId) {
      throw new Error(`TenantId nesakrīt: ${data.tenantId} != ${testTenantId}`);
    }

    if (data.rateLimit !== 25) {
      throw new Error(`RateLimit nesakrīt: ${data.rateLimit} != 25`);
    }

    newlyCreatedApiKey = data.apiKey;
    return `HTTP 200 OK | Izveidota atslēga: ${newlyCreatedApiKey.slice(0, 16)}... | Tenants: ${data.tenantId} | Termiņš: ${data.expiresAt}`;
  });

  // 5. Tests: Verificēt, ka ar tikko izveidoto atslēgu var veikt tools/list izsaukumu
  await runStep("P.5", "Tikko izveidotās atslēgas verifikācija (POST /mcp/messages tools/list)", async () => {
    if (!newlyCreatedApiKey) {
      throw new Error("Iepriekšējais solis neizveidoja jaunu atslēgu");
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
      throw new Error(`Gaidīts HTTP 200 OK, saņemts ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as any;
    if (data.jsonrpc !== "2.0" || data.id !== 101) {
      throw new Error(`Nederīga JSON-RPC atbilde: ${JSON.stringify(data)}`);
    }

    const tools = data.result?.tools;
    if (!Array.isArray(tools) || tools.length === 0) {
      throw new Error(`Rīku saraksts ir tukšs: ${JSON.stringify(data)}`);
    }

    return `HTTP 200 OK | Autentifikācija ar jauno atslēgu sekmīga | Pieejami rīki: ${tools.map((t: any) => t.name).join(", ")}`;
  });

  console.log(`\n================================================================`);
  console.log(`  VERIFIKĀCIJAS KOPSAVILKUMS:`);
  const failed = results.filter((r) => r.status === "FAIL");
  const passed = results.filter((r) => r.status === "PASS");
  console.log(`  Kopā soļi: ${results.length} | Sekmīgi: ${passed.length} | Kļūdas: ${failed.length}`);
  console.log(`================================================================\n`);

  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Kritiska kļūda testa izpildē:", err);
  process.exit(1);
});
