# SPEC_SPRINT3_X402: MCPX Machine-to-Machine (M2M) Monetization & Credit Balance Gateway

## Status: APPROVED (AHP GATE 1)
## Target: Cloudflare Edge (mcpx.harrykrauze.com)

---

## 1. Scope & Architectural Goals
This specification formalizes the autonomous Machine-to-Machine (M2M) billing and credit metering engine for `mcpx`.
It enables coding agents (such as Claude Code, Cursor, and custom autonomous agents) to:
1. Discover tools and capabilities at 0 cost (`tools/list`, `initialize`, `ping`);
2. Execute paid domain tools with atomic credit debit metering;
3. Receive standardized `HTTP 402 Payment Required` with L402 / x402 headers whenever credit balance is insufficient;
4. Support programmatic balance replenishment via `POST /keys/topup` authenticated by `MCPX_MASTER_KEY`;
5. Collect operational telemetry without latency overhead (<0.1 ms) via Cloudflare Workers Analytics Engine.

---

## 2. Data Schema (`src/auth.ts`)

```typescript
export type BillingMode = 'prepaid' | 'postpaid' | 'unlimited';

export interface BillingDetails {
  mode: BillingMode;
  balanceCents: number;             // Integer Euro cents to prevent floating point inaccuracies
  currency: 'EUR';
  costPerToolCallCents: number;     // Base cost for standard tools (default: 1 cent)
  costPerGenerateCents: number;     // Cost for code generation (default: 5 cents)
  totalSpentCents: number;          // Cumulative lifetime spend
  lastTopupAt?: string;             // ISO 8601 timestamp
  lowBalanceThresholdCents: number; // Low balance warning threshold (default: 50 cents)
}

export interface ApiKeyRecord {
  keyId?: string;
  userId: string;
  tenantId?: string;
  description?: string;
  plan: "free" | "pro" | "enterprise";
  status: "active" | "revoked";
  billing?: BillingDetails;
  requestsLimit?: number;
  rateLimit?: number;
  scopes?: string[];
  createdAt?: string;
  expiresAt?: string;
  revokedAt?: string;
}
```

---

## 3. Pricing Matrix

- **Free Operations (0 cents):**
  - `initialize`
  - `notifications/initialized`
  - `tools/list`
  - `ping`
  - `GET /health`
  - `GET /llms.txt`
  - `GET /.well-known/*`
- **Paid Operations:**
  - `evaluate_fraud_transaction`: 1 cent (0.01 EUR)
  - `analyze_jev_semantic_ast`: 1 cent (0.01 EUR)
  - `calculate_u_value_iso6946`: 2 cents (0.02 EUR)
  - `generate_mcp_server`: 5 cents (0.05 EUR)
  - `POST /api/generate`: 5 cents (0.05 EUR)

---

## 4. x402 / L402 Protocol Specification

### 4.1. Response Headers on HTTP 402
```http
HTTP/1.1 402 Payment Required
Content-Type: application/json
WWW-Authenticate: L402 token="mcpx", invoice="https://mcpx.harrykrauze.com/billing/topup?tenant={tenantId}"
X-MCPX-Tenant: {tenantId}
X-MCPX-Balance-Cents: {balanceCents}
X-MCPX-Required-Cents: {cost}
Access-Control-Allow-Origin: *
```

### 4.2. Response Bodies on HTTP 402
- **REST routes (`/api/generate`):**
  ```json
  {
    "error": "Payment Required: Insufficient credit balance.",
    "code": 402,
    "tenantId": "{tenantId}",
    "balanceCents": 0,
    "requiredCents": 5,
    "invoice": "https://mcpx.harrykrauze.com/billing/topup?tenant={tenantId}"
  }
  ```
- **MCP JSON-RPC routes (`/message`, `/mcp/messages`):**
  ```json
  {
    "jsonrpc": "2.0",
    "id": 1,
    "error": {
      "code": 402,
      "message": "Payment Required: Insufficient credit balance. Required: 1 cents, available: 0 cents. Top up at: https://mcpx.harrykrauze.com/billing/topup?tenant={tenantId}",
      "data": {
        "tenantId": "{tenantId}",
        "balanceCents": 0,
        "requiredCents": 1,
        "invoice": "https://mcpx.harrykrauze.com/billing/topup?tenant={tenantId}"
      }
    }
  }
  ```

### 4.3. Success Response Headers
When `balanceCents < lowBalanceThresholdCents`:
- `X-MCPX-Low-Balance: true`
- `X-MCPX-Balance-Cents: {balanceCents}`

---

## 5. Verification Gate Criteria
- TypeScript static check passes (`npx tsc --noEmit`) with 0 errors.
- Test suite `scripts/test-x402-billing.ts` passes steps B.1 through B.8 with 100% success.
- Zero regressions across existing tool tests (`test:domain-tools`, `test:client-connection`, `test:telemetry`).
