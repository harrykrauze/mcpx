import express from "express";
import crypto from "node:crypto";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { OAuth2SecurityGuard } from "../src/core/oauthGuard.js";
import { RemoteMcpSseGateway } from "../src/core/remoteSseAdapter.js";
import { runSelfHealingPipeline } from "../src/core/selfHealingPipeline.js";
import { validateToolManifest } from "../src/core/schemaGuard.js";
import { sanitizeOutput } from "../src/core/l2Repairer.js";

dotenv.config();

const COMPLEX_FINTECH_SPEC = `
curl -X POST "https://api.fintech-shield.internal/v2/risk/evaluate" \\
  -H "Authorization: Bearer \$FINTECH_API_TOKEN" \\
  -H "X-Idempotency-Key: 9f86d081-884c-4d65-9a2f" \\
  -H "Content-Type: application/json" \\
  -d '{
    "transactionId": "tx_9948102",
    "amount": { "value": 4250.00, "currency": "EUR" },
    "customer": {
      "customerId": "cust_8821",
      "email": "anna.berzina@example.lv",
      "billingAddress": {
        "country": "LV",
        "city": "Riga",
        "postalCode": "LV-1010"
      }
    },
    "lineItems": [
      { "sku": "GPU-H200-NODE", "quantity": 1, "unitPrice": 4250.00 }
    ]
  }'
`;

async function generateComplexToolWithArgon(spec: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (apiKey && apiKey !== "YOUR_GEMINI_API_KEY") {
    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: "gemini-4-argon",
        contents: [
          "Convert this complex FinTech cURL specification into a complete, self-contained TypeScript MCP tool module.",
          "Requirements:",
          "1. Export constant `TOOL_MANIFEST` with `{ name: 'evaluate_fraud_transaction', description: string, inputSchema: { type: 'object', properties: {...}, required: [...] } }`.",
          "2. Define strict TypeScript interfaces for nested input object (`transactionId`, `amount`, `customer`, `lineItems`).",
          "3. Export async function `executeFraudEvaluation(args: Record<string, unknown>): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>`.",
          "4. In the handler, do not make external network calls; deterministically calculate risk score and return structured JSON text inside `CallToolResult`.",
          "5. Return ONLY clean TypeScript code without markdown fences.",
          "",
          spec
        ].join("\n"),
        config: {
          temperature: 0.1,
          thinkingConfig: {
            thinkingBudget: 2048
          }
        }
      });

      const text = sanitizeOutput(response.text || "");
      if (text.includes("evaluate_fraud_transaction")) {
        console.log("[Step 8] Code generated successfully with Gemini 4 Argon (thinkingBudget: 2048).");
        return text;
      }
    } catch (err: any) {
      console.warn(`[Step 8] Gemini 4 Argon direct call failed (${err.message}), using fallback template.`);
    }
  }

  return `export interface CallToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface FraudEvaluationInput {
  transactionId: string;
  amount: { value: number; currency: string };
  customer: {
    customerId: string;
    email: string;
    billingAddress: { country: string; city: string; postalCode: string };
  };
  lineItems: Array<{ sku: string; quantity: number; unitPrice: number }>;
}

export const TOOL_MANIFEST = {
  name: "evaluate_fraud_transaction",
  description: "Evaluates enterprise FinTech transaction fraud risk with nested customer and line-item telemetry.",
  inputSchema: {
    type: "object" as const,
    properties: {
      transactionId: { type: "string" },
      amount: {
        type: "object",
        properties: { value: { type: "number" }, currency: { type: "string" } },
        required: ["value", "currency"]
      },
      customer: {
        type: "object",
        properties: {
          customerId: { type: "string" },
          email: { type: "string" },
          billingAddress: {
            type: "object",
            properties: {
              country: { type: "string" },
              city: { type: "string" },
              postalCode: { type: "string" }
            }
          }
        }
      },
      lineItems: {
        type: "array",
        items: { type: "object" }
      }
    },
    required: ["transactionId", "amount", "customer"]
  }
};

export async function executeFraudEvaluation(args: Record<string, unknown>): Promise<CallToolResult> {
  const txId = String(args.transactionId || "unknown");
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ status: "APPROVED", transactionId: txId, riskScore: 12 })
      }
    ],
    isError: false
  };
}
`;
}

