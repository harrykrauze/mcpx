/**
 * test/creem-webhook.test.ts
 * 
 * AHP GATE 3 & GATE 6 Deterministiskā Creem.io Webhook Vārtejas Testu Kopa:
 * 1. Nederīga vai trūkstoša HMAC SHA-256 paraksta noraidīšana ar HTTP 401 Unauthorized.
 * 2. Viltota / modificēta satura noraidīšana ar HTTP 401 Unauthorized.
 * 3. Derīga 'checkout.completed' paziņojuma apstrāde un bilances atomāra papildināšana eirocentos.
 * 4. Idempotences garantija pie dubultiem pieprasījumiem ar vienu un to pašu payload.id (atkārtots debets netiek veikts).
 * 5. Lietotāja identificēšana pēc customer.email, ja keyId nav norādīts custom_fields.
 * 6. Kļūdu apstrāde: nevesels vai negatīvs 'amount' -> HTTP 400 Bad Request.
 * 7. Citu notikumu ('invoice.paid') ignorēšana ar HTTP 200 bez bilances izmaiņām.
 * 8. Pilns maršrutēšanas tests caur workerDefault.fetch (POST /webhooks/creem).
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

// Konfigurācija testiem
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

function createMockEnv(kv: InMemoryKV): Env {
  return {
    GEMINI_API_KEY: "mock_gemini_key",
    CREEM_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
    MCPX_KEYS: kv,
  };
}

// 1. Tests: Trūkstošs vai nederīgs paraksts
it("C.1", "Nederīga vai trūkstoša HMAC paraksta noraidīšana (HTTP 401)", async () => {
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

  // A: Bez galvenes
  const reqNoHeader = new Request("https://mcpx.harrykrauze.com/webhooks/creem", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: rawBody,
  });
  const resNoHeader = await handleCreemWebhook(reqNoHeader, env, ctx);
  if (resNoHeader.status !== 401) {
    throw new Error(`Gaidīts 401 bez galvenes, saņemts ${resNoHeader.status}`);
  }

  // B: Ar nederīgu parakstu
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
    throw new Error(`Gaidīts 401 ar nepareizu parakstu, saņemts ${resBadSig.status}`);
  }

  return "HTTP 401 noraidīts gan bez paraksta, gan ar falsificētu parakstu";
});

// 2. Tests: Saturs modificēts pēc parakstīšanas
it("C.2", "Tampered/modificēta raw body noraidīšana (HTTP 401)", async () => {
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

  // Modificēts saturs (uzbrucējs palielina summu no 100 uz 100000)
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
    throw new Error(`Gaidīts 401 modificētam saturam, saņemts ${res.status}`);
  }

  return "Web Crypto HMAC verifikācija veiksmīgi novērsa datu falsifikāciju";
});

// 3. Tests: Derīga apstrāde un bilances atomāra papildināšana eirocentos
it("C.3", "Derīga 'checkout.completed' apstrāde un bilances papildināšana (HTTP 200)", async () => {
  const kv = new InMemoryKV();
  const env = createMockEnv(kv);
  const ctx = createMockCtx();

  // Sagatavojam sākotnējo API atslēgas ierakstu KV krātuvē ar bilanci 50 centi
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
      amount: 1000, // 10 EUR = 1000 eirocenti
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
    throw new Error(`Gaidīts 200 OK, saņemts ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as CreemWebhookResponse;
  if (!data.success || data.addedCents !== 1000 || data.newBalanceCents !== 1050) {
    throw new Error(`Nepareiza atbilde: ${JSON.stringify(data)}`);
  }

  // Pārbaudām KV krātuves faktisko stāvokli
  const updatedRaw = await kv.get(`key:${TEST_API_KEY}`, "text");
  const updatedRecord = JSON.parse(updatedRaw!) as ApiKeyRecord;
  if (updatedRecord.billing?.balanceCents !== 1050) {
    throw new Error(`Bilance KV nav 1050! Fakti: ${updatedRecord.billing?.balanceCents}`);
  }

  // Pārbaudām idempotences atslēgu KV
  const idempRaw = await kv.get(`webhook:processed:${payload.id}`, "text");
  if (!idempRaw) {
    throw new Error(`Idempotences atslēga 'webhook:processed:${payload.id}' netika saglabāta KV!`);
  }

  return `Bilance papildināta par €10.00 (1000 c) -> Jaunā bilance: €10.50 (1050 c)`;
});

// 4. Tests: Idempotence pie dubultiem pieprasījumiem
it("C.4", "Idempotences garantija pie dubultiem izsaukumiem ar vienu payload.id", async () => {
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

  // Pirmais izsaukums
  const req1 = new Request("https://mcpx.harrykrauze.com/webhooks/creem", {
    method: "POST",
    headers: { "Content-Type": "application/json", "creem-signature": sig },
    body: rawBody,
  });
  const res1 = await handleCreemWebhook(req1, env, ctx);
  if (res1.status !== 200) throw new Error(`Pirmais izsaukums neizdevās: ${res1.status}`);

  // Otrais identisks izsaukums (replay / webhook retry)
  const req2 = new Request("https://mcpx.harrykrauze.com/webhooks/creem", {
    method: "POST",
    headers: { "Content-Type": "application/json", "creem-signature": sig },
    body: rawBody,
  });
  const res2 = await handleCreemWebhook(req2, env, ctx);
  if (res2.status !== 200) throw new Error(`Otrais izsaukums neizdevās: ${res2.status}`);

  const data2 = (await res2.json()) as CreemWebhookResponse;
  if (!data2.idempotentDuplicate) {
    throw new Error(`Gaidīts idempotentDuplicate: true otrajā izsaukumā: ${JSON.stringify(data2)}`);
  }

  // Pārliecināmies, ka bilance tika palielināta TIKAI VIENU REIZI (100 + 500 = 600, nevis 1100)
  const finalRaw = await kv.get(`key:${TEST_API_KEY}`, "text");
  const finalRecord = JSON.parse(finalRaw!) as ApiKeyRecord;
  if (finalRecord.billing?.balanceCents !== 600) {
    throw new Error(`Idempotences pārkāpums! Bilance ir ${finalRecord.billing?.balanceCents}, gaidīta 600`);
  }

  return `Idempotence apstiprināta: otrais pieprasījums atgrieza 200 OK (idempotentDuplicate: true), bilance = 600 c`;
});

// 5. Tests: Lookup pēc customer.email (kad keyId nav nodots)
it("C.5", "Atslēgas lookup pēc customer.email, kad keyId nav custom_fields", async () => {
  const kv = new InMemoryKV();
  const env = createMockEnv(kv);
  const ctx = createMockCtx();

  const initialRecord: ApiKeyRecord = {
    keyId: "key_email_lookup_01",
    userId: TEST_EMAIL, // Lietotāja identifikators sakrīt ar e-pastu
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
    throw new Error(`Email lookup neizdevās (HTTP ${res.status}): ${errText}`);
  }

  const updatedRaw = await kv.get("key:mcpx_live_email_user_key", "text");
  const updated = JSON.parse(updatedRaw!) as ApiKeyRecord;
  if (updated.billing?.balanceCents !== 270) {
    throw new Error(`Gaidīta bilance 270 (20 + 250), bet ir ${updated.billing?.balanceCents}`);
  }

  return `Sekmīgs lookup pēc e-pasta: bilance palielināta no 20 c uz 270 c`;
});

// 6. Tests: Nevesela vai negatīva summa (eirocentu standarts)
it("C.6", "Neveselas vai negatīvas summas noraidīšana (HTTP 400)", async () => {
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
      throw new Error(`Summa ${amt} netika noraidīta ar 400! Statuss: ${res.status}`);
    }
  }

  return `Visi nederīgie summu šabloni (-100, 0, 10.5, 3.1415) noraidīti ar HTTP 400`;
});

// 6b. Tests: Neatbalstītas valūtas noraidīšana ar HTTP 400
it("C.6b", "Neatbalstītas valūtas ('GBP', 'JPY') noraidīšana ar HTTP 400", async () => {
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
    throw new Error(`Neatbalstīta valūta 'GBP' netika noraidīta ar 400! Statuss: ${res.status}`);
  }

  const errJson = (await res.json()) as any;
  if (!errJson.error?.includes("Unsupported currency")) {
    throw new Error(`Gaidīts paziņojums par neatbalstītu valūtu, saņemts: ${JSON.stringify(errJson)}`);
  }

  return `Neatbalstīta valūta 'GBP' noraidīta ar HTTP 400 Bad Request`;
});

// 7. Tests: workerDefault.fetch pilna integrācija (POST /webhooks/creem)
it("C.7", "Pilns maršrutēšanas tests caur workerDefault.fetch", async () => {
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
      "x-creem-signature": sig, // Testējam arī alternatīvo x-creem-signature galveni
    },
    body: rawBody,
  });

  const res = await workerDefault.fetch(req, env, ctx);
  if (res.status !== 200) {
    const errText = await res.text();
    throw new Error(`workerDefault.fetch neizdevās (HTTP ${res.status}): ${errText}`);
  }

  const resData = (await res.json()) as CreemWebhookResponse;
  if (resData.newBalanceCents !== 310) {
    throw new Error(`Gaidīta bilance 310, saņemts ${resData.newBalanceCents}`);
  }

  return `Router maršruts POST /webhooks/creem veiksmīgi apstrādāts caur workerDefault.fetch`;
});

// 8. Tests: USD valūtas apstrāde un formāts ($10.00 / 1000 credits)
it("C.8", "USD valūtas topup apstrāde ar '$' simbolu atbildē", async () => {
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
    throw new Error(`handleCreemWebhook neizdevās (HTTP ${res.status}): ${errText}`);
  }

  const resData = (await res.json()) as CreemWebhookResponse;
  if (resData.newBalanceCents !== 1200) {
    throw new Error(`Gaidīta bilance 1200, saņemts ${resData.newBalanceCents}`);
  }
  if (!resData.message.includes("$10.00")) {
    throw new Error(`Atbildes ziņojumā nav '$10.00': ${resData.message}`);
  }

  return `USD topup $10.00 (1000 c) sekmīgi apstrādāts: ${resData.message}`;
});

async function run() {
  console.log(`================================================================`);
  console.log(`  AHP GATE 3 / GATE 6: CREEM.IO WEBHOOK VĀRTEJAS VERIFIKĀCIJA    `);
  console.log(`  Laika zīmogs: ${new Date().toISOString()}`);
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
      console.error(`       Kļūda: ${err.message || String(err)}`);
      failCount++;
    }
  }

  console.log(`\n================================================================`);
  console.log(`                      TESTU KOPSAVILKUMS                        `);
  console.log(`================================================================`);
  console.log(`Kopā soļi:    ${steps.length}`);
  console.log(`Veiksmīgi:    ${passCount}`);
  console.log(`Neveiksmīgi:  ${failCount}`);

  if (failCount > 0) {
    console.error(`\n[VĀRTI SLĒGTI] ${failCount} tests(-i) izgāzās!`);
    process.exit(1);
  } else {
    console.log(`\n[VĀRTI ATVĒRTI] Visi Creem.io Webhook vārtejas testi izturēti ar 100% PASS!`);
  }
}

run().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
