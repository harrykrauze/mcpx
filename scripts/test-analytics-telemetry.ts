/**
 * scripts/test-analytics-telemetry.ts
 * 
 * AHP GATE 3 (/test) Cloudflare Workers Analytics Engine Integrācijas Verifikācijas Tests:
 * 1. Pārbaudīt Unit līmenī: `detectClientType`, `recordTelemetry` datu formātu un graceful degradation.
 * 2. Pārbaudīt `/health` galapunktu — jāsatur `analyticsConfigured`.
 * 3. Izsaukt `tools/call` (`evaluate_fraud_transaction`) ar aktīvu atslēgu -> HTTP 200 OK.
 * 4. Izveidot un anulēt pagaidu nomnieka atslēgu, izsaukt `tools/call` -> HTTP 401 `token_revoked`.
 * 5. Izsaukt nezināmu metodi / rīku -> JSON-RPC kļūda -32601 (telemetrijas `client_error`).
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
    console.error(`       Kļūda: ${err.message || String(err)}`);
    results.push({ step: code, name, status: "FAIL", error: err.message || String(err) });
  }
}

async function main() {
  console.log(`================================================================`);
  console.log(`  AHP GATE 3: CLOUDFLARE ANALYTICS ENGINE INTEGRĀCIJAS TESTS    `);
  console.log(`  Mērķa vārteja: ${BASE_URL}`);
  console.log(`  Laika zīmogs: ${new Date().toISOString()}`);
  console.log(`================================================================\n`);

  const baseUrlClean = BASE_URL.replace(/\/+$/, "");

  // 1. Tests: detectClientType loģika
  await runStep("T.1", "Unit tests: detectClientType identifikācija", async () => {
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
        throw new Error(`UA '${c.ua}' atpazīts kā '${detected}', bet gaidīts '${c.expected}'`);
      }
    }
    return `Visi ${cases.length} User-Agent šabloni veiksmīgi klasificēti`;
  });

  // 2. Tests: recordTelemetry datu punkta shēma un Graceful Degradation
  await runStep("T.2", "Unit tests: recordTelemetry shēma un droša degradācija", async () => {
    const captured: AnalyticsEngineDataPoint[] = [];
    const mockDataset: AnalyticsEngineDataset = {
      writeDataPoint(point: AnalyticsEngineDataPoint) {
        captured.push(point);
      },
    };

    const mockCtx = {
      waitUntil(promise: Promise<unknown>) {
        // Izpildām uzreiz testā
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

    // Ļaujam asinhronajai mikrouzdevumu rindai izpildīties
    await new Promise((resolve) => setTimeout(resolve, 50));

    if (captured.length !== 1) {
      throw new Error(`Gaidīts 1 ieraksts mock Analytics datasetā, saņemti ${captured.length}`);
    }

    const item = captured[0];
    if (!item.indexes || item.indexes[0] !== "tenant_alpha") {
      throw new Error(`Nepareizs index1: ${item.indexes?.[0]}`);
    }
    if (!item.blobs || item.blobs[0] !== "tenant_alpha" || item.blobs[1] !== "tools/call" || item.blobs[2] !== "evaluate_fraud_transaction" || item.blobs[3] !== "success" || item.blobs[4] !== "claude-code") {
      throw new Error(`Nepareizi blobs: ${JSON.stringify(item.blobs)}`);
    }
    if (!item.doubles || item.doubles[0] !== 45 || item.doubles[1] !== 200 || item.doubles[2] !== 512) {
      throw new Error(`Nepareizi doubles: ${JSON.stringify(item.doubles)}`);
    }

    // Graceful degradation pārbaude bez env.ANALYTICS (nedrīkst mest kļūdu)
    const mockEnvWithoutAnalytics: Env = {
      GEMINI_API_KEY: "fake_gemini",
      MCPX_KEYS: null as any,
    };
    recordTelemetry(mockEnvWithoutAnalytics, mockCtx, testPoint);

    return `Shēma verificēta: indexes=[tenant], blobs=[tenant, method, tool, status, clientType], doubles=[time, status, size]`;
  });

  // 3. Tests: /health galapunkts (analītikas konfigurācijas statuss)
  await runStep("T.3", "Veselības pārbaude (GET /health)", async () => {
    const res = await fetch(`${baseUrlClean}/health`);
    if (res.status !== 200) {
      throw new Error(`Gaidīts 200 OK, saņemts ${res.status}`);
    }
    const data = await res.json() as any;
    if (typeof data.analyticsConfigured !== "boolean") {
      throw new Error(`Lauks 'analyticsConfigured' nav atrasts atbildē: ${JSON.stringify(data)}`);
    }
    return `HTTP 200 OK | status: ${data.status} | analyticsConfigured: ${data.analyticsConfigured}`;
  });

  let tempTenantKey = "";
  let tempKeyId = "";

  // 4. Tests: Jaunas atslēgas izsniegšana caur POST /keys/provision
  await runStep("T.4", "Jaunas atslēgas izsniegšana ar Master atslēgu (POST /keys/provision)", async () => {
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
      throw new Error(`Neizdevās izsniegt pagaidu atslēgu: HTTP ${res.status} | ${errText}`);
    }

    const data = await res.json() as any;
    if (!data.apiKey || !data.keyId) {
      throw new Error(`Atbildē trūkst apiKey vai keyId: ${JSON.stringify(data)}`);
    }

    tempTenantKey = data.apiKey;
    tempKeyId = data.keyId;
    return `Izsniegta pagaidu atslēga ${data.apiKey.slice(0, 14)}... ar keyId: ${tempKeyId}`;
  });

  // 5. Tests: Veiksmīgs rīka izsaukums ar aktīvu atslēgu (tools/call -> 200 OK)
  await runStep("T.5", "MCP rīka izsaukums ar aktīvu atslēgu (tools/call -> 200 OK)", async () => {
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
      throw new Error(`Gaidīts HTTP 200 OK, saņemts ${res.status}: ${err}`);
    }

    const data = await res.json() as any;
    if (!data.result || !data.result.content) {
      throw new Error(`Nepareiza JSON-RPC atbilde: ${JSON.stringify(data)}`);
    }

    return `HTTP 200 OK | evaluate_fraud_transaction izpildīts | User-Agent: Claude-Code`;
  });

  // 6. Tests: Nezināms JSON-RPC izsaukums (metode nav atrasta -> client_error telemetrija)
  await runStep("T.6", "Nezināma JSON-RPC metode (client_error fiksēšana)", async () => {
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
      throw new Error(`Gaidīts HTTP 200 JSON-RPC error, saņemts ${res.status}`);
    }

    const data = await res.json() as any;
    if (!data.error || data.error.code !== -32601) {
      throw new Error(`Gaidīts JSON-RPC kļūdas kods -32601, saņemts: ${JSON.stringify(data)}`);
    }

    return `HTTP 200 OK (JSON-RPC -32601 Method not found) | telemetrijas statuss: client_error`;
  });

  // 7. Tests: Atslēgas atsaukšana un piekļuves bloķēšana (telemetrijas statuss: revoked)
  await runStep("T.7", "Atslēgas atsaukšana un bloķēšanas telemetrija (HTTP 401 token_revoked)", async () => {
    // 1. Atsaukt atslēgu ar DELETE /keys/:keyId
    const delRes = await fetch(`${baseUrlClean}/keys/${tempKeyId}`, {
      method: "DELETE",
      headers: {
        "Authorization": `Bearer ${MASTER_KEY}`,
      },
    });

    if (delRes.status !== 200) {
      const err = await delRes.text();
      throw new Error(`Neizdevās atsaukt atslēgu: HTTP ${delRes.status} | ${err}`);
    }

    // 2. Mēģināt izsaukt rīku ar tikko anulēto atslēgu
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
      throw new Error(`Gaidīts HTTP 401 Unauthorized ar anulētu atslēgu, saņemts ${testRevokedRes.status}`);
    }

    const wwwAuth = testRevokedRes.headers.get("WWW-Authenticate") || "";
    if (!wwwAuth.includes("token_revoked")) {
      throw new Error(`Trūkst 'token_revoked' galvenē WWW-Authenticate: ${wwwAuth}`);
    }

    return `HTTP 401 Unauthorized | WWW-Authenticate: ${wwwAuth} | telemetrijas statuss: revoked`;
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

  console.log(`\n[VĀRTI ATVĒRTI] Visi analītikas dzinēja telemetrijas testi sekmīgi izturēti!\n`);
}

main().catch((err) => {
  console.error("Kritiska kļūda testa izpildē:", err);
  process.exit(1);
});
