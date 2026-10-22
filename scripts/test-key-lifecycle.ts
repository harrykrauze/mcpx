/**
 * scripts/test-key-lifecycle.ts
 * 
 * AHP GATE 3 (/test) Atslēgu Dzīvescikla Drošības un Atsaukšanas Tests:
 * 1. Izveidot jaunu pagaidu nomnieka atslēgu caur POST /keys/provision.
 * 2. Pārbaudīt GET /keys ar Master atslēgu — jaunajai atslēgai jābūt sarakstā ar statusu 'active'.
 * 3. Pārbaudīt GET /keys un DELETE /keys/:keyId bez Master atslēgas -> 401 Unauthorized.
 * 4. Pārbaudīt ar nomnieka atslēgu -> 403 Forbidden (insufficient_scope).
 * 5. Izsaukt DELETE /keys/:keyId ar Master atslēgu -> 200 OK (anulēta).
 * 6. Izsaukt POST /mcp/messages ar anulēto atslēgu -> 401 Unauthorized (error="token_revoked").
 * 7. Pārbaudīt dzēšanu neeksistējošai atslēgai -> 404 Not Found.
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
  console.log(`  AHP GATE 3: MCPX KEY LIFECYCLE MANAGEMENT DROŠĪBAS TESTS      `);
  console.log(`  Mērķa vārteja: ${BASE_URL}`);
  console.log(`  Laika zīmogs: ${new Date().toISOString()}`);
  console.log(`================================================================\n`);

  const baseUrlClean = BASE_URL.replace(/\/+$/, "");
  let tempApiKey = "";
  let tempKeyId = "";

  // 1. Solis: Izveidot pagaidu atslēgu caur POST /keys/provision
  await runStep("L.1", "Pagaidu nomnieka atslēgas izveide (POST /keys/provision)", async () => {
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
      throw new Error(`Gaidīts HTTP 200/201, saņemts ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as any;
    if (!data.success || !data.apiKey || !data.keyId) {
      throw new Error(`Atbildē trūkst 'apiKey' vai 'keyId': ${JSON.stringify(data)}`);
    }

    tempApiKey = data.apiKey;
    tempKeyId = data.keyId;
    return `Izveidota atslēga: ${tempKeyId} (${tempApiKey.slice(0, 14)}...)`;
  });

  // 2. Solis: Pārbaudīt GET /keys ar Master atslēgu — jaunajai atslēgai jābūt sarakstā
  await runStep("L.2", "Atslēgu inventarizācija (GET /keys ar Master atslēgu)", async () => {
    const res = await fetch(`${baseUrlClean}/keys`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${MASTER_KEY}`,
        "Accept": "application/json",
      },
      redirect: "manual",
    });

    if (res.status !== 200) {
      throw new Error(`Gaidīts HTTP 200 OK, saņemts ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as any;
    if (!data.success || !Array.isArray(data.keys)) {
      throw new Error(`Nederīgs atbildes formāts: ${JSON.stringify(data)}`);
    }

    const found = data.keys.find((k: any) => k.keyId === tempKeyId);
    if (!found) {
      throw new Error(`Tikko izveidotā atslēga ${tempKeyId} netika atrasta sarakstā!`);
    }

    if (found.status !== "active") {
      throw new Error(`Atslēgas statuss nav 'active': ${found.status}`);
    }

    // Pārliecināmies, ka pilnais noslēpums nav nopludināts
    if (JSON.stringify(data).includes(tempApiKey)) {
      throw new Error(`DROŠĪBAS PĀRKĀPUMS: Pilnā API atslēga ir atklāta GET /keys sarakstā!`);
    }

    return `Atrasta atslēga ${tempKeyId} ar statusu '${found.status}', maskētā vērtība: ${found.maskedKey}`;
  });

  // 3. Solis: Pārbaudīt GET /keys un DELETE /keys/:keyId bez Master atslēgas -> 401 Unauthorized
  await runStep("L.3", "Neautorizēta piekļuve GET /keys un DELETE /keys/:id (401 Unauthorized)", async () => {
    // GET /keys bez galvenes
    const resGet = await fetch(`${baseUrlClean}/keys`, { redirect: "manual" });
    if (resGet.status !== 401) {
      throw new Error(`GET /keys bez galvenes: gaidīts 401, saņemts ${resGet.status}`);
    }

    // DELETE /keys/:id bez galvenes
    const resDel = await fetch(`${baseUrlClean}/keys/${tempKeyId}`, {
      method: "DELETE",
      redirect: "manual",
    });
    if (resDel.status !== 401) {
      throw new Error(`DELETE /keys/:id bez galvenes: gaidīts 401, saņemts ${resDel.status}`);
    }

    const wwwAuth = resGet.headers.get("www-authenticate") || "";
    return `GET un DELETE veiksmīgi bloķēti ar HTTP 401 | WWW-Authenticate: ${wwwAuth}`;
  });

  // 4. Solis: Pārbaudīt ar nomnieka atslēgu -> 403 Forbidden (insufficient_scope)
  await runStep("L.4", "Nomnieka privilēģiju eskalācijas bloķēšana (403 Forbidden)", async () => {
    // Nomnieks mēģina izgūt visas atslēgas
    const resGet = await fetch(`${baseUrlClean}/keys`, {
      method: "GET",
      headers: { "Authorization": `Bearer ${TENANT_KEY}` },
      redirect: "manual",
    });

    if (resGet.status !== 403) {
      throw new Error(`Nomnieks GET /keys: gaidīts 403, saņemts ${resGet.status}`);
    }

    // Nomnieks mēģina dzēst atslēgu
    const resDel = await fetch(`${baseUrlClean}/keys/${tempKeyId}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${TENANT_KEY}` },
      redirect: "manual",
    });

    if (resDel.status !== 403) {
      throw new Error(`Nomnieks DELETE /keys: gaidīts 403, saņemts ${resDel.status}`);
    }

    return `Nomnieka mēģinājums pārvaldīt atslēgas pārtverts ar HTTP 403 Forbidden`;
  });

  // 5. Solis: Izsaukt DELETE /keys/:keyId ar Master atslēgu -> 200 OK (anulēta)
  await runStep("L.5", "Atslēgas tūlītēja anulēšana (DELETE /keys/:keyId ar Master atslēgu)", async () => {
    const res = await fetch(`${baseUrlClean}/keys/${tempKeyId}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${MASTER_KEY}` },
      redirect: "manual",
    });

    if (res.status !== 200) {
      throw new Error(`Gaidīts HTTP 200 OK, saņemts ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as any;
    if (!data.success || data.status !== "revoked") {
      throw new Error(`Nederīga atbilde: ${JSON.stringify(data)}`);
    }

    return `HTTP 200 OK | Atslēga ${data.keyId} anulēta laika zīmogā ${data.revokedAt}`;
  });

  // 6. Solis: Izsaukt POST /mcp/messages ar tikko anulēto atslēgu -> 401 Unauthorized (error="token_revoked")
  await runStep("L.6", "Anulētas atslēgas tūlītēja bloķēšana (gaidīts 401 error=token_revoked)", async () => {
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
      throw new Error(`Gaidīts HTTP 401 Unauthorized, saņemts ${res.status}: ${await res.text()}`);
    }

    const wwwAuth = res.headers.get("www-authenticate") || "";
    if (!wwwAuth.includes("token_revoked")) {
      throw new Error(`WWW-Authenticate galvenē trūkst 'token_revoked': '${wwwAuth}'`);
    }

    return `HTTP 401 Unauthorized | WWW-Authenticate: ${wwwAuth}`;
  });

  // 7. Solis: Dzēšana neeksistējošai atslēgai -> 404 Not Found
  await runStep("L.7", "Neeksistējoša keyId dzēšanas mēģinājums (gaidīts 404 Not Found)", async () => {
    const res = await fetch(`${baseUrlClean}/keys/key_nonexistent_999999`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${MASTER_KEY}` },
      redirect: "manual",
    });

    if (res.status !== 404) {
      throw new Error(`Gaidīts HTTP 404 Not Found, saņemts ${res.status}: ${await res.text()}`);
    }

    return `HTTP 404 Not Found sekmīgi atgriezts`;
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
  console.error("Kritiska kļūda dzīvescikla testa izpildē:", err);
  process.exit(1);
});
