/**
 * test/creem-webhook.test.ts
 * 
 * AHP GATE 3 & GATE 6 Deterministic Creem.io Webhook Gateway Test Suite:
 * 1. Invalid or missing HMAC SHA-256 signature rejected with HTTP 401 Unauthorized.
 * 2. Tampered or modified request body rejected with HTTP 401 Unauthorized.
 * 3. Valid 'checkout.completed' webhook processing and atomic balance top-up in integer cents.
 * 4. Idempotency guarantee on duplicate requests with identical payload.id.
 * 5. Key lookup via customer.email when keyId is absent in custom_fields.
 * 6. Error handling: non-integer or negative amounts rejected with HTTP 400 Bad Request.
 * 7. Full routing test through workerDefault.fetch (POST /webhooks/creem).
 * 8. USD currency processing and format ($10.00 / 1000 credits).
 */

import workerDefault from "../src/index";
import { Env, ExecutionContext, ApiKeyRecord, KVNamespace } from "../src/auth";
import { CreemWebhookPayload, CreemWebhookResponse } from "../src/types/creem";
import { generateCreemSignature, verifyCreemSignature } from "../src/services/creemSignature";
import { handleCreemWebhook } from "../src/routes/webhooks";

class InMemoryKV implements KVNamespace {
  private store = new Map<string, { value: string; expiration?: number }>();

  async get(key: string, type?: "text"): Promise<string | null>;
  async get<ExpectedValue = unknown>(key: string, type: "json"): Promise<ExpectedValue | null>;
  async get(key: string, type: "text" | "json" = "text"): Promise<any> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiration && Date.now() / 1000 > entry.expiration) {
      this.store.delete(key);
      return null;
    }
    if (type === "json") {
      try {
        return JSON.parse(entry.value);
      } catch {
        return null;
      }
    }
    return entry.value;
  }

  async put(
    key: string,
    value: string,
    options?: { expiration?: number; expirationTtl?: number; metadata?: any }
  ): Promise<void> {
    let expiration = options?.expiration;
    if (options?.expirationTtl) {
      expiration = Math.floor(Date.now() / 1000) + options.expirationTtl;
    }
    this.store.set(key, { value, expiration });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    keys: Array<{ name: string; expiration?: number; metadata?: any }>;
    list_complete: boolean;
    cursor?: string;
  }> {
    const prefix = options?.prefix || "";
    const keys: Array<{ name: string; expiration?: number }> = [];
    for (const [k, v] of this.store.entries()) {
      if (k.startsWith(prefix)) {
        keys.push({ name: k, expiration: v.expiration });
      }
    }
    return { keys, list_complete: true };
  }

  peek(key: string): string | undefined {
    return this.store.get(key)?.value;
  }

  peekTtl(key: string): number | undefined {
    return this.store.get(key)?.expiration;
  }
}

interface TestStep {
  id: string;
  name: string;
  run: () => Promise<string | void>;
}

const steps: TestStep[] = [];
let passCount = 0;
let failCount = 0;

function it(id: string, name: string, fn: () => Promise<string | void>) {
  steps.push({ id, name, run: fn });
}

// Test configuration
const TEST_WEBHOOK_SECRET = "creem_whsec_determinism_test_2026_strict";
const TEST_API_KEY = "mcpx_live_creem_test_key_001";
const TEST_KEY_ID = "key_creem_test_01";
const TEST_EMAIL = "developer@example.com";

function createMockCtx(): ExecutionContext {
  const promises: Promise<unknown>[] = [];
  return {
    waitUntil(promise: Promise<unknown>) {
      promises.push(promise.catch(() => {}));
    },
    passThroughOnException() {},
  };
}

const recordedAnalyticsPoints: any[] = [];

function createMockEnv(kv: InMemoryKV): Env {
  return {
    GEMINI_API_KEY: "mock_gemini_key",
    CREEM_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
    MCPX_KEYS: kv,
    ANALYTICS: {
      writeDataPoint: (point: any) => {
        recordedAnalyticsPoints.push(point);
      },
    },
  };
}

