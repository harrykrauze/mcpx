#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import dotenv from 'dotenv';
import { generateMcpServer } from './core/generator.js';
import { McpLanguage } from './types/mcp.js';

dotenv.config();

// Zod validation schema for tool input
const GenerateMcpServerInputSchema = z.object({
  spec: z
    .string()
    .min(1, 'API specification or snippet is required')
    .describe('The raw API specification, OpenAPI YAML/JSON, cURL snippet, or JSON structure.'),
  target_language: z
    .enum(['typescript', 'python'])
    .optional()
    .default('typescript')
    .describe('The target framework (@modelcontextprotocol/sdk for TS, FastMCP for Python).'),
  server_name: z
    .string()
    .optional()
    .default('generated-mcp-server')
    .describe('The human-readable or slug name for the server.'),
});

type GenerateMcpServerInput = z.infer<typeof GenerateMcpServerInputSchema>;

// Tool metadata conforming to Model Context Protocol specification
const GENERATE_TOOL = {
  name: 'generate_mcp_server',
  description:
    'Generates a fully functional MCP server (TypeScript or Python) from an OpenAPI spec, cURL command, or JSON API schema.',
  inputSchema: {
    type: 'object',
    properties: {
      spec: {
        type: 'string',
        description: 'The raw API specification, OpenAPI YAML/JSON, cURL snippet, or JSON structure.',
      },
      target_language: {
        type: 'string',
        enum: ['typescript', 'python'],
        default: 'typescript',
        description: 'The target framework (@modelcontextprotocol/sdk for TS, FastMCP for Python).',
      },
      server_name: {
        type: 'string',
        default: 'generated-mcp-server',
        description: 'The human-readable or slug name for the server.',
      },
    },
    required: ['spec'],
  },
};

// Initialize the stdio MCP server instance
const server = new Server(
  {
    name: 'mcp-server-generator',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Route all debug / log outputs strictly to stderr to prevent JSON-RPC stream corruption
server.onerror = (error) => console.error('[mcp-server-generator ERROR]', error);

process.on('SIGINT', async () => {
  await server.close();
  process.exit(0);
});

// Register tool listing handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [GENERATE_TOOL],
  };
});

// Register tool execution handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'generate_mcp_server') {
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
  }

  const parseResult = GenerateMcpServerInputSchema.safeParse(request.params.arguments);
  if (!parseResult.success) {
    return {
      content: [
        {
          type: 'text',
          text: `Validation error: ${parseResult.error.message}`,
        },
      ],
      isError: true,
    };
  }

  const input: GenerateMcpServerInput = parseResult.data;

  try {
    // Generate server using core generator (logs strictly redirected to stderr)
    const result = await generateMcpServer({
      inputSnippet: input.spec,
      language: input.target_language as McpLanguage,
      serverName: input.server_name,
      transport: 'stdio',
      logger: {
        log: (...args: any[]) => console.error('[MCP Generator]', ...args),
        warn: (...args: any[]) => console.error('[MCP Generator WARN]', ...args),
        error: (...args: any[]) => console.error('[MCP Generator ERROR]', ...args),
      },
    });

    // Format rich text response for AI agent
    const mainFile = result.files.find((f) => f.path === 'index.ts' || f.path === 'server.py');
    const mcpConfigFile = result.files.find((f) => f.path === 'mcp_config.json');
    const envExampleFile = result.files.find((f) => f.path === '.env.example');

    let responseMarkdown = `## MCP Server Generated: \`${result.serverName}\`\n\n`;
    responseMarkdown += `- **Target Language:** ${result.language === 'typescript' ? 'TypeScript (@modelcontextprotocol/sdk)' : 'Python (FastMCP)'}\n`;
    if (result.generatedBy) {
      responseMarkdown += `- **Generator Engine:** ${result.generatedBy}\n`;
    }
    if (result.summary?.toolsGenerated?.length) {
      responseMarkdown += `- **Tools Provided:** ${result.summary.toolsGenerated.map((t) => `\`${t}\``).join(', ')}\n`;
    }
    if (result.summary?.requiredEnvVars?.length) {
      responseMarkdown += `- **Required Environment Variables:** ${result.summary.requiredEnvVars.map((e) => `\`${e}\``).join(', ')}\n`;
    }
    if (result.notice) {
      responseMarkdown += `\n> **Notice:** ${result.notice}\n`;
    }

    // Config block snippet
    if (mcpConfigFile) {
      responseMarkdown += `\n### Client Registration Snippet (\`mcpServers\`)\n\`\`\`json\n${mcpConfigFile.content}\n\`\`\`\n`;
    }

    // Main executable file
    if (mainFile) {
      const lang = result.language === 'typescript' ? 'typescript' : 'python';
      responseMarkdown += `\n### Primary Implementation (\`${mainFile.path}\`)\n\`\`\`${lang}\n${mainFile.content}\n\`\`\`\n`;
    }

    // Other files
    const otherFiles = result.files.filter(
      (f) => f.path !== mainFile?.path && f.path !== 'mcp_config.json'
    );
    if (otherFiles.length > 0) {
      responseMarkdown += `\n### Supporting Files\n`;
      for (const file of otherFiles) {
        let codeLang = 'text';
        if (file.path.endsWith('.json')) codeLang = 'json';
        else if (file.path.endsWith('.md')) codeLang = 'markdown';
        else if (file.path.endsWith('.ts')) codeLang = 'typescript';
        else if (file.path.endsWith('.py')) codeLang = 'python';

        responseMarkdown += `\n#### \`${file.path}\`\n\`\`\`${codeLang}\n${file.content}\n\`\`\`\n`;
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: responseMarkdown,
        },
      ],
    };
  } catch (err: any) {
    console.error('[mcp-server-generator ERROR]', err);
    return {
      content: [
        {
          type: 'text',
          text: `Generation failed: ${err?.message || 'Unknown error during MCP server generation.'}`,
        },
      ],
      isError: true,
    };
  }
});

// Start the server over standard input/output (stdio)
async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[mcp-server-generator] Stdio MCP Server running and ready for tool calls');
}

run().catch((error) => {
  console.error('[mcp-server-generator FATAL]', error);
  process.exit(1);
});
