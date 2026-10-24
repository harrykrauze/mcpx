import type { Express, Request, Response } from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import { generateMcpServer } from "./generator.js";
import { runSelfHealingPipeline } from "./selfHealingPipeline.js";
import { validateToolManifest } from "./schemaGuard.js";
import { TypeSafeJevFilter } from "./jevFilter.js";
import type { AuthenticatedPrincipal, OAuth2SecurityGuard } from "./oauthGuard.js";
import type { McpLanguage } from "../types/mcp.js";

export interface DynamicMcpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
  tenantId?: string; // If specified, accessible only to that tenantId (multitenancy isolation)
  sourceCode?: string; // Generated TypeScript code for semantic Jev safety check
  handler: (args: Record<string, any>, principal: AuthenticatedPrincipal) => Promise<{
    content: Array<{ type: "text"; text: string }>;
    isError?: boolean;
  }>;
}

export interface ManagedSseSession {
  sessionId: string;
  principal: AuthenticatedPrincipal;
  transport: SSEServerTransport;
  server: Server;
  keepAliveTimer: NodeJS.Timeout;
  createdAt: number;
  lastActivityAt: number;
}

const BUILTIN_GENERATE_TOOL = {
  name: "generate_mcp_server",
  description:
    "Generates and self-heals a production-ready MCP server from an OpenAPI spec, cURL command, or JSON schema.",
  inputSchema: {
    type: "object" as const,
    properties: {
      spec: {
        type: "string",
        description: "The raw API specification, OpenAPI YAML/JSON, cURL snippet, or JSON structure."
      },
      target_language: {
        type: "string",
        enum: ["typescript", "python"],
        default: "typescript"
      },
      server_name: {
        type: "string",
        default: "generated-mcp-server"
      }
    },
    required: ["spec"]
  }
};

export class RemoteMcpSseGateway {
  private readonly sessions = new Map<string, ManagedSseSession>();
  private readonly dynamicTools = new Map<string, DynamicMcpToolDefinition>();
  private readonly keepAliveIntervalMs: number;

  constructor(options?: { keepAliveIntervalMs?: number }) {
    this.keepAliveIntervalMs = options?.keepAliveIntervalMs ?? 15000;
  }

  /**
   * Registers a dynamically generated and verified MCP tool in the gateway
   */
  public registerDynamicTool(tool: DynamicMcpToolDefinition): void {
    const validation = validateToolManifest({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    });

    if (!validation.success) {
      throw new Error(
        `Dynamic tool registration rejected (SchemaGuard): ${validation.errors?.join("; ")}`
      );
    }

    // TypeSafe Jev semantic code check prior to registration
    if (tool.sourceCode) {
      const jevCheck = TypeSafeJevFilter.inspectCode(tool.sourceCode);
      if (!jevCheck.allowed) {
        throw new Error(
          `Dynamic tool registration rejected (JevFilter): ${jevCheck.violations.map(v => v.message).join("; ")}`
        );
      }
    }

    this.dynamicTools.set(tool.name, tool);
  }

  /**
   * Returns active sessions list and metadata
   */
  public getActiveSessions() {
    return Array.from(this.sessions.values()).map(s => ({
      sessionId: s.sessionId,
      clientId: s.principal.clientId,
      tenantId: s.principal.tenantId,
      authMethod: s.principal.authMethod,
      createdAt: s.createdAt,
      lastActivityAt: s.lastActivityAt
    }));
  }

