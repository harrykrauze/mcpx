/**
 * test/dashboard-and-verify.test.ts
 * 
 * Verification suite for Midnight Gourmet Status Page, Content Negotiation,
 * self-service endpoint POST /keys/verify, and llms.txt endpoints.
 */

import workerDefault from "../src/index";
import { Env, ExecutionContext, ApiKeyRecord, KVNamespace } from "../src/auth";

class MockKV implements KVNamespace {
  private store = new Map<string, string>();

  async get(key: string, type?: "text"): Promise<string | null>;
  async get<ExpectedValue = unknown>(key: string, type: "json"): Promise<ExpectedValue | null>;
  async get(key: string, type: "text" | "json" = "text"): Promise<any> {
    const val = this.store.get(key);
    if (!val) return null;
    if (type === "json") {
      try {
        return JSON.parse(val);
      } catch {
        return null;
      }
    }
    return val;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(options?: { prefix?: string }): Promise<{ keys: Array<{ name: string }>; list_complete: boolean }> {
    const prefix = options?.prefix || "";
    const keys: Array<{ name: string }> = [];
    for (const k of this.store.keys()) {
      if (k.startsWith(prefix)) {
        keys.push({ name: k });
      }
    }
    return { keys, list_complete: true };
  }
}

function createMockCtx(): ExecutionContext {
  return {
    waitUntil(_p: Promise<unknown>) {},
    passThroughOnException() {},
  };
}

async function run() {
  console.log(`================================================================`);
  console.log(`  MIDNIGHT GOURMET DASHBOARD & KEYS/VERIFY VERIFICATION         `);
  console.log(`  Timestamp: ${new Date().toISOString()}`);
  console.log(`================================================================\n`);

  const kv = new MockKV();
  const env: Env = {
    GEMINI_API_KEY: "fake_gemini",
    MCPX_KEYS: kv,
  };
  const ctx = createMockCtx();

  let pass = 0;
  let fail = 0;

  async function testStep(name: string, fn: () => Promise<void>) {
    process.stdout.write(`[*] ${name}... `);
    try {
      await fn();
      console.log("PASS");
      pass++;
    } catch (err: any) {
      console.log("FAIL");
      console.error(`    ${err.message || String(err)}`);
      fail++;
    }
  }

  // 1. Content Negotiation: Accept: text/html -> Midnight Gourmet HTML
  await testStep("Content Negotiation (Accept: text/html -> HTML dashboard)", async () => {
    const req = new Request("https://mcpx.harrykrauze.com/", {
      method: "GET",
      headers: { "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9" },
    });
    const res = await workerDefault.fetch(req, env, ctx);
    if (res.status !== 200) throw new Error(`HTTP status is not 200: ${res.status}`);
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) throw new Error(`Invalid Content-Type: ${contentType}`);
    const cacheControl = res.headers.get("cache-control") || "";
    if (!cacheControl.includes("public")) throw new Error(`Invalid Cache-Control: ${cacheControl}`);

    const html = await res.text();
    if (!html.includes("Edge V8 Mesh Active")) {
      throw new Error(`HTML missing 'Edge V8 Mesh Active' badge!`);
    }
    if (!html.includes("checkBalance")) {
      throw new Error(`HTML missing checkBalance() JavaScript function!`);
    }
    if (!html.includes('lang="en"')) {
      throw new Error(`HTML missing lang="en"!`);
    }
    if (!html.includes("Verify API Key Balance")) {
      throw new Error(`HTML missing 'Verify API Key Balance'!`);
    }
    if (!html.includes("Free ($0.00)")) {
      throw new Error(`HTML missing 'Free ($0.00)' discovery rate!`);
    }
    if (!html.includes("$0.01 (1 credit)")) {
      throw new Error(`HTML missing '$0.01 (1 credit)' rate!`);
    }
    if (!html.includes("$0.02 (2 credits)")) {
      throw new Error(`HTML missing '$0.02 (2 credits)' rate!`);
    }
    if (!html.includes("$0.05 (5 credits)")) {
      throw new Error(`HTML missing '$0.05 (5 credits)' rate!`);
    }
    if (html.includes("/ 1 c") || html.includes("/ 2 c") || html.includes("/ 5 c")) {
      throw new Error(`HTML still contains redundant '/ X c' annotation!`);
    }
    if (!html.includes("currency=USD")) {
      throw new Error(`HTML missing 'currency=USD' checkout parameter!`);
    }
    if (!html.includes("Privacy Policy") || !html.includes("https://harrykrauze.com/privacy")) {
      throw new Error(`HTML missing Privacy Policy link with valid target!`);
    }
    if (!html.includes("Terms of Service") || !html.includes("https://harrykrauze.com/terms")) {
      throw new Error(`HTML missing Terms of Service link with valid target!`);
    }
    if (!html.includes("support@harrykrauze.com") || !html.includes("mailto:support@harrykrauze.com")) {
      throw new Error(`HTML missing support@harrykrauze.com mailto link!`);
    }
    if (!html.includes('rel="noopener noreferrer"')) {
      throw new Error(`HTML legal links missing rel="noopener noreferrer"!`);
    }
  });

