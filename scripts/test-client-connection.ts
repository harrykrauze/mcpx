/**
 * scripts/test-client-connection.ts
 * 
 * Deterministic Claude Code and Cursor MCP client connection verification test.
 * Verifies SSE handshake, message endpoint discovery, and JSON-RPC 2.0 lifecycle
 * (initialize, notifications/initialized, tools/list, tools/call) against mcpx.harrykrauze.com.
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
    console.error(`       Error: ${err.message || String(err)}`);
    results.push({ step: code, name, status: "FAIL", error: err.message || String(err) });
  }
}

async function main() {
  console.log(`================================================================`);
  console.log(`  MCPX DETERMINISTIC CLIENT CONNECTION VERIFICATION TEST        `);
  console.log(`  Target Gateway: ${BASE_URL}`);
  console.log(`  Authentication: Bearer ${API_KEY.slice(0, 14)}...`);
  console.log(`  Timestamp: ${new Date().toISOString()}`);
  console.log(`================================================================\n`);

  let messageEndpointUrl = `${BASE_URL}/message`;

  // Step 1: SSE handshake and endpoint discovery
  await step("C.1", "SSE Handshake (GET /mcp/sse with Bearer authentication)", async () => {
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
      throw new Error(`Expected HTTP 200 OK, received ${res.status}`);
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/event-stream")) {
      throw new Error(`Invalid Content-Type: ${contentType}. Expected text/event-stream`);
    }

    // Read initial stream body (SSE endpoint event)
    const text = await res.text();
    const endpointMatch = text.match(/event:\s*endpoint\s*\ndata:\s*([^\n\r]+)/i);

    if (!endpointMatch || !endpointMatch[1]) {
      throw new Error(`SSE stream missing 'endpoint' event. Received: ${text.slice(0, 200)}`);
    }

    const rawEndpoint = endpointMatch[1].trim();
    if (rawEndpoint.startsWith("http://") || rawEndpoint.startsWith("https://")) {
      messageEndpointUrl = rawEndpoint;
    } else {
      messageEndpointUrl = new URL(rawEndpoint, BASE_URL).toString();
    }

    return `HTTP 200 OK | Content-Type: ${contentType} | Endpoint: ${messageEndpointUrl}`;
  });

  // Step 2: MCP Initialization request (JSON-RPC initialize)
  await step("C.2", "MCP Initialization (POST initialize to message endpoint)", async () => {
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
      throw new Error(`Expected HTTP 200 OK, received ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as any;
    if (data.jsonrpc !== "2.0" || data.id !== 1) {
      throw new Error(`Invalid JSON-RPC response: ${JSON.stringify(data)}`);
    }

    if (!data.result?.serverInfo?.name || data.result.serverInfo.name !== "mcpx") {
      throw new Error(`ServerInfo missing or invalid: ${JSON.stringify(data.result?.serverInfo)}`);
    }

    return `Protocol: ${data.result.protocolVersion} | Server: ${data.result.serverInfo.name} v${data.result.serverInfo.version}`;
  });

  // Step 3: MCP Initialized notification (notifications/initialized)
  await step("C.3", "MCP Notification (POST notifications/initialized)", async () => {
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
      throw new Error(`Expected HTTP 200 or 204, received ${res.status}`);
    }

    return `HTTP ${res.status} OK`;
  });

  // Step 4: MCP Tools discovery (tools/list)
  await step("C.4", "MCP Tools list query (POST tools/list)", async () => {
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
      throw new Error(`Expected HTTP 200 OK, received ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as any;
    if (data.jsonrpc !== "2.0" || data.id !== 2) {
      throw new Error(`Invalid JSON-RPC response: ${JSON.stringify(data)}`);
    }

    const tools = data.result?.tools;
    if (!Array.isArray(tools) || tools.length === 0) {
      throw new Error(`Tools list is empty or not an array: ${JSON.stringify(tools)}`);
    }

    const toolNames = tools.map((t: any) => t.name);
    if (!toolNames.includes("generate_mcp_server")) {
      throw new Error(`Tools list missing 'generate_mcp_server'! Available: ${toolNames.join(", ")}`);
    }

    if (!toolNames.includes("evaluate_fraud_transaction")) {
      throw new Error(`Tools list missing 'evaluate_fraud_transaction'! Available: ${toolNames.join(", ")}`);
    }

    return `Found ${tools.length} tools: ${toolNames.join(", ")}`;
  });

  // Step 5: MCP Tool execution test (tools/call)
  await step("C.5", "MCP Tool execution (POST tools/call -> evaluate_fraud_transaction)", async () => {
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
      throw new Error(`Expected HTTP 200 OK, received ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as any;
    if (data.jsonrpc !== "2.0" || data.id !== 3) {
      throw new Error(`Invalid JSON-RPC response: ${JSON.stringify(data)}`);
    }

    const content = data.result?.content;
    if (!Array.isArray(content) || content.length === 0 || !content[0].text) {
      throw new Error(`Missing tool execution content: ${JSON.stringify(data.result)}`);
    }

    const parsedResult = JSON.parse(content[0].text);
    if (!parsedResult.decision) {
      throw new Error(`Missing decision field in tool response: ${content[0].text}`);
    }

    return `Decision: ${parsedResult.decision} | Risk Level: ${parsedResult.riskLevel} | Amount: ${parsedResult.amount} ${parsedResult.currency}`;
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
  console.error("Critical error during client verification execution:", err);
  process.exit(1);
});
