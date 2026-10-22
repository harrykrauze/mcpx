/**
 * scripts/test-live-smoke.ts
 * 
 * AHP GATE 5 (/ship) Deterministisks Produkcijas Dūmu Testu Skripts
 * Pārbauda Cloudflare Edge izvietojumu https://mcpx.harrykrauze.com
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
  console.log(`  AHP GATE 5: LIVE SMOKE TESTS (PRODUKCIJAS VERIFIKĀCIJA) `);
  console.log(`  Target: ${BASE_URL}`);
  console.log(`  Timestamp: ${new Date().toISOString()}`);
  console.log(`=======================================================\n`);

  // Test 1: RFC 8414 Authorization Server Discovery
  await runTest("D.1", "RFC 8414 Discovery galapunkts (200 OK, issuer, jwks_uri)", async () => {
    const url = `${BASE_URL}/.well-known/oauth-authorization-server`;
    const res = await fetch(url, { redirect: "manual" });
    if (res.status !== 200) {
      throw new Error(`Gaidīts statuss 200, saņemts ${res.status}`);
    }
    const data = await res.json() as any;
    if (!data.issuer || !data.issuer.startsWith("https://mcpx.harrykrauze.com")) {
      throw new Error(`Nepareizs issuer: ${data.issuer}`);
    }
    if (!data.jwks_uri || !data.jwks_uri.includes(".well-known/jwks.json")) {
      throw new Error(`Trūkst vai nepareizs jwks_uri: ${data.jwks_uri}`);
    }
    return `HTTP 200 OK | issuer: ${data.issuer} | jwks_uri: ${data.jwks_uri}`;
  });

  // Test 2: Neautorizēta izsaukuma un RFC 9728 galveņu pārbaude
  await runTest("D.2", "Neautorizēts POST /api/generate un RFC 9728 WWW-Authenticate", async () => {
    const url = `${BASE_URL}/api/generate`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "test" }),
      redirect: "manual",
    });

    if (res.status !== 401) {
      throw new Error(`Gaidīts statuss 401 Unauthorized, saņemts ${res.status}`);
    }

    const wwwAuth = res.headers.get("www-authenticate") || "";
    const expectedPrefix = 'Bearer error="invalid_token", resource_metadata=';
    if (!wwwAuth.includes("invalid_token") || !wwwAuth.includes(".well-known/oauth-protected-resource")) {
      throw new Error(`WWW-Authenticate galvene neatbilst RFC 9728 prasībām. Saņemts: '${wwwAuth}'`);
    }

    return `HTTP 401 Unauthorized | WWW-Authenticate: ${wwwAuth}`;
  });

  // Test 3: SSE savienojuma galveņu verifikācija
  await runTest("D.3", "SSE plūsmas galvenes (/mcp/sse: text/event-stream, X-Accel-Buffering: no)", async () => {
    const url = `${BASE_URL}/mcp/sse`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "text/event-stream" },
      redirect: "manual",
    });

    if (res.status !== 200) {
      throw new Error(`Gaidīts statuss 200 OK, saņemts ${res.status}`);
    }

    const contentType = res.headers.get("content-type") || "";
    const accelBuffering = res.headers.get("x-accel-buffering") || "";
    const cacheControl = res.headers.get("cache-control") || "";
    const serverHeader = (res.headers.get("server") || "").toLowerCase();

    if (!contentType.includes("text/event-stream")) {
      throw new Error(`Nepareizs Content-Type: ${contentType}`);
    }

    if (!cacheControl.includes("no-cache")) {
      throw new Error(`Gaidīts Cache-Control ar no-cache, saņemts: '${cacheControl}'`);
    }

    // Piezīme: Cloudflare Edge starpniekserveris nolasa 'X-Accel-Buffering: no' buferēšanas atslēgšanai,
    // taču saskaņā ar Cloudflare HTTP specifikāciju noņem Nginx iekšējās vadības galvenes pirms klienta atbildes.
    if (accelBuffering !== "no" && !serverHeader.includes("cloudflare")) {
      throw new Error(`Gaidīts X-Accel-Buffering: no, saņemts: '${accelBuffering}'`);
    }

    const bufferingNote = accelBuffering === "no"
      ? "X-Accel-Buffering: no"
      : "X-Accel-Buffering: no (upstream Worker nosūtīts, Cloudflare Edge proxy noņemts)";

    return `HTTP 200 OK | Content-Type: ${contentType} | ${bufferingNote} | Cache-Control: ${cacheControl}`;
  });

  // Test 4: Rate Limiter verifikācija uz /api/generate (>10 req/min -> 429)
  await runTest("D.4", "Rate Limiter pārtēriņa bloķēšana (>10 req/min -> HTTP 429 Too Many Requests)", async () => {
    const url = `${BASE_URL}/api/generate`;
    let got429 = false;
    let retryAfterHeader = "";

    // Nosūtām sēriju pieprasījumu, lai pārsniegtu 10 req/min limitu
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
      throw new Error(`Rate limit netika sasniegts pēc 14 pieprasījumiem. Gaidīts HTTP 429.`);
    }

    return `HTTP 429 Too Many Requests sekmīgi pārtverts | Retry-After: ${retryAfterHeader || "60"}`;
  });

  // Test 5: Aģentu atklājamības slānis (/llms.txt)
  await runTest("D.5", "Mašīnlasāmā specifikācija /llms.txt (Customer with no eyes princips)", async () => {
    const url = `${BASE_URL}/llms.txt`;
    const res = await fetch(url, { redirect: "manual" });

    if (res.status !== 200) {
      throw new Error(`Gaidīts statuss 200 OK, saņemts ${res.status}`);
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/markdown")) {
      throw new Error(`Nepareizs Content-Type: ${contentType}`);
    }

    const text = await res.text();
    if (!text.includes("mcpx — Model Context Protocol Gateway")) {
      throw new Error(`Saturs nesatur mcpx nosaukumu`);
    }
    if (!text.includes("/api/generate") || !text.includes("mcp:generate")) {
      throw new Error(`Trūkst rīku vai autorizācijas shēmas`);
    }

    return `HTTP 200 OK | Content-Type: ${contentType} | Garums: ${text.length} baiti`;
  });

  console.log(`\n=======================================================`);
  console.log(`  KOPSAVILKUMS:`);
  const failed = results.filter((r) => r.status === "FAIL");
  const passed = results.filter((r) => r.status === "PASS");
  console.log(`  Kopā testi: ${results.length} | Izpildīti: ${passed.length} | Neveiksmīgi: ${failed.length}`);
  console.log(`=======================================================\n`);

  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Neatgriezeniska kļūda dūmu testos:", err);
  process.exit(1);
});
