/**
 * src/routes/webhooks.ts
 * 
 * Creem.io Webhook Vārtejas Apstrādātājs.
 * Nodrošina HMAC SHA-256 verifikāciju, KV idempotenci (7 dienas) un bilances atomāru papildināšanu USD/EUR centos.
 */

import { Env, ExecutionContext, recordTelemetry, ApiKeyRecord, computeKeyId } from "../auth";
import { CreemWebhookPayload, CreemWebhookResponse } from "../types/creem";
import { verifyCreemSignature } from "../services/creemSignature";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, creem-signature, x-creem-signature, Authorization",
};

export async function handleCreemWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const startTime = Date.now();

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method Not Allowed. Use POST." }),
      { status: 405, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
    );
  }

  // 1. Slepenās atslēgas esamības pārbaude
  const webhookSecret = env.CREEM_WEBHOOK_SECRET || process.env.CREEM_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("CREEM_WEBHOOK_SECRET is not configured.");
    return new Response(
      JSON.stringify({ error: "Server Configuration Error: Webhook secret not configured." }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
    );
  }

  // 2. Neapstrādāta ķermeņa (raw body) nolasīšana precīzai HMAC verifikācijai
  const rawBody = await request.text();
  const signatureHeader = request.headers.get("creem-signature") || request.headers.get("x-creem-signature");

  // 3. Kriptogrāfiskā paraksta pārbaude
  const isValidSignature = await verifyCreemSignature(rawBody, signatureHeader, webhookSecret);
  if (!isValidSignature) {
    const executionTimeMs = Date.now() - startTime;
    recordTelemetry(env, ctx, {
      tenantId: "creem-unauthorized",
      method: "creem_fiat_topup",
      toolName: "signature_verification_failed",
      status: "security_violation",
      clientType: "creem-webhook",
      executionTimeMs,
      statusCode: 401,
      payloadSizeBytes: rawBody.length,
    });

    return new Response(
      JSON.stringify({ error: "Unauthorized: Invalid or missing Creem webhook signature." }),
      { status: 401, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
    );
  }

  // 4. JSON parsēšana un shēmas pārbaude
  let payload: CreemWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as CreemWebhookPayload;
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: "Bad Request: Malformed JSON payload.", details: err?.message }),
      { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
    );
  }

  if (!payload || !payload.id || !payload.event) {
    return new Response(
      JSON.stringify({ error: "Bad Request: Missing required webhook fields (id, event)." }),
      { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
    );
  }

  // Apstrādājam tikai 'checkout.completed' notikumus
  if (payload.event !== "checkout.completed") {
    return new Response(
      JSON.stringify({
        success: true,
        message: `Webhook event '${payload.event}' ignored. Only 'checkout.completed' is handled.`,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
    );
  }

  // Validējam summu un valūtu
  const amount = payload.data?.amount;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) {
    return new Response(
      JSON.stringify({ error: "Bad Request: 'data.amount' must be a positive integer in cents." }),
      { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
    );
  }

  if (payload.data?.currency !== "USD" && payload.data?.currency !== "EUR") {
    return new Response(
      JSON.stringify({ error: "Bad Request: Unsupported currency. Only 'USD' and 'EUR' are allowed." }),
      { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
    );
  }

  if (!env.MCPX_KEYS) {
    return new Response(
      JSON.stringify({ error: "Storage not configured on server." }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
    );
  }

  // 5. Idempotences pārbaude (KV atslēga webhook:processed:${payload.id})
  const idempotencyKey = `webhook:processed:${payload.id}`;
  const existingProcessed = await env.MCPX_KEYS.get(idempotencyKey, "text");
  if (existingProcessed) {
    try {
      const parsed = JSON.parse(existingProcessed);
      return new Response(
        JSON.stringify({
          success: true,
          idempotentDuplicate: true,
          message: "Webhook event already processed (idempotent duplicate).",
          keyId: parsed.keyId,
          tenantId: parsed.tenantId,
          addedCents: parsed.amountCents,
          orderId: payload.data.order_id,
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
      );
    } catch {
      return new Response(
        JSON.stringify({
          success: true,
          idempotentDuplicate: true,
          message: "Webhook event already processed.",
          orderId: payload.data.order_id,
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
      );
    }
  }

  // 6. API atslēgas identifikācija:
  // Prioritāte 1: custom_fields.key_id
  // Prioritāte 2: metadata.keyId vai metadata.key_id
  // Prioritāte 3: customer.email lookup
  const targetKeyId = (
    payload.data.custom_fields?.key_id ||
    payload.data.metadata?.keyId ||
    payload.data.metadata?.key_id ||
    ""
  ).trim();

  const customerEmail = payload.data.customer?.email?.trim().toLowerCase();

  let actualKey: string | null = null;
  let rawRecord: string | null = null;

  // A. Meklēšana pēc keyId
  if (targetKeyId) {
    const mappedKey = await env.MCPX_KEYS.get(`id:${targetKeyId}`, "text");
    if (mappedKey) {
      actualKey = mappedKey.trim();
      rawRecord = await env.MCPX_KEYS.get(`key:${actualKey}`, "text");
    }

    if (!rawRecord) {
      const directKeyRecord = await env.MCPX_KEYS.get(`key:${targetKeyId}`, "text");
      if (directKeyRecord) {
        actualKey = targetKeyId;
        rawRecord = directKeyRecord;
      }
    }

    if (!rawRecord) {
      const listRes = await env.MCPX_KEYS.list({ prefix: "key:" });
      for (const k of listRes.keys) {
        const candidateRaw = await env.MCPX_KEYS.get(k.name, "text");
        if (candidateRaw) {
          try {
            const candRecord = JSON.parse(candidateRaw.replace(/^\uFEFF/, "").trim()) as ApiKeyRecord;
            const computedId = candRecord.keyId || (await computeKeyId(k.name.slice(4)));
            if (candRecord.keyId === targetKeyId || computedId === targetKeyId) {
              actualKey = k.name.slice(4);
              rawRecord = candidateRaw;
              break;
            }
          } catch {
            // Ignorēt
          }
        }
      }
    }
  }

  // B. Lookup pēc customer.email (ja keyId nav vai netika atrasts)
  if (!rawRecord && customerEmail) {
    const emailMappedKey = await env.MCPX_KEYS.get(`email:${customerEmail}`, "text");
    if (emailMappedKey) {
      actualKey = emailMappedKey.trim();
      rawRecord = await env.MCPX_KEYS.get(`key:${actualKey}`, "text");
    }

    if (!rawRecord) {
      const listRes = await env.MCPX_KEYS.list({ prefix: "key:" });
      for (const k of listRes.keys) {
        const candidateRaw = await env.MCPX_KEYS.get(k.name, "text");
        if (candidateRaw) {
          try {
            const candRecord = JSON.parse(candidateRaw.replace(/^\uFEFF/, "").trim()) as ApiKeyRecord;
            if (
              candRecord.userId?.toLowerCase() === customerEmail ||
              candRecord.tenantId?.toLowerCase() === customerEmail ||
              (candRecord.description && candRecord.description.toLowerCase().includes(customerEmail))
            ) {
              actualKey = k.name.slice(4);
              rawRecord = candidateRaw;
              break;
            }
          } catch {
            // Ignorēt
          }
        }
      }
    }
  }

  if (!rawRecord || !actualKey) {
    return new Response(
      JSON.stringify({
        error: "Not Found: API key record not found for specified keyId or customer email.",
        details: { keyId: targetKeyId || null, email: customerEmail || null },
      }),
      { status: 404, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
    );
  }

  // 7. Atomārā bilances papildināšana eirocentos
  const record = JSON.parse(rawRecord.replace(/^\uFEFF/, "").trim()) as ApiKeyRecord;
  if (!record.billing) {
    record.billing = {
      mode: "prepaid",
      balanceCents: 0,
      currency: "USD",
      costPerToolCallCents: 1,
      costPerGenerateCents: 5,
      totalSpentCents: 0,
      lowBalanceThresholdCents: 10,
    };
  }

  record.billing.balanceCents += amount;
  record.billing.lastTopupAt = new Date().toISOString();

  // Saglabājam atjaunoto atslēgas ierakstu
  await env.MCPX_KEYS.put(`key:${actualKey}`, JSON.stringify(record));

  // 8. Saglabājam idempotences atslēgu ar TTL 7 dienas (604800 sek.)
  const resolvedKeyId = record.keyId || targetKeyId || (await computeKeyId(actualKey));
  const resolvedTenantId = record.tenantId || record.userId;

  await env.MCPX_KEYS.put(
    idempotencyKey,
    JSON.stringify({
      processedAt: new Date().toISOString(),
      orderId: payload.data.order_id,
      keyId: resolvedKeyId,
      tenantId: resolvedTenantId,
      amountCents: amount,
    }),
    { expirationTtl: 604800 }
  );

  // 9. Asinhronā telemetrija: creem_fiat_topup
  const executionTimeMs = Date.now() - startTime;
  recordTelemetry(env, ctx, {
    tenantId: resolvedTenantId,
    method: "creem_fiat_topup",
    toolName: payload.data.order_id,
    status: "success",
    clientType: "creem-webhook",
    executionTimeMs,
    statusCode: 200,
    payloadSizeBytes: rawBody.length,
    costCents: amount,
  });

  const currencySymbol = payload.data?.currency === "EUR" ? "€" : "$";
  const responsePayload: CreemWebhookResponse = {
    success: true,
    message: `Creem topup of ${currencySymbol}${(amount / 100).toFixed(2)} (${amount} c) applied successfully.`,
    keyId: resolvedKeyId,
    tenantId: resolvedTenantId,
    addedCents: amount,
    newBalanceCents: record.billing.balanceCents,
    orderId: payload.data.order_id,
  };

  return new Response(JSON.stringify(responsePayload), {
    status: 200,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
