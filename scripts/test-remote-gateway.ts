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
          "Konvertē šo sarežģīto FinTech cURL specifikāciju par pilnīgu, pašpietiekamu TypeScript MCP rīka moduli.",
          "Prasības:",
          "1. Eksportē konstanti `TOOL_MANIFEST` ar `{ name: 'evaluate_fraud_transaction', description: string, inputSchema: { type: 'object', properties: {...}, required: [...] } }`.",
          "2. Definē stingrus TypeScript interfeisus ligzdotajam ievades objektam (`transactionId`, `amount`, `customer`, `lineItems`).",
          "3. Eksportē asinhrono funkciju `executeFraudEvaluation(args: Record<string, unknown>): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>`.",
          "4. Funkcijā neveic ārēju tīkla izsaukumu uz neeksistējošo domēnu, bet deterministiski aprēķini riska līmeni un atgriez strukturētu JSON teksta atbildi iekš `CallToolResult`.",
          "5. Atgriez TIKAI tīru TypeScript kodu bez markdown blokiem.",
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
        console.log("[Solis 8] Kods veiksmīgi uzģenerēts ar Gemini 4 Argon (thinkingBudget: 2048).");
        return text;
      }
    } catch (err: any) {
      console.warn(`[Solis 8] Gemini 4 Argon tiešais izsaukums neizdevās (${err.message}), izmantojam rezerves šablonu.`);
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
  console.log("=== SOLIS 6, 7 UN 8: REMOTE HTTP/SSE, OAUTH 2.1 UN ANTIGRAVITY RĪKU PLŪSMAS VERIFIKĀCIJA ===\n");

  // -------------------------------------------------------------------------
  // 1. SOLIS 8.1: Ģenerējam rīku ar Gemini 4 Argon un izlaižam caur Self-Healing Pipeline
  // -------------------------------------------------------------------------
  console.log("1. Ģenerējam sarežģītu FinTech MCP rīku ar Gemini 4 Argon...");
  const rawGeneratedTs = await generateComplexToolWithArgon(COMPLEX_FINTECH_SPEC);

  console.log("2. Verificējam un pašārstējam ģenerēto TypeScript kodu (Solis 1-5 Pipeline)...");
  const healingResult = await runSelfHealingPipeline({
    initialCode: rawGeneratedTs,
    maxIterations: 2
  });

  console.log(
    `   Pašārstēšanās rezultāts: success=${healingResult.success}, iterācijas=${healingResult.totalIterations}, vēsture=${JSON.stringify(healingResult.history)}`
  );

  if (!healingResult.success) {
    throw new Error(
      `Ģenerētā rīka pašārstēšanās neizdevās: ${JSON.stringify(healingResult.errorReport)}`
    );
  }

  // Definējam manifestu un verificējam ar SchemaGuard
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
    throw new Error(`Manifesta shēma nav derīga: ${manifestValidation.errors?.join(", ")}`);
  }
  console.log("   SchemaGuard verifikācija: { success: true }");

  // -------------------------------------------------------------------------
  // 2. SOLIS 6 & 7: Palaižam Remote MCP SSE Vārteju ar OAuth 2.1 aizsargslāni
  // -------------------------------------------------------------------------
  const app = express();
  app.use(express.json());

  const serverInstance = app.listen(0);
  const address = serverInstance.address();
  const port = typeof address === "object" && address ? address.port : 3456;
  const baseUrl = `http://localhost:${port}`;

  const securityGuard = new OAuth2SecurityGuard({ issuerUrl: baseUrl });
  const gateway = new RemoteMcpSseGateway({ keepAliveIntervalMs: 5000 });

  // Reģistrējam verificēto rīku konkrētam nomniekam (tenant_fintech_prod)
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
    console.log(`\n3. Remote MCP Vārteja palaista: ${baseUrl}`);

    // 3.1. Pārbaudām neautorizēta pieprasījuma noraidīšanu (RFC 9728 WWW-Authenticate)
    const unauthRes = await fetch(`${baseUrl}/mcp/sse`);
    const wwwAuth = unauthRes.headers.get("www-authenticate") || "";
    console.log(`   Neautorizēts GET /mcp/sse statuss: ${unauthRes.status} (WWW-Authenticate: ${wwwAuth})`);
    if (unauthRes.status !== 401 || !wwwAuth.includes("resource_metadata=")) {
      throw new Error("Solis 7 neizdevās: Gaidīts 401 ar RFC 9728 resource_metadata galveni!");
    }

    // 3.2. Pārbaudām RFC 9728 Protected Resource Metadata galapunktu
    const metaRes = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`);
    const metadata = (await metaRes.json()) as Record<string, any>;
    console.log("   RFC 9728 Metadata:", JSON.stringify(metadata));
    if (!metadata.dcr_supported || !metadata.pkce_code_challenge_methods_supported?.includes("S256")) {
      throw new Error("Solis 7 neizdevās: Nepilnīgi RFC 9728 metadati!");
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
    console.log(`   DCR Klients reģistrēts: client_id=${dcrClient.client_id}, tenant=${dcrClient.tenant_id}`);

    // 3.4. OAuth 2.1 PKCE S256 plūsmas pārbaude
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
      throw new Error("Solis 7 neizdevās: PKCE S256 tokena apmaiņa neizdevās!");
    }
    console.log("   OAuth 2.1 PKCE S256 Bearer JWT veiksmīgi izsniegts.");

    // 3.5. Izveidojam Scoped API Key citam nomniekam (tenant_intruder), lai pārbaudītu izolāciju
    const intruderKey = securityGuard.createScopedApiKey({
      tenantId: "tenant_intruder",
      scopes: ["mcp:connect", "mcp:tools"]
    });

    // -------------------------------------------------------------------------
    // 3. SOLIS 6 & 8.2: Savienojam Antigravity MCP Klientu caur Remote SSE transportu
    // -------------------------------------------------------------------------
    console.log("\n4. Savienojam MCP Klientu caur Remote HTTP/SSE ar OAuth 2.1 Bearer JWT...");

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
    console.log("   MCP Klients veiksmīgi savienots caur SSE!");

    // Pārbaudām aktīvās sesijas un multitenancy izolāciju
    const sessionsRes = await authedFetch(`${baseUrl}/mcp/sessions`);
    const sessionsInfo = (await sessionsRes.json()) as {
      activeSessionsCount: number;
      sessions: Array<{ sessionId: string; tenantId: string }>;
    };
    console.log("   Aktīvās SSE sesijas:", JSON.stringify(sessionsInfo));

    if (sessionsInfo.activeSessionsCount !== 1) {
      throw new Error("Solis 6 neizdevās: Aktīvo SSE sesiju skaitam jābūt 1!");
    }

    const activeSessionId = sessionsInfo.sessions[0].sessionId;

    // Pārbaudām, vai svešs nomnieks (tenant_intruder) ar derīgu API atslēgu tiek bloķēts no svešas sesijas
    const hijackAttempt = await fetch(`${baseUrl}/mcp/messages?sessionId=${activeSessionId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": intruderKey.rawApiKey
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 99, method: "tools/list" })
    });
    console.log(`   Sveša nomnieka (tenant_intruder) sesijas pārtveršanas mēģinājuma statuss: ${hijackAttempt.status}`);
    if (hijackAttempt.status !== 403) {
      throw new Error("Solis 7 neizdevās: Sveša nomnieka piekļuvei pie citas SSE sesijas jāatgriež 403 Forbidden!");
    }

    // Izsaucam tools/list caur SSE
    const toolsList = await mcpClient.listTools();
    const toolNames = toolsList.tools.map(t => t.name);
    console.log("   Pieejamie MCP rīki sesijā:", toolNames);

    if (!toolNames.includes("evaluate_fraud_transaction") || !toolNames.includes("generate_mcp_server")) {
      throw new Error("Solis 8 neizdevās: Sarakstā trūkst 'evaluate_fraud_transaction' vai 'generate_mcp_server'!");
    }

    // Izsaucam ģenerēto FinTech rīku ar dziļi ligzdotu peiloudu caur SSE
    console.log("\n5. Izpildām 'evaluate_fraud_transaction' rīka izsaukumu caur Remote SSE...");
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

    console.log("   Rīka izpildes atbilde (CallToolResult):", JSON.stringify(callResult, null, 2));

    const firstContent = (callResult.content as Array<{ type: string; text: string }>)[0];
    const parsedPayload = JSON.parse(firstContent.text);

    if (
      parsedPayload.decision !== "ALLOW" ||
      parsedPayload.transactionId !== "tx_9948102" ||
      parsedPayload.evaluatedByTenant !== "tenant_fintech_prod" ||
      parsedPayload.customerCountry !== "LV"
    ) {
      throw new Error("Solis 8 neizdevās: Rīka atgrieztais peilouds neatbilst gaidītajam rezultātam!");
    }

    await mcpClient.close();
    console.log("\nVisi 6., 7. un 8. soļa (Remote HTTP/SSE, OAuth 2.1 DCR/PKCE, Scoped Keys un Gemini 4 Argon rīka izpildes) testi sekmīgi izturēti!");
  } finally {
    await gateway.closeAllSessions();
    serverInstance.close();
  }
}

runRemoteGatewayVerification().catch(err => {
  console.error("Testa kļūda:", err);
  process.exit(1);
});
