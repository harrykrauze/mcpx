import { GoogleGenAI } from '@google/genai';
import { McpLanguage, McpServerResponse } from '../types/mcp';

export interface GenerateOptions {
  inputSnippet: string;
  language?: McpLanguage;
  serverName?: string;
  transport?: 'stdio' | 'sse';
  logger?: {
    log: (...args: any[]) => void;
    warn: (...args: any[]) => void;
    error: (...args: any[]) => void;
  };
}

// System instructions from Blueprint
export const SYSTEM_INSTRUCTIONS = `You are an elite Systems Architect and Model Context Protocol (MCP) engineer specializing in deterministic, TypeSafe API bridging.
Your sole responsibility is to convert user-supplied API snippets (cURL commands, OpenAPI 3.0/3.1 specs, Swagger YAML/JSON, or raw JSON schemas) into a production-ready, fully executable Model Context Protocol (MCP) server.

### Technical & Architectural Requirements:
1. Target Protocol: Official Model Context Protocol specification (@modelcontextprotocol/sdk for TypeScript or mcp package for Python).
2. Deterministic Type Safety:
   - TypeScript target: Strict Zod schemas (\`z.object({...})\`) for all tool input parameters and responses.
     Use standard modern @modelcontextprotocol/sdk patterns (e.g. Server, StdioServerTransport, ListToolsRequestSchema, CallToolRequestSchema).
   - Python target: FastMCP (\`from mcp.server.fastmcp import FastMCP\`) or standard \`mcp.server\` with Pydantic (\`BaseModel\`) validation models.
3. Security & Error Handling:
   - Never hardcode secrets, tokens, or bearer headers in generated code. Always extract them into environment variables (e.g., \`process.env.API_KEY\` or \`os.getenv("API_KEY")\`).
   - Implement comprehensive try-catch wrappers around network calls and return structured errors to the agent with \`isError: true\`.
   - Prevent command and prompt injection vectors by strictly validating input schema boundaries.
4. Output Integrity:
   - Return raw, syntactically flawless code blocks ready for execution without placeholders (no \`// TODO: implement here\`).
   - Include complete package.json (with @modelcontextprotocol/sdk, zod, etc.) or requirements.txt (with mcp, httpx, pydantic, etc.).
   - Include exact mcp_config.json suitable for Claude Desktop or Cursor or Antigravity with args and env variables.
   - Include clear README.md with setup and usage instructions.
   - Include .env.example with placeholders for all required environment variables.

### Output Format Specification:
Return ONLY a valid JSON object matching this schema without any preamble, markdown code ticks, or post-generation explanations:
{
  "serverName": "string",
  "language": "typescript" | "python",
  "files": [
    {
      "path": "index.ts" | "server.py",
      "content": "string (complete executable MCP server implementation)"
    },
    {
      "path": "package.json" | "requirements.txt",
      "content": "string (runtime and dev dependencies with exact semantic versions)"
    },
    {
      "path": "mcp_config.json",
      "content": "string (client snippet for Claude Desktop, Cursor, or Antigravity)"
    },
    {
      "path": "README.md",
      "content": "string (installation and configuration documentation)"
    },
    {
      "path": ".env.example",
      "content": "string (environment variables template)"
    }
  ],
  "summary": {
    "toolsGenerated": ["tool_name_1", "tool_name_2"],
    "requiredEnvVars": ["ENV_VAR_NAME"],
    "description": "string summarizing the extracted tools and their purpose"
  }
}`;

