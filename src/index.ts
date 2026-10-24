import {
  requireAuth,
  validateMasterAuth,
  recordUsage,
  generateApiKey,
  computeKeyId,
  ApiKeyRecord,
  ProvisionKeyPayload,
  BillingMode,
  BillingDetails,
  AnalyticsEngineDataPoint,
  AnalyticsEngineDataset,
  Env,
  ExecutionContext,
  TelemetryPoint,
  ScheduledController,
  LowBalanceRecord,
  DailyAuditSummary,
  detectClientType,
  recordTelemetry,
} from "./auth";
import { generateMcpSpec } from "./gemini";
import {
  calculateUValueIso6946,
  analyzeJevSemanticAst,
  UValueCalculationInput,
  JevAstInput,
  TOOL_ALIASES,
  resolveCanonicalToolName,
} from "./tools/domainTools";
import { handleCreemWebhook } from "./routes/webhooks";
import { renderDashboardHtml, HealthStatus } from "./views/dashboard";
import { INDEXNOW_KEY, INDEXNOW_KEY_FILE, submitIndexNow } from "./indexnow";

export type { Env, ExecutionContext, TelemetryPoint, HealthStatus, ScheduledController, LowBalanceRecord, DailyAuditSummary };
export { detectClientType, recordTelemetry, renderDashboardHtml, TOOL_ALIASES, resolveCanonicalToolName, LLMS_TXT_CONTENT, LLMS_FULL_TXT_CONTENT, INDEXNOW_KEY, INDEXNOW_KEY_FILE, submitIndexNow };

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id, X-Master-Key",
  "Access-Control-Expose-Headers": "WWW-Authenticate, X-MCPX-Tenant, X-MCPX-Balance-Cents, X-MCPX-Required-Cents, X-MCPX-Low-Balance, Link, X-MCP-Discovery",
  "Link": '<https://mcpx.harrykrauze.com/llms.txt>; rel="llms-txt", <https://mcpx.harrykrauze.com/llms-full.txt>; rel="llms-full-txt"',
  "X-MCP-Discovery": "https://mcpx.harrykrauze.com/mcp/sse",
};

const LLMS_TXT_CONTENT = `# mcpx gateway

> Deterministic Model Context Protocol (MCP) Edge Gateway with native x402 machine billing.
> Hosted on Cloudflare Workers V8 Mesh with sub-250ms deterministic execution.

## System Overview
mcpx bridges autonomous LLM agents and edge tooling via isolated V8 execution environments. It meters compute usage deterministically through native HTTP 402 protocols and bearer keys (\`mcpx_live_...\`).

## x402 Pricing Matrix (Ladder of Trust)
| Operation Tier | MCP Methods / Scope | Rate (USD) | Credit Cost | Trust Tier |
| :--- | :--- | :--- | :--- | :--- |
| Discovery | \`tools/list\`, \`initialize\`, \`/llms.txt\` | \$0.00 | 0 credits | Discovery Free Tier |
| Tier 1: AST Security | \`analyze_jev_semantic_ast\` | \$0.01 | 1 credit | Agent Work Session |
| Tier 1: Fraud Risk | \`evaluate_fraud_transaction\` | \$0.01 | 1 credit | Real-time Decisioning |
| Tier 2: Physics | \`calculate_u_value_iso6946\` | \$0.02 | 2 credits | ISO Standards Engine |
| Tier 3: Compiler | \`generate_mcp_server\` | \$0.05 | 5 credits | Full Synthesis Cycle |

## Gateway Endpoints
- MCP Remote SSE Endpoint: \`GET https://mcpx.harrykrauze.com/mcp/sse\`
- Direct REST Execution: \`POST https://mcpx.harrykrauze.com/tools/execute\`
- Balance Verification: \`POST https://mcpx.harrykrauze.com/keys/verify\`
- Full Schema Specification: \`https://mcpx.harrykrauze.com/llms-full.txt\`
- Interactive Terminal: \`https://mcpx.harrykrauze.com/\`

## Authentication & Billing Protocol
1. Pass bearer token: \`Authorization: Bearer mcpx_live_<token>\`
2. Free discovery calls (\`tools/list\`, \`initialize\`, \`/llms.txt\`) require zero balance and deduct 0 credits.
3. If balance is insufficient for Tier 1–3 tools, the gateway emits \`HTTP 402 Payment Required\` with \`WWW-Authenticate: L402\` and top-up checkout metadata.

## Client Integration (Claude Desktop, Claude Code & Cursor)

### Claude Desktop (claude_desktop_config.json)
\`\`\`json
{
  "mcpServers": {
    "mcpx": {
      "url": "https://mcpx.harrykrauze.com/mcp/sse",
      "headers": {
        "Authorization": "Bearer YOUR_MCPX_API_KEY"
      }
    }
  }
}
\`\`\`

### Cursor IDE (.cursor/mcp.json)
\`\`\`json
{
  "mcpServers": {
    "mcpx": {
      "type": "sse",
      "url": "https://mcpx.harrykrauze.com/mcp/sse",
      "headers": {
        "Authorization": "Bearer YOUR_MCPX_API_KEY"
      }
    }
  }
}
\`\`\`

### Claude Code (CLI)
\`\`\`bash
claude mcp add --transport sse mcpx https://mcpx.harrykrauze.com/mcp/sse --header "Authorization: Bearer <MCPX_API_KEY>"
\`\`\`
`;

const LLMS_FULL_TXT_CONTENT = `# mcpx gateway — Full Specification & JSON-RPC Protocol

## 1. Protocol Architecture
- Protocol: Model Context Protocol (MCP) over JSON-RPC 2.0 (HTTP POST / SSE)
- Transport: HTTPS / Server-Sent Events
- Base URL: \`https://mcpx.harrykrauze.com/mcp/sse\`
- REST Endpoint: \`https://mcpx.harrykrauze.com/tools/execute\`
- Auth Header: \`Authorization: Bearer mcpx_live_<token>\`

## 2. Discovery Methods (Free Tier: \$0.00 / 0 credits)

### 2.1 Handshake (\`initialize\`)
Request:
\`\`\`json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": { "name": "AgentClient", "version": "1.0.0" }
  }
}
\`\`\`

Response:
\`\`\`json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2024-11-05",
    "capabilities": { "tools": {} },
    "serverInfo": {
      "name": "mcpx-gateway",
      "version": "1.0.0",
      "runtime": "cloudflare-workers-v8"
    }
  }
}
\`\`\`

### 2.2 Tool Inspection (\`tools/list\`)
Request:
\`\`\`json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list",
  "params": {}
}
\`\`\`

Response:
\`\`\`json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "tools": [
      {
        "name": "analyze_jev_semantic_ast",
        "description": "Static AST analyzer that detects dangerous globals (process, fetch, prototype pollution) and code injection vectors.",
        "inputSchema": {
          "type": "object",
          "properties": { "code": { "type": "string" }, "filename": { "type": "string" } },
          "required": ["code"]
        },
        "x-pricing-tier": "read",
        "x-credit-cost": 1
      },
      {
        "name": "evaluate_fraud_transaction",
        "description": "Deterministic transaction scoring and fraud anomaly classification in real time (~210ms).",
        "inputSchema": {
          "type": "object",
          "properties": { "amount": { "type": "number" }, "currency": { "type": "string" }, "ipCountry": { "type": "string" } },
          "required": ["amount"]
        },
        "x-pricing-tier": "compute",
        "x-credit-cost": 1
      },
      {
        "name": "calculate_u_value_iso6946",
        "description": "Certified EN ISO 6946 thermal transmittance, total resistance, and condensation risk calculation (~140ms).",
        "inputSchema": {
          "type": "object",
          "properties": { "layers": { "type": "array" }, "r_si": { "type": "number" }, "r_se": { "type": "number" } },
          "required": ["layers"]
        },
        "x-pricing-tier": "compute",
        "x-credit-cost": 2
      },
      {
        "name": "generate_mcp_server",
        "description": "Dynamic TypeScript and FastMCP server code compilation and remote schema generation.",
        "inputSchema": {
          "type": "object",
          "properties": { "serverName": { "type": "string" }, "tools": { "type": "array" } },
          "required": ["serverName"]
        },
        "x-pricing-tier": "sandbox",
        "x-credit-cost": 5
      }
    ]
  }
}
\`\`\`

## 3. Tool Invocation & Billing Handshake (\`tools/call\`)

Request:
\`\`\`json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "calculate_u_value_iso6946",
    "arguments": { "layers": [{ "name": "Concrete", "thickness": 0.2, "lambda": 1.7 }] }
  }
}
\`\`\`

### 3.1 Success Response (200 OK)
\`\`\`json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [{ "type": "text", "text": "{\\"uValue\\": 2.85, \\"rTotal\\": 0.35, \\"status\\": \\"compliant\\"}" }],
    "meta": {
      "creditsDeducted": 2,
      "remainingCredits": 48
    }
  }
}
\`\`\`

### 3.2 HTTP 402 Payment Required Error Schema

When bearer key credits are below tool cost:

\`\`\`http
HTTP/1.1 402 Payment Required
Content-Type: application/json
WWW-Authenticate: L402 token="...", invoice="..."
X-Credits-Required: 2
X-Credits-Available: 0
\`\`\`

\`\`\`json
{
  "error": "Payment Required",
  "code": 402,
  "message": "Insufficient credits for tool execution.",
  "details": {
    "tool": "calculate_u_value_iso6946",
    "requiredCredits": 2,
    "availableCredits": 0,
    "topUpUrl": "https://mcpx.harrykrauze.com/#pricing"
  }
}
\`\`\`
`;

