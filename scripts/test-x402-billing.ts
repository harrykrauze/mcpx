/**
 * scripts/test-x402-billing.ts
 * 
 * AHP GATE 3 (/test) — Sprint 3: x402 M2M Monetizācijas un Kredītu Bilances Verifikācijas Tests.
 * 
 * Verificē:
 *   [B.1] Atslēgas sagatavošana ar 3 centu bilanci (POST /keys/provision ar initialBalanceCents: 3)
 *   [B.2] Bezmaksas operācijas (tools/list -> 200 OK, bilance nemainās = 3 centi)
 *   [B.3] 1 centa rīks (evaluate_fraud_transaction -> 200 OK, bilance kļūst 2 centi)
 *   [B.4] 2 centu rīks (calculate_u_value_iso6946 -> 200 OK, bilance kļūst 0 centi, X-MCPX-Low-Balance: true)
 *   [B.5] x402 bloķēšana (analyze_jev_semantic_ast ar 0 bilanci -> HTTP 402 Payment Required, L402 galvenes)
 *   [B.6] Neautorizēta papildināšana (POST /keys/topup bez Master atslēgas -> HTTP 401 Unauthorized)
 *   [B.7] Master papildināšana (POST /keys/topup ar Master atslēgu par 500 centiem -> 200 OK, bilance = 500)
 *   [B.8] Izpildes atjaunošanās (generate_mcp_server ar maksu 5 centi -> 200 OK, bilance = 495)
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
    console.error(`       Kļūda: ${err.message || String(err)}`);
    results.push({ step: code, name, status: "FAIL", error: err.message || String(err) });
  }
}

async function main() {
  console.log(`================================================================`);
  console.log(`  AHP GATE 3: SPRINT 3 x402 M2M MONETIZĀCIJAS VERIFIKĀCIJA       `);
  console.log(`  Mērķa vārteja: ${BASE_URL}`);
  console.log(`  Laika zīmogs: ${new Date().toISOString()}`);
  console.log(`================================================================\n`);

  const baseUrlClean = BASE_URL.replace(/\/+$/, "");
  const messageUrl = `${baseUrlClean}/message`;

  let createdApiKey = "";
  let createdKeyId = "";
  const testTenant = `billing-test-${Math.floor(100000 + Math.random() * 900000)}`;

  // [B.1] Atslēgas sagatavošana ar fiksētu 3 centu bilanci
  await runStep("B.1", "Atslēgas sagatavošana (POST /keys/provision ar initialBalanceCents: 3)", async () => {
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
      throw new Error(`Neizdevās izveidot atslēgu (HTTP ${res.status}): ${errText}`);
    }

    const data = (await res.json()) as any;
    if (!data.apiKey || !data.keyId) {
      throw new Error("Trūkst apiKey vai keyId atbildē");
    }

    createdApiKey = data.apiKey;
    createdKeyId = data.keyId;

    if (!data.billing || data.billing.balanceCents !== 3) {
      throw new Error(`Gaidīta bilance 3 centi, saņemts: ${JSON.stringify(data.billing)}`);
    }

    return `Izveidota atslēga ${createdApiKey.slice(0, 14)}... ar keyId: ${createdKeyId} | Sākotnējā bilance: $${(data.billing.balanceCents / 100).toFixed(2)} (${data.billing.balanceCents} c)`;
  });

  // [B.2] Bezmaksas operācijas (tools/list)
  await runStep("B.2", "Bezmaksas operācijas (tools/list -> 200 OK, bilance nemainās = 3 c)", async () => {
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
      throw new Error(`tools/list kļūda (HTTP ${listRes.status}): ${errText}`);
    }

    const listData = (await listRes.json()) as any;
    if (!listData.result?.tools || !Array.isArray(listData.result.tools)) {
      throw new Error(`tools/list neatgrieza derīgu rīku sarakstu: ${JSON.stringify(listData)}`);
    }

    // Pārbaudām statusu un bilanci caur /keys/status
    const statusRes = await fetch(`${baseUrlClean}/keys/status`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${createdApiKey}`,
      },
    });

    if (statusRes.status !== 200) {
      throw new Error(`GET /keys/status kļūda (HTTP ${statusRes.status})`);
    }

    const statusData = (await statusRes.json()) as any;
    if (statusData.billing?.balanceCents !== 3) {
      throw new Error(`tools/list atskaitīja kredītus! Bilance ir ${statusData.billing?.balanceCents}, gaidīta 3`);
    }

    return `tools/list sekmīgs (pieejami ${listData.result.tools.length} rīki) | Bilance paliek nemainīga: $0.03 (3 c)`;
  });

  // [B.3] 1 centa rīka izsaukums (evaluate_fraud_transaction)
  await runStep("B.3", "1 centa rīks (evaluate_fraud_transaction -> 200 OK, bilance kļūst 2 c)", async () => {
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
      throw new Error(`tools/call kļūda (HTTP ${callRes.status}): ${errText}`);
    }

    const balanceHeader = callRes.headers.get("X-MCPX-Balance-Cents");
    if (balanceHeader !== "2") {
      throw new Error(`Gaidīta galvene X-MCPX-Balance-Cents: 2, saņemts: '${balanceHeader}'`);
    }

    const callData = (await callRes.json()) as any;
    if (callData.error) {
      throw new Error(`JSON-RPC kļūda: ${JSON.stringify(callData.error)}`);
    }

    return `evaluate_fraud_transaction izpildīts (maksa 1 c) | X-MCPX-Balance-Cents: ${balanceHeader}`;
  });

  // [B.4] 2 centu rīka izsaukums (calculate_u_value_iso6946)
  await runStep("B.4", "2 centu rīks (calculate_u_value_iso6946 -> 200 OK, bilance kļūst 0 c, Low-Balance)", async () => {
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
      throw new Error(`tools/call kļūda (HTTP ${callRes.status}): ${errText}`);
    }

    const balanceHeader = callRes.headers.get("X-MCPX-Balance-Cents");
    const lowBalanceHeader = callRes.headers.get("X-MCPX-Low-Balance");

    if (balanceHeader !== "0") {
      throw new Error(`Gaidīta galvene X-MCPX-Balance-Cents: 0, saņemts: '${balanceHeader}'`);
    }

    if (lowBalanceHeader !== "true") {
      throw new Error(`Gaidīta galvene X-MCPX-Low-Balance: true, saņemts: '${lowBalanceHeader}'`);
    }

    return `calculate_u_value_iso6946 izpildīts (maksa 2 c) | Bilance: 0 c | X-MCPX-Low-Balance: ${lowBalanceHeader}`;
  });

  // [B.5] x402 bloķēšana pie 0 bilances (analyze_jev_semantic_ast)
  await runStep("B.5", "x402 bloķēšana (analyze_jev_semantic_ast ar 0 bilanci -> HTTP 402, L402 galvenes)", async () => {
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
      throw new Error(`Gaidīts HTTP 402 Payment Required, saņemts ${callRes.status}: ${body}`);
    }

    const authHeader = callRes.headers.get("WWW-Authenticate") || "";
    const balanceHeader = callRes.headers.get("X-MCPX-Balance-Cents");
    const requiredHeader = callRes.headers.get("X-MCPX-Required-Cents");
    const tenantHeader = callRes.headers.get("X-MCPX-Tenant");

    if (!authHeader.includes("L402") || !authHeader.includes("invoice=")) {
      throw new Error(`Trūkst derīgas WWW-Authenticate L402 galvenes: '${authHeader}'`);
    }

    if (balanceHeader !== "0") {
      throw new Error(`Gaidīta X-MCPX-Balance-Cents: 0, saņemts: '${balanceHeader}'`);
    }

    if (requiredHeader !== "1") {
      throw new Error(`Gaidīta X-MCPX-Required-Cents: 1, saņemts: '${requiredHeader}'`);
    }

    if (tenantHeader !== testTenant) {
      throw new Error(`Gaidīts X-MCPX-Tenant: ${testTenant}, saņemts: '${tenantHeader}'`);
    }

    const json = (await callRes.json()) as any;
    if (json.error?.code !== 402) {
      throw new Error(`Gaidīts JSON-RPC error.code 402, saņemts: ${JSON.stringify(json.error)}`);
    }

    return `Pārtverts HTTP 402 Payment Required | L402 invoice piesaistīts | code: ${json.error.code}`;
  });

  // [B.6] Neautorizēta bilances papildināšana (POST /keys/topup bez Master)
  await runStep("B.6", "Neautorizēta papildināšana (POST /keys/topup bez Master atslēgas -> HTTP 401)", async () => {
    const topupRes = await fetch(`${baseUrlClean}/keys/topup`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${createdApiKey}`, // Nomnieka atslēga, nevis Master
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        keyId: createdKeyId,
        amountCents: 500,
      }),
    });

    if (topupRes.status !== 401 && topupRes.status !== 403) {
      const body = await topupRes.text();
      throw new Error(`Gaidīts HTTP 401 vai 403, saņemts ${topupRes.status}: ${body}`);
    }

    return `Perimetra aizsardzība aktīva (HTTP ${topupRes.status} Unauthorized / Forbidden)`;
  });

  // [B.7] Master kredītu papildināšana (POST /keys/topup ar Master)
  await runStep("B.7", "Master papildināšana (POST /keys/topup par 500 centiem -> 200 OK, bilance = 500 c)", async () => {
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
      throw new Error(`Topup neizdevās (HTTP ${topupRes.status}): ${errText}`);
    }

    const data = (await topupRes.json()) as any;
    if (data.billing?.balanceCents !== 500) {
      throw new Error(`Gaidīta bilance 500 centi, saņemts: ${data.billing?.balanceCents}`);
    }

    return `Papildināts par $${(data.addedCents / 100).toFixed(2)} (${data.addedCents} c) | Jaunā bilance: $${(data.billing.balanceCents / 100).toFixed(2)} (${data.billing.balanceCents} c)`;
  });

  // [B.8] Izpildes atjaunošanās ar maksas rīku (generate_mcp_server, maksa 5 centi)
  await runStep("B.8", "Izpildes atjaunošanās (generate_mcp_server ar maksu 5 c -> 200 OK, bilance = 495 c)", async () => {
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
      throw new Error(`tools/call kļūda pēc papildināšanas (HTTP ${callRes.status}): ${errText}`);
    }

    const balanceHeader = callRes.headers.get("X-MCPX-Balance-Cents");
    if (balanceHeader !== "495") {
      throw new Error(`Gaidīta galvene X-MCPX-Balance-Cents: 495, saņemts: '${balanceHeader}'`);
    }

    const callData = (await callRes.json()) as any;
    if (callData.error) {
      throw new Error(`JSON-RPC kļūda: ${JSON.stringify(callData.error)}`);
    }

    return `generate_mcp_server veiksmīgi izpildīts (maksa 5 c) | Bilance: $${(Number(balanceHeader) / 100).toFixed(2)} (${balanceHeader} c)`;
  });

  // Sakopšana (Cleanup)
  if (createdKeyId) {
    try {
      await fetch(`${baseUrlClean}/keys/${createdKeyId}`, {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${MASTER_KEY}`,
        },
      });
    } catch {
      // Ignorējam sakopšanas kļūdas
    }
  }

  // Kopsavilkums
  console.log(`\n================================================================`);
  console.log(`                      TESTU KOPSAVILKUMS                        `);
  console.log(`================================================================`);
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  console.log(`Kopā soļi:    ${results.length}`);
  console.log(`Veiksmīgi:    ${passed}`);
  console.log(`Neveiksmīgi:  ${failed}\n`);

  if (failed > 0) {
    console.error(`[VĀRTI SLĒGTI] ${failed} tests(-i) izgāzās!`);
    process.exit(1);
  } else {
    console.log(`[VĀRTI ATVĒRTI] Visi x402 M2M monetizācijas un bilances testi sekmīgi izturēti!`);
  }
}

main().catch((err) => {
  console.error("Kritiska kļūda testu izpildē:", err);
  process.exit(1);
});
