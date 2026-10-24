export type BillingMode = "prepaid" | "postpaid" | "unlimited";

export interface BillingDetails {
  mode: BillingMode;
  balanceCents: number;             // Integer (USD cents), eliminating floating-point errors
  currency: "USD" | "EUR";
  costPerToolCallCents: number;     // Base price per standard tool call (default: 1 cent = $0.01)
  costPerGenerateCents: number;     // Price per code generation (default: 5 cents = $0.05)
  totalSpentCents: number;          // Historical total spend in cents
  lastTopupAt?: string;             // ISO 8601 timestamp
  lowBalanceThresholdCents: number; // Threshold for low-balance warning header (default: 10 cents = $0.10)
}

export interface ProvisionKeyPayload {
  tenantId?: string;
  userId?: string;
  description?: string;
  plan?: "free" | "pro" | "enterprise";
  rateLimit?: number;
  scopes?: string[];
  expiresInDays?: number;
  requestsLimit?: number;
  initialBalanceCents?: number;
  billingMode?: BillingMode;
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

export interface KVNamespace {
  get(key: string, type?: "text"): Promise<string | null>;
  get<ExpectedValue = unknown>(key: string, type: "json"): Promise<ExpectedValue | null>;
  put(key: string, value: string, options?: { expiration?: number; expirationTtl?: number; metadata?: any }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    keys: Array<{ name: string; expiration?: number; metadata?: any }>;
    list_complete: boolean;
    cursor?: string;
  }>;
}

export interface AnalyticsEngineDataPoint {
  indexes?: (string | null | undefined)[];
  blobs?: (string | null | undefined)[];
  doubles?: (number | null | undefined)[];
}

export interface AnalyticsEngineDataset {
  writeDataPoint(point: AnalyticsEngineDataPoint): void;
}

export interface Env {
  GEMINI_API_KEY: string;
  MCPX_MASTER_KEY?: string;
  MCPX_API_KEY?: string;
  JWT_SECRET?: string;
  CREEM_WEBHOOK_SECRET?: string;
  MCPX_KEYS: KVNamespace;
  ENVIRONMENT?: string;
  ISSUER_URL?: string;
  RESOURCE_ID?: string;
  RATE_LIMITER?: {
    limit: (options: { key: string }) => Promise<{ success: boolean }>;
  };
  ANALYTICS?: AnalyticsEngineDataset;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export interface ScheduledController {
  scheduledTime: number;
  cron: string;
  noRetry?: () => void;
}

export interface LowBalanceRecord {
  keyId: string;
  tenantId: string;
  balanceCents: number;
}

export interface DailyAuditSummary {
  timestamp: string;
  date: string;
  previousDate: string;
  totalActiveKeys: number;
  lowBalanceCount: number;
  lowBalanceKeys: LowBalanceRecord[];
  status: "HEALTHY" | "DEGRADED";
}

export interface TelemetryPoint {
  tenantId?: string;
  method: string;
  toolName?: string;
  status: "success" | "timeout" | "security_violation" | "client_error" | "revoked" | "server_error" | "payment_required";
  clientType?: string;
  executionTimeMs: number;
  statusCode: number;
  payloadSizeBytes?: number;
  costCents?: number;
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

  const runTask = async () => {
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
          point.costCents !== undefined ? point.costCents : (point.payloadSizeBytes ?? 0),
        ],
      });
    } catch (err) {
      // Telemetry errors must not abort primary execution flow
      console.error("Telemetry write failed:", err);
    }
  };

  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(runTask());
  } else {
    runTask().catch(() => {});
  }
}

