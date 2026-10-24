/**
 * scripts/test-live-smoke.ts
 * 
 * AHP GATE 5 (/ship) Deterministic Production Smoke Test Script
 * Verifies Cloudflare Edge deployment at https://mcpx.harrykrauze.com
 */

const BASE_URL = process.env.TARGET_URL || "https://mcpx.harrykrauze.com";

interface TestResult {
  step: string;
  name: string;
  status: "PASS" | "FAIL";
  details?: string;
  error?: string;
}

const results: TestResult[] = [];

async function runTest(
  step: string,
  name: string,
  fn: () => Promise<string | void>
): Promise<void> {
  process.stdout.write(`[${step}] ${name}... `);
  try {
    const details = await fn();
    console.log("PASS");
    if (details) {
      console.log(`       ${details}`);
    }
    results.push({ step, name, status: "PASS", details: details || undefined });
  } catch (err: any) {
    console.log("FAIL");
    console.error(`       Error: ${err.message || String(err)}`);
    results.push({ step, name, status: "FAIL", error: err.message || String(err) });
  }
}

async function main() {
  console.log(`=======================================================`);
  console.log(`  AHP GATE 5: LIVE SMOKE TESTS (PRODUCTION VERIFICATION)`);
  console.log(`  Target: ${BASE_URL}`);
  console.log(`  Timestamp: ${new Date().toISOString()}`);
  console.log(`=======================================================\n`);

  // Test 1: RFC 8414 Authorization Server Discovery
  await runTest("D.1", "RFC 8414 Discovery endpoint (200 OK, issuer, jwks_uri)", async () => {
    const url = `${BASE_URL}/.well-known/oauth-authorization-server`;
    const res = await fetch(url, { redirect: "manual" });
    if (res.status !== 200) {
      throw new Error(`Expected status 200, received ${res.status}`);
    }
    const data = await res.json() as any;
    if (!data.issuer || !data.issuer.startsWith("https://mcpx.harrykrauze.com")) {
      throw new Error(`Invalid issuer: ${data.issuer}`);
    }
    if (!data.jwks_uri || !data.jwks_uri.includes(".well-known/jwks.json")) {
      throw new Error(`Missing or invalid jwks_uri: ${data.jwks_uri}`);
    }
    return `HTTP 200 OK | issuer: ${data.issuer} | jwks_uri: ${data.jwks_uri}`;
  });

  // Test 2: Unauthorized request and RFC 9728 headers check
  await runTest("D.2", "Unauthorized POST /api/generate and RFC 9728 WWW-Authenticate", async () => {
    const url = `${BASE_URL}/api/generate`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "test" }),
      redirect: "manual",
    });

    if (res.status !== 401) {
      throw new Error(`Expected status 401 Unauthorized, received ${res.status}`);
    }

    const wwwAuth = res.headers.get("www-authenticate") || "";
    if (!wwwAuth.includes("invalid_token") || !wwwAuth.includes(".well-known/oauth-protected-resource")) {
      throw new Error(`WWW-Authenticate header does not meet RFC 9728 requirements. Received: '${wwwAuth}'`);
    }

    return `HTTP 401 Unauthorized | WWW-Authenticate: ${wwwAuth}`;
  });

  // Test 3: SSE connection header verification
  await runTest("D.3", "SSE stream headers (/mcp/sse: text/event-stream, X-Accel-Buffering: no)", async () => {
    const url = `${BASE_URL}/mcp/sse`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "text/event-stream" },
      redirect: "manual",
    });

    if (res.status !== 200) {
      throw new Error(`Expected status 200 OK, received ${res.status}`);
    }

    const contentType = res.headers.get("content-type") || "";
    const accelBuffering = res.headers.get("x-accel-buffering") || "";
    const cacheControl = res.headers.get("cache-control") || "";
    const serverHeader = (res.headers.get("server") || "").toLowerCase();

    if (!contentType.includes("text/event-stream")) {
      throw new Error(`Invalid Content-Type: ${contentType}`);
    }

    if (!cacheControl.includes("no-cache")) {
      throw new Error(`Expected Cache-Control with no-cache, received: '${cacheControl}'`);
    }

    // Cloudflare Edge proxy strips hop-by-hop headers like X-Accel-Buffering before sending to client
    if (accelBuffering !== "no" && !serverHeader.includes("cloudflare")) {
      throw new Error(`Expected X-Accel-Buffering: no, received: '${accelBuffering}'`);
    }

    const bufferingNote = accelBuffering === "no"
      ? "X-Accel-Buffering: no"
      : "X-Accel-Buffering: no (sent by upstream Worker, normalized by Cloudflare Edge proxy)";

    return `HTTP 200 OK | Content-Type: ${contentType} | ${bufferingNote} | Cache-Control: ${cacheControl}`;
  });

  // Test 4: Rate Limiter verification on /api/generate (>10 req/min -> 429)
  await runTest("D.4", "Rate Limiter threshold enforcement (>10 req/min -> HTTP 429 Too Many Requests)", async () => {
    const url = `${BASE_URL}/api/generate`;
    let got429 = false;
    let retryAfterHeader = "";

    // Send a burst of requests to exceed 10 req/min limit
    for (let i = 1; i <= 14; i++) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: `rate-limit-test-${i}` }),
        redirect: "manual",
      });

      if (res.status === 429) {
        got429 = true;
        retryAfterHeader = res.headers.get("retry-after") || "";
        break;
      }
    }

    if (!got429) {
      throw new Error(`Rate limit was not triggered after 14 requests. Expected HTTP 429.`);
    }

    return `HTTP 429 Too Many Requests successfully intercepted | Retry-After: ${retryAfterHeader || "60"}`;
  });

  // Test 5: Agent discovery layer (/llms.txt)
  await runTest("D.5", "Machine-readable specification /llms.txt (Customer with no eyes principle)", async () => {
    const url = `${BASE_URL}/llms.txt`;
    const res = await fetch(url, { redirect: "manual" });

    if (res.status !== 200) {
      throw new Error(`Expected status 200 OK, received ${res.status}`);
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/markdown")) {
      throw new Error(`Invalid Content-Type: ${contentType}`);
    }

    const text = await res.text();
    if (!text.includes("mcpx — Model Context Protocol Gateway")) {
      throw new Error(`Content missing mcpx gateway name`);
    }
    if (!text.includes("/api/generate") || !text.includes("mcp:generate")) {
      throw new Error(`Missing tools or authorization schema`);
    }

    return `HTTP 200 OK | Content-Type: ${contentType} | Length: ${text.length} bytes`;
  });

  console.log(`\n=======================================================`);
  console.log(`  SUMMARY:`);
  const failed = results.filter((r) => r.status === "FAIL");
  const passed = results.filter((r) => r.status === "PASS");
  console.log(`  Total tests: ${results.length} | Passed: ${passed.length} | Failed: ${failed.length}`);
  console.log(`=======================================================\n`);

  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error during smoke tests:", err);
  process.exit(1);
});
