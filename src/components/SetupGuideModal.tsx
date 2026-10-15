import React, { useState } from 'react';
import { X, Check, Copy, ExternalLink, Terminal, Laptop, Monitor, Sparkles } from 'lucide-react';
import { copyToClipboard } from '../utils/zipExport';

interface SetupGuideModalProps {
  serverName?: string;
  onClose: () => void;
}

export const SetupGuideModal: React.FC<SetupGuideModalProps> = ({
  serverName = 'my-mcp-server',
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'claude' | 'cursor' | 'inspector'>('claude');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const cleanName = serverName.toLowerCase().replace(/[^a-z0-9_-]/g, '-') || 'api-mcp-server';

  const claudeConfigSnippet = `{
  "mcpServers": {
    "${cleanName}": {
      "command": "node",
      "args": [
        "/Users/YOUR_USERNAME/Documents/${cleanName}/build/index.js"
      ],
      "env": {
        "API_KEY": "YOUR_SECRET_TOKEN"
      }
    }
  }
}`;

  const cursorConfigSnippet = `{
  "mcp.servers": {
    "${cleanName}": {
      "command": "node",
      "args": ["/absolute/path/to/${cleanName}/build/index.js"],
      "env": {
        "API_KEY": "YOUR_SECRET_TOKEN"
      }
    }
  }
}`;

  const inspectorCommand = `npx @modelcontextprotocol/inspector node build/index.js`;

  const handleCopy = async (key: string, content: string) => {
    await copyToClipboard(content);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <Laptop className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">
                MCP Server Setup & Deployment Guide
              </h2>
              <p className="text-xs text-zinc-400">
                Connect your generated server to Claude Desktop, Cursor, or MCP Inspector
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

        {/* Tabs */}
        <div className="flex border-b border-zinc-800 bg-zinc-950 px-5 gap-3">
          <button
            onClick={() => setActiveTab('claude')}
            className={`py-3 text-xs font-medium border-b-2 transition flex items-center gap-2 ${
              activeTab === 'claude'
                ? 'border-indigo-500 text-white'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Monitor className="w-4 h-4" />
            <span>Claude Desktop</span>
          </button>
          <button
            onClick={() => setActiveTab('cursor')}
            className={`py-3 text-xs font-medium border-b-2 transition flex items-center gap-2 ${
              activeTab === 'cursor'
                ? 'border-indigo-500 text-white'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span>Cursor / Antigravity</span>
          </button>
          <button
            onClick={() => setActiveTab('inspector')}
            className={`py-3 text-xs font-medium border-b-2 transition flex items-center gap-2 ${
              activeTab === 'inspector'
                ? 'border-indigo-500 text-white'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Terminal className="w-4 h-4" />
            <span>Official MCP Inspector</span>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs text-zinc-300">
          {activeTab === 'claude' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-white mb-1">
                  1. Locate Claude Desktop Configuration File
                </h3>
                <ul className="space-y-1 text-zinc-400 font-mono text-[11px] list-disc list-inside">
                  <li>
                    <strong className="text-zinc-200">macOS:</strong>{' '}
                    ~/Library/Application Support/Claude/claude_desktop_config.json
                  </li>
                  <li>
                    <strong className="text-zinc-200">Windows:</strong>{' '}
                    %APPDATA%\Claude\claude_desktop_config.json
                  </li>
                </ul>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-white">
                    2. Add Server Snippet
                  </h3>
                  <button
                    onClick={() => handleCopy('claude', claudeConfigSnippet)}
                    className="text-xs px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 flex items-center gap-1.5 transition"
                  >
                    {copiedKey === 'claude' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{copiedKey === 'claude' ? 'Copied' : 'Copy JSON'}</span>
                  </button>
                </div>
                <pre className="p-3.5 bg-zinc-900/90 border border-zinc-800 rounded-xl font-mono text-indigo-300 overflow-x-auto leading-relaxed">
                  {claudeConfigSnippet}
                </pre>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-white mb-1">
                  3. Restart Claude Desktop
                </h3>
                <p className="text-zinc-400">
                  Fully quit and relaunch Claude Desktop. Look for the hammer icon{' '}
                  <span className="font-mono text-zinc-200">[🔨]</span> in the prompt box to see your new tools!
                </p>
              </div>
            </div>
          )}

          {activeTab === 'cursor' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-white mb-1">
                  Cursor Settings & MCP Configuration
                </h3>
                <p className="text-zinc-400 mb-3">
                  Open Cursor Settings &rarr; Features &rarr; MCP Servers &rarr; Add New MCP Server.
                </p>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-zinc-200">Config Snippet</span>
                  <button
                    onClick={() => handleCopy('cursor', cursorConfigSnippet)}
                    className="text-xs px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 flex items-center gap-1.5 transition"
                  >
                    {copiedKey === 'cursor' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{copiedKey === 'cursor' ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <pre className="p-3.5 bg-zinc-900/90 border border-zinc-800 rounded-xl font-mono text-indigo-300 overflow-x-auto">
                  {cursorConfigSnippet}
                </pre>
              </div>
            </div>
          )}

          {activeTab === 'inspector' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-white mb-1">
                  Test with Official @modelcontextprotocol/inspector
                </h3>
                <p className="text-zinc-400 mb-3">
                  The MCP Inspector is an interactive web-based UI provided by Anthropic and the MCP team to test tool calls, prompts, and resources without attaching an LLM.
                </p>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-zinc-200">Terminal Command</span>
                  <button
                    onClick={() => handleCopy('inspector', inspectorCommand)}
                    className="text-xs px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 flex items-center gap-1.5 transition"
                  >
                    {copiedKey === 'inspector' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{copiedKey === 'inspector' ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <pre className="p-3.5 bg-zinc-900/90 border border-zinc-800 rounded-xl font-mono text-emerald-300 overflow-x-auto">
                  {inspectorCommand}
                </pre>
                <p className="text-[11px] text-zinc-400 mt-2">
                  This spins up a local web server (usually at http://localhost:5173) connecting directly via Stdio transport.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-950 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-medium transition"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
