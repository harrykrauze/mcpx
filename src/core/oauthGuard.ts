import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";

export type McpScope = "mcp:connect" | "mcp:tools" | "mcp:generate" | "mcp:admin";

export interface AuthenticatedPrincipal {
  clientId: string;
  tenantId: string;
  scopes: McpScope[];
  authMethod: "oauth2_jwt" | "scoped_api_key";
}

export interface RegisteredOAuthClient {
  clientId: string;
  clientSecretHash: string;
  clientName: string;
  tenantId: string;
  redirectUris: string[];
  grantTypes: string[];
  scopes: McpScope[];
  createdAt: number;
}

export interface ScopedApiKeyRecord {
  keyId: string;
  keyPrefix: string;
  keyHash: string;
  tenantId: string;
  scopes: McpScope[];
  createdAt: number;
}

interface JwtPayload {
  sub: string;
  tenantId: string;
  scope: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

/**
 * Deterministic SHA-256 hashing helper (Zero-LLM)
 */
export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Constant-time string comparison preventing timing attacks
 */
export function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * OAuth 2.1 (RFC 9728 / DCR) and Scoped API Keys security manager
 */
export class OAuth2SecurityGuard {
  private readonly jwtSecret: string;
  private readonly issuerUrl: string;
  private readonly resourceId: string;
  private readonly clients = new Map<string, RegisteredOAuthClient>();
  private readonly apiKeys = new Map<string, ScopedApiKeyRecord>();
  private readonly pkceCodes = new Map<
    string,
    { clientId: string; codeChallenge: string; scopes: McpScope[]; expiresAt: number }
  >();

  constructor(options?: { jwtSecret?: string; issuerUrl?: string; resourceId?: string }) {
    this.jwtSecret =
      options?.jwtSecret ||
      process.env.MCP_JWT_SECRET ||
      crypto.randomBytes(32).toString("hex");
    this.issuerUrl = options?.issuerUrl || "http://localhost:3000";
    this.resourceId = options?.resourceId || `${this.issuerUrl}/mcp/sse`;
  }

  /**
   * RFC 9728: OAuth 2.0 Protected Resource Metadata
   */
  public getProtectedResourceMetadata(baseUrl?: string) {
    const resourceBase = baseUrl || this.issuerUrl;
    return {
      resource: `${resourceBase}/mcp/sse`,
      authorization_servers: [resourceBase],
      registration_endpoint: `${resourceBase}/oauth/register`,
      token_endpoint: `${resourceBase}/oauth/token`,
      bearer_methods_supported: ["header"],
      scopes_supported: ["mcp:connect", "mcp:tools", "mcp:generate", "mcp:admin"],
      resource_documentation: `${resourceBase}/MCP_CONFIG.md`,
      dcr_supported: true,
      pkce_code_challenge_methods_supported: ["S256"]
    };
  }