// Helper to initialize Gemini SDK
export function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Deterministic generator fallback if API key is not supplied or model quota reached
export function generateDeterministicFallback(
  inputSnippet: string,
  language: McpLanguage = 'typescript',
  serverName = 'mcp-server'
): McpServerResponse {
  const isPython = language === 'python';
  const cleanServerName =
    serverName.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+|-+$/g, '') || 'api-mcp-server';

  // Extract URLs, methods, headers from cURL or OpenAPI
  const isPost = /(-X\s*POST|post:|"method":\s*"POST")/i.test(inputSnippet);
  const method = isPost ? 'POST' : 'GET';

  // Try to find url
  const urlMatch = inputSnippet.match(/https?:\/\/[^\s"']+/);
  const targetUrl = urlMatch ? urlMatch[0] : 'https://api.example.com/v1/action';

  // Try to extract auth header name
  const hasBearer = /Bearer\s+([^\s"']+)/i.test(inputSnippet) || /Authorization/i.test(inputSnippet);
  const envVarName = hasBearer ? `${cleanServerName.toUpperCase().replace(/-/g, '_')}_API_KEY` : 'API_KEY';

  if (!isPython) {
    const tsCode = `#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// Environment validation
const API_KEY = process.env.${envVarName};
if (!API_KEY) {
  console.error("Warning: ${envVarName} is not set in environment variables.");
}

// Tool Input Schema
const ExecuteApiSchema = z.object({
  endpoint: z.string().default("${targetUrl}").describe("API endpoint to call"),
  payload: z.record(z.any()).optional().describe("Request payload data"),
  query: z.record(z.string()).optional().describe("Query parameters"),
});

type ExecuteApiInput = z.infer<typeof ExecuteApiSchema>;

class ${cleanServerName.split('-').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('')}Server {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: "${cleanServerName}",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    
    // Error handling
    this.server.onerror = (error) => console.error("[MCP Server Error]", error);
    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "execute_request",
          description: "Execute request to ${targetUrl} with strict validation and error handling.",
          inputSchema: {
            type: "object",
            properties: {
              endpoint: {
                type: "string",
                description: "Target URL endpoint",
                default: "${targetUrl}",
              },
              payload: {
                type: "object",
                description: "Request body data",
              },
              query: {
                type: "object",
                description: "Query parameters key-value mapping",
              },
            },
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name !== "execute_request") {
        throw new McpError(
          ErrorCode.MethodNotFound,
          \`Unknown tool: \${request.params.name}\`
        );
      }

      const parseResult = ExecuteApiSchema.safeParse(request.params.arguments);
      if (!parseResult.success) {
        return {
          content: [
            {
              type: "text",
              text: \`Validation error: \${parseResult.error.message}\`,
            },
          ],
          isError: true,
        };
      }

      const input: ExecuteApiInput = parseResult.data;

      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "User-Agent": "${cleanServerName}/1.0.0",
        };

        if (process.env.${envVarName}) {
          headers["Authorization"] = \`Bearer \${process.env.${envVarName}}\`;
        }

        const url = new URL(input.endpoint);
        if (input.query) {
          Object.entries(input.query).forEach(([k, v]) => {
            url.searchParams.append(k, String(v));
          });
        }

        const response = await fetch(url.toString(), {
          method: "${method}",
          headers,
          body: "${method}" !== "GET" && input.payload ? JSON.stringify(input.payload) : undefined,
        });

        const contentType = response.headers.get("content-type") || "";
        const data = contentType.includes("application/json")
          ? await response.json()
          : await response.text();

        if (!response.ok) {
          return {
            content: [
              {
                type: "text",
                text: \`API HTTP \${response.status} error: \${typeof data === "string" ? data : JSON.stringify(data, null, 2)}\`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text",
              text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: \`Execution failed: \${error.message}\`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("${cleanServerName} MCP server running on stdio");
  }
}

const server = new ${cleanServerName.split('-').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('')}Server();
server.run().catch(console.error);
`;

    const packageJson = JSON.stringify(
      {
        name: cleanServerName,
        version: "1.0.0",
        description: `Production Model Context Protocol (MCP) server for ${cleanServerName}`,
        type: "module",
        bin: {
          [cleanServerName]: "./build/index.js",
        },
        scripts: {
          build: "tsc",
          start: "node build/index.js",
          dev: "tsx index.ts",
        },
        dependencies: {
          "@modelcontextprotocol/sdk": "^1.26.0",
          zod: "^3.24.2",
          dotenv: "^16.4.7",
        },
        devDependencies: {
          "@types/node": "^20.17.0",
          typescript: "^5.7.0",
          tsx: "^4.19.2",
        },
      },
      null,
      2
    );

    const mcpConfig = JSON.stringify(
      {
        mcpServers: {
          [cleanServerName]: {
            command: "node",
            args: [`/absolute/path/to/${cleanServerName}/build/index.js`],
            env: {
              [envVarName]: "your_api_key_here",
            },
          },
        },
      },
      null,
      2
    );

    const readme = `# ${cleanServerName} MCP Server

Official Model Context Protocol (MCP) server for interacting with \`${targetUrl}\`.

## Quick Start
1. Install dependencies:
   \`\`\`bash
   npm install
   \`\`\`
2. Build TypeScript:
   \`\`\`bash
   npm run build
   \`\`\`
3. Configure in Claude Desktop / Cursor using the snippet in \`mcp_config.json\`.
4. Ensure \`${envVarName}\` is set in your environment.
`;

    const envExample = `${envVarName}="your_secret_token_here"\n`;

    return {
      serverName: cleanServerName,
      language: "typescript",
      files: [
        { path: "index.ts", content: tsCode },
        { path: "package.json", content: packageJson },
        { path: "mcp_config.json", content: mcpConfig },
        { path: "README.md", content: readme },
        { path: ".env.example", content: envExample },
      ],
      summary: {
        toolsGenerated: ["execute_request"],
        requiredEnvVars: [envVarName],
        description: `Deterministic TypeScript MCP server for ${cleanServerName} targeting ${targetUrl}.`,
      },
    };
  } else {
    // Python FastMCP Fallback
    const pyCode = `#!/usr/bin/env python3
import os
import sys
import httpx
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
from mcp.server.fastmcp import FastMCP

# Initialize FastMCP Server
mcp = FastMCP("${cleanServerName}")

API_KEY = os.getenv("${envVarName}")
if not API_KEY:
    print("Warning: ${envVarName} is not set in environment variables.", file=sys.stderr)

class ApiPayload(BaseModel):
    endpoint: str = Field(default="${targetUrl}", description="Target API endpoint URL")
    payload: Optional[Dict[str, Any]] = Field(default=None, description="Request JSON payload")
    query: Optional[Dict[str, str]] = Field(default=None, description="Query string parameters")

@mcp.tool()
async def execute_request(endpoint: str = "${targetUrl}", payload: Optional[Dict[str, Any]] = None, query: Optional[Dict[str, str]] = None) -> str:
    """Execute validated HTTP request to ${targetUrl}."""
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "${cleanServerName}/1.0.0"
    }
    
    if API_KEY:
        headers["Authorization"] = f"Bearer {API_KEY}"
        
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.request(
                method="${method}",
                url=endpoint,
                headers=headers,
                json=payload if "${method}" != "GET" else None,
                params=query
            )
            response.raise_for_status()
            return response.text
        except httpx.HTTPStatusError as e:
            return f"API error HTTP {e.response.status_code}: {e.response.text}"
        except Exception as e:
            return f"Network error: {str(e)}"

if __name__ == "__main__":
    mcp.run(transport="stdio")
`;

    const requirements = `mcp>=1.3.0
httpx>=0.28.1
pydantic>=2.10.6
python-dotenv>=1.0.1
`;

    const mcpConfig = JSON.stringify(
      {
        mcpServers: {
          [cleanServerName]: {
            command: "python",
            args: [`/absolute/path/to/${cleanServerName}/server.py`],
            env: {
              [envVarName]: "your_api_key_here",
            },
          },
        },
      },
      null,
      2
    );

    const readme = `# ${cleanServerName} Python FastMCP Server

Official Model Context Protocol (MCP) server written in Python using FastMCP.

## Setup
1. Create virtual environment:
   \`\`\`bash
   python -m venv .venv
   source .venv/bin/activate  # Or on Windows: .venv\\Scripts\\activate
   \`\`\`
2. Install requirements:
   \`\`\`bash
   pip install -r requirements.txt
   \`\`\`
3. Set environment variable:
   \`\`\`bash
   export ${envVarName}="your_token"
   \`\`\`
4. Run server:
   \`\`\`bash
   python server.py
   \`\`\`
`;

    const envExample = `${envVarName}="your_secret_token_here"\n`;

    return {
      serverName: cleanServerName,
      language: "python",
      files: [
        { path: "server.py", content: pyCode },
        { path: "requirements.txt", content: requirements },
        { path: "mcp_config.json", content: mcpConfig },
        { path: "README.md", content: readme },
        { path: ".env.example", content: envExample },
      ],
      summary: {
        toolsGenerated: ["execute_request"],
        requiredEnvVars: [envVarName],
        description: `Generated production-ready Python FastMCP server for ${cleanServerName}.`,
      },
    };
  }
}

// Main generation function used across HTTP and stdio MCP interfaces
export async function generateMcpServer(options: GenerateOptions): Promise<McpServerResponse> {
  const {
    inputSnippet,
    language = 'typescript',
    serverName,
    transport = 'stdio',
    logger = console,
  } = options;

  if (!inputSnippet || typeof inputSnippet !== 'string' || !inputSnippet.trim()) {
    throw new Error('Input snippet is required (cURL command, OpenAPI YAML/JSON, or API schema).');
  }

  const ai = getGeminiClient();

  // If Gemini client is not configured, return deterministic fallback directly
  if (!ai) {
    logger.log('[MCP Generator] GEMINI_API_KEY not configured, using deterministic engine fallback');
    const fallback = generateDeterministicFallback(inputSnippet, language, serverName);
    return { ...fallback, generatedBy: 'deterministic-engine' };
  }

  try {
    const userPrompt = `Convert the following API specification/command into a production-ready ${language.toUpperCase()} MCP server:

User Specified Server Name: ${serverName || 'auto-infer from endpoint'}
Transport: ${transport}
Target Language: ${language}

Input API Snippet:
\`\`\`
${inputSnippet.trim()}
\`\`\`

Remember to:
1. Extract any tokens/auth into environment variables (never hardcode values).
2. Generate strict ${language === 'typescript' ? 'Zod schemas (z.object)' : 'Pydantic BaseModel / typed FastMCP arguments'}.
3. Wrap network calls with proper error handling and response formatting with isError: true on failure.
4. Provide complete, executable code without any placeholders or TODOs.
5. Provide realistic package.json or requirements.txt with pinned/standard versions.
6. Provide exact mcp_config.json for Claude Desktop / Cursor.
7. Return raw JSON matching the required schema.`;

    const candidateModels = ['gemini-3.8-flash', 'gemini-2.5-flash'];
    let lastError: any = null;
    let jsonResult: any = null;

    for (const model of candidateModels) {
      try {
        logger.log(`[MCP Generator] Calling Gemini model: ${model}`);
        const response = await ai.models.generateContent({
          model,
          contents: userPrompt,
          config: {
            systemInstruction: SYSTEM_INSTRUCTIONS,
            temperature: 0.1,
            topP: 0.8,
            responseMimeType: 'application/json',
          },
        });

        const rawText = response.text?.trim() || '';
        if (rawText) {
          const cleanedText = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
          jsonResult = JSON.parse(cleanedText);
          if (jsonResult && jsonResult.files && Array.isArray(jsonResult.files)) {
            jsonResult.generatedBy = `gemini-ai (${model})`;
            break;
          }
        }
      } catch (err: any) {
        logger.warn(`[MCP Generator] Model ${model} failed:`, err?.message || err);
        lastError = err;
      }
    }

    if (jsonResult) {
      return jsonResult;
    }

    logger.warn('[MCP Generator] Falling back to deterministic engine due to Gemini failure:', lastError?.message);
    const fallback = generateDeterministicFallback(inputSnippet, language, serverName);
    return {
      ...fallback,
      generatedBy: 'deterministic-engine (AI fallback)',
      notice: lastError ? `AI generation encountered an issue (${lastError.message}), used deterministic engine.` : undefined,
    };
  } catch (error: any) {
    logger.error('[MCP Generator Error]', error);
    const fallback = generateDeterministicFallback(inputSnippet, language, serverName);
    return {
      ...fallback,
      generatedBy: 'deterministic-engine (error fallback)',
      notice: error.message,
    };
  }
}
