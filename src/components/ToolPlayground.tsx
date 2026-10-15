import React, { useState } from 'react';
import { X, Play, Terminal, CheckCircle2, AlertCircle, ArrowRight, ShieldCheck, Copy, Check } from 'lucide-react';
import { McpServerResponse } from '../types/mcp';
import { copyToClipboard } from '../utils/zipExport';

interface ToolPlaygroundProps {
  data: McpServerResponse;
  onClose: () => void;
}

export const ToolPlayground: React.FC<ToolPlaygroundProps> = ({ data, onClose }) => {
  const tools = data.summary?.toolsGenerated?.length > 0 ? data.summary.toolsGenerated : ['execute_request'];
  const [selectedTool, setSelectedTool] = useState(tools[0]);
  const [mockInputs, setMockInputs] = useState<Record<string, string>>({
    to: 'user@example.com',
    subject: 'Test email from MCP Simulator',
    html: '<p>Hello from MCP Simulator</p>',
    city: 'San Francisco',
    units: 'metric',
  });
  const [simulatedResponse, setSimulatedResponse] = useState<any | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [copiedPayload, setCopiedPayload] = useState(false);

  const handleSimulate = () => {
    setIsSimulating(true);
    setSimulatedResponse(null);

    setTimeout(() => {
      // Simulate MCP Server tool invocation response
      const toolCallResult = {
        toolName: selectedTool,
        status: 'success',
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  id: `mock_${Math.random().toString(36).substring(2, 9)}`,
                  status: 'processed',
                  tool: selectedTool,
                  simulatedTimestamp: new Date().toISOString(),
                  message: `Successfully executed ${selectedTool} via Model Context Protocol bridge.`,
                  inputArguments: mockInputs,
                },
                null,
                2
              ),
            },
          ],
          isError: false,
        },
      };

      setSimulatedResponse(toolCallResult);
      setIsSimulating(false);
    }, 450);
  };

  const clientRpcPayload = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: selectedTool,
      arguments: mockInputs,
    },
  };

  const handleCopyRpc = async () => {
    await copyToClipboard(JSON.stringify(clientRpcPayload, null, 2));
    setCopiedPayload(true);
    setTimeout(() => setCopiedPayload(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <Terminal className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">
                MCP Interactive Tool Simulator
              </h2>
              <p className="text-xs text-zinc-400">
                Test and inspect JSON-RPC 2.0 tool execution payloads for {data.serverName}
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
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Tool selector */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2">
              Select Tool to Test
            </label>
            <div className="flex flex-wrap gap-2">
              {tools.map((tool) => (
                <button
                  key={tool}
                  onClick={() => setSelectedTool(tool)}
                  className={`text-xs px-3.5 py-1.5 rounded-lg border font-mono transition ${
                    selectedTool === tool
                      ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
                      : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:bg-zinc-800'
                  }`}
                >
                  {tool}()
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left: Input parameters */}
            <div className="flex flex-col bg-zinc-900/40 border border-zinc-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-zinc-200">
                  Simulated Agent Arguments
                </span>
                <span className="text-[11px] text-zinc-400 font-mono">
                  JSON Key-Value
                </span>
              </div>

              <div className="space-y-3 flex-1">
                {Object.keys(mockInputs).map((key) => (
                  <div key={key}>
                    <label className="block text-[11px] font-mono text-zinc-400 mb-1">
                      {key}:
                    </label>
                    <input
                      type="text"
                      value={mockInputs[key] || ''}
                      onChange={(e) =>
                        setMockInputs({ ...mockInputs, [key]: e.target.value })
                      }
                      className="w-full px-3 py-1.5 text-xs bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200 font-mono focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                ))}
              </div>

              <div className="mt-4 pt-3 border-t border-zinc-800 flex items-center justify-between">
                <button
                  type="button"
                  onClick={handleSimulate}
                  disabled={isSimulating}
                  className="w-full px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium flex items-center justify-center gap-2 transition shadow-md"
                >
                  {isSimulating ? (
                    <div className="w-3.5 h-3.5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Play className="w-3.5 h-3.5 fill-white" />
                  )}
                  <span>Simulate Tool Execution</span>
                </button>
              </div>
            </div>

            {/* Right: Client JSON-RPC Request & Response */}
            <div className="flex flex-col space-y-4">
              {/* Client RPC */}
              <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-zinc-200">
                    Claude Desktop / Cursor RPC Call
                  </span>
                  <button
                    onClick={handleCopyRpc}
                    className="text-[11px] text-zinc-400 hover:text-white flex items-center gap-1 transition"
                  >
                    {copiedPayload ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedPayload ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <pre className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-[11px] font-mono text-indigo-300 overflow-x-auto max-h-36">
                  {JSON.stringify(clientRpcPayload, null, 2)}
                </pre>
              </div>

              {/* Server Response */}
              <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 flex-1">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                    MCP Response
                    {simulatedResponse && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
                        isError: false
                      </span>
                    )}
                  </span>
                </div>
                {simulatedResponse ? (
                  <pre className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-[11px] font-mono text-emerald-300 overflow-x-auto max-h-48">
                    {JSON.stringify(simulatedResponse.result, null, 2)}
                  </pre>
                ) : (
                  <div className="h-32 flex flex-col items-center justify-center border border-dashed border-zinc-800 rounded-lg text-zinc-400 text-xs text-center p-3">
                    Click &ldquo;Simulate Tool Execution&rdquo; to test invocation
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-950 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Strict Zod/Pydantic validation active on all inputs</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white transition"
          >
            Close Simulator
          </button>
        </div>
      </div>
    </div>
  );
};