  /**
   * RFC 8414: OAuth 2.0 Authorization Server Metadata
   */
  public getAuthorizationServerMetadata(baseUrl?: string) {
    const base = baseUrl || this.issuerUrl;
    return {
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      jwks_uri: `${base}/.well-known/jwks.json`,
      scopes_supported: ["mcp:connect", "mcp:tools", "mcp:generate", "mcp:admin"],
      response_types_supported: ["code", "token"],
      grant_types_supported: ["client_credentials", "authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
      resource_registration_endpoint: `${base}/.well-known/oauth-protected-resource`
    };
  }

  /**
   * RFC 7591: Dynamic Client Registration (DCR)
   */
  public registerClient(params: {
    client_name: string;
    tenant_id?: string;
    redirect_uris?: string[];
    grant_types?: string[];
    scope?: string;
  }): {
    client_id: string;
    client_secret: string;
    client_name: string;
    tenant_id: string;
    scope: string;
    grant_types: string[];
  } {
    const clientId = `mcpx_client_${crypto.randomBytes(8).toString("hex")}`;
    const clientSecret = `mcpx_secret_${crypto.randomBytes(16).toString("hex")}`;
    const tenantId = params.tenant_id || `tenant_${crypto.randomBytes(4).toString("hex")}`;

    const requestedScopes = (params.scope || "mcp:connect mcp:tools mcp:generate")
      .split(/\s+/)
      .filter(Boolean) as McpScope[];

    const record: RegisteredOAuthClient = {
      clientId,
      clientSecretHash: sha256Hex(clientSecret),
      clientName: params.client_name || "anonymous-mcp-agent",
      tenantId,
      redirectUris: params.redirect_uris || [],
      grantTypes: params.grant_types || ["client_credentials", "authorization_code"],
      scopes: requestedScopes,
      createdAt: Date.now()
    };

    this.clients.set(clientId, record);

    return {
      client_id: clientId,
      client_secret: clientSecret,
      client_name: record.clientName,
      tenant_id: tenantId,
      scope: requestedScopes.join(" "),
      grant_types: record.grantTypes
    };
  }

  /**
   * Creates a PKCE authorization code (OAuth 2.1 authorization_code flow with S256)
   */
  public createPkceAuthorizationCode(params: {
    clientId: string;
    codeChallenge: string;
    scopes?: McpScope[];
  }): string {
    const client = this.clients.get(params.clientId);
    if (!client) {
      throw new Error("invalid_client: Unknown client_id");
    }
    const code = `mcpx_code_${crypto.randomBytes(12).toString("hex")}`;
    this.pkceCodes.set(code, {
      clientId: params.clientId,
      codeChallenge: params.codeChallenge,
      scopes: params.scopes || client.scopes,
      expiresAt: Date.now() + 5 * 60 * 1000
    });
    return code;
  }

  /**
   * OAuth 2.1 Token exchange (client_credentials or authorization_code with PKCE S256)
   */
  public exchangeToken(params: {
    grant_type: string;
    client_id: string;
    client_secret?: string;
    code?: string;
    code_verifier?: string;
    scope?: string;
    expiresInSeconds?: number;
  }): {
    access_token: string;
    token_type: "Bearer";
    expires_in: number;
    scope: string;
    tenant_id: string;
  } {
    const client = this.clients.get(params.client_id);
    if (!client) {
      throw new Error("invalid_client: Client is not registered.");
    }

    let grantedScopes = client.scopes;

    if (params.grant_type === "client_credentials") {
      if (!params.client_secret) {
        throw new Error("invalid_client: Missing client_secret.");
      }
      const incomingHash = sha256Hex(params.client_secret);
      if (!timingSafeCompare(incomingHash, client.clientSecretHash)) {
        throw new Error("invalid_client: Incorrect client_secret.");
      }
      if (params.scope) {
        const reqScopes = params.scope.split(/\s+/).filter(Boolean) as McpScope[];
        grantedScopes = reqScopes.filter(s => client.scopes.includes(s));
      }
    } else if (params.grant_type === "authorization_code") {
      if (!params.code || !params.code_verifier) {
        throw new Error("invalid_request: Missing code or PKCE code_verifier.");
      }
      const pkceEntry = this.pkceCodes.get(params.code);
      if (!pkceEntry || pkceEntry.clientId !== client.clientId || Date.now() > pkceEntry.expiresAt) {
        throw new Error("invalid_grant: Authorization code is invalid or expired.");
      }
      this.pkceCodes.delete(params.code);

      // Verify PKCE S256: BASE64URL-ENCODE(SHA256(ASCII(code_verifier))) === code_challenge
      const computedChallenge = crypto
        .createHash("sha256")
        .update(params.code_verifier, "ascii")
        .digest("base64url");

      if (!timingSafeCompare(computedChallenge, pkceEntry.codeChallenge)) {
        throw new Error("invalid_grant: PKCE S256 code_verifier verification failed.");
      }
      grantedScopes = pkceEntry.scopes;
    } else {
      throw new Error(`unsupported_grant_type: ${params.grant_type}`);
    }

    const expiresIn = params.expiresInSeconds ?? 3600;
    const nowSec = Math.floor(Date.now() / 1000);
    const payload: JwtPayload = {
      sub: client.clientId,
      tenantId: client.tenantId,
      scope: grantedScopes.join(" "),
      iat: nowSec,
      exp: nowSec + expiresIn,
      iss: this.issuerUrl,
      aud: this.resourceId
    };

    const accessToken = this.signJwt(payload);
    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: expiresIn,
      scope: payload.scope,
      tenant_id: client.tenantId
    };
  }

  /**
   * Creates a scoped API key, persisting only its SHA-256 hash
   */
  public createScopedApiKey(params: {
    tenantId: string;
    scopes: McpScope[];
  }): { rawApiKey: string; keyId: string; tenantId: string; scopes: McpScope[] } {
    const keyId = `key_${crypto.randomBytes(6).toString("hex")}`;
    const rawSecret = crypto.randomBytes(20).toString("hex");
    const rawApiKey = `mcpx_live_${keyId}_${rawSecret}`;
    const keyHash = sha256Hex(rawApiKey);

    this.apiKeys.set(keyHash, {
      keyId,
      keyPrefix: `mcpx_live_${keyId}`,
      keyHash,
      tenantId: params.tenantId,
      scopes: params.scopes,
      createdAt: Date.now()
    });

    return {
      rawApiKey,
      keyId,
      tenantId: params.tenantId,
      scopes: params.scopes
    };
  }