// 1. Test: Missing or invalid signature
it("C.1", "Rejection of invalid or missing HMAC signature (HTTP 401)", async () => {
  const kv = new InMemoryKV();
  const env = createMockEnv(kv);
  const ctx = createMockCtx();

  const payload: CreemWebhookPayload = {
    id: "evt_test_001",
    event: "checkout.completed",
    created_at: new Date().toISOString(),
    data: {
      id: "ord_1001",
      order_id: "order_creem_001",
      customer: { id: "cust_1", email: TEST_EMAIL },
      amount: 500,
      currency: "EUR",
      custom_fields: { key_id: TEST_KEY_ID },
    },
  };

  const rawBody = JSON.stringify(payload);

  // A: Without header
  const reqNoHeader = new Request("https://mcpx.harrykrauze.com/webhooks/creem", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: rawBody,
  });
  const resNoHeader = await handleCreemWebhook(reqNoHeader, env, ctx);
  if (resNoHeader.status !== 401) {
    throw new Error(`Expected 401 without header, received ${resNoHeader.status}`);
  }

  // B: With invalid signature
  const reqBadSig = new Request("https://mcpx.harrykrauze.com/webhooks/creem", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "creem-signature": "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
    },
    body: rawBody,
  });
  const resBadSig = await handleCreemWebhook(reqBadSig, env, ctx);
  if (resBadSig.status !== 401) {
    throw new Error(`Expected 401 with invalid signature, received ${resBadSig.status}`);
  }

  return "HTTP 401 rejected both without signature and with falsified signature";
});

// 2. Test: Content tampered after signing
it("C.2", "Rejection of tampered / modified raw body (HTTP 401)", async () => {
  const kv = new InMemoryKV();
  const env = createMockEnv(kv);
  const ctx = createMockCtx();

  const originalBody = JSON.stringify({
    id: "evt_tamper_01",
    event: "checkout.completed",
    created_at: new Date().toISOString(),
    data: {
      id: "ord_t1",
      order_id: "order_tamper_1",
      customer: { id: "cust_1", email: TEST_EMAIL },
      amount: 100,
      currency: "EUR",
    },
  });

  const validSig = await generateCreemSignature(originalBody, TEST_WEBHOOK_SECRET);

  // Tampered payload (attacker modifies amount from 100 to 100000)
  const tamperedBody = originalBody.replace(`"amount":100`, `"amount":100000`);

  const reqTampered = new Request("https://mcpx.harrykrauze.com/webhooks/creem", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "creem-signature": validSig,
    },
    body: tamperedBody,
  });

  const res = await handleCreemWebhook(reqTampered, env, ctx);
  if (res.status !== 401) {
    throw new Error(`Expected 401 for tampered body, received ${res.status}`);
  }

  return "Web Crypto HMAC verification successfully prevented payload tampering";
});