  // 2. Content Negotiation: Accept: application/json -> JSON healthData
  await testStep("Content Negotiation (Accept: application/json -> JSON healthData)", async () => {
    const req = new Request("https://mcpx.harrykrauze.com/", {
      method: "GET",
      headers: { "Accept": "application/json" },
    });
    const res = await workerDefault.fetch(req, env, ctx);
    if (res.status !== 200) throw new Error(`HTTP status is not 200: ${res.status}`);
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) throw new Error(`Invalid Content-Type: ${contentType}`);
    const cacheControl = res.headers.get("cache-control") || "";
    if (!cacheControl.includes("no-store")) throw new Error(`Invalid Cache-Control: ${cacheControl}`);

    const json = (await res.json()) as any;
    if (json.status !== "healthy") {
      throw new Error(`JSON missing status: healthy: ${JSON.stringify(json)}`);
    }
  });

  // 3. /health path always returns JSON even with Accept: text/html
  await testStep("GET /health always returns JSON even with Accept: text/html", async () => {
    const req = new Request("https://mcpx.harrykrauze.com/health", {
      method: "GET",
      headers: { "Accept": "text/html" },
    });
    const res = await workerDefault.fetch(req, env, ctx);
    if (res.status !== 200) throw new Error(`HTTP status is not 200: ${res.status}`);
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) throw new Error(`Expected JSON, received: ${contentType}`);
  });

  // 4. POST /keys/verify without key -> 400 Bad Request
  await testStep("POST /keys/verify without parameters -> HTTP 400", async () => {
    const req = new Request("https://mcpx.harrykrauze.com/keys/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await workerDefault.fetch(req, env, ctx);
    if (res.status !== 400) throw new Error(`Expected 400, received ${res.status}`);
  });

  // 5. POST /keys/verify with non-existent key -> 404 Not Found
  await testStep("POST /keys/verify with non-existent key -> HTTP 404", async () => {
    const req = new Request("https://mcpx.harrykrauze.com/keys/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "mcpx_live_non_existent_key_999" }),
    });
    const res = await workerDefault.fetch(req, env, ctx);
    if (res.status !== 404) throw new Error(`Expected 404, received ${res.status}`);
  });

  // 6. POST /keys/verify with valid key -> 200 OK and balance data
  await testStep("POST /keys/verify with valid key -> HTTP 200 with balance", async () => {
    const testRecord: ApiKeyRecord = {
      keyId: "key_verify_test_01",
      userId: "user_dashboard",
      tenantId: "tenant_dashboard",
      plan: "pro",
      status: "active",
      billing: {
        mode: "prepaid",
        balanceCents: 450,
        currency: "USD",
        costPerToolCallCents: 1,
        costPerGenerateCents: 5,
        totalSpentCents: 50,
        lowBalanceThresholdCents: 10,
      },
    };
    await kv.put("key:mcpx_live_dashboard_key_01", JSON.stringify(testRecord));
    await kv.put("id:key_verify_test_01", "mcpx_live_dashboard_key_01");

    const req = new Request("https://mcpx.harrykrauze.com/keys/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "mcpx_live_dashboard_key_01" }),
    });

    const res = await workerDefault.fetch(req, env, ctx);
    if (res.status !== 200) throw new Error(`Expected 200, received ${res.status}`);
    const data = (await res.json()) as any;
    if (data.keyId !== "key_verify_test_01") throw new Error(`Invalid keyId: ${data.keyId}`);
    if (data.balanceCents !== 450) throw new Error(`Invalid balanceCents: ${data.balanceCents}`);
    if (data.totalSpentCents !== 50) throw new Error(`Invalid totalSpentCents: ${data.totalSpentCents}`);
    if (data.status !== "active") throw new Error(`Invalid status: ${data.status}`);
    if (data.currency !== "USD") throw new Error(`Invalid currency: ${data.currency}`);
  });

  // 7. POST /keys/verify with keyId
  await testStep("POST /keys/verify with keyId lookup -> HTTP 200", async () => {
    const req = new Request("https://mcpx.harrykrauze.com/keys/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyId: "key_verify_test_01" }),
    });
    const res = await workerDefault.fetch(req, env, ctx);
    if (res.status !== 200) throw new Error(`Expected 200, received ${res.status}`);
    const data = (await res.json()) as any;
    if (data.balanceCents !== 450) throw new Error(`Invalid balanceCents: ${data.balanceCents}`);
  });

  // 8. POST / direct MCP JSON-RPC routing (tools/list)
  await testStep("POST / direct MCP JSON-RPC routing (tools/list) -> HTTP 200", async () => {
    const req = new Request("https://mcpx.harrykrauze.com/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer mcpx_live_dashboard_key_01",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 801,
        method: "tools/list",
      }),
    });
    const res = await workerDefault.fetch(req, env, ctx);
    if (res.status !== 200) throw new Error(`Expected 200, received ${res.status}`);
    const data = (await res.json()) as any;
    if (!data.result || !Array.isArray(data.result.tools)) {
      throw new Error(`tools/list response missing tools array: ${JSON.stringify(data)}`);
    }
  });

  // 9. Tool alias execution: inspect_ast -> analyze_jev_semantic_ast via POST /
  await testStep("Tool alias inspect_ast via POST / -> HTTP 200 and SAFE verdict", async () => {
    const req = new Request("https://mcpx.harrykrauze.com/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer mcpx_live_dashboard_key_01",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 901,
        method: "tools/call",
        params: {
          name: "inspect_ast",
          arguments: {
            code: "const x: number = 42;",
          },
        },
      }),
    });
    const res = await workerDefault.fetch(req, env, ctx);
    if (res.status !== 200) throw new Error(`Expected 200, received ${res.status}`);
    const balanceHeader = res.headers.get("X-MCPX-Balance-Cents");
    if (balanceHeader !== "449") {
      throw new Error(`Expected remaining balance 449 c (1 c deducted), received '${balanceHeader}'`);
    }
    const data = (await res.json()) as any;
    if (!data.result || !Array.isArray(data.result.content)) {
      throw new Error(`tools/call response missing content: ${JSON.stringify(data)}`);
    }
    const parsedText = JSON.parse(data.result.content[0].text);
    if (parsedText.verdict !== "SAFE") {
      throw new Error(`Expected 'SAFE', received: ${parsedText.verdict}`);
    }
  });

  // 10. GET /llms.txt
  await testStep("GET /llms.txt returns machine-readable spec with tools and pricing", async () => {
    const req = new Request("https://mcpx.harrykrauze.com/llms.txt", { method: "GET" });
    const res = await workerDefault.fetch(req, env, ctx);
    if (res.status !== 200) throw new Error(`Expected 200, received ${res.status}`);
    const ct = res.headers.get("Content-Type") || "";
    if (!ct.includes("text/markdown") && !ct.includes("text/plain")) {
      throw new Error(`Expected markdown or plain text, received: ${ct}`);
    }
    const text = await res.text();
    if (!text.includes("evaluate_fraud_transaction") || !text.includes("analyze_jev_semantic_ast")) {
      throw new Error("llms.txt does not contain core tools");
    }
    if (!text.includes("claude_desktop_config.json") || !text.includes(".cursor/mcp.json")) {
      throw new Error("llms.txt does not contain client configuration profiles");
    }
  });

  // 11. GET /llms-full.txt
  await testStep("GET /llms-full.txt returns extended spec with input schemas", async () => {
    const req = new Request("https://mcpx.harrykrauze.com/llms-full.txt", { method: "GET" });
    const res = await workerDefault.fetch(req, env, ctx);
    if (res.status !== 200) throw new Error(`Expected 200, received ${res.status}`);
    const ct = res.headers.get("Content-Type") || "";
    if (!ct.includes("text/markdown") && !ct.includes("text/plain")) {
      throw new Error(`Expected markdown or plain text, received: ${ct}`);
    }
    const text = await res.text();
    if (!text.includes("Detailed Tool Input Scheemas") && !text.includes("calculate_u_value_iso6946")) {
      throw new Error("llms-full.txt does not contain detailed schemas");
    }
  });

  // 12. GET /mcp/sse
  await testStep("GET /mcp/sse returns SSE stream with 'event: endpoint'", async () => {
    const req = new Request("https://mcpx.harrykrauze.com/mcp/sse", {
      method: "GET",
      headers: { "Accept": "text/event-stream" },
    });
    const res = await workerDefault.fetch(req, env, ctx);
    if (res.status !== 200) throw new Error(`Expected 200, received ${res.status}`);
    const ct = res.headers.get("Content-Type") || "";
    if (!ct.includes("text/event-stream")) throw new Error(`Expected text/event-stream, received ${ct}`);
    const body = await res.text();
    if (!body.includes("event: endpoint") || !body.includes("data: /message")) {
      throw new Error(`Unexpected SSE body: ${body}`);
    }
  });

  // 13. POST /tools/execute
  await testStep("POST /tools/execute direct REST execution for tool ast_check", async () => {
    const req = new Request("https://mcpx.harrykrauze.com/tools/execute", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer mcpx_live_dashboard_key_01",
      },
      body: JSON.stringify({
        tool: "ast_check",
        parameters: {
          code: "console.log('clean code');",
          filename: "test.ts",
        },
      }),
    });
    const res = await workerDefault.fetch(req, env, ctx);
    if (res.status !== 200) throw new Error(`Expected 200, received ${res.status}`);
    const data = (await res.json()) as any;
    if (data.success !== true || data.valid !== true || data.verdict !== "SAFE") {
      throw new Error(`Unexpected result from /tools/execute: ${JSON.stringify(data)}`);
    }
    const balanceHdr = res.headers.get("X-MCPX-Balance-Cents");
    if (!balanceHdr) throw new Error("Missing X-MCPX-Balance-Cents header");
  });

  console.log(`\n================================================================`);
  console.log(`Result: ${pass} passed, ${fail} failed`);
  console.log(`================================================================`);

  if (fail > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Crash:", err);
  process.exit(1);
});
