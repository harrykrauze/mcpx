import { requireAuth, recordUsage, generateApiKey, ApiKeyRecord, Env } from "./auth";
import { generateMcpSpec } from "./gemini";

export type { Env };

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
};

const MAX_PAYLOAD_BYTES = 512 * 1024; // 512 KB drošības slieksnis

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // 1. Publiskais veselības pārbaudes maršruts
    if (url.pathname === "/health" || (url.pathname === "/" && request.method === "GET")) {
      return new Response(
        JSON.stringify({
          status: "healthy",
          domain: "mcpx.harrykrauze.com",
          geminiConfigured: !!env.GEMINI_API_KEY,
          authConfigured: !!(env.MCPX_API_KEY || env.MCPX_KEYS),
          kvConfigured: !!env.MCPX_KEYS,
          rateLimiterConfigured: !!env.RATE_LIMITER,
        }, null, 2),
        {
          headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS }
        }
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
`;
      return new Response(llmsContent, {
        headers: { "Content-Type": "text/markdown; charset=utf-8", ...CORS_HEADERS }
      });
    }

    const baseUrl = env.ISSUER_URL || "https://mcpx.harrykrauze.com";

    // RFC 9728: OAuth Protected Resource Metadata
    if (url.pathname === "/.well-known/oauth-protected-resource") {
      return new Response(
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
      );
    }

    // RFC 8414: OAuth 2.0 Authorization Server Metadata
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      return new Response(
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
      );
    }

    // RFC 7517: JSON Web Key Set (JWKS)
    if (url.pathname === "/.well-known/jwks.json") {
      return new Response(
        JSON.stringify({ keys: [] }, null, 2),
        {
          headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS }
        }
      );
    }

    // Dinamiskā atslēgu izsniegšana (Admin/Headless)
    if (url.pathname === "/keys/provision") {
      if (request.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method Not Allowed. Use POST." }), {
          status: 405,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }

      // Pārbaude: atļauts TIKAI ar derīgu Master API atslēgu
      const authHeader = request.headers.get("Authorization");
      const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

      if (!env.MCPX_API_KEY || token !== env.MCPX_API_KEY) {
        return new Response(
          JSON.stringify({ error: "Forbidden: Master admin key required for key provisioning." }),
          { status: 403, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
        );
      }

      if (!env.MCPX_KEYS) {
        return new Response(
          JSON.stringify({ error: "Storage not configured." }),
          { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
        );
      }

      try {
        const payload = (await request.json()) as {
          userId?: string;
          plan?: "free" | "pro" | "enterprise";
          requestsLimit?: number;
        };

        if (!payload.userId || typeof payload.userId !== "string") {
          return new Response(
            JSON.stringify({ error: "Bad Request: 'userId' (string) is required." }),
            { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
          );
        }

        const newApiKey = generateApiKey();
        const record: ApiKeyRecord = {
          userId: payload.userId.trim(),
          plan: payload.plan || "pro",
          status: "active",
          requestsLimit: payload.requestsLimit,
        };

        await env.MCPX_KEYS.put(`key:${newApiKey}`, JSON.stringify(record));

        return new Response(
          JSON.stringify({
            success: true,
            apiKey: newApiKey,
            userId: record.userId,
            plan: record.plan,
            status: record.status,
            requestsLimit: record.requestsLimit ?? null,
          }),
          {
            status: 201,
            headers: { "Content-Type": "application/json", ...CORS_HEADERS },
          }
        );
      } catch (err: any) {
        return new Response(
          JSON.stringify({ error: "Bad Request: Invalid JSON body.", details: err?.message }),
          { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
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
        return new Response(auth.response.body, {
          status: auth.response.status,
          headers,
        });
      }

      const { userId, plan, requestsLimit } = auth.context;
      let usage = 0;
      if (env.MCPX_KEYS) {
        const usageStr = await env.MCPX_KEYS.get(`usage:${userId}`, "text");
        usage = usageStr ? parseInt(usageStr.trim(), 10) || 0 : 0;
      }

      return new Response(
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
      );
    }

    // Atslēgas atsaukšana ar Master atslēgu (POST /keys/revoke)
    if (url.pathname === "/keys/revoke") {
      if (request.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method Not Allowed. Use POST." }), {
          status: 405,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }

      const authHeader = request.headers.get("Authorization");
      const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

      if (!env.MCPX_API_KEY || token !== env.MCPX_API_KEY) {
        return new Response(
          JSON.stringify({ error: "Forbidden: Master admin key required to revoke keys." }),
          { status: 403, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
        );
      }

      if (!env.MCPX_KEYS) {
        return new Response(
          JSON.stringify({ error: "Storage not configured." }),
          { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
        );
      }

      try {
        const payload = (await request.json()) as { apiKey?: string };
        if (!payload.apiKey || typeof payload.apiKey !== "string") {
          return new Response(
            JSON.stringify({ error: "Bad Request: 'apiKey' (string) is required." }),
            { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
          );
        }

        const targetKey = payload.apiKey.trim();
        const rawRecord = await env.MCPX_KEYS.get(`key:${targetKey}`, "text");
        if (!rawRecord) {
          return new Response(
            JSON.stringify({ error: "Not Found: API key not found." }),
            { status: 404, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
          );
        }

        const cleaned = rawRecord.replace(/^\uFEFF/, "").trim();
        const record = JSON.parse(cleaned) as ApiKeyRecord;
        record.status = "revoked";

        await env.MCPX_KEYS.put(`key:${targetKey}`, JSON.stringify(record));

        return new Response(
          JSON.stringify({
            success: true,
            apiKey: targetKey,
            userId: record.userId,
            status: "revoked",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json", ...CORS_HEADERS },
          }
        );
      } catch (err: any) {
        return new Response(
          JSON.stringify({ error: "Bad Request: Invalid JSON body.", details: err?.message }),
          { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
        );
      }
    }

    // SSE plūsmas ceļš (/sse un /mcp/sse)
    if ((url.pathname === "/sse" || url.pathname === "/mcp/sse") && request.method === "GET") {
      return new Response("event: endpoint\ndata: /message\n\n", {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no",
          ...CORS_HEADERS,
        },
      });
    }

    // 2. Apstrādes un koda ģenerēšanas maršruts (/api/generate un /message)
    if (url.pathname === "/api/generate" || url.pathname === "/message") {
      if (request.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method Not Allowed. Use POST." }), {
          status: 405,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }

      // 2.0. Ātruma ierobežotāja pārbaude (Rate Limiting: 10 req/min)
      if (env.RATE_LIMITER) {
        const clientKey = request.headers.get("cf-connecting-ip") || "anonymous";
        const { success } = await env.RATE_LIMITER.limit({ key: clientKey });

        if (!success) {
          return new Response(
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
          );
        }
      }

      // 2.1. Payload izmēra pārbaude pirms lasīšanas atmiņā
      const contentLength = request.headers.get("content-length");
      if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD_BYTES) {
        return new Response(
          JSON.stringify({
            error: "Payload Too Large: Maximum allowed request size is 512 KB.",
          }),
          { status: 413, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
        );
      }

      // 2.2. Autorizācijas pārbaude (KV vai Master atslēga)
      const auth = await requireAuth(request, env);
      if (!auth.authorized) {
        const headers = new Headers(auth.response.headers);
        for (const [k, v] of Object.entries(CORS_HEADERS)) {
          headers.set(k, v);
        }
        return new Response(auth.response.body, {
          status: auth.response.status,
          headers,
        });
      }

      const { userId, plan, requestsLimit } = auth.context;

      // 2.3. Lietotāja kvotas pārbaude (ja definēts requestsLimit)
      if (requestsLimit !== undefined && env.MCPX_KEYS) {
        const currentUsageStr = await env.MCPX_KEYS.get(`usage:${userId}`, "text");
        const currentUsage = currentUsageStr ? parseInt(currentUsageStr, 10) || 0 : 0;
        if (currentUsage >= requestsLimit) {
          return new Response(
            JSON.stringify({
              error: `Quota Exceeded: Plan '${plan}' limit of ${requestsLimit} requests reached.`,
            }),
            {
              status: 429,
              headers: { "Content-Type": "application/json", ...CORS_HEADERS },
            }
          );
        }
      }

      // 2.4. Pieprasījuma satura nolasīšana un apstrāde
      try {
        const body = (await request.json()) as {
          message?: string;
          input?: string;
          spec?: string;
          prompt?: string;
          inputSnippet?: string;
        };
        const rawInput = body.prompt || body.inputSnippet || body.message || body.input || body.spec;

        if (!rawInput || typeof rawInput !== "string") {
          return new Response(
            JSON.stringify({ error: "Bad Request: 'prompt', 'message', 'input', or 'spec' string is required." }),
            { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
          );
        }

        const result = await generateMcpSpec(rawInput, env.GEMINI_API_KEY);

        // 2.5. Asinhrona patēriņa uzskaite tikai pēc veiksmīga Gemini izsaukuma
        ctx.waitUntil(recordUsage(env, userId));

        return new Response(
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
        );
      } catch (err: any) {
        return new Response(
          JSON.stringify({ error: "Internal Server Error", details: err?.message || String(err) }),
          { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
        );
      }
    }

    return new Response(JSON.stringify({ error: "Not Found" }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  },
};