// 3. Test: Valid processing and atomic balance top-up in integer cents
it("C.3", "Valid 'checkout.completed' processing and balance top-up (HTTP 200)", async () => {
  const kv = new InMemoryKV();
  const env = createMockEnv(kv);
  const ctx = createMockCtx();

  // Prepare initial API key record in KV with 50 cents balance
  const initialRecord: ApiKeyRecord = {
    keyId: TEST_KEY_ID,
    userId: "user_alpha",
    tenantId: "tenant_alpha",
    plan: "pro",
    status: "active",
    billing: {
      mode: "prepaid",
      balanceCents: 50,
      currency: "EUR",
      costPerToolCallCents: 1,
      costPerGenerateCents: 5,
      totalSpentCents: 10,
      lowBalanceThresholdCents: 10,
    },
  };

  await kv.put(`key:${TEST_API_KEY}`, JSON.stringify(initialRecord));
  await kv.put(`id:${TEST_KEY_ID}`, TEST_API_KEY);

  const payload: CreemWebhookPayload = {
    id: "evt_valid_topup_100",
    event: "checkout.completed",
    created_at: new Date().toISOString(),
    data: {
      id: "creem_ord_777",
      order_id: "order_topup_10eur",
      customer: { id: "cust_123", email: TEST_EMAIL },
      amount: 1000, // 10 EUR = 1000 cents
      currency: "EUR",
      custom_fields: { key_id: TEST_KEY_ID },
    },
  };

  const rawBody = JSON.stringify(payload);
  const sig = await generateCreemSignature(rawBody, TEST_WEBHOOK_SECRET);

  const req = new Request("https://mcpx.harrykrauze.com/webhooks/creem", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "creem-signature": sig,
    },
    body: rawBody,
  });

  const res = await handleCreemWebhook(req, env, ctx);
  if (res.status !== 200) {
    const errText = await res.text();
    throw new Error(`Expected 200 OK, received ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as CreemWebhookResponse;
  if (!data.success || data.addedCents !== 1000 || data.newBalanceCents !== 1050) {
    throw new Error(`Invalid response: ${JSON.stringify(data)}`);
  }

  // Verify KV actual state
  const updatedRaw = await kv.get(`key:${TEST_API_KEY}`, "text");
  const updatedRecord = JSON.parse(updatedRaw!) as ApiKeyRecord;
  if (updatedRecord.billing?.balanceCents !== 1050) {
    throw new Error(`Balance in KV is not 1050! Actual: ${updatedRecord.billing?.balanceCents}`);
  }

  // Verify idempotency key in KV
  const idempRaw = await kv.get(`webhook:processed:${payload.id}`, "text");
  if (!idempRaw) {
    throw new Error(`Idempotency key 'webhook:processed:${payload.id}' was not saved in KV!`);
  }

  // Verify Analytics Engine telemetry data point
  const topupPoint = recordedAnalyticsPoints.find((p) => p.blobs?.[0] === "creem.topup");
  if (!topupPoint) {
    throw new Error("Analytics Engine data point with 'creem.topup' was not recorded!");
  }
  if (topupPoint.doubles?.[0] !== 1000 || topupPoint.doubles?.[2] !== 1050) {
    throw new Error(`Invalid Analytics Engine numeric data: ${JSON.stringify(topupPoint.doubles)}`);
  }

  return `Balance topped up by €10.00 (1000 c) -> New balance: €10.50 (1050 c) (Analytics verified)`;
});

// 4. Test: Idempotency on duplicate requests
it("C.4", "Idempotency guarantee on duplicate calls with identical payload.id", async () => {
  const kv = new InMemoryKV();
  const env = createMockEnv(kv);
  const ctx = createMockCtx();

  const initialRecord: ApiKeyRecord = {
    keyId: TEST_KEY_ID,
    userId: "user_alpha",
    tenantId: "tenant_alpha",
    plan: "pro",
    status: "active",
    billing: {
      mode: "prepaid",
      balanceCents: 100,
      currency: "EUR",
      costPerToolCallCents: 1,
      costPerGenerateCents: 5,
      totalSpentCents: 0,
      lowBalanceThresholdCents: 10,
    },
  };
  await kv.put(`key:${TEST_API_KEY}`, JSON.stringify(initialRecord));
  await kv.put(`id:${TEST_KEY_ID}`, TEST_API_KEY);

  const payload: CreemWebhookPayload = {
    id: "evt_idempotent_test_999",
    event: "checkout.completed",
    created_at: new Date().toISOString(),
    data: {
      id: "ord_999",
      order_id: "order_idemp_999",
      customer: { id: "cust_1", email: TEST_EMAIL },
      amount: 500, // 5 EUR
      currency: "EUR",
      custom_fields: { key_id: TEST_KEY_ID },
    },
  };

  const rawBody = JSON.stringify(payload);
  const sig = await generateCreemSignature(rawBody, TEST_WEBHOOK_SECRET);

  // First call
  const req1 = new Request("https://mcpx.harrykrauze.com/webhooks/creem", {
    method: "POST",
    headers: { "Content-Type": "application/json", "creem-signature": sig },
    body: rawBody,
  });
  const res1 = await handleCreemWebhook(req1, env, ctx);
  if (res1.status !== 200) throw new Error(`First call failed: ${res1.status}`);

  // Second identical call (replay / webhook retry)
  const req2 = new Request("https://mcpx.harrykrauze.com/webhooks/creem", {
    method: "POST",
    headers: { "Content-Type": "application/json", "creem-signature": sig },
    body: rawBody,
  });
  const res2 = await handleCreemWebhook(req2, env, ctx);
  if (res2.status !== 200) throw new Error(`Second call failed: ${res2.status}`);

  const data2 = (await res2.json()) as CreemWebhookResponse;
  if (!data2.idempotentDuplicate) {
    throw new Error(`Expected idempotentDuplicate: true on second call: ${JSON.stringify(data2)}`);
  }

  // Ensure balance increased only once (100 + 500 = 600, not 1100)
  const finalRaw = await kv.get(`key:${TEST_API_KEY}`, "text");
  const finalRecord = JSON.parse(finalRaw!) as ApiKeyRecord;
  if (finalRecord.billing?.balanceCents !== 600) {
    throw new Error(`Idempotency violation! Balance is ${finalRecord.billing?.balanceCents}, expected 600`);
  }

  return `Idempotency confirmed: second request returned 200 OK (idempotentDuplicate: true), balance = 600 c`;
});

// 5. Test: Lookup by customer.email (when keyId is omitted)
it("C.5", "Key lookup via customer.email when keyId is absent in custom_fields", async () => {
  const kv = new InMemoryKV();
  const env = createMockEnv(kv);
  const ctx = createMockCtx();

  const initialRecord: ApiKeyRecord = {
    keyId: "key_email_lookup_01",
    userId: TEST_EMAIL, // User ID matches email
    tenantId: "tenant_from_email",
    plan: "pro",
    status: "active",
    billing: {
      mode: "prepaid",
      balanceCents: 20,
      currency: "EUR",
      costPerToolCallCents: 1,
      costPerGenerateCents: 5,
      totalSpentCents: 0,
      lowBalanceThresholdCents: 10,
    },
  };
  await kv.put(`key:mcpx_live_email_user_key`, JSON.stringify(initialRecord));

  const payload: CreemWebhookPayload = {
    id: "evt_email_lookup_555",
    event: "checkout.completed",
    created_at: new Date().toISOString(),
    data: {
      id: "ord_email_1",
      order_id: "order_email_555",
      customer: { id: "cust_email", email: TEST_EMAIL },
      amount: 250, // €2.50
      currency: "EUR",
    },
  };

  const rawBody = JSON.stringify(payload);
  const sig = await generateCreemSignature(rawBody, TEST_WEBHOOK_SECRET);

  const req = new Request("https://mcpx.harrykrauze.com/webhooks/creem", {
    method: "POST",
    headers: { "Content-Type": "application/json", "creem-signature": sig },
    body: rawBody,
  });

  const res = await handleCreemWebhook(req, env, ctx);
  if (res.status !== 200) {
    const errText = await res.text();
    throw new Error(`Email lookup failed (HTTP ${res.status}): ${errText}`);
  }

  const updatedRaw = await kv.get("key:mcpx_live_email_user_key", "text");
  const updated = JSON.parse(updatedRaw!) as ApiKeyRecord;
  if (updated.billing?.balanceCents !== 270) {
    throw new Error(`Expected balance 270 (20 + 250), received ${updated.billing?.balanceCents}`);
  }

  return `Successful lookup by email: balance increased from 20 c to 270 c`;
});

// 6. Test: Non-integer or negative amount
it("C.6", "Rejection of non-integer or negative amounts (HTTP 400)", async () => {
  const kv = new InMemoryKV();
  const env = createMockEnv(kv);
  const ctx = createMockCtx();

  const invalidAmounts = [-100, 0, 10.5, 3.1415];
  for (const amt of invalidAmounts) {
    const payload = {
      id: `evt_invalid_${amt}`,
      event: "checkout.completed",
      created_at: new Date().toISOString(),
      data: {
        id: "ord_inv",
        order_id: "order_inv",
        customer: { id: "c1", email: TEST_EMAIL },
        amount: amt,
        currency: "EUR",
        custom_fields: { key_id: TEST_KEY_ID },
      },
    };

    const rawBody = JSON.stringify(payload);
    const sig = await generateCreemSignature(rawBody, TEST_WEBHOOK_SECRET);

    const req = new Request("https://mcpx.harrykrauze.com/webhooks/creem", {
      method: "POST",
      headers: { "Content-Type": "application/json", "creem-signature": sig },
      body: rawBody,
    });

    const res = await handleCreemWebhook(req, env, ctx);
    if (res.status !== 400) {
      throw new Error(`Amount ${amt} was not rejected with 400! Status: ${res.status}`);
    }
  }

  return `All invalid amount patterns (-100, 0, 10.5, 3.1415) rejected with HTTP 400`;
});

// 6b. Test: Rejection of unsupported currency with HTTP 400
it("C.6b", "Rejection of unsupported currencies ('GBP', 'JPY') with HTTP 400", async () => {
  const kv = new InMemoryKV();
  const env = createMockEnv(kv);
  const ctx = createMockCtx();

  const payload = {
    id: "evt_invalid_currency",
    event: "checkout.completed",
    created_at: new Date().toISOString(),
    data: {
      id: "ord_inv_curr",
      order_id: "order_inv_curr",
      customer: { id: "c1", email: TEST_EMAIL },
      amount: 1000,
      currency: "GBP",
      custom_fields: { key_id: TEST_KEY_ID },
    },
  };

  const rawBody = JSON.stringify(payload);
  const sig = await generateCreemSignature(rawBody, TEST_WEBHOOK_SECRET);

  const req = new Request("https://mcpx.harrykrauze.com/webhooks/creem", {
    method: "POST",
    headers: { "Content-Type": "application/json", "creem-signature": sig },
    body: rawBody,
  });

  const res = await handleCreemWebhook(req, env, ctx);
  if (res.status !== 400) {
    throw new Error(`Unsupported currency 'GBP' was not rejected with 400! Status: ${res.status}`);
  }

  const errJson = (await res.json()) as any;
  if (!errJson.error?.includes("Unsupported currency")) {
    throw new Error(`Expected unsupported currency message, received: ${JSON.stringify(errJson)}`);
  }

  return `Unsupported currency 'GBP' rejected with HTTP 400 Bad Request`;
});

// 7. Test: workerDefault.fetch full routing integration (POST /webhooks/creem)
it("C.7", "Full routing test via workerDefault.fetch", async () => {
  const kv = new InMemoryKV();
  const env = createMockEnv(kv);
  const ctx = createMockCtx();

  const initialRecord: ApiKeyRecord = {
    keyId: TEST_KEY_ID,
    userId: "user_router_test",
    tenantId: "tenant_router",
    plan: "pro",
    status: "active",
    billing: {
      mode: "prepaid",
      balanceCents: 10,
      currency: "EUR",
      costPerToolCallCents: 1,
      costPerGenerateCents: 5,
      totalSpentCents: 0,
      lowBalanceThresholdCents: 10,
    },
  };
  await kv.put(`key:${TEST_API_KEY}`, JSON.stringify(initialRecord));
  await kv.put(`id:${TEST_KEY_ID}`, TEST_API_KEY);

  const payload: CreemWebhookPayload = {
    id: "evt_router_999",
    event: "checkout.completed",
    created_at: new Date().toISOString(),
    data: {
      id: "ord_r999",
      order_id: "order_router_test",
      customer: { id: "cust_r", email: TEST_EMAIL },
      amount: 300,
      currency: "EUR",
      custom_fields: { key_id: TEST_KEY_ID },
    },
  };

  const rawBody = JSON.stringify(payload);
  const sig = await generateCreemSignature(rawBody, TEST_WEBHOOK_SECRET);

  const req = new Request("https://mcpx.harrykrauze.com/webhooks/creem", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-creem-signature": sig, // Test alternative header as well
    },
    body: rawBody,
  });

  const res = await workerDefault.fetch(req, env, ctx);
  if (res.status !== 200) {
    const errText = await res.text();
    throw new Error(`workerDefault.fetch failed (HTTP ${res.status}): ${errText}`);
  }

  const resData = (await res.json()) as CreemWebhookResponse;
  if (resData.newBalanceCents !== 310) {
    throw new Error(`Expected balance 310, received ${resData.newBalanceCents}`);
  }

  return `Router path POST /webhooks/creem successfully processed via workerDefault.fetch`;
});

// 8. Test: USD currency top-up processing and format ($10.00 / 1000 credits)
it("C.8", "USD currency top-up processing with '$' symbol in response", async () => {
  const kv = new InMemoryKV();
  const env = createMockEnv(kv);
  const ctx = createMockCtx();

  const initialRecord: ApiKeyRecord = {
    keyId: TEST_KEY_ID,
    userId: "user_usd_test",
    tenantId: "tenant_usd",
    plan: "pro",
    status: "active",
    billing: {
      mode: "prepaid",
      balanceCents: 200,
      currency: "USD",
      costPerToolCallCents: 1,
      costPerGenerateCents: 5,
      totalSpentCents: 50,
      lowBalanceThresholdCents: 10,
    },
  };
  await kv.put(`key:${TEST_API_KEY}`, JSON.stringify(initialRecord));
  await kv.put(`id:${TEST_KEY_ID}`, TEST_API_KEY);

  const payload: CreemWebhookPayload = {
    id: "evt_usd_checkout_1",
    event: "checkout.completed",
    created_at: new Date().toISOString(),
    data: {
      id: "ord_usd_1",
      order_id: "order_usd_topup_1000",
      customer: { id: "cust_usd", email: TEST_EMAIL },
      amount: 1000, // $10.00 = 1000 cents
      currency: "USD",
      custom_fields: { key_id: TEST_KEY_ID },
    },
  };

  const rawBody = JSON.stringify(payload);
  const sig = await generateCreemSignature(rawBody, TEST_WEBHOOK_SECRET);

  const req = new Request("https://mcpx.harrykrauze.com/webhooks/creem", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "creem-signature": sig,
    },
    body: rawBody,
  });

  const res = await handleCreemWebhook(req, env, ctx);
  if (res.status !== 200) {
    const errText = await res.text();
    throw new Error(`handleCreemWebhook failed (HTTP ${res.status}): ${errText}`);
  }

  const resData = (await res.json()) as CreemWebhookResponse;
  if (resData.newBalanceCents !== 1200) {
    throw new Error(`Expected balance 1200, received ${resData.newBalanceCents}`);
  }
  if (!resData.message.includes("$10.00")) {
    throw new Error(`Response message does not contain '$10.00': ${resData.message}`);
  }

  return `USD top-up $10.00 (1000 c) successfully processed: ${resData.message}`;
});

async function run() {
  console.log(`================================================================`);
  console.log(`  AHP GATE 3 / GATE 6: CREEM.IO WEBHOOK GATEWAY VERIFICATION    `);
  console.log(`  Timestamp: ${new Date().toISOString()}`);
  console.log(`================================================================\n`);

  for (const step of steps) {
    process.stdout.write(`[${step.id}] ${step.name}... `);
    try {
      const details = await step.run();
      console.log("PASS");
      if (details) {
        console.log(`       ${details}`);
      }
      passCount++;
    } catch (err: any) {
      console.log("FAIL");
      console.error(`       Error: ${err.message || String(err)}`);
      failCount++;
    }
  }

  console.log(`\n================================================================`);
  console.log(`                      TEST SUMMARY                              `);
  console.log(`================================================================`);
  console.log(`Total steps:  ${steps.length}`);
  console.log(`Passed:       ${passCount}`);
  console.log(`Failed:       ${failCount}`);

  if (failCount > 0) {
    console.error(`\n[GATE CLOSED] ${failCount} test(s) failed!`);
    process.exit(1);
  } else {
    console.log(`\n[GATE OPEN] All Creem.io Webhook gateway tests passed with 100% PASS!`);
  }
}

run().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