  /**
   * Verifies both OAuth 2.1 Bearer JWT tokens and Scoped API Keys (mcpx_live_...)
   */
  public verifyTokenOrApiKey(rawToken: string): AuthenticatedPrincipal {
    const clean = rawToken.replace(/^Bearer\s+/i, "").trim();
    if (!clean) {
      throw new Error("Empty authentication token.");
    }

    // 1. Check if token is a Scoped API key
    if (clean.startsWith("mcpx_live_")) {
      const hash = sha256Hex(clean);
      const record = this.apiKeys.get(hash);
      if (!record) {
        throw new Error("Invalid or revoked API key.");
      }
      return {
        clientId: record.keyId,
        tenantId: record.tenantId,
        scopes: record.scopes,
        authMethod: "scoped_api_key"
      };
    }

    // 2. Validate OAuth 2.1 JWT token
    const payload = this.verifyJwt(clean);
    return {
      clientId: payload.sub,
      tenantId: payload.tenantId,
      scopes: payload.scope.split(/\s+/).filter(Boolean) as McpScope[],
      authMethod: "oauth2_jwt"
    };
  }

  /**
   * Express middleware for protected MCP routes
   */
  public requireAuth(requiredScope: McpScope = "mcp:connect") {
    return (req: Request, res: Response, next: NextFunction) => {
      const authHeader = req.headers.authorization;
      const apiKeyHeader = req.headers["x-api-key"] as string | undefined;
      const tokenCandidate = authHeader || apiKeyHeader;

      if (!tokenCandidate) {
        const resourceMetaUrl = `${this.issuerUrl}/.well-known/oauth-protected-resource`;
        res.setHeader(
          "WWW-Authenticate",
          `Bearer realm="mcpx-remote-gateway", error="invalid_token", resource_metadata="${resourceMetaUrl}", scope="${requiredScope}"`
        );
        return res.status(401).json({
          error: "unauthorized",
          error_description: "OAuth 2.1 Bearer token or X-API-Key header required.",
          resource_metadata: resourceMetaUrl
        });
      }

      try {
        const principal = this.verifyTokenOrApiKey(tokenCandidate);
        if (
          !principal.scopes.includes(requiredScope) &&
          !principal.scopes.includes("mcp:admin")
        ) {
          return res.status(403).json({
            error: "insufficient_scope",
            error_description: `Missing required scope: ${requiredScope}`
          });
        }

        (req as Request & { mcpPrincipal?: AuthenticatedPrincipal }).mcpPrincipal = principal;
        next();
      } catch (err: any) {
        const resourceMetaUrl = `${this.issuerUrl}/.well-known/oauth-protected-resource`;
        res.setHeader(
          "WWW-Authenticate",
          `Bearer realm="mcpx-remote-gateway", error="invalid_token", resource_metadata="${resourceMetaUrl}", scope="${requiredScope}"`
        );
        return res.status(401).json({
          error: "invalid_token",
          error_description: err.message || "Authentication failed.",
          resource_metadata: resourceMetaUrl
        });
      }
    };
  }

  private signJwt(payload: JwtPayload): string {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = crypto
      .createHmac("sha256", this.jwtSecret)
      .update(`${header}.${body}`)
      .digest("base64url");
    return `${header}.${body}.${signature}`;
  }

  private verifyJwt(token: string): JwtPayload {
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new Error("Invalid JWT format.");
    }
    const [header, body, signature] = parts;
    const expectedSig = crypto
      .createHmac("sha256", this.jwtSecret)
      .update(`${header}.${body}`)
      .digest("base64url");

    if (!timingSafeCompare(signature, expectedSig)) {
      throw new Error("Invalid JWT signature.");
    }

    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as JwtPayload;
    const nowSec = Math.floor(Date.now() / 1000);
    const MAX_CLOCK_SKEW_SEC = 30;

    // 1. Mandatory exp check (with 30s clock skew)
    if (typeof payload.exp !== "number" || nowSec - MAX_CLOCK_SKEW_SEC > payload.exp) {
      throw new Error("JWT token expired or missing exp claim.");
    }

    // 2. Mandatory iat future check
    if (typeof payload.iat === "number" && payload.iat > nowSec + MAX_CLOCK_SKEW_SEC) {
      throw new Error("JWT token issued in the future (iat violation).");
    }

    // 3. Mandatory iss (Issuer) check
    if (!payload.iss || payload.iss !== this.issuerUrl) {
      throw new Error(`Invalid JWT issuer: expected '${this.issuerUrl}', received '${payload.iss}'.`);
    }

    // 4. Mandatory aud (Audience) check
    if (!payload.aud || (payload.aud !== this.resourceId && payload.aud !== this.issuerUrl)) {
      throw new Error(`Invalid JWT audience: expected '${this.resourceId}', received '${payload.aud}'.`);
    }

    return payload;
  }
}
