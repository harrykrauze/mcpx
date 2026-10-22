/**
 * scripts/test-client-connection.ts
 * 
 * Deterministisks Claude Code un Cursor MCP klienta savienojuma verifikācijas tests.
 * Pārbauda SSE roku spiedienu, ziņojumu galapunkta nolasīšanu un JSON-RPC 2.0 protokolu
 * (initialize, notifications/initialized, tools/list, tools/call) pret mcpx.harrykrauze.com.
 */

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
    console.error(`       Kļūda: ${err.message || String(err)}`);
    results.push({ step: code, name, status: "FAIL", error: err.message || String(err) });
  }
}

async function main() {
  console.log(`================================================================`);
  console.log(`  MCPX DETERMINISTISKS KLIENTA SAVIENOJUMA VERIFIKĀCIJAS TESTS  `);
  console.log(`  Mērķa vārteja: ${BASE_URL}`);
  console.log(`  Autentifikācija: Bearer ${API_KEY.slice(0, 14)}...`);
  console.log(`  Laika zīmogs: ${new Date().toISOString()}`);
  console.log(`================================================================\n`);

  let messageEndpointUrl = `${BASE_URL}/message`;

  // 1. Solis: SSE savienojuma izveide un roku spiediens
  await step("C.1", "SSE Rokasspiediens (GET /mcp/sse ar Bearer autentifikāciju)", async () => {
    const sseUrl = `${BASE_URL}/mcp/sse`;
    const res = await fetch(sseUrl, {
      method: "GET",
      headers: {
        "Accept": "text/event-stream",
        "Authorization": `Bearer ${API_KEY}`,
      },
      redirect: "manual",
    });

    if (res.status !== 200) {
      throw new Error(`Gaidīts HTTP 200 OK, saņemts ${res.status}`);
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/event-stream")) {
      throw new Error(`Nepareizs Content-Type: ${contentType}. Gaidīts text/event-stream`);
    }

    // Nolasām sākotnējo straumes daļu (SSE notikumu)
    const text = await res.text();
    const endpointMatch = text.match(/event:\s*endpoint\s*\ndata:\s*([^\n\r]+)/i);

    if (!endpointMatch || !endpointMatch[1]) {
      throw new Error(`SSE plūsmā netika atrasts 'endpoint' notikums. Saņemts: ${text.slice(0, 200)}`);
    }

    const rawEndpoint = endpointMatch[1].trim();
    if (rawEndpoint.startsWith("http://") || rawEndpoint.startsWith("https://")) {
      messageEndpointUrl = rawEndpoint;
    } else {
      messageEndpointUrl = new URL(rawEndpoint, BASE_URL).toString();
    }

    return `HTTP 200 OK | Content-Type: ${contentType} | Endpoint: ${messageEndpointUrl}`;
  });

  // 2. Solis: MCP Inicializācijas pieprasījums (JSON-RPC initialize)
  await step("C.2", "MCP Inicializācija (POST initialize uz ziņojumu galapunktu)", async () => {
    const payload = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "claude-code-verifier",
          version: "1.0.0",
        },
      },
    };

    const res = await fetch(messageEndpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(payload),
      redirect: "manual",
    });

    if (res.status !== 200) {
      throw new Error(`Gaidīts HTTP 200 OK, saņemts ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as any;
    if (data.jsonrpc !== "2.0" || data.id !== 1) {
      throw new Error(`Nederīga JSON-RPC atbilde: ${JSON.stringify(data)}`);
    }

    if (!data.result?.serverInfo?.name || data.result.serverInfo.name !== "mcpx") {
      throw new Error(`ServerInfo trūkst vai nepareizs: ${JSON.stringify(data.result?.serverInfo)}`);
    }

    return `Protokols: ${data.result.protocolVersion} | Serveris: ${data.result.serverInfo.name} v${data.result.serverInfo.version}`;
  });

  // 3. Solis: MCP Inicializācijas paziņojums (notifications/initialized)
  await step("C.3", "MCP Notifikācija (POST notifications/initialized)", async () => {
    const payload = {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    };

    const res = await fetch(messageEndpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(payload),
      redirect: "manual",
    });

    if (res.status !== 200 && res.status !== 204) {
      throw new Error(`Gaidīts HTTP 200 vai 204, saņemts ${res.status}`);
    }

    return `HTTP ${res.status} OK`;
  });

  // 4. Solis: MCP Rīku atklāšana (tools/list)
  await step("C.4", "MCP Rīku saraksta izgūšana (POST tools/list)", async () => {
    const payload = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    };

    const res = await fetch(messageEndpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(payload),
      redirect: "manual",
    });

    if (res.status !== 200) {
      throw new Error(`Gaidīts HTTP 200 OK, saņemts ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as any;
    if (data.jsonrpc !== "2.0" || data.id !== 2) {
      throw new Error(`Nederīga JSON-RPC atbilde: ${JSON.stringify(data)}`);
    }

    const tools = data.result?.tools;
    if (!Array.isArray(tools) || tools.length === 0) {
      throw new Error(`Rīku saraksts ir tukšs vai nav masīvs: ${JSON.stringify(tools)}`);
    }

    const toolNames = tools.map((t: any) => t.name);
    if (!toolNames.includes("generate_mcp_server")) {
      throw new Error(`Rīku sarakstā trūkst 'generate_mcp_server'! Pieejamie rīki: ${toolNames.join(", ")}`);
    }

    if (!toolNames.includes("evaluate_fraud_transaction")) {
      throw new Error(`Rīku sarakstā trūkst 'evaluate_fraud_transaction'! Pieejamie rīki: ${toolNames.join(", ")}`);
    }

    return `Atrasti ${tools.length} rīki: ${toolNames.join(", ")}`;
  });

  // 5. Solis: MCP Rīka izpildes tests (tools/call)
  await step("C.5", "MCP Rīka izsaukums (POST tools/call -> evaluate_fraud_transaction)", async () => {
    const payload = {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "evaluate_fraud_transaction",
        arguments: {
          amount: 150.0,
          currency: "EUR",
          userRiskScore: 0.05,
        },
      },
    };

    const res = await fetch(messageEndpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(payload),
      redirect: "manual",
    });

    if (res.status !== 200) {
      throw new Error(`Gaidīts HTTP 200 OK, saņemts ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as any;
    if (data.jsonrpc !== "2.0" || data.id !== 3) {
      throw new Error(`Nederīga JSON-RPC atbilde: ${JSON.stringify(data)}`);
    }

    const content = data.result?.content;
    if (!Array.isArray(content) || content.length === 0 || !content[0].text) {
      throw new Error(`Trūkst rīka izpildes rezultāta saturs: ${JSON.stringify(data.result)}`);
    }

    const parsedResult = JSON.parse(content[0].text);
    if (!parsedResult.decision) {
      throw new Error(`Trūkst lēmuma lauka rīka atbildē: ${content[0].text}`);
    }

    return `Lēmums: ${parsedResult.decision} | Riska līmenis: ${parsedResult.riskLevel} | Summa: ${parsedResult.amount} ${parsedResult.currency}`;
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
  console.error("Kritiska kļūda klienta verifikācijas izpildē:", err);
  process.exit(1);
});