export interface AuthContext {
  userId: string;
  tenantId?: string;
  plan: "free" | "pro" | "enterprise";
  requestsLimit?: number;
  scopes?: string[];
  apiKey?: string;
  keyId?: string;
  billing: BillingDetails;
  isMaster: boolean;
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

export async function computeKeyId(apiKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuf = await crypto.subtle.digest("SHA-256", encoder.encode(apiKey));
  const hashHex = Array.from(new Uint8Array(hashBuf), (b) => b.toString(16).padStart(2, "0")).join("");
  return `key_${hashHex.slice(0, 12)}`;
}

/**
 * Constant-time string comparison using SHA-256 hashing via Web Crypto.
 * Prevents timing attacks and length-leakage side-channels.
 */
export async function timingSafeStringEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const aBuf = await crypto.subtle.digest("SHA-256", encoder.encode(a));
  const bBuf = await crypto.subtle.digest("SHA-256", encoder.encode(b));
  const aBytes = new Uint8Array(aBuf);
  const bBytes = new Uint8Array(bBuf);
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

/**
 * Strict administrator authorization check for routes /keys, /keys/provision, /keys/:keyId.
 * Requires Authorization: Bearer <MCPX_MASTER_KEY> or X-Master-Key header.
 */
export async function validateMasterAuth(
  request: Request,
  env: Env
): Promise<{ authorized: true } | { authorized: false; response: Response }> {
  const baseUrl = env.ISSUER_URL || "https://mcpx.harrykrauze.com";
  const resourceMetadataUrl = `${baseUrl}/.well-known/oauth-protected-resource`;

  const masterSecret = env.MCPX_MASTER_KEY || env.MCPX_API_KEY;
  if (!masterSecret) {
    return {
      authorized: false,
      response: new Response(
        JSON.stringify({ error: "Master authentication is not configured on server." }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      ),
    };
  }

  // 1. Extract token from Authorization: Bearer or X-Master-Key header
  const authHeader = request.headers.get("Authorization");
  const xMasterKey = request.headers.get("X-Master-Key")?.trim();

  let token: string | null = null;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7).trim();
  } else if (xMasterKey) {
    token = xMasterKey;
  }

