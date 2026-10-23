# SPEC_GATE6_CREEM_WEBHOOK: mcpx GATE 6 Konsolidācija & Creem.io Webhook Vārteja

## Statuss: APPROVED (AHP GATE 1 / GATE 6)
## Mērķa Platforma: Cloudflare Edge Workers & KV (`mcpx.harrykrauze.com`)

---

## 1. Mērķis un Arhitektūras Ietvars

Šī specifikācija formalizē `mcpx` AHP GATE 6 (/dream) konsolidācijas fāzi un Creem.io fiat maksājumu webhook vārteju. Tā nodrošina deterministisku, tipdrošu un drošu tiltu starp Creem.io norēķinu sistēmu un Cloudflare Workers KV bilances krātuvi.

### Pamatprincipi:
1. **Eirocentu Standarts:** Visas bilances (`balanceCents`), patēriņi (`totalSpentCents`), tarifi un maksājumi tiek glabāti un rēķināti **TIKAI kā veseli eirocenti (`integer eurocents`)**. Peldošā komata skaitļi (`float`) un decimāldaļas runtime biznesa loģikā ir kategoriski aizliegtas.
2. **Finanšu Terminoloģija:** Bilance tiek mērīta tikai naudas vienībās (eirocentos), kategoriski aizliedzot to jaukt ar LLM žetoniem (*tokens*) vai atmiņas apjomu.
3. **Ladder of Trust:** Rīku un servisu atklāšanas operācijas (`initialize`, `notifications/initialized`, `tools/list`, `ping`, `/health`, `/llms.txt`, `/.well-known/*`) vienmēr ir 0 eirocentu vērtībā (`costCents: 0`).
4. **x402 / L402 Pārtveršana:** Ja `balanceCents < toolCost`, pieprasījums tiek pārtverts ar `HTTP 402 Payment Required`, ģenerējot L402 `WWW-Authenticate` galveni un trūkstošo summu.
5. **Zemas Bilances Brīdinājums:** Ja pēc debeta atlikusī bilance ir `< 10` eirocenti, atbildē obligāti tiek iekļauta galvene `X-MCPX-Low-Balance: true`.
6. **Kriptogrāfiskā Pārbaude:** Creem.io Webhook autentiskums tiek pārbaudīts tikai ar W3C Web Crypto API (`crypto.subtle`) HMAC SHA-256 hešu un timing-safe salīdzināšanu. Aizliegts izmantot ārējas smagas bibliotēkas.
7. **Idempotence & KV TTL:** Webhook apstrāde ir 100% idempotenta, fiksējot `webhook:processed:${payload.id}` ar 7 dienu TTL (604800 sek.).
8. **Asinhronā Telemetrija:** Notikums `creem_fiat_topup` tiek reģistrēts Analytics Engine bez klienta bloķēšanas ar `ctx.waitUntil`.

---

## 2. Tipu Shēmas (`src/types/creem.ts`)

```typescript
export interface CreemCustomer {
  id: string;
  email: string;
}

export interface CreemOrderData {
  id: string;
  order_id: string;
  customer: CreemCustomer;
  amount: number; // eirocentos (integer)
  currency: 'EUR';
  custom_fields?: {
    key_id?: string;
    [key: string]: string | undefined;
  };
  metadata?: Record<string, string>;
}

export interface CreemWebhookPayload {
  id: string;
  event: 'checkout.completed';
  created_at: string;
  data: CreemOrderData;
}

export interface WebhookResult {
  success: boolean;
  idempotentDuplicate?: boolean;
  keyId?: string;
  tenantId?: string;
  addedCents?: number;
  newBalanceCents?: number;
  orderId?: string;
  message: string;
}
```

---

## 3. Kriptogrāfiskā Validācija (`src/services/creemSignature.ts`)

### Drošības Prasības:
- Pārbauda galveni `creem-signature` (vai rezerves `x-creem-signature`).
- Ja galvene trūkst vai ir tukša -> `false`.
- Ja `secret` nav konfigurēts -> met izņēmumu (500 Server Error).
- Izmanto tikai Web Crypto API:
  1. `crypto.subtle.importKey("raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["verify"])`
  2. Pārvērš heksadecimālo hešu par `Uint8Array`.
  3. `crypto.subtle.verify("HMAC", key, signatureBytes, rawBodyBytes)`.
- Aizsardzība pret timing uzbrukumiem tiek nodrošināta Web Crypto dziļajā līmenī.

---

## 4. Webhook Apstrādātājs (`src/routes/webhooks.ts`)

### Maršruts: `POST /webhooks/creem`
1. **Raw Body Iegūšana:** `const rawBody = await request.text();` pirms jebkādas JSON parsēšanas.
2. **Paraksta Pārbaude:** Izsauc `verifyCreemSignature(rawBody, signature, env.CREEM_WEBHOOK_SECRET)`. Ja nederīgs -> atgriež `HTTP 401 Unauthorized`.
3. **Idempotences Pārbaude:**
   - Nolasa KV atslēgu `webhook:processed:${payload.id}`.
   - Ja atrodama -> atgriež `HTTP 200 OK` ar statusu `idempotentDuplicate: true` un pārtrauc tālāku apstrādi.
4. **API Atslēgas Identifikācija:**
   - 1. prioritāte: `payload.data.custom_fields?.key_id`
   - 2. prioritāte: `payload.data.metadata?.keyId` vai `payload.data.metadata?.key_id`
   - 3. prioritāte: lookup pēc `payload.data.customer.email` (ja atrodama `id:${email}`, `key:${email}` vai ieraksta `userId` / `tenantId` sakrīt ar e-pastu).
   - Ja atslēga netiek atrasta -> atgriež `HTTP 404 Not Found` ar kļūdas paziņojumu.
5. **Atomārā Bilances Papildināšana:**
   - Iegūst esošo `ApiKeyRecord`.
   - Palielina `billing.balanceCents += payload.data.amount`.
   - Atjaunina `billing.lastTopupAt = new Date().toISOString()`.
   - Saglabā `key:${actualKey}` KV krātuvē.
6. **Idempotences Atslēgas Ieraksts:**
   - Ieraksta KV `webhook:processed:${payload.id}` ar saturu `{ processedAt, orderId, keyId, amount }` un `expirationTtl: 604800` (7 dienas).
7. **Asinhronā Telemetrija:**
   - Izsauc `recordTelemetry` ar `method: "creem_fiat_topup"`, `toolName: payload.data.order_id`, `costCents: payload.data.amount`, `status: "success"`.
8. **Atbilde:** Atgriež `HTTP 200 OK` ar papildināšanas statusu.
