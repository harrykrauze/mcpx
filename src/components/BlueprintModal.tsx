import React, { useState } from 'react';
import { X, Copy, Check, Sparkles, Sliders, CheckSquare, Layers } from 'lucide-react';
import { copyToClipboard } from '../utils/zipExport';

interface BlueprintModalProps {
  onClose: () => void;
}

export const BlueprintModal: React.FC<BlueprintModalProps> = ({ onClose }) => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const SYSTEM_INSTRUCTIONS_TEXT = `You are an elite Systems Architect and Model Context Protocol (MCP) engineer specializing in deterministic, TypeSafe API bridging.
Your sole responsibility is to convert user-supplied API snippets (cURL commands, OpenAPI 3.0/3.1 specs, Swagger YAML/JSON, or raw JSON schemas) into a production-ready, fully executable Model Context Protocol (MCP) server.

### Technical & Architectural Requirements:
1. Target Protocol: Official Model Context Protocol specification (@modelcontextprotocol/sdk for TypeScript or mcp package for Python).
2. Deterministic Type Safety:
   - TypeScript target: Strict Zod schemas (\`z.object({...})\`) for all tool input parameters and responses.
   - Python target: Pydantic (\`BaseModel\`) validation models.
3. Security & Error Handling:
   - Never hardcode secrets, tokens, or bearer headers in generated code. Always extract them into environment variables (e.g., \`process.env.API_KEY\` or \`os.getenv("API_KEY")\`).
   - Implement comprehensive try-catch wrappers around network calls and return structured errors to the agent with \`isError: true\`.
   - Prevent command and prompt injection vectors by strictly validating input schema boundaries.
4. Output Integrity:
   - Return raw, syntactically flawless code blocks ready for execution without placeholders (no \`// TODO: implement here\`).

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
    }
  ],
  "summary": {
    "toolsGenerated": ["tool_name_1", "tool_name_2"],
    "requiredEnvVars": ["ENV_VAR_NAME"]
  }
}`;

  const JSON_SCHEMA_OUTPUT = `{
  "type": "object",
  "properties": {
    "serverName": { "type": "string" },
    "language": { "type": "string", "enum": ["typescript", "python"] },
    "files": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "path": { "type": "string" },
          "content": { "type": "string" }
        },
        "required": ["path", "content"]
      }
    },
    "summary": {
      "type": "object",
      "properties": {
        "toolsGenerated": { "type": "array", "items": { "type": "string" } },
        "requiredEnvVars": { "type": "array", "items": { "type": "string" } }
      },
      "required": ["toolsGenerated", "requiredEnvVars"]
    }
  },
  "required": ["serverName", "language", "files", "summary"]
}`;

  const handleCopy = async (key: string, content: string) => {
    await copyToClipboard(content);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">
                Google AI Studio Blueprint Specification
              </h2>
              <p className="text-xs text-zinc-400">
                Original prompt architecture, model hyperparameters, and output contract
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs text-zinc-300">
          {/* Section 1: System Instructions */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-[11px] font-bold">1</span>
                System Instructions (Google AI Studio Prompt)
              </span>
              <button
                onClick={() => handleCopy('sys', SYSTEM_INSTRUCTIONS_TEXT)}
                className="text-xs px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 flex items-center gap-1.5 transition"
              >
                {copiedKey === 'sys' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>{copiedKey === 'sys' ? 'Copied' : 'Copy System Instructions'}</span>
              </button>
            </div>
            <pre className="p-3.5 bg-zinc-900 border border-zinc-800 rounded-xl font-mono text-[11px] text-zinc-300 overflow-x-auto leading-relaxed max-h-56">
              {SYSTEM_INSTRUCTIONS_TEXT}
            </pre>
          </div>

          {/* Section 2: Model Configuration */}
          <div className="space-y-2">
            <span className="text-xs font-semibold text-white flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center text-[11px] font-bold">2</span>
              Model Configuration (Google AI Studio Sidebar)
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-xl">
                <div className="text-[11px] text-zinc-400 mb-0.5">Model</div>
                <div className="font-mono font-semibold text-white text-xs">gemini-2.5-flash</div>
                <div className="text-[10px] text-zinc-400">or gemini-3.8-flash</div>
              </div>
              <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-xl">
                <div className="text-[11px] text-zinc-400 mb-0.5">Temperature</div>
                <div className="font-mono font-semibold text-indigo-400 text-xs">0.1</div>
                <div className="text-[10px] text-zinc-400">Strict determinism</div>
              </div>
              <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-xl">
                <div className="text-[11px] text-zinc-400 mb-0.5">Top-P</div>
                <div className="font-mono font-semibold text-purple-400 text-xs">0.8</div>
                <div className="text-[10px] text-zinc-400">Focused nucleus</div>
              </div>
              <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-xl">
                <div className="text-[11px] text-zinc-400 mb-0.5">Response MIME Type</div>
                <div className="font-mono font-semibold text-emerald-400 text-xs">application/json</div>
                <div className="text-[10px] text-zinc-400">Structured outputs</div>
              </div>
            </div>
          </div>

          {/* Section 3: Output JSON Schema */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[11px] font-bold">3</span>
                Structured Outputs JSON Schema
              </span>
              <button
                onClick={() => handleCopy('schema', JSON_SCHEMA_OUTPUT)}
                className="text-xs px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 flex items-center gap-1.5 transition"
              >
                {copiedKey === 'schema' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>{copiedKey === 'schema' ? 'Copied' : 'Copy Schema'}</span>
              </button>
            </div>
            <pre className="p-3 bg-zinc-900 border border-zinc-800 rounded-xl font-mono text-[11px] text-emerald-300 overflow-x-auto max-h-40">
              {JSON_SCHEMA_OUTPUT}
            </pre>
          </div>

          {/* Section 4: Production Checklist */}
          <div className="space-y-2">
            <span className="text-xs font-semibold text-white flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-[11px] font-bold">4</span>
              Production Deployment Checklist
            </span>
            <div className="p-3.5 bg-zinc-900 border border-zinc-800 rounded-xl space-y-2 text-zinc-300">
              <div className="flex items-start gap-2">
                <CheckSquare className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  <strong>AI Studio Verification:</strong> Tested with both cURL (Resend) and OpenAPI (Weather) fragments, producing valid Zod schemas and @modelcontextprotocol/sdk server code.
                </span>
              </div>
              <div className="flex items-start gap-2">
                <CheckSquare className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Edge Worker Proxy:</strong> Fully implemented server route (<code className="text-indigo-400 font-mono">/api/generate</code>) with temperature 0.1, top-p 0.8, and structured JSON parsing.
                </span>
              </div>
              <div className="flex items-start gap-2">
                <CheckSquare className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Client-Side Copy & Download:</strong> One-click copy buttons for <code className="text-indigo-400 font-mono">index.ts</code>, <code className="text-indigo-400 font-mono">mcp_config.json</code>, and complete <code className="text-indigo-400 font-mono">Download as ZIP</code>.
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-950 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-medium transition"
          >
            Close Blueprint
          </button>
        </div>
      </div>
    </div>
  );
};
