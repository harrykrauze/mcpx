import {
  requireAuth,
  validateMasterAuth,
  recordUsage,
  generateApiKey,
  computeKeyId,
  ApiKeyRecord,
  ProvisionKeyPayload,
  AnalyticsEngineDataPoint,
  AnalyticsEngineDataset,
  Env,
} from "./auth";
import { generateMcpSpec } from "./gemini";

export type { Env };

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export interface TelemetryPoint {
  tenantId?: string;
  method: string;
  toolName?: string;
  status: "success" | "timeout" | "security_violation" | "client_error" | "revoked" | "server_error";
  clientType?: string;
  executionTimeMs: number;
  statusCode: number;
  payloadSizeBytes?: number;
}

export function detectClientType(userAgent: string | null): string {
  if (!userAgent) return "unknown";
  const ua = userAgent.toLowerCase();
  if (ua.includes("claude-code") || ua.includes("claudecode") || ua.includes("claude")) {
    return "claude-code";
  }
  if (ua.includes("cursor")) {
    return "cursor";
  }
  if (ua.includes("mozilla") || ua.includes("chrome") || ua.includes("safari") || ua.includes("edge")) {
    return "browser";
  }
  if (ua.includes("node") || ua.includes("python") || ua.includes("curl") || ua.includes("tsx") || ua.includes("postman")) {
    return "custom-agent";
  }
  return "custom-agent";
}

export function recordTelemetry(
  env: Env,
  ctx: ExecutionContext,
  point: TelemetryPoint
): void {
  if (!env.ANALYTICS || typeof env.ANALYTICS.writeDataPoint !== "function") {
    return;
  }
  ctx.waitUntil(
    (async () => {
      try {
        const tenant = point.tenantId || "anonymous";
        env.ANALYTICS!.writeDataPoint({
          indexes: [tenant],
          blobs: [
            tenant,
            point.method,
            point.toolName || "none",
            point.status,
            point.clientType || "unknown",
          ],
          doubles: [
            Math.max(0, Math.round(point.executionTimeMs)),
            point.statusCode,
            point.payloadSizeBytes ?? 0,
          ],
        });
      } catch (err) {
        // Telemetrijas kļūdas nedrīkst pārtraukt pamata izpildi
        console.error("Telemetry write failed:", err);
      }
    })()
  );
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
};

