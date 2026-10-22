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
     Format Zod validation errors strictly using \`parseResult.error.message\` (avoid deprecated or untyped \`.errors\` property).
   - Python target: FastMCP (\`from mcp.server.fastmcp import FastMCP\`) with \`stateless_http=True\` or standard \`mcp.server\` with Pydantic (\`BaseModel\`) validation models.
3. Security, SSRF & Error Handling:
   - Never hardcode secrets, tokens, or bearer headers in generated code. Always extract them into environment variables (e.g., \`process.env.API_KEY\` or \`os.getenv("API_KEY")\`).
   - Implement strict SSRF prevention: Validate target protocol (HTTPS only, HTTP allowed strictly for localhost/127.0.0.1 in local dev). Block private subnets (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8, 0.0.0.0/8, 169.254.169.254, and IPv6 equivalents ::1, fc00::/7, fe80::/10).
   - Origin Lock: Never attach \`Authorization\` headers to untrusted or dynamic origins; attach secrets ONLY when destination matches the intended trusted API origin.
   - Redirect Safety: Disable automatic redirects (\`redirect: 'manual'\` in fetch, \`follow_redirects=False\` in httpx).
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

/**
 * Pārbauda, vai hostdators/IP adrese pieder privātajiem tīkliem, lokālajām adresēm,
 * mākoņpakalpojumu metadatiem vai aizliegtajiem diapazoniem (SSRF aizsardzība).
 */
export function isPrivateOrBlockedHost(hostname: string, allowLocalhost = false): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').trim().toLowerCase();

  if (host === 'localhost' || host === 'metadata.google.internal' || host === 'instance-data') {
    return !allowLocalhost;
  }

  // IPv6 pārbaudes
  if (host === '::1' || host === '::' || host === '0:0:0:0:0:0:0:1' || host === '0:0:0:0:0:0:0:0') {
    return !allowLocalhost;
  }
  // fc00::/7 (Unique Local Address) vai fe80::/10 (Link-Local)
  if (host.startsWith('fc') || host.startsWith('fd') || /^fe[89ab]/i.test(host)) {
    return true;
  }

  // IPv4-kartēts IPv6 (::ffff:127.0.0.1 vai ::ffff:a9fe:a9fe)
  if (host.startsWith('::ffff:')) {
    const rest = host.slice(7);
    if (rest.includes(':')) {
      const p = rest.split(':');
      if (p.length === 2) {
        const high = parseInt(p[0], 16);
        const low = parseInt(p[1], 16);
        if (!isNaN(high) && !isNaN(low)) {
          const a = (high >>> 8) & 255;
          const b = high & 255;
          if (a === 0) return true;
          if (a === 127) return !allowLocalhost;
          if (a === 10) return true;
          if (a === 172 && b >= 16 && b <= 31) return true;
          if (a === 192 && b === 168) return true;
          if (a === 169 && b === 254) return true;
          return false;
        }
      }
    }
  }

  // IPv4 vai IPv4-kartēts IPv6 (::ffff:127.0.0.1)
  let ipv4 = host;
  if (host.startsWith('::ffff:')) {
    ipv4 = host.slice(7);
  }

  // Pārbauda heksadecimālo DWORD (piemēram 0x7f000001 vai 0xa9fea9fe)
  if (/^0x[0-9a-f]+$/i.test(ipv4)) {
    const num = parseInt(ipv4, 16);
    if (!isNaN(num) && num >= 0 && num <= 4294967295) {
      const a = (num >>> 24) & 255;
      const b = (num >>> 16) & 255;
      if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
        return true;
      }
    }
  }

  // Pārbauda decimālo skaitļu notāciju (piemēram, 2130706433 vai 2852039166)
  if (/^\d+$/.test(ipv4)) {
    const num = parseInt(ipv4, 10);
    if (!isNaN(num) && num >= 0 && num <= 4294967295) {
      const a = (num >>> 24) & 255;
      const b = (num >>> 16) & 255;
      if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
        return true;
      }
    }
  }

  // Pārbauda punktēto notāciju (tostarp oktālos 0177.0.0.1 vai heksa 0x7f.0.0.1 oktetus)
  const parts = ipv4.split('.');
  if (parts.length === 4) {
    const parsedParts = parts.map((p) => {
      if (/^0x[0-9a-f]+$/i.test(p)) return parseInt(p, 16);
      if (/^0\d+$/.test(p)) return parseInt(p, 8);
      if (/^\d+$/.test(p)) return parseInt(p, 10);
      return NaN;
    });

    if (!parsedParts.some(isNaN) && parsedParts.every((n) => n >= 0 && n <= 255)) {
      const [a, b] = parsedParts;
      if (a === 0) return true;
      if (a === 127) return !allowLocalhost;
      if (a === 10) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      if (a === 169 && b === 254) return true;
      return false;
    }
  }

  return false;
}

/**
 * Validē URL protokolu, SSRF ierobežojumus un uzticamās izcelsmes (origin) atbilstību.
 */
export function validateSafeUrl(
  rawUrl: string,
  expectedOrigin?: string,
  options?: { allowLocalhost?: boolean }
): { valid: boolean; error?: string; url?: URL; isTrustedOrigin?: boolean } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch (err: any) {
    return { valid: false, error: `Nederīgs URL formāts: ${err?.message || rawUrl}` };
  }

  const allowLocal = options?.allowLocalhost ?? (process.env.ALLOW_LOCAL_TARGETS === 'true');
  const isLocalHost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';

  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocalHost && allowLocal)) {
    return {
      valid: false,
      error: `Protokols '${parsed.protocol}' ir aizliegts. Atļauts tikai HTTPS (vai HTTP lokālajai izstrādei uz localhost/127.0.0.1).`,
    };
  }

  if (isPrivateOrBlockedHost(parsed.hostname, allowLocal)) {
    return {
      valid: false,
      error: `Piekļuve privātajai vai bloķētajai adresei '${parsed.hostname}' ir liegta (SSRF aizsardzība).`,
    };
  }

  let isTrustedOrigin = false;
  if (expectedOrigin) {
    try {
      const exp = new URL(expectedOrigin);
      isTrustedOrigin = parsed.origin === exp.origin;
    } catch {
      isTrustedOrigin = false;
    }
  }

  return { valid: true, url: parsed, isTrustedOrigin };
}

// Deterministic generator fallback if API key is not supplied or model quota reached
export function generateDeterministicFallback(
  inputSnippet: string,
  language: McpLanguage = 'typescript',
  serverName = 'mcp-server',
  transport: 'stdio' | 'sse' = 'stdio'
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
  let targetOrigin = 'https://api.example.com';
  try {
    targetOrigin = new URL(targetUrl).origin;
  } catch {
    targetOrigin = 'https://api.example.com';
  }

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

const ALLOWED_ORIGIN = "${targetOrigin}";

// SSRF & Security Validation Functions
function isPrivateOrBlockedHost(hostname: string, allowLocalhost = false): boolean {
  const host = hostname.replace(/^\\[|\\]$/g, '').trim().toLowerCase();
  if (host === 'localhost' || host === 'metadata.google.internal' || host === 'instance-data') {
    return !allowLocalhost;
  }
  if (host === '::1' || host === '::' || host === '0:0:0:0:0:0:0:1' || host === '0:0:0:0:0:0:0:0') {
    return !allowLocalhost;
  }
  if (host.startsWith('fc') || host.startsWith('fd') || /^fe[89ab]/i.test(host)) {
    return true;
  }
  let ipv4 = host;
  if (host.startsWith('::ffff:')) {
    ipv4 = host.slice(7);
  }
  const ipv4Match = ipv4.match(/^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$/);
  if (ipv4Match) {
    const a = parseInt(ipv4Match[1], 10);
    const b = parseInt(ipv4Match[2], 10);
    const c = parseInt(ipv4Match[3], 10);
    const d = parseInt(ipv4Match[4], 10);
    if (a > 255 || b > 255 || c > 255 || d > 255) return true;
    if (a === 0) return true;
    if (a === 127) return !allowLocalhost;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }
  if (/^\\d+$/.test(host)) {
    const num = parseInt(host, 10);
    if (!isNaN(num) && num >= 0 && num <= 4294967295) {
      const a = (num >>> 24) & 255;
      const b = (num >>> 16) & 255;
      if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
        return true;
      }
    }
  }
  return false;
}

function validateSafeUrl(rawUrl: string, expectedOrigin?: string): { valid: boolean; error?: string; url?: URL; isTrustedOrigin?: boolean } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch (err: any) {
    return { valid: false, error: \`Invalid URL: \${err?.message || rawUrl}\` };
  }
  const isLocalDev = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocalDev)) {
    return { valid: false, error: \`Protocol '\${parsed.protocol}' is prohibited. Only HTTPS is allowed (HTTP allowed strictly for localhost development).\` };
  }
  if (isPrivateOrBlockedHost(parsed.hostname, isLocalDev)) {
    return { valid: false, error: \`Access to private or blocked host '\${parsed.hostname}' is prohibited (SSRF prevention).\` };
  }
  let isTrustedOrigin = false;
  if (expectedOrigin) {
    try {
      const exp = new URL(expectedOrigin);
      isTrustedOrigin = parsed.origin === exp.origin;
    } catch {
      isTrustedOrigin = false;
    }
  }
  return { valid: true, url: parsed, isTrustedOrigin };
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

      // Validate URL against SSRF and private networks
      const urlCheck = validateSafeUrl(input.endpoint, ALLOWED_ORIGIN);
      if (!urlCheck.valid || !urlCheck.url) {
        return {
          content: [
            {
              type: "text",
              text: \`SSRF Security Error: \${urlCheck.error}\`,
            },
          ],
          isError: true,
        };
      }

      const url = urlCheck.url;

      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "User-Agent": "${cleanServerName}/1.0.0",
        };

        // Security: Attach Authorization header ONLY if the target matches the trusted origin
        if (process.env.${envVarName} && urlCheck.isTrustedOrigin) {
          headers["Authorization"] = \`Bearer \${process.env.${envVarName}}\`;
        }

        if (input.query) {
          Object.entries(input.query).forEach(([k, v]) => {
            url.searchParams.append(k, String(v));
          });
        }

        const response = await fetch(url.toString(), {
          method: "${method}",
          headers,
          body: "${method}" !== "GET" && input.payload ? JSON.stringify(input.payload) : undefined,
          redirect: "manual",
        });

        // Block automatic redirects to prevent SSRF bypass
        if (response.status >= 300 && response.status < 400) {
          const redirectLoc = response.headers.get("location") || "unknown";
          return {
            content: [
              {
                type: "text",
                text: \`Security Block: HTTP \${response.status} redirect to '\${redirectLoc}' blocked (automatic redirect following disabled).\`,
              },
            ],
            isError: true,
          };
        }

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
import ipaddress
from urllib.parse import urlparse
import httpx
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
from mcp.server.fastmcp import FastMCP

# Initialize FastMCP Server with stateless_http=True for Cursor / Claude Code compatibility
mcp = FastMCP("${cleanServerName}", stateless_http=True)

API_KEY = os.getenv("${envVarName}")
if not API_KEY:
    print("Warning: ${envVarName} is not set in environment variables.", file=sys.stderr)

ALLOWED_ORIGIN = "${targetOrigin}"

def is_private_or_blocked_host(host: str, allow_localhost: bool = False) -> bool:
    host_clean = host.strip("[]").lower()
    if host_clean in ("localhost", "metadata.google.internal", "instance-data"):
        return not allow_localhost
    if host_clean in ("::1", "::", "0:0:0:0:0:0:0:1", "0:0:0:0:0:0:0:0"):
        return not allow_localhost
    if host_clean.startswith("fc") or host_clean.startswith("fd") or host_clean.startswith("fe8") or host_clean.startswith("fe9") or host_clean.startswith("fea") or host_clean.startswith("feb"):
        return True
    try:
        ip = ipaddress.ip_address(host_clean)
        if ip.is_loopback:
            return not allow_localhost
        if ip.is_private or ip.is_link_local or ip.is_unspecified or ip.is_reserved:
            return True
        return False
    except ValueError:
        return False

def validate_safe_url(raw_url: str, expected_origin: str) -> tuple[bool, str, bool]:
    try:
        parsed = urlparse(raw_url)
    except Exception as e:
        return False, f"Invalid URL format: {str(e)}", False
    
    is_local_dev = parsed.hostname in ("localhost", "127.0.0.1")
    if parsed.scheme != "https" and not (parsed.scheme == "http" and is_local_dev):
        return False, f"Protocol '{parsed.scheme}' is prohibited. Only HTTPS is allowed (HTTP allowed strictly for localhost development).", False
    
    if not parsed.hostname or is_private_or_blocked_host(parsed.hostname, is_local_dev):
        return False, f"Access to private or blocked host '{parsed.hostname}' is prohibited (SSRF prevention).", False
        
    actual_origin = f"{parsed.scheme}://{parsed.netloc}"
    is_trusted = (actual_origin == expected_origin)
    return True, "", is_trusted

class ApiPayload(BaseModel):
    endpoint: str = Field(default="${targetUrl}", description="Target API endpoint URL")
    payload: Optional[Dict[str, Any]] = Field(default=None, description="Request JSON payload")
    query: Optional[Dict[str, str]] = Field(default=None, description="Query string parameters")

@mcp.tool()
async def execute_request(endpoint: str = "${targetUrl}", payload: Optional[Dict[str, Any]] = None, query: Optional[Dict[str, str]] = None) -> str:
    """Execute validated HTTP request to ${targetUrl} with strict SSRF protection."""
    valid, err_msg, is_trusted = validate_safe_url(endpoint, ALLOWED_ORIGIN)
    if not valid:
        return f"SSRF Security Error: {err_msg}"

    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "${cleanServerName}/1.0.0"
    }
    
    # Attach API key ONLY if destination matches trusted origin
    if API_KEY and is_trusted:
        headers["Authorization"] = f"Bearer {API_KEY}"
        
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=False) as client:
        try:
            response = await client.request(
                method="${method}",
                url=endpoint,
                headers=headers,
                json=payload if "${method}" != "GET" else None,
                params=query
            )
            if response.is_redirect:
                return f"Security Block: HTTP {response.status_code} redirect blocked (automatic redirect following disabled)."
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
    const fallback = generateDeterministicFallback(inputSnippet, language, serverName, transport);
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
3. Implement strict SSRF prevention: lock API keys to target origin and block private/link-local/metadata IPs.
4. Wrap network calls with proper error handling and response formatting with isError: true on failure.
5. Provide complete, executable code without any placeholders or TODOs.
6. Provide realistic package.json or requirements.txt with pinned/standard versions.
7. Provide exact mcp_config.json for Claude Desktop / Cursor.
8. Return raw JSON matching the required schema.`;

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
    const fallback = generateDeterministicFallback(inputSnippet, language, serverName, transport);
    return {
      ...fallback,
      generatedBy: 'deterministic-engine (AI fallback)',
      notice: lastError ? `AI generation encountered an issue (${lastError.message}), used deterministic engine.` : undefined,
    };
  } catch (error: any) {
    logger.error('[MCP Generator Error]', error);
    const fallback = generateDeterministicFallback(inputSnippet, language, serverName, transport);
    return {
      ...fallback,
      generatedBy: 'deterministic-engine (error fallback)',
      notice: error.message,
    };
  }
}