  if (!token) {
    return {
      authorized: false,
      response: new Response(
        JSON.stringify({
          error: "Unauthorized: Missing Authorization or X-Master-Key header.",
          resource_metadata: resourceMetadataUrl,
        }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            "WWW-Authenticate": `Bearer error="unauthorized", resource_metadata="${resourceMetadataUrl}"`,
          },
        }
      ),
    };
  }

  // 2. Constant-time comparison against Master Secret
  const isMaster = await timingSafeStringEqual(token, masterSecret);
  if (isMaster) {
    return { authorized: true };
  }

  // Additional check with secondary master key if both are defined
  if (env.MCPX_MASTER_KEY && env.MCPX_API_KEY && env.MCPX_MASTER_KEY !== env.MCPX_API_KEY) {
    const isAltMaster = await timingSafeStringEqual(token, env.MCPX_API_KEY);
    if (isAltMaster) {
      return { authorized: true };
    }
  }

  // 3. Check: Is this a tenant API key from KV storage?
  if (env.MCPX_KEYS) {
    try {
      const rawRecord = await env.MCPX_KEYS.get(`key:${token}`, "text");
      if (rawRecord) {
        const cleaned = rawRecord.replace(/^\uFEFF/, "").trim();
        const record = JSON.parse(cleaned) as ApiKeyRecord;
        if (record) {
          if (record.status === "revoked") {
            return {
              authorized: false,
              response: new Response(
                JSON.stringify({
                  error: "Unauthorized: API key has been revoked.",
                  resource_metadata: resourceMetadataUrl,
                }),
                {
                  status: 401,
                  headers: {
                    "Content-Type": "application/json",
                    "WWW-Authenticate": `Bearer error="token_revoked", resource_metadata="${resourceMetadataUrl}"`,
                  },
                }
              ),
            };
          }

          if (record.status === "active") {
            // Tenant is authenticated, but lacks administrator privileges -> 403 Forbidden
            return {
              authorized: false,
              response: new Response(
                JSON.stringify({
                  error: "Forbidden: Insufficient scope. Master admin privileges required.",
                  resource_metadata: resourceMetadataUrl,
                }),
                {
                  status: 403,
                  headers: {
                    "Content-Type": "application/json",
                    "WWW-Authenticate": `Bearer error="insufficient_scope", resource_metadata="${resourceMetadataUrl}"`,
                  },
                }
              ),
            };
          }
        }
      }
    } catch {
      // If JSON is malformed, ignore and fall through to 401
    }
  }

  // 4. Token recognized neither as master nor tenant -> 401 Unauthorized
  return {
    authorized: false,
    response: new Response(
      JSON.stringify({
        error: "Unauthorized: Invalid token.",
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

export async function requireAuth(request: Request, env: Env): Promise<AuthResult> {
  const masterSecret = env.MCPX_MASTER_KEY || env.MCPX_API_KEY;
  if (!masterSecret && !env.MCPX_KEYS) {
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

  // 1. Emergency master/admin key validation with constant-time comparison
  if (masterSecret) {
    const isMaster = await timingSafeStringEqual(token, masterSecret);
    if (isMaster) {
      return {
        authorized: true,
        context: {
          userId: "master-admin",
          tenantId: "master-admin",
          plan: "enterprise",
          scopes: ["mcp:read", "mcp:write", "mcp:generate", "mcp:admin"],
          apiKey: token,
          keyId: "master-admin",
          isMaster: true,
          billing: {
            mode: "unlimited",
            balanceCents: 999999,
            currency: "USD",
            costPerToolCallCents: 1,
            costPerGenerateCents: 5,
            totalSpentCents: 0,
            lowBalanceThresholdCents: 50,
          },
        },
      };
    }
    if (env.MCPX_MASTER_KEY && env.MCPX_API_KEY && env.MCPX_MASTER_KEY !== env.MCPX_API_KEY) {
      const isAltMaster = await timingSafeStringEqual(token, env.MCPX_API_KEY);
      if (isAltMaster) {
        return {
          authorized: true,
          context: {
            userId: "master-admin",
            tenantId: "master-admin",
            plan: "enterprise",
            scopes: ["mcp:read", "mcp:write", "mcp:generate", "mcp:admin"],
            apiKey: token,
            keyId: "master-admin",
            isMaster: true,
            billing: {
              mode: "unlimited",
              balanceCents: 999999,
              currency: "USD",
              costPerToolCallCents: 1,
              costPerGenerateCents: 5,
              totalSpentCents: 0,
              lowBalanceThresholdCents: 50,
            },
          },
        };
      }
    }
  }

  // 2. Multi-tenant KV storage verification with key format `key:<token>`
  if (env.MCPX_KEYS) {
    try {
      const rawRecord = await env.MCPX_KEYS.get(`key:${token}`, "text");
      if (rawRecord) {
        const cleaned = rawRecord.replace(/^\uFEFF/, "").trim();
        const record = JSON.parse(cleaned) as ApiKeyRecord;
        if (record) {
          // Check if key is revoked
          if (record.status === "revoked") {
            return {
              authorized: false,
              response: new Response(
                JSON.stringify({
                  error: "Unauthorized: API key has been revoked.",
                  resource_metadata: resourceMetadataUrl,
                }),
                {
                  status: 401,
                  headers: {
                    "Content-Type": "application/json",
                    "WWW-Authenticate": `Bearer error="token_revoked", resource_metadata="${resourceMetadataUrl}"`,
                  },
                }
              ),
            };
          }

          if (record.status === "active" || (record.status as string)?.toLowerCase() === "active") {
            // Check expiration timestamp if configured
            if (record.expiresAt) {
              const expTime = new Date(record.expiresAt).getTime();
              if (!isNaN(expTime) && Date.now() > expTime) {
                return {
                  authorized: false,
                  response: new Response(
                    JSON.stringify({
                      error: "Unauthorized: API key has expired.",
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
            }

            const rawBalance = (record as any).balanceCents;
            const balanceCents = typeof rawBalance === "number" ? rawBalance : 100;
            const billing: BillingDetails = record.billing || {
              mode: "prepaid",
              balanceCents,
              currency: "USD",
              costPerToolCallCents: 1,
              costPerGenerateCents: 5,
              totalSpentCents: (record as any).totalSpentCents || 0,
              lowBalanceThresholdCents: 50,
            };

            return {
              authorized: true,
              context: {
                userId: record.userId || record.tenantId || "anonymous",
                tenantId: record.tenantId || record.userId || "anonymous",
                plan: record.plan || "pro",
                requestsLimit: record.requestsLimit,
                scopes: record.scopes || ["mcp:read", "mcp:write", "mcp:generate"],
                apiKey: token,
                keyId: record.keyId || (await computeKeyId(token)),
                billing,
                isMaster: false,
              },
            };
          }
        }
      }
    } catch {
      // If JSON record in KV is invalid, treat as unauthenticated
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