const MAX_PAYLOAD_BYTES = 512 * 1024; // 512 KB drošības slieksnis

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
      }
    ): Response => {
      const executionTimeMs = Date.now() - startTime;
      let status = options.status;
      if (!status) {
        if (response.status >= 500) {
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
      });
      return response;
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // 1. Publiskais veselības pārbaudes maršruts
    if (url.pathname === "/health" || (url.pathname === "/" && request.method === "GET")) {
      return track(
        new Response(
          JSON.stringify({
            status: "healthy",
            domain: "mcpx.harrykrauze.com",
            geminiConfigured: !!env.GEMINI_API_KEY,
            authConfigured: !!(env.MCPX_API_KEY || env.MCPX_KEYS),
            kvConfigured: !!env.MCPX_KEYS,
            rateLimiterConfigured: !!env.RATE_LIMITER,
            analyticsConfigured: !!env.ANALYTICS,
          }, null, 2),
          {
            headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS }
          }
        ),
        { method: "health", status: "success" }
      );
    }

    // 1b. Mašīnlasāmā specifikācija LLM aģentiem (/llms.txt)
    if (url.pathname === "/llms.txt") {
      const llmsContent = `# mcpx — Model Context Protocol Gateway & Generation Engine

> High-performance, deterministic Model Context Protocol (MCP) server generator and secure remote SSE execution gateway.

## Overview
- **Domain:** \`https://mcpx.harrykrauze.com\`
- **Protocol:** Model Context Protocol (MCP 2024-11-05+), RFC 9728 (OAuth Protected Resource Metadata), RFC 8414 (OAuth Authorization Server Metadata), RFC 7591 (Dynamic Client Registration).
- **Core Engine:** TypeScript 5.8 / 7.0, Gemini 2.5 / 3.8 Flash, Node.js / Cloudflare Workers runtime.
- **Security Posture:** Strict SSRF blocking (RFC 1918, Link-local, Cloud metadata, Loopback, IPv6 ULA/Link-local), Origin lock, Rate limiting (10 req/min), Zero-trust token validation (iss, aud, exp with 30s clock skew).

## Discovery & OAuth 2.1 Endpoints
- \`GET /.well-known/oauth-protected-resource\`: RFC 9728 resource metadata pointing to SSE endpoint and authorization servers.
- \`GET /.well-known/oauth-authorization-server\`: RFC 8414 server metadata with grant types, token endpoints, and supported scopes.
- \`GET /.well-known/jwks.json\`: RFC 7517 JSON Web Key Set endpoint.
- \`GET /health\`: Public health check with system uptime and provider status.
- \`GET /llms.txt\`: This machine-readable specification.

## Core Services
- \`POST /api/generate\`: Protected MCP server code generation from OpenAPI specs, cURL snippets, or JSON schemas.
  - Required Header: \`Authorization: Bearer <JWT>\` or \`X-API-Key: <SCOPED_KEY>\`
  - Required Scope: \`mcp:generate\`
  - Rate Limit: 10 req/min (HTTP 429 with \`Retry-After: 60\`)
- \`GET /mcp/sse\`: Remote MCP Server-Sent Events stream for agent connections.
  - Required Scope: \`mcp:connect\`
  - Headers: \`X-Accel-Buffering: no\`, \`Cache-Control: no-cache, no-transform\`
- \`POST /mcp/messages?sessionId={id}\`: Remote MCP JSON-RPC message delivery with tenant isolation.

## Tool Capabilities
- \`generate_mcp_server\`: Transforms API snippets into executable TypeScript (@modelcontextprotocol/sdk) or Python (FastMCP with stateless_http=True) MCP servers.
- \`evaluate_fraud_transaction\`: Real-time risk scoring and transaction policy evaluation tool.

## Client Integration (Claude Code & Cursor)

### Claude Code (CLI)
\`\`\`bash
claude mcp add --transport sse mcpx https://mcpx.harrykrauze.com/mcp/sse --header "Authorization: Bearer <MCPX_API_KEY>"
\`\`\`

### Cursor IDE (.cursor/mcp.json)
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
`;
      return track(
        new Response(llmsContent, {
          headers: { "Content-Type": "text/markdown; charset=utf-8", ...CORS_HEADERS }
        }),
        { method: "llms.txt", status: "success" }
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

    // Dinamiskā atslēgu izsniegšana (Admin/Headless - Stingrā perimetra aizsardzība)
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

      // 1. Ātruma ierobežotājs (Rate Limiting perimetram: 5 req/min uz IP)
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

      // 2. Stingra Master Administratora autorizācijas pārbaude ar timing-safe salīdzināšanu
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

      // 3. Krātuves pārbaude
      if (!env.MCPX_KEYS) {
        return track(
          new Response(
            JSON.stringify({ error: "Storage not configured on server." }),
            { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
          ),
          { method: "keys/provision", status: "server_error" }
        );
      }

      // 4. Ievades datu validācija (TypeSafe Zod/TS shēma)
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

        const newApiKey = generateApiKey();
        const keyId = await computeKeyId(newApiKey);
        const record: ApiKeyRecord = {
          keyId,
          userId: tenantId,
          tenantId,
          description,
          plan,
          status: "active",
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

    // Atslēgu inventarizācija un saraksts administratoram (GET /keys)
    if (url.pathname === "/keys" && request.method === "GET") {
      // 1. Ātruma ierobežotājs (Rate limit 10 req/min)
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

      // 2. Master administratora autorizācija
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
          const rawKey = k.name.slice(4); // Noņem "key:" prefiksu
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

            keysList.push({
              keyId,
              maskedKey,
              tenantId: record.tenantId || record.userId,
              description: record.description ?? null,
              plan: record.plan,
              status: record.status,
              rateLimit: record.rateLimit || 10,
              scopes: record.scopes || ["mcp:read", "mcp:write", "mcp:generate"],
              createdAt: record.createdAt || null,
              expiresAt: record.expiresAt || null,
              revokedAt: record.revokedAt || null,
            });
          } catch {
            // Ignorē atsevišķu bojātu ierakstu
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

    // Atslēgas tūlītēja atsaukšana (DELETE /keys/:keyId vai POST /keys/revoke)
    if (
      (request.method === "DELETE" && url.pathname.startsWith("/keys/")) ||
      (url.pathname === "/keys/revoke" && request.method === "POST")
    ) {
      // 1. Ātruma ierobežotājs
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

      // 2. Master administratora autorizācija
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

        // Meklējam atslēgu KV krātuvē:
        // A variants: tiešā atslēga `key:<targetIdentifier>`
        let actualKey = targetIdentifier;
        let rawRecord = await env.MCPX_KEYS.get(`key:${targetIdentifier}`, "text");

        // B variants: rādītājs pēc `id:<targetIdentifier>`
        if (!rawRecord) {
          const resolvedKey = await env.MCPX_KEYS.get(`id:${targetIdentifier}`, "text");
          if (resolvedKey) {
            actualKey = resolvedKey.trim();
            rawRecord = await env.MCPX_KEYS.get(`key:${actualKey}`, "text");
          }
        }

        // C variants: skenējam pēc `record.keyId`
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
                // Turpināt meklēšanu
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

    // Atslēgas statusa un patēriņa pārbaude (GET /keys/status)
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

      const { userId, plan, requestsLimit, tenantId } = auth.context;
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

    // SSE plūsmas ceļš (/sse un /mcp/sse)
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

    // 2. Apstrādes un koda ģenerēšanas maršruts (/api/generate, /message, /mcp/messages)
    if (url.pathname === "/api/generate" || url.pathname === "/message" || url.pathname === "/mcp/messages") {
      if (request.method !== "POST") {
        return track(
          new Response(JSON.stringify({ error: "Method Not Allowed. Use POST." }), {
            status: 405,
            headers: { "Content-Type": "application/json", ...CORS_HEADERS },
          }),
          { method: url.pathname.replace(/^\//, ""), status: "client_error" }
        );
      }

      // 2.0. Ātruma ierobežotāja pārbaude (Rate Limiting: 10 req/min)
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
            { method: url.pathname.replace(/^\//, ""), status: "security_violation" }
          );
        }
      }

      // 2.1. Payload izmēra pārbaude pirms lasīšanas atmiņā
      const contentLength = request.headers.get("content-length");
      if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD_BYTES) {
        return track(
          new Response(
            JSON.stringify({
              error: "Payload Too Large: Maximum allowed request size is 512 KB.",
            }),
            { status: 413, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
          ),
          { method: url.pathname.replace(/^\//, ""), status: "client_error" }
        );
      }

      // 2.2. Autorizācijas pārbaude (KV vai Master atslēga)
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
          { method: url.pathname.replace(/^\//, ""), status: isRevoked ? "revoked" : "security_violation" }
        );
      }

      const { userId, plan, requestsLimit, tenantId } = auth.context;
      const activeTenant = tenantId || userId;

      // 2.3. Lietotāja kvotas pārbaude (ja definēts requestsLimit)
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
            { tenantId: activeTenant, method: url.pathname.replace(/^\//, ""), status: "security_violation" }
          );
        }
      }

      // 2.4. Pieprasījuma satura nolasīšana un apstrāde
      try {
        const body = (await request.json()) as any;

        // Model Context Protocol (MCP) JSON-RPC 2.0 atbalsts
        if (body && typeof body === "object" && body.jsonrpc === "2.0" && typeof body.method === "string") {
          const reqId = body.id;

          // MCP Dzīvescikls: initialize
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

          // MCP Dzīvescikls: notifications/initialized
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

          // MCP Rīku atklāšana: tools/list
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

          // MCP Rīku izpilde: tools/call
          if (body.method === "tools/call") {
            const toolName = body.params?.name;
            const toolArgs = body.params?.arguments || {};

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
                    { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
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
                      ...CORS_HEADERS,
                    },
                  }
                ),
                { tenantId: activeTenant, method: "tools/call", toolName: "generate_mcp_server", status: "success" }
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
                    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
                  }
                ),
                { tenantId: activeTenant, method: "tools/call", toolName: "evaluate_fraud_transaction", status: "success" }
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

          // Citi neatpazīti JSON-RPC izsaukumi
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

        // 2.5. Tradicionālā (legacy) HTTP POST specifikācijas ģenerēšana
        const rawInput = body.prompt || body.inputSnippet || body.message || body.input || body.spec;

        if (!rawInput || typeof rawInput !== "string") {
          return track(
            new Response(
              JSON.stringify({ error: "Bad Request: 'prompt', 'message', 'input', or 'spec' string is required." }),
              { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
            ),
            { tenantId: activeTenant, method: url.pathname.replace(/^\//, ""), status: "client_error" }
          );
        }

        const result = await generateMcpSpec(rawInput, env.GEMINI_API_KEY);

        // 2.6. Asinhrona patēriņa uzskaite tikai pēc veiksmīga Gemini izsaukuma
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
                ...CORS_HEADERS,
              },
            }
          ),
          { tenantId: activeTenant, method: url.pathname.replace(/^\//, ""), toolName: "generate_mcp_server", status: "success" }
        );
      } catch (err: any) {
        return track(
          new Response(
            JSON.stringify({ error: "Internal Server Error", details: err?.message || String(err) }),
            { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
          ),
          { tenantId: activeTenant, method: url.pathname.replace(/^\//, ""), status: "server_error" }
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
};
