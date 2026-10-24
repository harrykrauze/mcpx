# Agentic Harness Protocol (AHP) — mcpx Project Operational Framework

This document defines the Six Phase Gate (Gates 1–6) procedure, deterministic constraints, and engineering quality standards for maintaining and advancing the `mcpx` project in the Google Antigravity environment.

---

## AHP Core Axioms

1. **No Vibe Coding:** Modifying codebase files without an approved `/spec` is strictly forbidden. Every single line of changed code must be grounded in an approved specification requirement.
2. **No Head Math:** Numerical calculations, bitshifts, CIDR/subnet range math, token clock-skew, and performance benchmarks must never be computed via LLM mental hallucinations. All computations must be delegated to deterministic scripts (Python, Node.js, or PowerShell CLI) and backed by automated tests.
3. **Context Hygiene:** Secrets (`.env`, private keys, JWT secrets) and local build caches must never be committed to the Git index or passed to untrusted environments.
4. **Strict Network Boundary Enforcement:** All outbound network calls must enforce strict SSRF protection (blocking RFC 1918, link-local, loopback addresses), origin locking, and redirect stripping.

---

## Six Phase Gate System

### GATE 1: `/spec` (Specification & Threat Analysis)
- **Objective:** Develop a comprehensive technical specification before touching code.
- **Requirements:**
  - Threat modeling and risk analysis.
  - Precise data types, validation schemas (Zod / JSON Schema / Pydantic), and interfaces.
  - Error handling and security boundaries (SSRF filters, OAuth 2.1 RFCs, rate limits).
- **Verification Gate:** Execution is HALTED prior to code edits until human operator approval is granted.

### GATE 2: `/build` (Atomic Implementation)
- **Objective:** Perform minimal, precise, and atomic codebase modifications according to the approved `/spec`.
- **Requirements:**
  - Strict type safety (TypeScript `strict: true`, zero unjustified `any` types).
  - Zero tolerance policy against unvalidated external input.
- **Verification Gate:** `npx tsc --noEmit` must return exactly 0 errors (Exit code 0).

### GATE 3: `/test` (Deterministic Verification)
- **Objective:** Validate behavioral correctness and boundary cases using automated test scripts.
- **Requirements:**
  - Negative tests: unauthorized requests (401), private/metadata IP blocking (SSRF), rate limiting.
  - Positive tests: authenticated flows, token exchange, permitted HTTPS calls.
  - Rate limiting verification and `Retry-After` headers.
- **Verification Gate:** All automated tests must execute with 100% pass rate (`Exit code 0`).

### GATE 4: `/audit` (Security & Compliance Audit)
- **Objective:** Audit the codebase against known vulnerabilities and industry standards.
- **Requirements:**
  - Review discovered vulnerability matrices (`AUDIT_MCPX_REPORT.md`).
  - Verify P1 (Critical) and P2 (High) vulnerabilities, marking remediation status as `RESOLVED`.
  - RFC compliance audit: OAuth 2.1 (RFC 6749bis), RFC 8414, RFC 9728, RFC 7517.
  - **Credential Pinning & Origin Isolation:** Prohibit forwarding secret headers (`Authorization`, `x-api-key`) to external URLs unless destination matches `ALLOWED_ORIGIN`. Strip secret headers on 301/302 redirects or disable redirects (`redirect: 'manual'`).
- **Verification Gate:** `AUDIT_MCPX_REPORT.md` contains complete audit log and sign-off.

### GATE 5: `/ship` (Deployment Readiness & Edge Gateway)
- **Objective:** Prepare and verify deployment configuration and infrastructure.
- **Requirements:**
  - `wrangler.jsonc` configuration verification (Cloudflare Workers, KV bindings, Rate Limiter).
  - Machine-readable specifications availability (`/llms.txt`, Schema.org metadata, discovery endpoints).
  - Dry-run simulation (`npx wrangler deploy --dry-run`).
  - **CDN Header Normalization:** When verifying SSE streaming behind Cloudflare Edge or reverse proxies, use `Content-Type: text/event-stream` and `Cache-Control: no-cache, no-transform` as baseline criteria. Do not fail if CDN strips hop-by-hop headers (e.g., `X-Accel-Buffering`).
- **Verification Gate:** Successful dry-run simulation and production smoke test execution (`DEPLOY_GATE5_REPORT.md`).

### GATE 6: `/dream` (Post-Execution Consolidation & Agent Memory)
- **Objective:** Consolidate learnings and prepare the system for subsequent development cycles.
- **Requirements:**
  - Document findings and architectural decisions (`SPEC_GATE6_CREEM_WEBHOOK.md`).
  - Update backlog (P3/P4 low-risk improvements).
  - Update agent rules and schemas.
  - **USD Integer Cents Standard:** Balances, debits, credits, and rates are stored and computed ONLY in integer cents (`balanceCents`, `totalSpentCents`, where 1 credit = 1 cent = $0.01 USD). Floating-point arithmetic and rounding in runtime code are strictly prohibited; all financial ledgers are strict integers.
  - **Financial Unit Terminology:** Strict prohibition against tying balance to LLM tokens or memory size. The sole unit is monetary credits / USD cents ($).
  - **Ladder of Trust Law:** `tools/list`, `initialize`, `/llms.txt`, `/health`, and other discovery requests are always free (`costCents: 0`, $0.00).
  - **x402 / L402 Interception:** If `balanceCents < toolCost`, the request MUST be intercepted with `HTTP 402 Payment Required`, including header `WWW-Authenticate: L402 invoice="..."` and exact shortfall in USD cents.
  - **Warning Threshold:** If balance after debit is `< 10` cents ($0.10), response must include header `X-MCPX-Low-Balance: true`.
  - **Creem.io Webhook Gateway:** Deterministic, type-safe webhook gateway with HMAC SHA-256 Web Crypto signature verification and 7-day KV idempotency guarantee (`webhook:processed:${id}`).
  - **Asynchronous Telemetry Standard:** Telemetry recording must utilize `ctx.waitUntil(...)` without blocking client response latency (<0.1 ms overhead).
  - **Graceful Degradation:** Absence of telemetry binding (`env.ANALYTICS === undefined` or quota exhaustion) must NEVER trigger HTTP 500 or break core MCP/API services. All telemetry errors are silently caught (`try/catch`).
  - **Strict Telemetry Schema (Analytics Engine Contract):** Standardize `blobs` [tenantId, method, toolName, status, clientType], `doubles` [executionTimeMs, statusCode, payloadSizeBytes], and `indexes` [tenantId] across all edge services.