  /**
   * Creates an isolated MCP Server instance for the specific SSE session and its tenant
   */
  private createSessionMcpServer(principal: AuthenticatedPrincipal): Server {
    const mcpServer = new Server(
      {
        name: "mcpx-remote-gateway",
        version: "0.2.0"
      },
      {
        capabilities: {
          tools: {}
        }
      }
    );

    mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
      const tenantTools = Array.from(this.dynamicTools.values())
        .filter(t => !t.tenantId || t.tenantId === principal.tenantId)
        .map(t => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema
        }));

      return {
        tools: [BUILTIN_GENERATE_TOOL, ...tenantTools]
      };
    });

    mcpServer.setRequestHandler(CallToolRequestSchema, async request => {
      const toolName = request.params.name;
      const args = (request.params.arguments || {}) as Record<string, any>;

      // 1. Built-in self-healing MCP server generator
      if (toolName === "generate_mcp_server") {
        if (!principal.scopes.includes("mcp:generate") && !principal.scopes.includes("mcp:admin")) {
          return {
            content: [{ type: "text", text: "Forbidden: Missing 'mcp:generate' scope." }],
            isError: true
          };
        }

        const spec = String(args.spec || "");
        const language = (args.target_language || "typescript") as McpLanguage;
        const serverName = String(args.server_name || "generated-mcp-server");

        const result = await generateMcpServer({
          inputSnippet: spec,
          language,
          serverName,
          transport: "sse"
        });

        // If target language is TypeScript, pass main entry file through Self-Healing Pipeline
        const mainTsFile = result.files.find(f => f.path === "index.ts");
        let healingSummary = "N/A";
        if (mainTsFile && language === "typescript") {
          const healRes = await runSelfHealingPipeline({
            initialCode: mainTsFile.content,
            maxIterations: 2
          });
          mainTsFile.content = healRes.code;
          healingSummary = healRes.success
            ? `VERIFIED_CLEAN (iterations: ${healRes.totalIterations})`
            : `CIRCUIT_BREAKER_HALT (${healRes.errorReport?.reason})`;
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  serverName: result.serverName,
                  language: result.language,
                  selfHealingStatus: healingSummary,
                  summary: result.summary,
                  filesCount: result.files.length
                },
                null,
                2
              )
            }
          ]
        };
      }

      // 2. Dynamically registered tools with tenant isolation
      const dynamicTool = this.dynamicTools.get(toolName);
      if (!dynamicTool) {
        throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${toolName}`);
      }

      if (dynamicTool.tenantId && dynamicTool.tenantId !== principal.tenantId) {
        return {
          content: [
            {
              type: "text",
              text: `Access Denied: Tool '${toolName}' belongs to another tenant.`
            }
          ],
          isError: true
        };
      }

      if (!principal.scopes.includes("mcp:tools") && !principal.scopes.includes("mcp:admin")) {
        return {
          content: [{ type: "text", text: "Forbidden: Missing 'mcp:tools' scope." }],
          isError: true
        };
      }

      // TypeSafe Jev runtime arguments validation
      const inputCheck = TypeSafeJevFilter.inspectInput(args);
      if (!inputCheck.allowed) {
        return {
          content: [
            {
              type: "text",
              text: `JevFilter Security Violation: ${inputCheck.violations.map(v => v.message).join("; ")}`
            }
          ],
          isError: true
        };
      }

      return await dynamicTool.handler(args, principal);
    });

    return mcpServer;
  }

  /**
   * Mounts Remote SSE and OAuth 2.1 routes on the Express application
   */
  public mountRoutes(app: Express, securityGuard: OAuth2SecurityGuard): void {
    // 1. RFC 9728: OAuth Protected Resource Metadata
    app.get("/.well-known/oauth-protected-resource", (req: Request, res: Response) => {
      const host = req.headers.host || "localhost:3000";
      const protocol = req.protocol || "http";
      res.json(securityGuard.getProtectedResourceMetadata(`${protocol}://${host}`));
    });

    // 1b. RFC 8414: OAuth 2.0 Authorization Server Metadata
    app.get("/.well-known/oauth-authorization-server", (req: Request, res: Response) => {
      const host = req.headers.host || "localhost:3000";
      const protocol = req.protocol || "http";
      res.json(securityGuard.getAuthorizationServerMetadata(`${protocol}://${host}`));
    });

    // 1c. JWKS Endpoint (RFC 7517)
    app.get("/.well-known/jwks.json", (_req: Request, res: Response) => {
      res.json({ keys: [] });
    });

    // 2. RFC 7591: Dynamic Client Registration (DCR)
    app.post("/oauth/register", (req: Request, res: Response) => {
      try {
        const clientData = securityGuard.registerClient(req.body || {});
        res.status(201).json(clientData);
      } catch (err: any) {
        res.status(400).json({ error: "invalid_client_metadata", error_description: err.message });
      }
    });

    // 3. OAuth 2.1 Token Endpoint
    app.post("/oauth/token", (req: Request, res: Response) => {
      try {
        const tokenResp = securityGuard.exchangeToken(req.body || {});
        res.json(tokenResp);
      } catch (err: any) {
        res.status(400).json({ error: "invalid_grant", error_description: err.message });
      }
    });

    // 4. Scoped API Key izveides galapunkts
    app.post("/oauth/api-keys", (req: Request, res: Response) => {
      const { tenant_id = "default_tenant", scopes = ["mcp:connect", "mcp:tools", "mcp:generate"] } =
        req.body || {};
      const keyData = securityGuard.createScopedApiKey({
        tenantId: tenant_id,
        scopes
      });
      res.status(201).json(keyData);
    });

    // 5. Remote MCP SSE sesijas izveide (GET /mcp/sse)
    app.get(
      "/mcp/sse",
      securityGuard.requireAuth("mcp:connect"),
      async (req: Request, res: Response) => {
        // Prevent SSE buffering behind Nginx and Cloudflare proxies
        res.setHeader("X-Accel-Buffering", "no");
        res.setHeader("Cache-Control", "no-cache, no-transform");

        const principal = (req as Request & { mcpPrincipal: AuthenticatedPrincipal }).mcpPrincipal;
        const transport = new SSEServerTransport("/mcp/messages", res);
        const sessionServer = this.createSessionMcpServer(principal);

        const sessionId = transport.sessionId;

        // Send ping / keep-alive comments every N seconds
        const keepAliveTimer = setInterval(() => {
          if (!res.writableEnded) {
            res.write(`: ping ${Date.now()}\n\n`);
          }
        }, this.keepAliveIntervalMs);

        const managedSession: ManagedSseSession = {
          sessionId,
          principal,
          transport,
          server: sessionServer,
          keepAliveTimer,
          createdAt: Date.now(),
          lastActivityAt: Date.now()
        };

        this.sessions.set(sessionId, managedSession);

        res.on("close", () => {
          clearInterval(keepAliveTimer);
          this.sessions.delete(sessionId);
          sessionServer.close().catch(() => {});
        });

        await sessionServer.connect(transport);
      }
    );

    // 6. Remote MCP JSON-RPC message handling (POST /mcp/messages?sessionId=...)
    app.post(
      "/mcp/messages",
      securityGuard.requireAuth("mcp:connect"),
      async (req: Request, res: Response) => {
        const principal = (req as Request & { mcpPrincipal: AuthenticatedPrincipal }).mcpPrincipal;
        const sessionId = String(req.query.sessionId || "");

        if (!sessionId) {
          return res.status(400).json({ error: "Missing sessionId query parameter." });
        }

        const session = this.sessions.get(sessionId);
        if (!session) {
          return res.status(404).json({ error: `Session '${sessionId}' not found or has been closed.` });
        }

        // Strict Tenant isolation: other tenants cannot send commands to foreign sessions
        if (session.principal.tenantId !== principal.tenantId) {
          return res.status(403).json({
            error: "tenant_isolation_violation",
            error_description: "Access denied: session belongs to another tenant."
          });
        }

        session.lastActivityAt = Date.now();
        await session.transport.handlePostMessage(req, res, req.body);
      }
    );

    // 7. Active sessions telemetry
    app.get(
      "/mcp/sessions",
      securityGuard.requireAuth("mcp:connect"),
      (_req: Request, res: Response) => {
        res.json({
          activeSessionsCount: this.sessions.size,
          sessions: this.getActiveSessions()
        });
      }
    );
  }

  /**
   * Closes all active SSE sessions (e.g., during graceful server shutdown)
   */
  public async closeAllSessions(): Promise<void> {
    for (const session of this.sessions.values()) {
      clearInterval(session.keepAliveTimer);
      await session.server.close().catch(() => {});
    }
    this.sessions.clear();
  }
}