export function getToolCostCents(toolName: string): number {
  const canonical = resolveCanonicalToolName(toolName);
  switch (canonical) {
    case "evaluate_fraud_transaction":
      return 1;
    case "analyze_jev_semantic_ast":
      return 1;
    case "calculate_u_value_iso6946":
      return 2;
    case "generate_mcp_server":
      return 5;
    default:
      return 1;
  }
}

export async function deductCredits(
  env: Env,
  apiKey: string | undefined,
  billing: BillingDetails,
  costCents: number
): Promise<{ balanceCents: number; lowBalance: boolean }> {
  if (billing.mode === "unlimited" || !apiKey || !env.MCPX_KEYS) {
    return {
      balanceCents: billing.balanceCents,
      lowBalance: billing.balanceCents < billing.lowBalanceThresholdCents,
    };
  }

  const newBalance = Math.max(0, billing.balanceCents - costCents);
  const newSpent = billing.totalSpentCents + costCents;
  billing.balanceCents = newBalance;
  billing.totalSpentCents = newSpent;

  try {
    const rawRecord = await env.MCPX_KEYS.get(`key:${apiKey}`, "text");
    if (rawRecord) {
      const cleaned = rawRecord.replace(/^\uFEFF/, "").trim();
      const record = JSON.parse(cleaned) as ApiKeyRecord;
      record.billing = billing;
      await env.MCPX_KEYS.put(`key:${apiKey}`, JSON.stringify(record));
    }
  } catch (err) {
    console.error("Failed to update billing in KV:", err);
  }

  return {
    balanceCents: newBalance,
    lowBalance: newBalance < billing.lowBalanceThresholdCents,
  };
}

export function create402RestResponse(
  tenantId: string,
  balanceCents: number,
  costCents: number
): Response {
  const invoiceUrl = `https://mcpx.harrykrauze.com/billing/topup?tenant=${encodeURIComponent(tenantId)}`;
  return new Response(
    JSON.stringify({
      error: "INSUFFICIENT_CREDITS",
      message: "Payment Required: Insufficient credit balance.",
      code: 402,
      tenantId,
      balanceCents,
      requiredCents: costCents,
      invoice: invoiceUrl,
      details: {
        requiredCredits: costCents,
        availableCredits: balanceCents,
        topUpUrl: invoiceUrl,
      },
    }),
    {
      status: 402,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": `L402 token="mcpx", invoice="${invoiceUrl}"`,
        "X-MCPX-Tenant": tenantId,
        "X-MCPX-Balance-Cents": String(balanceCents),
        "X-MCPX-Required-Cents": String(costCents),
        ...CORS_HEADERS,
      },
    }
  );
}

export function create402McpResponse(
  reqId: string | number | null | undefined,
  tenantId: string,
  balanceCents: number,
  costCents: number
): Response {
  const invoiceUrl = `https://mcpx.harrykrauze.com/billing/topup?tenant=${encodeURIComponent(tenantId)}`;
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: reqId ?? null,
      error: {
        code: 402,
        message: `Payment Required: Insufficient credit balance. Required: ${costCents} cents, available: ${balanceCents} cents. Top up at: ${invoiceUrl}`,
        data: {
          tenantId,
          balanceCents,
          requiredCents: costCents,
          invoice: invoiceUrl,
        },
      },
    }),
    {
      status: 402,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": `L402 token="mcpx", invoice="${invoiceUrl}"`,
        "X-MCPX-Tenant": tenantId,
        "X-MCPX-Balance-Cents": String(balanceCents),
        "X-MCPX-Required-Cents": String(costCents),
        ...CORS_HEADERS,
      },
    }
  );
}

export async function handleScheduled(
  controller: ScheduledController,
  env: Env,
  ctx?: ExecutionContext
): Promise<DailyAuditSummary> {
  const scheduledTimestamp = controller?.scheduledTime || Date.now();
  const todayDate = new Date(scheduledTimestamp).toISOString().slice(0, 10);
  const yesterdayDate = new Date(scheduledTimestamp - 86400 * 1000).toISOString().slice(0, 10);

  let totalActiveKeys = 0;
  const lowBalanceKeys: LowBalanceRecord[] = [];

  // b) Iterate through active KV keys (MCPX_KEYS.list({ prefix: "key:" }))
  if (env.MCPX_KEYS) {
    try {
      let cursor: string | undefined = undefined;
      do {
        const listResult = await env.MCPX_KEYS.list({ prefix: "key:", limit: 1000, cursor });
        for (const item of listResult.keys) {
          const rawRecord = await env.MCPX_KEYS.get(item.name, "text");
          if (!rawRecord) continue;
          try {
            const cleaned = rawRecord.replace(/^\uFEFF/, "").trim();
            const record = JSON.parse(cleaned) as ApiKeyRecord;
            if (record && record.status === "active") {
              totalActiveKeys++;
              const balanceCents = record.billing?.balanceCents ?? 0;
              // c) Identify clients with balance below 100 cents ($1.00 USD)
              if (balanceCents < 100) {
                const keyId = record.keyId || item.name.replace(/^key:/, "").slice(0, 16);
                lowBalanceKeys.push({
                  keyId,
                  tenantId: record.tenantId || record.userId || "unknown",
                  balanceCents,
                });
              }
            }
          } catch {
            // Ignore malformed individual entries
          }
        }
        cursor = listResult.list_complete ? undefined : listResult.cursor;
      } while (cursor);
    } catch (err) {
      console.error("KV key list failed in scheduled audit:", err);
    }
  }

  const summary: DailyAuditSummary = {
    timestamp: new Date(scheduledTimestamp).toISOString(),
    date: todayDate,
    previousDate: yesterdayDate,
    totalActiveKeys,
    lowBalanceCount: lowBalanceKeys.length,
    lowBalanceKeys,
    status: "HEALTHY",
  };

  // d) Record daily audit summary to KV at stats:daily:${date} with 30-day TTL
  if (env.MCPX_KEYS) {
    try {
      await env.MCPX_KEYS.put(
        `stats:daily:${todayDate}`,
        JSON.stringify(summary, null, 2),
        { expirationTtl: 30 * 86400 }
      );
    } catch (putErr) {
      console.error("Failed to write daily stats to KV:", putErr);
    }
  }

  // e) If env.ANALYTICS is configured, emit telemetry point for system health check
  if (env.ANALYTICS && typeof env.ANALYTICS.writeDataPoint === "function") {
    try {
      env.ANALYTICS.writeDataPoint({
        indexes: ["system"],
        blobs: [
          "system.cron_health",
          "mcpx",
          todayDate,
          summary.status,
          controller?.cron || "0 8 * * *",
        ],
        doubles: [
          totalActiveKeys,
          lowBalanceKeys.length,
          Date.now(),
        ],
      });
    } catch (telemetryErr) {
      console.error("Failed to record cron telemetry:", telemetryErr);
    }
  }

  return summary;
}

