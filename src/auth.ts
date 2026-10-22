export interface ApiKeyRecord {
  userId: string;
  plan: "free" | "pro" | "enterprise";
  status: "active" | "revoked";
  requestsLimit?: number;
}

export interface KVNamespace {
  get(key: string, type?: "text"): Promise<string | null>;
  get<ExpectedValue = unknown>(key: string, type: "json"): Promise<ExpectedValue | null>;
  put(key: string, value: string, options?: { expiration?: number; expirationTtl?: number; metadata?: any }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface Env {
  GEMINI_API_KEY: string;
  MCPX_API_KEY?: string;
  JWT_SECRET?: string;
  MCPX_KEYS: KVNamespace;
  ENVIRONMENT?: string;
  ISSUER_URL?: string;
  RESOURCE_ID?: string;
  RATE_LIMITER?: {
    limit: (options: { key: string }) => Promise<{ success: boolean }>;
  };
}

export interface AuthContext {
  userId: string;
  plan: "free" | "pro" | "enterprise";
  requestsLimit?: number;
}

export type AuthResult =
  | { authorized: true; context: AuthContext }
  | { authorized: false; response: Response };

export function generateApiKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `mcpx_live_${hex}`;
}

export async function requireAuth(request: Request, env: Env): Promise<AuthResult> {
  if (!env.MCPX_API_KEY && !env.MCPX_KEYS) {
    return {
      authorized: false,
      response: new Response(
        JSON.stringify({ error: "Server authentication is not configured." }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      ),
    };
  }

  const authHeader = request.headers.get("Authorization");
  const baseUrl = env.ISSUER_URL || "https://mcpx.harrykrauze.com";
  const resourceMetadataUrl = `${baseUrl}/.well-known/oauth-protected-resource`;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      authorized: false,
      response: new Response(
        JSON.stringify({
          error: "Unauthorized: Missing or malformed Authorization header. Expected 'Bearer <key>'.",
          resource_metadata: resourceMetadataUrl,
        }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            "WWW-Authenticate": `Bearer error="invalid_token", resource_metadata="${resourceMetadataUrl}"`,
          },
        }
      ),
    };
  }

  const token = authHeader.slice(7).trim();

  // 1. Ārkārtas master/admin atslēgas pārbaude
  if (env.MCPX_API_KEY && token === env.MCPX_API_KEY) {
    return {
      authorized: true,
      context: {
        userId: "master-admin",
        plan: "enterprise",
      },
    };
  }

  // 2. Daudzlietotāju KV krātuves pārbaude ar formātu `key:<token>`
  if (env.MCPX_KEYS) {
    try {
      const rawRecord = await env.MCPX_KEYS.get(`key:${token}`, "text");
      if (rawRecord) {
        const cleaned = rawRecord.replace(/^\uFEFF/, "").trim();
        const record = JSON.parse(cleaned) as ApiKeyRecord;
        if (record && record.status === "active") {
          return {
            authorized: true,
            context: {
              userId: record.userId,
              plan: record.plan,
              requestsLimit: record.requestsLimit,
            },
          };
        }
      }
    } catch {
      // Ja JSON formāts KV ierakstā nav derīgs, apstrādā kā nederīgu atslēgu
    }
  }

  return {
    authorized: false,
    response: new Response(
      JSON.stringify({
        error: "Forbidden: Invalid or revoked API key.",
        resource_metadata: resourceMetadataUrl,
      }),
      {
        status: 403,
        headers: {
          "Content-Type": "application/json",
          "WWW-Authenticate": `Bearer error="invalid_token", resource_metadata="${resourceMetadataUrl}"`,
        },
      }
    ),
  };
}

export async function recordUsage(env: Env, userId: string): Promise<void> {
  if (!env.MCPX_KEYS) return;
  const usageKey = `usage:${userId}`;
  const currentStr = await env.MCPX_KEYS.get(usageKey, "text");
  const currentCount = currentStr ? parseInt(currentStr.trim(), 10) || 0 : 0;
  await env.MCPX_KEYS.put(usageKey, String(currentCount + 1));
}
