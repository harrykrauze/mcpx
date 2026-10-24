/**
 * test/dashboard-and-verify.test.ts
 * 
 * Verifikācija Midnight Gourmet Statusa Lapai, Satura Saskaņošanai (Content Negotiation)
 * un Pašapkalpošanās Galapunktam POST /keys/verify.
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
  console.log(`  MIDNIGHT GOURMET DASHBOARD & KEYS/VERIFY VERIFIKĀCIJA         `);
  console.log(`  Laika zīmogs: ${new Date().toISOString()}`);
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

  // 1. Satura saskaņošana: Accept: text/html -> Midnight Gourmet HTML
  await testStep("Content Negotiation (Accept: text/html -> HTML dashboard)", async () => {
    const req = new Request("https://mcpx.harrykrauze.com/", {
      method: "GET",
      headers: { "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9" },
    });
    const res = await workerDefault.fetch(req, env, ctx);
    if (res.status !== 200) throw new Error(`HTTP statuss nav 200: ${res.status}`);
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) throw new Error(`Nepareizs Content-Type: ${contentType}`);
    const cacheControl = res.headers.get("cache-control") || "";
    if (!cacheControl.includes("public")) throw new Error(`Nepareizs Cache-Control: ${cacheControl}`);

    const html = await res.text();
    if (!html.includes("Edge V8 Mesh Active")) {
      throw new Error(`HTML nesatur 'Edge V8 Mesh Active' birku!`);
    }
    if (!html.includes("checkBalance")) {
      throw new Error(`HTML nesatur checkBalance() JavaScript funkciju!`);
    }
    if (!html.includes('lang="en"')) {
      throw new Error(`HTML nesatur lang="en"!`);
    }
    if (!html.includes("Verify API Key Balance")) {
      throw new Error(`HTML nesatur 'Verify API Key Balance'!`);
    }
    if (!html.includes("Free ($0.00)")) {
      throw new Error(`HTML nesatur 'Free ($0.00)' Discovery likmi!`);
    }
    if (!html.includes("$0.01 (1 credit)")) {
      throw new Error(`HTML nesatur '$0.01 (1 credit)' tarifu!`);
    }
    if (!html.includes("$0.02 (2 credits)")) {
      throw new Error(`HTML nesatur '$0.02 (2 credits)' tarifu!`);
    }
    if (!html.includes("$0.05 (5 credits)")) {
      throw new Error(`HTML nesatur '$0.05 (5 credits)' tarifu!`);
    }
    if (html.includes("/ 1 c") || html.includes("/ 2 c") || html.includes("/ 5 c")) {
      throw new Error(`HTML joprojām satur lieko '/ X c' anotāciju!`);
    }
    if (!html.includes("currency=USD")) {
      throw new Error(`HTML nesatur 'currency=USD' checkout parametru!`);
    }
    if (!html.includes("Privacy Policy") || !html.includes("https://harrykrauze.com/privacy")) {
      throw new Error(`HTML nesatur Privacy Policy saiti ar pareizu adresi!`);
    }
    if (!html.includes("Terms of Service") || !html.includes("https://harrykrauze.com/terms")) {
      throw new Error(`HTML nesatur Terms of Service saiti ar pareizu adresi!`);
    }
    if (!html.includes("support@harrykrauze.com") || !html.includes("mailto:support@harrykrauze.com")) {
      throw new Error(`HTML nesatur support@harrykrauze.com mailto saiti!`);
    }
    if (!html.includes('rel="noopener noreferrer"')) {
      throw new Error(`HTML juridiskās saites nesatur rel="noopener noreferrer"!`);
    }
  });

  // 2. Satura saskaņošana: Accept: application/json -> JSON healthData
  await testStep("Content Negotiation (Accept: application/json -> JSON healthData)", async () => {
    const req = new Request("https://mcpx.harrykrauze.com/", {
      method: "GET",
      headers: { "Accept": "application/json" },
    });
    const res = await workerDefault.fetch(req, env, ctx);
    if (res.status !== 200) throw new Error(`HTTP statuss nav 200: ${res.status}`);
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) throw new Error(`Nepareizs Content-Type: ${contentType}`);
    const cacheControl = res.headers.get("cache-control") || "";
    if (!cacheControl.includes("no-store")) throw new Error(`Nepareizs Cache-Control: ${cacheControl}`);

    const json = (await res.json()) as any;
    if (json.status !== "healthy") {
      throw new Error(`JSON nesatur status: healthy: ${JSON.stringify(json)}`);
    }
  });

  // 3. /health ceļš vienmēr atgriež JSON pat ar Accept: text/html
  await testStep("GET /health vienmēr atgriež JSON", async () => {
    const req = new Request("https://mcpx.harrykrauze.com/health", {
      method: "GET",
      headers: { "Accept": "text/html" },
    });
    const res = await workerDefault.fetch(req, env, ctx);
    if (res.status !== 200) throw new Error(`HTTP statuss nav 200: ${res.status}`);
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) throw new Error(`Gaidīts JSON, saņemts: ${contentType}`);
  });

  // 4. POST /keys/verify bez atslēgas -> 400 Bad Request
  await testStep("POST /keys/verify bez parametriem -> HTTP 400", async () => {
    const req = new Request("https://mcpx.harrykrauze.com/keys/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await workerDefault.fetch(req, env, ctx);
    if (res.status !== 400) throw new Error(`Gaidīts 400, saņemts ${res.status}`);
  });

  // 5. POST /keys/verify ar neeksistējošu atslēgu -> 404 Not Found
  await testStep("POST /keys/verify neeksistējoša atslēga -> HTTP 404", async () => {
    const req = new Request("https://mcpx.harrykrauze.com/keys/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "mcpx_live_non_existent_key_999" }),
    });
    const res = await workerDefault.fetch(req, env, ctx);
    if (res.status !== 404) throw new Error(`Gaidīts 404, saņemts ${res.status}`);
  });

  // 6. POST /keys/verify ar derīgu atslēgu -> 200 OK un bilances dati
  await testStep("POST /keys/verify ar derīgu atslēgu -> HTTP 200 ar bilanci", async () => {
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
    if (res.status !== 200) throw new Error(`Gaidīts 200, saņemts ${res.status}`);
    const data = (await res.json()) as any;
    if (data.keyId !== "key_verify_test_01") throw new Error(`Nepareizs keyId: ${data.keyId}`);
    if (data.balanceCents !== 450) throw new Error(`Nepareizs balanceCents: ${data.balanceCents}`);
    if (data.totalSpentCents !== 50) throw new Error(`Nepareizs totalSpentCents: ${data.totalSpentCents}`);
    if (data.status !== "active") throw new Error(`Nepareizs status: ${data.status}`);
    if (data.currency !== "USD") throw new Error(`Nepareiza valūta: ${data.currency}`);
  });

  // 7. POST /keys/verify ar keyId
  await testStep("POST /keys/verify ar keyId meklēšanu -> HTTP 200", async () => {
    const req = new Request("https://mcpx.harrykrauze.com/keys/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyId: "key_verify_test_01" }),
    });
    const res = await workerDefault.fetch(req, env, ctx);
    if (res.status !== 200) throw new Error(`Gaidīts 200, saņemts ${res.status}`);
    const data = (await res.json()) as any;
    if (data.balanceCents !== 450) throw new Error(`Nepareizs balanceCents: ${data.balanceCents}`);
  });

  // 8. POST / tiešais MCP ziņojumu maršruts (tools/list)
  await testStep("POST / tiešā MCP JSON-RPC maršrutēšana (tools/list) -> HTTP 200", async () => {
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
    if (res.status !== 200) throw new Error(`Gaidīts 200, saņemts ${res.status}`);
    const data = (await res.json()) as any;
    if (!data.result || !Array.isArray(data.result.tools)) {
      throw new Error(`tools/list atbildē nav rīku masīva: ${JSON.stringify(data)}`);
    }
  });

  // 9. Rīka sinonīma (alias) izsaukums: inspect_ast -> analyze_jev_semantic_ast caur POST /
  await testStep("Rīka sinonīms inspect_ast caur POST / -> HTTP 200 un SAFE spriedums", async () => {
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
    if (res.status !== 200) throw new Error(`Gaidīts 200, saņemts ${res.status}`);
    const balanceHeader = res.headers.get("X-MCPX-Balance-Cents");
    if (balanceHeader !== "449") {
      throw new Error(`Gaidīta atlikusī bilance 449 c (debetēts 1 c), saņemts '${balanceHeader}'`);
    }
    const data = (await res.json()) as any;
    if (!data.result || !Array.isArray(data.result.content)) {
      throw new Error(`tools/call atbildē trūkst satura: ${JSON.stringify(data)}`);
    }
    const parsedText = JSON.parse(data.result.content[0].text);
    if (parsedText.verdict !== "SAFE") {
      throw new Error(`Gaidīts 'SAFE', saņemts: ${parsedText.verdict}`);
    }
  });

  await testStep("GET /llms.txt atgriež mašīnlasāmu specifikāciju ar rīkiem un cenām", async () => {
    const req = new Request("https://mcpx.harrykrauze.com/llms.txt", { method: "GET" });
    const res = await workerDefault.fetch(req, env, ctx);
    if (res.status !== 200) throw new Error(`Gaidīts 200, saņemts ${res.status}`);
    const ct = res.headers.get("Content-Type") || "";
    if (!ct.includes("text/markdown") && !ct.includes("text/plain")) {
      throw new Error(`Gaidīts markdown vai plain saturs, saņemts: ${ct}`);
    }
    const text = await res.text();
    if (!text.includes("evaluate_fraud_transaction") || !text.includes("analyze_jev_semantic_ast")) {
      throw new Error("llms.txt nesatur pamata rīkus");
    }
    if (!text.includes("claude_desktop_config.json") || !text.includes(".cursor/mcp.json")) {
      throw new Error("llms.txt nesatur klienta konfigurācijas profilus");
    }
  });

  await testStep("GET /llms-full.txt atgriež paplašināto specifikāciju ar ievades shēmām", async () => {
    const req = new Request("https://mcpx.harrykrauze.com/llms-full.txt", { method: "GET" });
    const res = await workerDefault.fetch(req, env, ctx);
    if (res.status !== 200) throw new Error(`Gaidīts 200, saņemts ${res.status}`);
    const ct = res.headers.get("Content-Type") || "";
    if (!ct.includes("text/markdown") && !ct.includes("text/plain")) {
      throw new Error(`Gaidīts markdown vai plain saturs, saņemts: ${ct}`);
    }
    const text = await res.text();
    if (!text.includes("Detailed Tool Input Schemas") || !text.includes("calculate_u_value_iso6946")) {
      throw new Error("llms-full.txt nesatur detalizētās shēmas");
    }
  });

  await testStep("GET /mcp/sse atgriež SSE straumi ar 'event: endpoint'", async () => {
    const req = new Request("https://mcpx.harrykrauze.com/mcp/sse", {
      method: "GET",
      headers: { "Accept": "text/event-stream" },
    });
    const res = await workerDefault.fetch(req, env, ctx);
    if (res.status !== 200) throw new Error(`Gaidīts 200, saņemts ${res.status}`);
    const ct = res.headers.get("Content-Type") || "";
    if (!ct.includes("text/event-stream")) throw new Error(`Gaidīts text/event-stream, saņemts ${ct}`);
    const body = await res.text();
    if (!body.includes("event: endpoint") || !body.includes("data: /message")) {
      throw new Error(`Negaidīts SSE saturs: ${body}`);
    }
  });

  console.log(`\n================================================================`);
  console.log(`Rezultāts: ${pass} sekmīgi, ${fail} neveiksmīgi`);
  console.log(`================================================================`);

  if (fail > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Crash:", err);
  process.exit(1);
});