const MAX_PAYLOAD_BYTES = 512 * 1024; // 512 KB payload size ceiling

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const startTime = Date.now();
    const url = new URL(request.url);
    const clientType = detectClientType(request.headers.get("user-agent"));
    const rawContentLength = request.headers.get("content-length");
    const payloadSizeBytes = rawContentLength ? parseInt(rawContentLength, 10) || 0 : 0;

    const track = (
      response: Response,
      options: {
        tenantId?: string;
        method: string;
        toolName?: string;
        status?: TelemetryPoint["status"];
        costCents?: number;
      }
    ): Response => {
      const executionTimeMs = Date.now() - startTime;
      let status = options.status;
      if (!status) {
        if (response.status === 402) {
          status = "payment_required";
        } else if (response.status >= 500) {
          status = "server_error";
        } else if (response.status === 401 || response.status === 403) {
          const authHeader = response.headers.get("WWW-Authenticate") || "";
          status = authHeader.includes("token_revoked") ? "revoked" : "security_violation";
        } else if (response.status === 429) {
          status = "security_violation";
        } else if (response.status >= 400) {
          status = "client_error";
        } else {
          status = "success";
        }
      }
      recordTelemetry(env, ctx, {
        tenantId: options.tenantId,
        method: options.method,
        toolName: options.toolName || "none",
        status,
        clientType,
        executionTimeMs,
        statusCode: response.status,
        payloadSizeBytes,
        costCents: options.costCents,
      });
      return response;
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // 1. Content negotiation on root for autonomous LLM agents
    if (url.pathname === "/") {
      const accept = request.headers.get("Accept") || "";
      if (accept.includes("text/markdown") && !accept.includes("text/html")) {
        return track(
          new Response(LLMS_TXT_CONTENT, {
            status: 200,
            headers: {
              "Content-Type": "text/markdown; charset=utf-8",
              "Vary": "Accept",
              "Cache-Control": "public, max-age=3600",
              ...CORS_HEADERS,
            },
          }),
          { method: "llms_markdown_negotiated", status: "success" }
        );
      }
    }

    // 1b. Direct /llms.txt route
    if (url.pathname === "/llms.txt") {
      return track(
        new Response(LLMS_TXT_CONTENT, {
          status: 200,
          headers: {
            "Content-Type": "text/markdown; charset=utf-8",
            "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
            ...CORS_HEADERS,
            "Link": '<https://mcpx.harrykrauze.com/llms-full.txt>; rel="llms-full-txt"',
          },
        }),
        { method: "llms.txt", status: "success" }
      );
    }

    // 1c. Direct /llms-full.txt route
    if (url.pathname === "/llms-full.txt") {
      return track(
        new Response(LLMS_FULL_TXT_CONTENT, {
          status: 200,
          headers: {
            "Content-Type": "text/markdown; charset=utf-8",
            "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
            ...CORS_HEADERS,
            "Link": '<https://mcpx.harrykrauze.com/llms.txt>; rel="llms-txt"',
          },
        }),
        { method: "llms-full.txt", status: "success" }
      );
    }

    // 1c.1. Serve IndexNow Verification Key
    if (url.pathname === `/${INDEXNOW_KEY_FILE}` || url.pathname === "/indexnow.txt") {
      return track(
        new Response(INDEXNOW_KEY, {
          status: 200,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=86400",
            "Access-Control-Allow-Origin": "*",
          },
        }),
        { method: "indexnow.txt", status: "success" }
      );
    }

    // 1c.2. IndexNow Trigger Endpoint
    if (url.pathname === "/api/indexnow/submit" && request.method === "POST") {
      const authHeader = request.headers.get("Authorization") || "";
      const expectedAdminSecret = (env as any).INDEXNOW_ADMIN_SECRET || "dev_secret_bypass";

      if (!authHeader.includes(expectedAdminSecret) && (env as any).ENVIRONMENT === "production") {
        return track(
          new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json", ...CORS_HEADERS },
          }),
          { method: "api/indexnow/submit", status: "security_violation" }
        );
      }

      const result = await submitIndexNow();
      return track(
        new Response(
          JSON.stringify({
            success: result.status === 200 || result.status === 202,
            indexNowStatus: result.status,
            message: result.text || "Submitted successfully to api.indexnow.org",
          }),
          {
            status: result.status === 200 || result.status === 202 ? 200 : 502,
            headers: { "Content-Type": "application/json", ...CORS_HEADERS },
          }
        ),
        { method: "api/indexnow/submit", status: result.status === 200 || result.status === 202 ? "success" : "client_error" }
      );
    }

    // 1d. Public health check and Midnight Gourmet Dashboard route
    if (url.pathname === "/health" || (url.pathname === "/" && request.method === "GET")) {
      const healthData: HealthStatus = {
        status: "healthy",
        domain: "mcpx.harrykrauze.com",
        geminiConfigured: !!env.GEMINI_API_KEY,
        authConfigured: !!(env.MCPX_API_KEY || env.MCPX_KEYS),
        kvConfigured: !!env.MCPX_KEYS,
        rateLimiterConfigured: !!env.RATE_LIMITER,
        analyticsConfigured: !!env.ANALYTICS,
      };

      const accept = request.headers.get("accept") || "";

      // If browser request to root path (Accept includes text/html and excludes application/json)
      if (url.pathname === "/" && accept.includes("text/html") && !accept.includes("application/json")) {
        return track(
          new Response(renderDashboardHtml(healthData), {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "public, max-age=30, s-maxage=60",
              ...CORS_HEADERS,
            },
          }),
          { method: "dashboard_html", status: "success" }
        );
      }

      // Standard JSON response for agents, cURL, and /health endpoint
      return track(
        new Response(JSON.stringify(healthData, null, 2), {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            ...CORS_HEADERS,
          },
        }),
        { method: "health", status: "success" }
      );
    }

    const baseUrl = env.ISSUER_URL || "https://mcpx.harrykrauze.com";

    // RFC 9728: OAuth Protected Resource Metadata
    if (url.pathname === "/.well-known/oauth-protected-resource") {
      return track(
        new Response(
          JSON.stringify({
            resource: `${baseUrl}/mcp/sse`,
            authorization_servers: [baseUrl],
            registration_endpoint: `${baseUrl}/keys/provision`,
            token_endpoint: `${baseUrl}/keys/status`,
            bearer_methods_supported: ["header"],
            scopes_supported: ["mcp:connect", "mcp:tools", "mcp:generate", "mcp:admin"],
            resource_documentation: `${baseUrl}/MCP_CONFIG.md`,
            dcr_supported: false,
          }, null, 2),
          {
            headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS }
          }
        ),
        { method: "oauth-protected-resource", status: "success" }
      );
    }

    // RFC 8414: OAuth 2.0 Authorization Server Metadata
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      return track(
        new Response(
          JSON.stringify({
            issuer: baseUrl,
            token_endpoint: `${baseUrl}/keys/status`,
            registration_endpoint: `${baseUrl}/keys/provision`,
            jwks_uri: `${baseUrl}/.well-known/jwks.json`,
            response_types_supported: ["token"],
            grant_types_supported: ["client_credentials"],
            resource_registration_endpoint: `${baseUrl}/.well-known/oauth-protected-resource`,
          }, null, 2),
          {
            headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS }
          }
        ),
        { method: "oauth-authorization-server", status: "success" }
      );
    }

    // RFC 7517: JSON Web Key Set (JWKS)
    if (url.pathname === "/.well-known/jwks.json") {
      return track(
        new Response(
          JSON.stringify({ keys: [] }, null, 2),
          {
            headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS }
          }
        ),
        { method: "jwks", status: "success" }
      );
    }

    // Dynamic API key provisioning (Admin/Headless - Strict perimeter defense)
    if (url.pathname === "/keys/provision") {
      if (request.method !== "POST") {
        return track(
          new Response(JSON.stringify({ error: "Method Not Allowed. Use POST." }), {
            status: 405,
            headers: { "Content-Type": "application/json", ...CORS_HEADERS },
          }),
          { method: "keys/provision", status: "client_error" }
        );
      }

      // 1. Rate Limiting for provisioning perimeter: 5 req/min per IP
      if (env.RATE_LIMITER) {
        const clientIp = request.headers.get("cf-connecting-ip") || "anonymous";
        const { success } = await env.RATE_LIMITER.limit({ key: `prov:${clientIp}` });
        if (!success) {
          return track(
            new Response(
              JSON.stringify({ error: "Too Many Requests: Rate limit exceeded for key provisioning." }),
              {
                status: 429,
                headers: { "Content-Type": "application/json", "Retry-After": "60", ...CORS_HEADERS },
              }
            ),
            { method: "keys/provision", status: "security_violation" }
          );
        }
      }

      // 2. Strict Master Administrator authorization check with constant-time comparison
      const masterAuth = await validateMasterAuth(request, env);
      if (!masterAuth.authorized) {
        const headers = new Headers(masterAuth.response.headers);
        for (const [k, v] of Object.entries(CORS_HEADERS)) {
          headers.set(k, v);
        }
        return track(
          new Response(masterAuth.response.body, {
            status: masterAuth.response.status,
            headers,
          }),
          { method: "keys/provision", status: "security_violation" }
        );
      }

      // 3. Storage availability check
      if (!env.MCPX_KEYS) {
        return track(
          new Response(
            JSON.stringify({ error: "Storage not configured on server." }),
            { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
          ),
          { method: "keys/provision", status: "server_error" }
        );
      }

      // 4. Input validation (TypeSafe schema)
      try {
        const payload = (await request.json()) as ProvisionKeyPayload;

        const rawTenant = payload.tenantId || payload.userId;
        if (!rawTenant || typeof rawTenant !== "string") {
          return track(
            new Response(
              JSON.stringify({
                error: "Bad Request: 'tenantId' is required and must be an alphanumeric string [a-zA-Z0-9_-].",
              }),
              { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
            ),
            { method: "keys/provision", status: "client_error" }
          );
        }

        const tenantId = rawTenant.trim();
        if (!/^[a-zA-Z0-9_-]{3,64}$/.test(tenantId)) {
          return track(
            new Response(
              JSON.stringify({
                error: "Bad Request: 'tenantId' must be 3-64 characters matching pattern [a-zA-Z0-9_-].",
              }),
              { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
            ),
            { method: "keys/provision", status: "client_error" }
          );
        }

        const description = typeof payload.description === "string" ? payload.description.slice(0, 128).trim() : undefined;
        const plan = payload.plan || "pro";
        const rateLimit = typeof payload.rateLimit === "number" && payload.rateLimit >= 1 && payload.rateLimit <= 120
          ? payload.rateLimit
          : 10;
        const scopes = Array.isArray(payload.scopes) && payload.scopes.length > 0
          ? payload.scopes
          : ["mcp:read", "mcp:write", "mcp:generate"];

        let expiresAt: string | undefined = undefined;
        if (typeof payload.expiresInDays === "number" && payload.expiresInDays > 0) {
          expiresAt = new Date(Date.now() + payload.expiresInDays * 24 * 60 * 60 * 1000).toISOString();
        }

        const initialBalance = typeof payload.initialBalanceCents === "number"
          ? Math.max(0, Math.round(payload.initialBalanceCents))
          : 100;
        const billing: BillingDetails = {
          mode: payload.billingMode || "prepaid",
          balanceCents: initialBalance,
          currency: "USD",
          costPerToolCallCents: 1,
          costPerGenerateCents: 5,
          totalSpentCents: 0,
          lowBalanceThresholdCents: 10,
        };

        const newApiKey = generateApiKey();
        const keyId = await computeKeyId(newApiKey);
        const record: ApiKeyRecord = {
          keyId,
          userId: tenantId,
          tenantId,
          description,
          plan,
          status: "active",
          billing,
          requestsLimit: payload.requestsLimit,
          rateLimit,
          scopes,
          createdAt: new Date().toISOString(),
          expiresAt,
        };

        await env.MCPX_KEYS.put(`key:${newApiKey}`, JSON.stringify(record));
        await env.MCPX_KEYS.put(`id:${keyId}`, newApiKey);

        return track(
          new Response(
            JSON.stringify({
              success: true,
              keyId: record.keyId,
              apiKey: newApiKey,
              tenantId: record.tenantId,
              userId: record.userId,
              description: record.description ?? null,
              plan: record.plan,
              status: record.status,
              billing: record.billing,
              rateLimit: record.rateLimit,
              scopes: record.scopes,
              createdAt: record.createdAt,
              expiresAt: record.expiresAt ?? null,
              requestsLimit: record.requestsLimit ?? null,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json", ...CORS_HEADERS },
            }
          ),
          { tenantId: record.tenantId, method: "keys/provision", status: "success" }
        );
      } catch (err: any) {
        return track(
          new Response(
            JSON.stringify({ error: "Bad Request: Invalid JSON body.", details: err?.message }),
            { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
          ),
          { method: "keys/provision", status: "client_error" }
        );
      }
    }

    // Key inventory and listing for administrator (GET /keys)
    if (url.pathname === "/keys" && request.method === "GET") {
      // 1. Rate limiter (Rate limit 10 req/min)
      if (env.RATE_LIMITER) {
        const clientIp = request.headers.get("cf-connecting-ip") || "anonymous";
        const { success } = await env.RATE_LIMITER.limit({ key: `list:${clientIp}` });
        if (!success) {
          return track(
            new Response(
              JSON.stringify({ error: "Too Many Requests: Rate limit exceeded." }),
              { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "60", ...CORS_HEADERS } }
            ),
            { method: "keys/list", status: "security_violation" }
          );
        }
      }

      // 2. Master administrator authorization
      const masterAuth = await validateMasterAuth(request, env);
      if (!masterAuth.authorized) {
        const headers = new Headers(masterAuth.response.headers);
        for (const [k, v] of Object.entries(CORS_HEADERS)) {
          headers.set(k, v);
        }
        return track(
          new Response(masterAuth.response.body, {
            status: masterAuth.response.status,
            headers,
          }),
          { method: "keys/list", status: "security_violation" }
        );
      }

      if (!env.MCPX_KEYS) {
        return track(
          new Response(
            JSON.stringify({ error: "Storage not configured." }),
            { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
          ),
          { method: "keys/list", status: "server_error" }
        );
      }

      try {
        const statusFilter = url.searchParams.get("status")?.trim().toLowerCase();
        const listRes = await env.MCPX_KEYS.list({ prefix: "key:" });
        const keysList: any[] = [];

        for (const k of listRes.keys) {
          const rawKey = k.name.slice(4); // Remove "key:" prefix
          const rawRecord = await env.MCPX_KEYS.get(k.name, "text");
          if (!rawRecord) continue;

          try {
            const cleaned = rawRecord.replace(/^\uFEFF/, "").trim();
            const record = JSON.parse(cleaned) as ApiKeyRecord;
            if (statusFilter && record.status !== statusFilter) {
              continue;
            }

            const keyId = record.keyId || (await computeKeyId(rawKey));
            const maskedKey = rawKey.length > 14
              ? `${rawKey.slice(0, 10)}...${rawKey.slice(-4)}`
              : "mcpx_live_...";

            const billing: BillingDetails = record.billing || {
              mode: "prepaid",
              balanceCents: 100,
              currency: "USD",
              costPerToolCallCents: 1,
              costPerGenerateCents: 5,
              totalSpentCents: 0,
              lowBalanceThresholdCents: 10,
            };

            keysList.push({
              keyId,
              maskedKey,
              tenantId: record.tenantId || record.userId,
              description: record.description ?? null,
              plan: record.plan,
              status: record.status,
              billing,
              rateLimit: record.rateLimit || 10,
              scopes: record.scopes || ["mcp:read", "mcp:write", "mcp:generate"],
              createdAt: record.createdAt || null,
              expiresAt: record.expiresAt || null,
              revokedAt: record.revokedAt || null,
            });
          } catch {
            // Ignore malformed individual entries
          }
        }

        return track(
          new Response(
            JSON.stringify({
              success: true,
              total: keysList.length,
              keys: keysList,
            }),
            { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
          ),
          { tenantId: "master-admin", method: "keys/list", status: "success" }
        );
      } catch (err: any) {
        return track(
          new Response(
            JSON.stringify({ error: "Internal Server Error", details: err?.message || String(err) }),
            { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
          ),
          { method: "keys/list", status: "server_error" }
        );
      }
    }

    // Immediate API key revocation (DELETE /keys/:keyId or POST /keys/revoke)
    if (
      (request.method === "DELETE" && url.pathname.startsWith("/keys/")) ||
      (url.pathname === "/keys/revoke" && request.method === "POST")
    ) {
      // 1. Rate limiter
      if (env.RATE_LIMITER) {
        const clientIp = request.headers.get("cf-connecting-ip") || "anonymous";
        const { success } = await env.RATE_LIMITER.limit({ key: `del:${clientIp}` });
        if (!success) {
          return track(
            new Response(
              JSON.stringify({ error: "Too Many Requests: Rate limit exceeded." }),
              { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "60", ...CORS_HEADERS } }
            ),
            { method: "keys/revoke", status: "security_violation" }
          );
        }
      }

      // 2. Master administrator authorization
      const masterAuth = await validateMasterAuth(request, env);
      if (!masterAuth.authorized) {
        const headers = new Headers(masterAuth.response.headers);
        for (const [k, v] of Object.entries(CORS_HEADERS)) {
          headers.set(k, v);
        }
        return track(
          new Response(masterAuth.response.body, {
            status: masterAuth.response.status,
            headers,
          }),
          { method: "keys/revoke", status: "security_violation" }
        );
      }

      if (!env.MCPX_KEYS) {
        return track(
          new Response(
            JSON.stringify({ error: "Storage not configured." }),
            { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
          ),
          { method: "keys/revoke", status: "server_error" }
        );
      }

      try {
        let targetIdentifier = "";

        if (request.method === "DELETE") {
          targetIdentifier = url.pathname.replace(/^\/keys\/?/, "").trim();
        } else {
          const payload = ((await request.json().catch(() => ({}))) || {}) as {
            keyId?: string;
            apiKey?: string;
          };
          targetIdentifier = (payload.keyId || payload.apiKey || "").trim();
        }

        if (!targetIdentifier) {
          return track(
            new Response(
              JSON.stringify({ error: "Bad Request: 'keyId' or 'apiKey' is required." }),
              { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
            ),
            { method: "keys/revoke", status: "client_error" }
          );
        }

        // Search for key in KV storage:
        // Option A: Direct key `key:<targetIdentifier>`
        let actualKey = targetIdentifier;
        let rawRecord = await env.MCPX_KEYS.get(`key:${targetIdentifier}`, "text");

        // Option B: Pointer by `id:<targetIdentifier>`
        if (!rawRecord) {
          const resolvedKey = await env.MCPX_KEYS.get(`id:${targetIdentifier}`, "text");
          if (resolvedKey) {
            actualKey = resolvedKey.trim();
            rawRecord = await env.MCPX_KEYS.get(`key:${actualKey}`, "text");
          }
        }

        // Option C: Scan across `record.keyId`
        if (!rawRecord) {
          const listRes = await env.MCPX_KEYS.list({ prefix: "key:" });
          for (const k of listRes.keys) {
            const candidateRaw = await env.MCPX_KEYS.get(k.name, "text");
            if (candidateRaw) {
              try {
                const candRecord = JSON.parse(candidateRaw.replace(/^\uFEFF/, "").trim()) as ApiKeyRecord;
                const computedId = candRecord.keyId || (await computeKeyId(k.name.slice(4)));
                if (candRecord.keyId === targetIdentifier || computedId === targetIdentifier) {
                  actualKey = k.name.slice(4);
                  rawRecord = candidateRaw;
                  break;
                }
              } catch {
                // Continue scanning
              }
            }
          }
        }

        if (!rawRecord) {
          return track(
            new Response(
              JSON.stringify({ error: "Not Found: API key or keyId not found." }),
              { status: 404, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
            ),
            { method: "keys/revoke", status: "client_error" }
          );
        }

        const cleaned = rawRecord.replace(/^\uFEFF/, "").trim();
        const record = JSON.parse(cleaned) as ApiKeyRecord;
        const nowIso = new Date().toISOString();

        record.status = "revoked";
        record.revokedAt = nowIso;
        record.expiresAt = nowIso;

        await env.MCPX_KEYS.put(`key:${actualKey}`, JSON.stringify(record));

        return track(
          new Response(
            JSON.stringify({
              success: true,
              keyId: record.keyId || targetIdentifier,
              status: "revoked",
              revokedAt: record.revokedAt,
              message: "API key successfully revoked.",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json", ...CORS_HEADERS },
            }
          ),
          { tenantId: record.tenantId || "master-admin", method: "keys/revoke", status: "success" }
        );
      } catch (err: any) {
        return track(
          new Response(
            JSON.stringify({ error: "Internal Server Error", details: err?.message || String(err) }),
            { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
          ),
          { method: "keys/revoke", status: "server_error" }
        );
      }
    }

    // Credit top-up endpoint for administrator (POST /keys/topup)
    if (url.pathname === "/keys/topup" && request.method === "POST") {
      // 1. Rate limiter
      if (env.RATE_LIMITER) {
        const clientIp = request.headers.get("cf-connecting-ip") || "anonymous";
        const { success } = await env.RATE_LIMITER.limit({ key: `topup:${clientIp}` });
        if (!success) {
          return track(
            new Response(
              JSON.stringify({ error: "Too Many Requests: Rate limit exceeded." }),
              { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "60", ...CORS_HEADERS } }
            ),
            { method: "keys/topup", status: "security_violation" }
          );
        }
      }

      // 2. Master administrator authorization
      const masterAuth = await validateMasterAuth(request, env);
      if (!masterAuth.authorized) {
        const headers = new Headers(masterAuth.response.headers);
        for (const [k, v] of Object.entries(CORS_HEADERS)) {
          headers.set(k, v);
        }
        return track(
          new Response(masterAuth.response.body, {
            status: masterAuth.response.status,
            headers,
          }),
          { method: "keys/topup", status: "security_violation" }
        );
      }

      if (!env.MCPX_KEYS) {
        return track(
          new Response(
            JSON.stringify({ error: "Storage not configured." }),
            { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
          ),
          { method: "keys/topup", status: "server_error" }
        );
      }

      try {
        const payload = (await request.json().catch(() => ({}))) as {
          tenantId?: string;
          keyId?: string;
          apiKey?: string;
          amountCents: number;
          reason?: string;
        };

        if (typeof payload.amountCents !== "number" || payload.amountCents <= 0 || !Number.isInteger(payload.amountCents)) {
          return track(
            new Response(
              JSON.stringify({ error: "Bad Request: 'amountCents' must be a positive integer." }),
              { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
            ),
            { method: "keys/topup", status: "client_error" }
          );
        }

        const targetIdentifier = (payload.keyId || payload.apiKey || payload.tenantId || "").trim();
        if (!targetIdentifier) {
          return track(
            new Response(
              JSON.stringify({ error: "Bad Request: 'keyId', 'apiKey', or 'tenantId' is required." }),
              { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
            ),
            { method: "keys/topup", status: "client_error" }
          );
        }

        // Search for key in KV storage
        let actualKey = targetIdentifier;
        let rawRecord = await env.MCPX_KEYS.get(`key:${targetIdentifier}`, "text");

        if (!rawRecord) {
          const resolvedKey = await env.MCPX_KEYS.get(`id:${targetIdentifier}`, "text");
          if (resolvedKey) {
            actualKey = resolvedKey.trim();
            rawRecord = await env.MCPX_KEYS.get(`key:${actualKey}`, "text");
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
                if (
                  candRecord.keyId === targetIdentifier ||
                  candRecord.tenantId === targetIdentifier ||
                  candRecord.userId === targetIdentifier ||
                  computedId === targetIdentifier
                ) {
                  actualKey = k.name.slice(4);
                  rawRecord = candidateRaw;
                  break;
                }
              } catch {
                // Continue scanning
              }
            }
          }
        }

        if (!rawRecord) {
          return track(
            new Response(
              JSON.stringify({ error: "Not Found: API key or tenant not found." }),
              { status: 404, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
            ),
            { method: "keys/topup", status: "client_error" }
          );
        }

        const record = JSON.parse(rawRecord.replace(/^\uFEFF/, "").trim()) as ApiKeyRecord;
        if (!record.billing) {
          record.billing = {
            mode: "prepaid",
            balanceCents: 100,
            currency: "USD",
            costPerToolCallCents: 1,
            costPerGenerateCents: 5,
            totalSpentCents: 0,
            lowBalanceThresholdCents: 10,
          };
        }

        record.billing.balanceCents += payload.amountCents;
        record.billing.lastTopupAt = new Date().toISOString();

        await env.MCPX_KEYS.put(`key:${actualKey}`, JSON.stringify(record));

        const currencySymbol = record.billing.currency === "EUR" ? "€" : "$";
        return track(
          new Response(
            JSON.stringify({
              success: true,
              keyId: record.keyId || (await computeKeyId(actualKey)),
              tenantId: record.tenantId || record.userId,
              billing: record.billing,
              addedCents: payload.amountCents,
              reason: payload.reason || "Manual topup",
              message: `Successfully topped up ${payload.amountCents} cents (${currencySymbol}${(payload.amountCents / 100).toFixed(2)}). New balance: ${record.billing.balanceCents} cents (${currencySymbol}${(record.billing.balanceCents / 100).toFixed(2)}).`,
            }),
            { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
          ),
          { tenantId: record.tenantId || "master-admin", method: "keys/topup", status: "success" }
        );
      } catch (err: any) {
        return track(
          new Response(
            JSON.stringify({ error: "Internal Server Error", details: err?.message || String(err) }),
            { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
          ),
          { method: "keys/topup", status: "server_error" }
        );
      }
    }

    // Creem.io Fiat Webhook Gateway (POST /webhooks/creem)
    if (url.pathname === "/webhooks/creem") {
      return handleCreemWebhook(request, env, ctx);
    }

    // Key self-service verification and balance inspection (POST /keys/verify)
    if (url.pathname === "/keys/verify" && request.method === "POST") {
      if (!env.MCPX_KEYS) {
        return track(
          new Response(
            JSON.stringify({ error: "Storage not configured on server." }),
            { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
          ),
          { method: "keys/verify", status: "server_error" }
        );
      }

      try {
        const body = (await request.json().catch(() => ({}))) as {
          key?: string;
          apiKey?: string;
          keyId?: string;
        };

        const targetKey = (body.key || body.apiKey || "").trim();
        const targetKeyId = (body.keyId || "").trim();

        if (!targetKey && !targetKeyId) {
          return track(
            new Response(
              JSON.stringify({ error: "Bad Request: 'key' or 'keyId' is required." }),
              { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
            ),
            { method: "keys/verify", status: "client_error" }
          );
        }

        let actualKey = targetKey;
        let rawRecord: string | null = null;

        // 1. Direct key lookup key:<targetKey>
        if (targetKey) {
          rawRecord = await env.MCPX_KEYS.get(`key:${targetKey}`, "text");
        }

        // 2. Pointer lookup id:<targetKeyId or targetKey>
        if (!rawRecord) {
          const lookupId = targetKeyId || targetKey;
          const resolved = await env.MCPX_KEYS.get(`id:${lookupId}`, "text");
          if (resolved) {
            actualKey = resolved.trim();
            rawRecord = await env.MCPX_KEYS.get(`key:${actualKey}`, "text");
          }
        }

        // 3. Scan by keyId
        if (!rawRecord) {
          const lookupId = targetKeyId || targetKey;
          const listRes = await env.MCPX_KEYS.list({ prefix: "key:" });
          for (const k of listRes.keys) {
            const candidateRaw = await env.MCPX_KEYS.get(k.name, "text");
            if (candidateRaw) {
              try {
                const candRecord = JSON.parse(candidateRaw.replace(/^\uFEFF/, "").trim()) as ApiKeyRecord;
                const computedId = candRecord.keyId || (await computeKeyId(k.name.slice(4)));
                if (candRecord.keyId === lookupId || computedId === lookupId) {
                  actualKey = k.name.slice(4);
                  rawRecord = candidateRaw;
                  break;
                }
              } catch {
                // Continue scanning
              }
            }
          }
        }

        if (!rawRecord) {
          return track(
            new Response(
              JSON.stringify({ error: "Not Found: Invalid API key or keyId not found." }),
              { status: 404, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
            ),
            { method: "keys/verify", status: "client_error" }
          );
        }

        const record = JSON.parse(rawRecord.replace(/^\uFEFF/, "").trim()) as ApiKeyRecord;
        const keyId = record.keyId || (actualKey ? await computeKeyId(actualKey) : "unknown");
        const balanceCents = record.billing?.balanceCents ?? 0;
        const totalSpentCents = record.billing?.totalSpentCents ?? 0;

        return track(
          new Response(
            JSON.stringify({
              success: true,
              keyId,
              tenantId: record.tenantId || record.userId,
              balanceCents,
              totalSpentCents,
              status: record.status,
              plan: record.plan,
              currency: record.billing?.currency || "USD",
            }),
            { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
          ),
          { tenantId: record.tenantId || "anonymous", method: "keys/verify", status: "success" }
        );
      } catch (err: any) {
        return track(
          new Response(
            JSON.stringify({ error: "Internal Server Error", details: err?.message || String(err) }),
            { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
          ),
          { method: "keys/verify", status: "server_error" }
        );
      }
    }

    // Key status and usage verification (GET /keys/status)
    if (url.pathname === "/keys/status" && request.method === "GET") {
      const auth = await requireAuth(request, env);
      if (!auth.authorized) {
        const headers = new Headers(auth.response.headers);
        for (const [k, v] of Object.entries(CORS_HEADERS)) {
          headers.set(k, v);
        }
        const isRevoked = (auth.response.headers.get("WWW-Authenticate") || "").includes("token_revoked");
        return track(
          new Response(auth.response.body, {
            status: auth.response.status,
            headers,
          }),
          { method: "keys/status", status: isRevoked ? "revoked" : "security_violation" }
        );
      }

      const { userId, plan, requestsLimit, tenantId, billing } = auth.context;
      let usage = 0;
      if (env.MCPX_KEYS) {
        const usageStr = await env.MCPX_KEYS.get(`usage:${userId}`, "text");
        usage = usageStr ? parseInt(usageStr.trim(), 10) || 0 : 0;
      }

      return track(
        new Response(
          JSON.stringify({
            success: true,
            userId,
            plan,
            status: "active",
            billing,
            usage,
            requestsLimit: requestsLimit ?? null,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json", ...CORS_HEADERS },
          }
        ),
        { tenantId: tenantId || userId, method: "keys/status", status: "success" }
      );
    }

    // 1c. Direct REST tool execution gateway (POST /tools/execute)
    if (url.pathname === "/tools/execute" && request.method === "POST") {
      const auth = await requireAuth(request, env);
      if (!auth.authorized) {
        const headers = new Headers(auth.response.headers);
        for (const [k, v] of Object.entries(CORS_HEADERS)) {
          headers.set(k, v);
        }
        return track(new Response(auth.response.body, { status: auth.response.status, headers }), {
          method: "tools/execute",
          status: "client_error",
        });
      }

      const activeTenant = auth.context.tenantId || auth.context.userId || "anonymous";

      try {
        const body = (await request.json().catch(() => ({}))) as {
          tool?: string;
          name?: string;
          parameters?: any;
          arguments?: any;
          params?: any;
        };

        const rawTool = body.tool || body.name || "";
        const toolName = resolveCanonicalToolName(rawTool);
        const toolArgs = body.parameters || body.arguments || body.params || {};

        const validTools = [
          "calculate_u_value_iso6946",
          "analyze_jev_semantic_ast",
          "generate_mcp_server",
          "evaluate_fraud_transaction",
        ];

        if (!toolName || !validTools.includes(toolName)) {
          return track(
            new Response(
              JSON.stringify({
                error: `Unknown tool: '${rawTool || toolName}'`,
                supportedTools: validTools,
              }),
              { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
            ),
            { tenantId: activeTenant, method: "tools/execute", toolName: String(rawTool || "none"), status: "client_error" }
          );
        }

        const cost = getToolCostCents(toolName);
        if (auth.context.billing.mode !== "unlimited" && auth.context.billing.balanceCents < cost) {
          return track(
            create402RestResponse(activeTenant, auth.context.billing.balanceCents, cost),
            { tenantId: activeTenant, method: "tools/execute", toolName, status: "payment_required", costCents: 0 }
          );
        }

        const { balanceCents, lowBalance } = await deductCredits(
          env,
          auth.context.apiKey,
          auth.context.billing,
          cost
        );
        const billingHeaders: Record<string, string> = {
          "X-MCPX-Balance-Cents": String(balanceCents),
          ...(lowBalance ? { "X-MCPX-Low-Balance": "true" } : {}),
        };

        if (toolName === "analyze_jev_semantic_ast") {
          const result = analyzeJevSemanticAst({
            code: toolArgs.code || "",
            strictness: toolArgs.strictness || "standard",
          });
          return track(
            new Response(
              JSON.stringify({
                success: result.verdict === "SAFE" || result.verdict === "WARNING",
                valid: result.verdict === "SAFE",
                ...result,
              }),
              {
                status: 200,
                headers: { "Content-Type": "application/json", ...billingHeaders, ...CORS_HEADERS },
              }
            ),
            { tenantId: activeTenant, method: "tools/execute", toolName: "analyze_jev_semantic_ast", status: "success", costCents: cost }
          );
        }

        if (toolName === "calculate_u_value_iso6946") {
          const result = calculateUValueIso6946(toolArgs as UValueCalculationInput);
          return track(
            new Response(
              JSON.stringify({ success: true, ...result }),
              {
                status: 200,
                headers: { "Content-Type": "application/json", ...billingHeaders, ...CORS_HEADERS },
              }
            ),
            { tenantId: activeTenant, method: "tools/execute", toolName: "calculate_u_value_iso6946", status: "success", costCents: cost }
          );
        }

        if (toolName === "evaluate_fraud_transaction") {
          const amount = Number(toolArgs.amount) || 0;
          const currency = String(toolArgs.currency || "EUR");
          const userRiskScore = Number(toolArgs.userRiskScore) || 0;
          const isHighRisk = amount > 5000 || userRiskScore > 0.8;
          return track(
            new Response(
              JSON.stringify({
                success: true,
                decision: isHighRisk ? "MANUAL_REVIEW" : "APPROVE",
                riskLevel: isHighRisk ? "HIGH" : "LOW",
                amount,
                currency,
                userRiskScore,
                timestamp: new Date().toISOString(),
              }),
              {
                status: 200,
                headers: { "Content-Type": "application/json", ...billingHeaders, ...CORS_HEADERS },
              }
            ),
            { tenantId: activeTenant, method: "tools/execute", toolName: "evaluate_fraud_transaction", status: "success", costCents: cost }
          );
        }

        return track(
          new Response(JSON.stringify({ error: "Unsupported tool" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...CORS_HEADERS },
          }),
          { tenantId: activeTenant, method: "tools/execute", status: "client_error" }
        );
      } catch (err: any) {
        return track(
          new Response(
            JSON.stringify({ error: err.message || String(err) }),
            { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
          ),
          { tenantId: activeTenant, method: "tools/execute", status: "client_error" }
        );
      }
    }

    // SSE stream endpoint (/sse and /mcp/sse)
    if ((url.pathname === "/sse" || url.pathname === "/mcp/sse") && request.method === "GET") {
      return track(
        new Response("event: endpoint\ndata: /message\n\n", {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            ...CORS_HEADERS,
          },
        }),
        { method: "mcp/sse", status: "success" }
      );
    }

    // 2. Processing and code generation route (/api/generate, /message, /mcp/messages, /mcp, or POST /)
    if (
      url.pathname === "/api/generate" ||
      url.pathname === "/message" ||
      url.pathname === "/mcp/messages" ||
      url.pathname === "/mcp" ||
      (url.pathname === "/" && request.method === "POST")
    ) {
      const routeMethod = url.pathname === "/" ? "message" : url.pathname.replace(/^\//, "");
      if (request.method !== "POST") {
        return track(
          new Response(JSON.stringify({ error: "Method Not Allowed. Use POST." }), {
            status: 405,
            headers: { "Content-Type": "application/json", ...CORS_HEADERS },
          }),
          { method: routeMethod, status: "client_error" }
        );
      }

      // 2.0. Rate limiter check (Rate Limiting: 10 req/min)
      if (env.RATE_LIMITER) {
        const clientKey = request.headers.get("cf-connecting-ip") || "anonymous";
        const { success } = await env.RATE_LIMITER.limit({ key: clientKey });

        if (!success) {
          return track(
            new Response(
              JSON.stringify({
                error: "Too Many Requests: Rate limit exceeded (10 req/min). Please try again later.",
              }),
              {
                status: 429,
                headers: {
                  "Content-Type": "application/json",
                  "Retry-After": "60",
                  ...CORS_HEADERS,
                },
              }
            ),
            { method: routeMethod, status: "security_violation" }
          );
        }
      }

      // 2.1. Payload size check prior to reading into memory
      const contentLength = request.headers.get("content-length");
      if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD_BYTES) {
        return track(
          new Response(
            JSON.stringify({
              error: "Payload Too Large: Maximum allowed request size is 512 KB.",
            }),
            { status: 413, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
          ),
          { method: routeMethod, status: "client_error" }
        );
      }

      // 2.2. Authorization check (KV or Master key)
      const auth = await requireAuth(request, env);

      // Check if request is an unauthenticated Discovery Free Tier call (tools/list, initialize, ping)
      let isDiscoveryMethod = false;
      if (!auth.authorized) {
        try {
          const peekBody = (await request.clone().json()) as any;
          if (
            peekBody &&
            typeof peekBody === "object" &&
            peekBody.jsonrpc === "2.0" &&
            (peekBody.method === "tools/list" ||
              peekBody.method === "initialize" ||
              peekBody.method === "ping" ||
              peekBody.method === "notifications/initialized")
          ) {
            isDiscoveryMethod = true;
          }
        } catch {}

        const isRevoked = (auth.response.headers.get("WWW-Authenticate") || "").includes("token_revoked");
        if (isRevoked || !isDiscoveryMethod) {
          const headers = new Headers(auth.response.headers);
          for (const [k, v] of Object.entries(CORS_HEADERS)) {
            headers.set(k, v);
          }
          return track(
            new Response(auth.response.body, {
              status: auth.response.status,
              headers,
            }),
            { method: routeMethod, status: isRevoked ? "revoked" : "security_violation" }
          );
        }
      }

      const authResult = auth.authorized
        ? auth
        : {
            authorized: true as const,
            context: {
              userId: "anonymous_discovery",
              plan: "free" as const,
              tenantId: "anonymous",
              requestsLimit: undefined,
              apiKey: undefined,
              billing: {
                balanceCents: 0,
                totalSpentCents: 0,
                mode: "prepaid" as const,
                currency: "USD" as const,
                costPerToolCallCents: 1,
                costPerGenerateCents: 5,
                lowBalanceThresholdCents: 10,
              },
              isMaster: false,
            },
          };

      const { userId, plan, requestsLimit, tenantId } = authResult.context;
      const activeTenant = tenantId || userId;

      // 2.3. User quota check (if requestsLimit is defined)
      if (requestsLimit !== undefined && env.MCPX_KEYS) {
        const currentUsageStr = await env.MCPX_KEYS.get(`usage:${userId}`, "text");
        const currentUsage = currentUsageStr ? parseInt(currentUsageStr, 10) || 0 : 0;
        if (currentUsage >= requestsLimit) {
          return track(
            new Response(
              JSON.stringify({
                error: `Quota Exceeded: Plan '${plan}' limit of ${requestsLimit} requests reached.`,
              }),
              {
                status: 429,
                headers: { "Content-Type": "application/json", ...CORS_HEADERS },
              }
            ),
            { tenantId: activeTenant, method: routeMethod, status: "security_violation" }
          );
        }
      }

      // 2.4. Request body parsing and processing
      try {
        const body = (await request.json()) as any;

        // Model Context Protocol (MCP) JSON-RPC 2.0 support
        if (body && typeof body === "object" && body.jsonrpc === "2.0" && typeof body.method === "string") {
          const reqId = body.id;

          // MCP Lifecycle: initialize
          if (body.method === "initialize") {
            return track(
              new Response(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: reqId,
                  result: {
                    protocolVersion: "2024-11-05",
                    capabilities: {
                      tools: {
                        listChanged: false,
                      },
                    },
                    serverInfo: {
                      name: "mcpx",
                      version: "1.0.0",
                    },
                  },
                }),
                {
                  status: 200,
                  headers: { "Content-Type": "application/json", ...CORS_HEADERS },
                }
              ),
              { tenantId: activeTenant, method: "initialize", status: "success" }
            );
          }

          // MCP Lifecycle: notifications/initialized
          if (body.method === "notifications/initialized") {
            return track(
              new Response(
                JSON.stringify({ jsonrpc: "2.0" }),
                {
                  status: 200,
                  headers: { "Content-Type": "application/json", ...CORS_HEADERS },
                }
              ),
              { tenantId: activeTenant, method: "notifications/initialized", status: "success" }
            );
          }

          // MCP Tool discovery: tools/list
          if (body.method === "tools/list") {
            return track(
              new Response(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: reqId,
                  result: {
                    tools: [
                      {
                        name: "generate_mcp_server",
                        description: "Transforms API snippets, OpenAPI specs, or cURL commands into executable TypeScript or Python MCP servers.",
                        inputSchema: {
                          type: "object",
                          properties: {
                            prompt: {
                              type: "string",
                              description: "API specification, cURL snippet, or description of the MCP server to generate.",
                            },
                          },
                          required: ["prompt"],
                        },
                      },
                      {
                        name: "calculate_u_value_iso6946",
                        description: "Calculates thermal transmittance (U-value) and total thermal resistance (R_tot) of multi-layer building elements according to EN ISO 6946.",
                        inputSchema: {
                          type: "object",
                          properties: {
                            direction: {
                              type: "string",
                              enum: ["horizontal", "upwards", "downwards"],
                              description: "Direction of heat flow: 'horizontal' (walls), 'upwards' (roofs/ceilings), or 'downwards' (floors). Default: 'horizontal'.",
                            },
                            rsi: {
                              type: "number",
                              description: "Internal surface thermal resistance in m²K/W (default: 0.13 horizontal, 0.10 upwards, 0.17 downwards).",
                            },
                            rse: {
                              type: "number",
                              description: "External surface thermal resistance in m²K/W (default: 0.04).",
                            },
                            layers: {
                              type: "array",
                              description: "Ordered material layers from inside to outside.",
                              items: {
                                type: "object",
                                properties: {
                                  name: { type: "string", description: "Material/layer name" },
                                  thickness_m: { type: "number", description: "Thickness in meters (d > 0)" },
                                  lambda_w_mk: { type: "number", description: "Thermal conductivity in W/(m·K) (λ > 0)" },
                                },
                                required: ["name", "thickness_m", "lambda_w_mk"],
                              },
                            },
                          },
                          required: ["layers"],
                        },
                      },
                      {
                        name: "analyze_jev_semantic_ast",
                        description: "Performs static code analysis and AST injection scanning using Jev rules to detect prototype pollution, dynamic execution, process access, and SSRF patterns.",
                        inputSchema: {
                          type: "object",
                          properties: {
                            code: {
                              type: "string",
                              description: "Source code to inspect.",
                            },
                            language: {
                              type: "string",
                              enum: ["typescript", "javascript", "python"],
                              description: "Programming language of the source code. Default: 'typescript'.",
                            },
                            strictness: {
                              type: "string",
                              enum: ["standard", "paranoid"],
                              description: "Analysis strictness level. 'paranoid' additionally flags timers, microtasks, and potential infinite loops. Default: 'standard'.",
                            },
                          },
                          required: ["code"],
                        },
                      },
                      {
                        name: "evaluate_fraud_transaction",
                        description: "Real-time risk scoring and transaction policy evaluation tool.",
                        inputSchema: {
                          type: "object",
                          properties: {
                            amount: { type: "number", description: "Transaction amount in EUR/USD" },
                            currency: { type: "string", description: "ISO currency code" },
                            userRiskScore: { type: "number", description: "User risk score between 0 and 1" },
                          },
                          required: ["amount", "currency"],
                        },
                      },
                    ],
                  },
                }),
                {
                  status: 200,
                  headers: { "Content-Type": "application/json", ...CORS_HEADERS },
                }
              ),
              { tenantId: activeTenant, method: "tools/list", status: "success" }
            );
          }

          // MCP Tool execution: tools/call
          if (body.method === "tools/call") {
            const rawToolName = body.params?.name;
            const toolName = resolveCanonicalToolName(rawToolName);
            const toolArgs = body.params?.arguments || {};

            const validTools = [
              "calculate_u_value_iso6946",
              "analyze_jev_semantic_ast",
              "generate_mcp_server",
              "evaluate_fraud_transaction",
            ];

            if (!toolName || !validTools.includes(toolName)) {
              return track(
                new Response(
                  JSON.stringify({
                    jsonrpc: "2.0",
                    id: reqId,
                    error: {
                      code: -32601,
                      message: `Unknown tool: '${rawToolName || toolName}'`,
                    },
                  }),
                  { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
                ),
                { tenantId: activeTenant, method: "tools/call", toolName: String(rawToolName || "none"), status: "client_error" }
              );
            }

            // x402 / L402 Credit check
            const cost = getToolCostCents(toolName);
            if (authResult.context.billing.mode !== "unlimited" && authResult.context.billing.balanceCents < cost) {
              return track(
                create402McpResponse(reqId, activeTenant, authResult.context.billing.balanceCents, cost),
                { tenantId: activeTenant, method: "tools/call", toolName, status: "payment_required", costCents: 0 }
              );
            }

            // Atomic balance deduction
            const { balanceCents, lowBalance } = await deductCredits(
              env,
              authResult.context.apiKey,
              authResult.context.billing,
              cost
            );
            const billingHeaders: Record<string, string> = {
              "X-MCPX-Balance-Cents": String(balanceCents),
              ...(lowBalance ? { "X-MCPX-Low-Balance": "true" } : {}),
            };

            if (toolName === "calculate_u_value_iso6946") {
              try {
                const result = calculateUValueIso6946(toolArgs as UValueCalculationInput);
                return track(
                  new Response(
                    JSON.stringify({
                      jsonrpc: "2.0",
                      id: reqId,
                      result: {
                        content: [
                          {
                            type: "text",
                            text: JSON.stringify(result, null, 2),
                          },
                        ],
                      },
                    }),
                    {
                      status: 200,
                      headers: { "Content-Type": "application/json", ...billingHeaders, ...CORS_HEADERS },
                    }
                  ),
                  { tenantId: activeTenant, method: "tools/call", toolName: "calculate_u_value_iso6946", status: "success", costCents: cost }
                );
              } catch (calcErr: any) {
                return track(
                  new Response(
                    JSON.stringify({
                      jsonrpc: "2.0",
                      id: reqId,
                      error: {
                        code: -32602,
                        message: `Invalid params for calculate_u_value_iso6946: ${calcErr.message || String(calcErr)}`,
                      },
                    }),
                    { status: 400, headers: { "Content-Type": "application/json", ...billingHeaders, ...CORS_HEADERS } }
                  ),
                  { tenantId: activeTenant, method: "tools/call", toolName: "calculate_u_value_iso6946", status: "client_error" }
                );
              }
            }

            if (toolName === "analyze_jev_semantic_ast") {
              try {
                const result = analyzeJevSemanticAst(toolArgs as JevAstInput);
                return track(
                  new Response(
                    JSON.stringify({
                      jsonrpc: "2.0",
                      id: reqId,
                      result: {
                        content: [
                          {
                            type: "text",
                            text: JSON.stringify(result, null, 2),
                          },
                        ],
                      },
                    }),
                    {
                      status: 200,
                      headers: { "Content-Type": "application/json", ...billingHeaders, ...CORS_HEADERS },
                    }
                  ),
                  { tenantId: activeTenant, method: "tools/call", toolName: "analyze_jev_semantic_ast", status: "success", costCents: cost }
                );
              } catch (astErr: any) {
                return track(
                  new Response(
                    JSON.stringify({
                      jsonrpc: "2.0",
                      id: reqId,
                      error: {
                        code: -32602,
                        message: `Invalid params for analyze_jev_semantic_ast: ${astErr.message || String(astErr)}`,
                      },
                    }),
                    { status: 400, headers: { "Content-Type": "application/json", ...billingHeaders, ...CORS_HEADERS } }
                  ),
                  { tenantId: activeTenant, method: "tools/call", toolName: "analyze_jev_semantic_ast", status: "client_error" }
                );
              }
            }

            if (toolName === "generate_mcp_server") {
              const prompt = toolArgs.prompt || toolArgs.input || toolArgs.spec;
              if (!prompt || typeof prompt !== "string") {
                return track(
                  new Response(
                    JSON.stringify({
                      jsonrpc: "2.0",
                      id: reqId,
                      error: {
                        code: -32602,
                        message: "Invalid params: 'prompt' string argument is required.",
                      },
                    }),
                    { status: 400, headers: { "Content-Type": "application/json", ...billingHeaders, ...CORS_HEADERS } }
                  ),
                  { tenantId: activeTenant, method: "tools/call", toolName: "generate_mcp_server", status: "client_error" }
                );
              }

              const result = await generateMcpSpec(prompt, env.GEMINI_API_KEY);
              ctx.waitUntil(recordUsage(env, userId));

              return track(
                new Response(
                  JSON.stringify({
                    jsonrpc: "2.0",
                    id: reqId,
                    result: {
                      content: [
                        {
                          type: "text",
                          text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
                        },
                      ],
                    },
                  }),
                  {
                    status: 200,
                    headers: {
                      "Content-Type": "application/json",
                      "X-MCPX-User": userId,
                      "X-MCPX-Plan": plan,
                      ...billingHeaders,
                      ...CORS_HEADERS,
                    },
                  }
                ),
                { tenantId: activeTenant, method: "tools/call", toolName: "generate_mcp_server", status: "success", costCents: cost }
              );
            }

            if (toolName === "evaluate_fraud_transaction") {
              const amount = Number(toolArgs.amount) || 0;
              const currency = String(toolArgs.currency || "EUR");
              const userRiskScore = Number(toolArgs.userRiskScore) || 0;
              const isHighRisk = amount > 5000 || userRiskScore > 0.8;

              return track(
                new Response(
                  JSON.stringify({
                    jsonrpc: "2.0",
                    id: reqId,
                    result: {
                      content: [
                        {
                          type: "text",
                          text: JSON.stringify({
                            decision: isHighRisk ? "MANUAL_REVIEW" : "APPROVE",
                            riskLevel: isHighRisk ? "HIGH" : "LOW",
                            amount,
                            currency,
                            userRiskScore,
                            timestamp: new Date().toISOString(),
                          }, null, 2),
                        },
                      ],
                    },
                  }),
                  {
                    status: 200,
                    headers: { "Content-Type": "application/json", ...billingHeaders, ...CORS_HEADERS },
                  }
                ),
                { tenantId: activeTenant, method: "tools/call", toolName: "evaluate_fraud_transaction", status: "success", costCents: cost }
              );
            }

            return track(
              new Response(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: reqId,
                  error: {
                    code: -32601,
                    message: `Unknown tool: '${toolName}'`,
                  },
                }),
                { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
              ),
              { tenantId: activeTenant, method: "tools/call", toolName: String(toolName || "none"), status: "client_error" }
            );
          }

          // MCP Ping
          if (body.method === "ping") {
            return track(
              new Response(
                JSON.stringify({ jsonrpc: "2.0", id: reqId, result: {} }),
                { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
              ),
              { tenantId: activeTenant, method: "ping", status: "success" }
            );
          }

          // Other unrecognized JSON-RPC calls
          return track(
            new Response(
              JSON.stringify({
                jsonrpc: "2.0",
                id: reqId ?? null,
                error: {
                  code: -32601,
                  message: `Method '${body.method}' not found.`,
                },
              }),
              { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
            ),
            { tenantId: activeTenant, method: String(body.method || "unknown"), toolName: "none", status: "client_error" }
          );
        }

        // 2.5. Legacy HTTP POST specification generation
        const cost = 5;
        if (authResult.context.billing.mode !== "unlimited" && authResult.context.billing.balanceCents < cost) {
          return track(
            create402RestResponse(activeTenant, authResult.context.billing.balanceCents, cost),
            { tenantId: activeTenant, method: routeMethod, toolName: "generate_mcp_server", status: "payment_required", costCents: 0 }
          );
        }

        const rawInput = body.prompt || body.inputSnippet || body.message || body.input || body.spec;

        if (!rawInput || typeof rawInput !== "string") {
          return track(
            new Response(
              JSON.stringify({ error: "Bad Request: 'prompt', 'message', 'input', or 'spec' string is required." }),
              { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
            ),
            { tenantId: activeTenant, method: routeMethod, status: "client_error" }
          );
        }

        const { balanceCents, lowBalance } = await deductCredits(
          env,
          authResult.context.apiKey,
          authResult.context.billing,
          cost
        );
        const billingHeaders: Record<string, string> = {
          "X-MCPX-Balance-Cents": String(balanceCents),
          ...(lowBalance ? { "X-MCPX-Low-Balance": "true" } : {}),
        };

        const result = await generateMcpSpec(rawInput, env.GEMINI_API_KEY);

        // 2.6. Asynchronous usage accounting only after successful Gemini call
        ctx.waitUntil(recordUsage(env, userId));

        return track(
          new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              meta: { userId, plan },
              result,
            }),
            {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                "X-MCPX-User": userId,
                "X-MCPX-Plan": plan,
                ...billingHeaders,
                ...CORS_HEADERS,
              },
            }
          ),
          { tenantId: activeTenant, method: routeMethod, toolName: "generate_mcp_server", status: "success", costCents: cost }
        );
      } catch (err: any) {
        return track(
          new Response(
            JSON.stringify({ error: "Internal Server Error", details: err?.message || String(err) }),
            { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
          ),
          { tenantId: activeTenant, method: routeMethod, status: "server_error" }
        );
      }
    }

    return track(
      new Response(JSON.stringify({ error: "Not Found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      }),
      { method: "not_found", status: "client_error" }
    );
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    await handleScheduled(controller, env, ctx);
  },
};