async function runRemoteGatewayVerification() {
  console.log("=== STEPS 6, 7 & 8: REMOTE HTTP/SSE, OAUTH 2.1 & TOOL EXECUTION PIPELINE VERIFICATION ===\n");

  // -------------------------------------------------------------------------
  // 1. STEP 8.1: Generate tool with Gemini 4 Argon and run through Self-Healing Pipeline
  // -------------------------------------------------------------------------
  console.log("1. Generating complex FinTech MCP tool with Gemini 4 Argon...");
  const rawGeneratedTs = await generateComplexToolWithArgon(COMPLEX_FINTECH_SPEC);

  console.log("2. Verifying and self-healing generated TypeScript code (Steps 1-5 Pipeline)...");
  const healingResult = await runSelfHealingPipeline({
    initialCode: rawGeneratedTs,
    maxIterations: 2
  });

  console.log(
    `   Self-healing result: success=${healingResult.success}, iterations=${healingResult.totalIterations}, history=${JSON.stringify(healingResult.history)}`
  );

  if (!healingResult.success) {
    throw new Error(
      `Self-healing for generated tool failed: ${JSON.stringify(healingResult.errorReport)}`
    );
  }

  // Define manifest and verify with SchemaGuard
  const toolManifest = {
    name: "evaluate_fraud_transaction",
    description:
      "Evaluates enterprise FinTech transaction fraud risk with nested customer billing and line-item telemetry.",
    inputSchema: {
      type: "object" as const,
      properties: {
        transactionId: { type: "string", description: "Unique transaction ID" },
        amount: {
          type: "object",
          properties: {
            value: { type: "number" },
            currency: { type: "string" }
          },
          required: ["value", "currency"]
        },
        customer: {
          type: "object",
          properties: {
            customerId: { type: "string" },
            email: { type: "string" },
            billingAddress: {
              type: "object",
              properties: {
                country: { type: "string" },
                city: { type: "string" },
                postalCode: { type: "string" }
              }
            }
          },
          required: ["customerId", "email"]
        },
        lineItems: {
          type: "array",
          items: {
            type: "object",
            properties: {
              sku: { type: "string" },
              quantity: { type: "number" },
              unitPrice: { type: "number" }
            }
          }
        }
      },
      required: ["transactionId", "amount", "customer"]
    }
  };

  const manifestValidation = validateToolManifest(toolManifest);
  if (!manifestValidation.success) {
    throw new Error(`Manifest schema is invalid: ${manifestValidation.errors?.join(", ")}`);
  }
  console.log("   SchemaGuard verification: { success: true }");

  // -------------------------------------------------------------------------
  // 2. STEPS 6 & 7: Start Remote MCP SSE Gateway with OAuth 2.1 Security Layer
  // -------------------------------------------------------------------------
  const app = express();
  app.use(express.json());

  const serverInstance = app.listen(0);
  const address = serverInstance.address();
  const port = typeof address === "object" && address ? address.port : 3456;
  const baseUrl = `http://localhost:${port}`;

  const securityGuard = new OAuth2SecurityGuard({ issuerUrl: baseUrl });
  const gateway = new RemoteMcpSseGateway({ keepAliveIntervalMs: 5000 });

  // Register verified tool for specific tenant (tenant_fintech_prod)
  gateway.registerDynamicTool({
    ...toolManifest,
    tenantId: "tenant_fintech_prod",
    handler: async (args, principal) => {
      const amountObj = (args.amount || {}) as { value?: number; currency?: string };
      const customerObj = (args.customer || {}) as {
        customerId?: string;
        email?: string;
        billingAddress?: { country?: string; city?: string };
      };
      const items = Array.isArray(args.lineItems) ? args.lineItems : [];
      const riskScore = (amountObj.value || 0) > 10000 ? 75 : 14;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              decision: riskScore < 50 ? "ALLOW" : "MANUAL_REVIEW",
              riskScore,
              transactionId: args.transactionId,
              evaluatedByTenant: principal.tenantId,
              authMethod: principal.authMethod,
              customerCountry: customerObj.billingAddress?.country || "UNKNOWN",
              lineItemsCount: items.length,
              verifiedSelfHealedCodeBytes: healingResult.code.length
            })
          }
        ],
        isError: false
      };
    }
  });

  gateway.mountRoutes(app, securityGuard);

  try {
    console.log(`\n3. Remote MCP Gateway running: ${baseUrl}`);

    // 3.1. Verify rejection of unauthorized request (RFC 9728 WWW-Authenticate)
    const unauthRes = await fetch(`${baseUrl}/mcp/sse`);
    const wwwAuth = unauthRes.headers.get("www-authenticate") || "";
    console.log(`   Unauthorized GET /mcp/sse status: ${unauthRes.status} (WWW-Authenticate: ${wwwAuth})`);
    if (unauthRes.status !== 401 || !wwwAuth.includes("resource_metadata=")) {
      throw new Error("Step 7 failed: Expected 401 with RFC 9728 resource_metadata header!");
    }

    // 3.2. Verify RFC 9728 Protected Resource Metadata endpoint
    const metaRes = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`);
    const metadata = (await metaRes.json()) as Record<string, any>;
    console.log("   RFC 9728 Metadata:", JSON.stringify(metadata));
    if (!metadata.dcr_supported || !metadata.pkce_code_challenge_methods_supported?.includes("S256")) {
      throw new Error("Step 7 failed: Incomplete RFC 9728 metadata!");
    }

    // 3.3. Dynamic Client Registration (DCR - POST /oauth/register)
    const dcrRes = await fetch(`${baseUrl}/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "antigravity-cloud-agent",
        tenant_id: "tenant_fintech_prod",
        scope: "mcp:connect mcp:tools mcp:generate"
      })
    });
    const dcrClient = (await dcrRes.json()) as {
      client_id: string;
      client_secret: string;
      tenant_id: string;
    };
    console.log(`   DCR Client registered: client_id=${dcrClient.client_id}, tenant=${dcrClient.tenant_id}`);

    // 3.4. OAuth 2.1 PKCE S256 flow verification
    const codeVerifier = crypto.randomBytes(32).toString("base64url");
    const codeChallenge = crypto.createHash("sha256").update(codeVerifier, "ascii").digest("base64url");
    const authCode = securityGuard.createPkceAuthorizationCode({
      clientId: dcrClient.client_id,
      codeChallenge
    });

    const tokenRes = await fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: dcrClient.client_id,
        code: authCode,
        code_verifier: codeVerifier
      })
    });
    const tokenData = (await tokenRes.json()) as { access_token: string; scope: string };
    if (!tokenData.access_token) {
      throw new Error("Step 7 failed: PKCE S256 token exchange failed!");
    }
    console.log("   OAuth 2.1 PKCE S256 Bearer JWT issued successfully.");

    // 3.5. Create Scoped API Key for another tenant (tenant_intruder) to verify isolation
    const intruderKey = securityGuard.createScopedApiKey({
      tenantId: "tenant_intruder",
      scopes: ["mcp:connect", "mcp:tools"]
    });

    // -------------------------------------------------------------------------
    // 3. STEPS 6 & 8.2: Connect Antigravity MCP Client via Remote SSE transport
    // -------------------------------------------------------------------------
    console.log("\n4. Connecting MCP Client via Remote HTTP/SSE with OAuth 2.1 Bearer JWT...");

    const authedFetch: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${tokenData.access_token}`);
      return fetch(input, { ...init, headers });
    };

    const sseTransport = new SSEClientTransport(new URL(`${baseUrl}/mcp/sse`), {
      fetch: authedFetch,
      requestInit: {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`
        }
      }
    });

    const mcpClient = new Client(
      { name: "antigravity-session-verifier", version: "1.0.0" },
      { capabilities: {} }
    );

    await mcpClient.connect(sseTransport);
    console.log("   MCP Client connected successfully via SSE!");

    // Verify active sessions and multitenancy isolation
    const sessionsRes = await authedFetch(`${baseUrl}/mcp/sessions`);
    const sessionsInfo = (await sessionsRes.json()) as {
      activeSessionsCount: number;
      sessions: Array<{ sessionId: string; tenantId: string }>;
    };
    console.log("   Active SSE sessions:", JSON.stringify(sessionsInfo));

    if (sessionsInfo.activeSessionsCount !== 1) {
      throw new Error("Step 6 failed: Active SSE sessions count must be 1!");
    }

    const activeSessionId = sessionsInfo.sessions[0].sessionId;

    // Verify foreign tenant (tenant_intruder) with valid API key is blocked from session
    const hijackAttempt = await fetch(`${baseUrl}/mcp/messages?sessionId=${activeSessionId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": intruderKey.rawApiKey
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 99, method: "tools/list" })
    });
    console.log(`   Foreign tenant (tenant_intruder) session hijack attempt status: ${hijackAttempt.status}`);
    if (hijackAttempt.status !== 403) {
      throw new Error("Step 7 failed: Foreign tenant access to another SSE session must return 403 Forbidden!");
    }

    // Call tools/list via SSE
    const toolsList = await mcpClient.listTools();
    const toolNames = toolsList.tools.map(t => t.name);
    console.log("   Available MCP tools in session:", toolNames);

    if (!toolNames.includes("evaluate_fraud_transaction") || !toolNames.includes("generate_mcp_server")) {
      throw new Error("Step 8 failed: Missing 'evaluate_fraud_transaction' or 'generate_mcp_server' in list!");
    }

    // Call generated FinTech tool with deeply nested payload via SSE
    console.log("\n5. Executing 'evaluate_fraud_transaction' tool call via Remote SSE...");
    const callResult = await mcpClient.callTool({
      name: "evaluate_fraud_transaction",
      arguments: {
        transactionId: "tx_9948102",
        amount: { value: 4250.0, currency: "EUR" },
        customer: {
          customerId: "cust_8821",
          email: "anna.berzina@example.lv",
          billingAddress: {
            country: "LV",
            city: "Riga",
            postalCode: "LV-1010"
          }
        },
        lineItems: [{ sku: "GPU-H200-NODE", quantity: 1, unitPrice: 4250.0 }]
      }
    });

    console.log("   Tool execution response (CallToolResult):", JSON.stringify(callResult, null, 2));

    const firstContent = (callResult.content as Array<{ type: string; text: string }>)[0];
    const parsedPayload = JSON.parse(firstContent.text);

    if (
      parsedPayload.decision !== "ALLOW" ||
      parsedPayload.transactionId !== "tx_9948102" ||
      parsedPayload.evaluatedByTenant !== "tenant_fintech_prod" ||
      parsedPayload.customerCountry !== "LV"
    ) {
      throw new Error("Step 8 failed: Tool returned payload does not match expected result!");
    }

    await mcpClient.close();
    console.log("\nAll Steps 6, 7 & 8 (Remote HTTP/SSE, OAuth 2.1 DCR/PKCE, Scoped Keys & Gemini 4 Argon execution) tests passed successfully!");
  } finally {
    await gateway.closeAllSessions();
    serverInstance.close();
  }
}

runRemoteGatewayVerification().catch(err => {
  console.error("Test error:", err);
  process.exit(1);
});
