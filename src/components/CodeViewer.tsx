import React, { useState } from 'react';
import {
  FileText,
  Copy,
  Check,
  Download,
  FolderArchive,
  Search,
  Code,
  Key,
  ShieldCheck,
  ExternalLink,
  Layers,
  Wrench
} from 'lucide-react';
import { GeneratedFile, McpServerResponse } from '../types/mcp';
import { copyToClipboard, downloadFilesAsZip } from '../utils/zipExport';

interface CodeViewerProps {
  data: McpServerResponse | null;
  onOpenTestPlayground: () => void;
}

export const CodeViewer: React.FC<CodeViewerProps> = ({
  data,
  onOpenTestPlayground,
}) => {
  const [activeFilePath, setActiveFilePath] = useState<string>('');
  const [copiedFile, setCopiedFile] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isZipping, setIsZipping] = useState(false);

  // Sync active file when data arrives
  React.useEffect(() => {
    if (data?.files && data.files.length > 0) {
      if (!activeFilePath || !data.files.some((f) => f.path === activeFilePath)) {
        // default to index.ts or server.py
        const mainFile = data.files.find(
          (f) => f.path === 'index.ts' || f.path === 'server.py'
        );
        setActiveFilePath(mainFile ? mainFile.path : data.files[0].path);
      }
    }
  }, [data, activeFilePath]);

  if (!data) {
    return (
      <div className="h-full min-h-[460px] flex flex-col items-center justify-center border border-zinc-800 rounded-2xl bg-zinc-900/40 p-8 text-center backdrop-blur">
        <div className="w-16 h-16 rounded-2xl bg-zinc-800/80 border border-zinc-700/60 flex items-center justify-center mb-4 text-zinc-500 shadow-inner">
          <Code className="w-8 h-8" />
        </div>
        <h3 className="text-base font-semibold text-zinc-200 mb-1">
          Ready to Generate MCP Server
        </h3>
        <p className="text-xs text-zinc-400 max-w-sm mb-6 leading-relaxed">
          Provide a cURL command or OpenAPI 3.0/3.1 specification on the left,
          choose your target language, and click &ldquo;Generate MCP Server&rdquo;.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2 text-[11px] text-zinc-400">
          <span className="flex items-center gap-1 bg-zinc-900 px-2.5 py-1 rounded-md border border-zinc-800">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            No Hardcoded Secrets
          </span>
          <span className="flex items-center gap-1 bg-zinc-900 px-2.5 py-1 rounded-md border border-zinc-800">
            <Layers className="w-3.5 h-3.5 text-indigo-400" />
            Strict Zod / Pydantic
          </span>
          <span className="flex items-center gap-1 bg-zinc-900 px-2.5 py-1 rounded-md border border-zinc-800">
            <FolderArchive className="w-3.5 h-3.5 text-purple-400" />
            One-Click ZIP Export
          </span>
        </div>
      </div>
    );
  }

  const activeFile = data.files.find((f) => f.path === activeFilePath) || data.files[0];

  const handleCopy = async (filePath: string, content: string) => {
    try {
      await copyToClipboard(content);
      setCopiedFile(filePath);
      setTimeout(() => setCopiedFile(null), 2000);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  const handleDownloadZip = async () => {
    try {
      setIsZipping(true);
      await downloadFilesAsZip(data.serverName, data.files);
    } catch (err) {
      console.error('Failed to zip files', err);
    } finally {
      setIsZipping(false);
    }
  };

  const mainCodeFileName = data.language === 'python' ? 'server.py' : 'index.ts';
  const mainCodeFile = data.files.find((f) => f.path === mainCodeFileName);
  const mcpConfigFile = data.files.find((f) => f.path === 'mcp_config.json');

  // Filter lines if search term is provided
  const lines = activeFile ? activeFile.content.split('\n') : [];

  return (
    <div className="flex flex-col h-full bg-zinc-900/60 border border-zinc-800 rounded-2xl overflow-hidden shadow-xl backdrop-blur">
      {/* Top summary header */}
      <div className="p-4 border-b border-zinc-800 bg-zinc-950/60">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-bold text-white bg-zinc-800 px-2 py-0.5 rounded border border-zinc-700">
                {data.serverName}
              </span>
              <span className="text-xs text-zinc-400">
                {data.language === 'typescript' ? 'TypeScript MCP (@modelcontextprotocol/sdk)' : 'Python FastMCP'}
              </span>
              {data.generatedBy && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
                  {data.generatedBy}
                </span>
              )}
            </div>
            {data.summary?.description && (
              <p className="text-xs text-zinc-400 mt-1 line-clamp-1">
                {data.summary.description}
              </p>
            )}
          </div>

          {/* Quick action buttons per blueprint spec */}
          <div className="flex items-center flex-wrap gap-2">
            {mainCodeFile && (
              <button
                onClick={() => handleCopy(mainCodeFileName, mainCodeFile.content)}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 flex items-center gap-1.5 transition"
                title={`Copy ${mainCodeFileName}`}
              >
                {copiedFile === mainCodeFileName ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-indigo-400" />
                )}
                <span>Copy {mainCodeFileName}</span>
              </button>
            )}

            {mcpConfigFile && (
              <button
                onClick={() => handleCopy('mcp_config.json', mcpConfigFile.content)}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 flex items-center gap-1.5 transition"
                title="Copy mcp_config.json"
              >
                {copiedFile === 'mcp_config.json' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-purple-400" />
                )}
                <span>Copy mcp_config.json</span>
              </button>
            )}

            <button
              onClick={handleDownloadZip}
              disabled={isZipping}
              className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium flex items-center gap-1.5 transition shadow-sm"
              title="Download all generated files as ready-to-run ZIP"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{isZipping ? 'Archiving...' : 'Download as ZIP'}</span>
            </button>
          </div>
        </div>

        {/* Security & Env Vars pill bar */}
        <div className="mt-3 pt-3 border-t border-zinc-800/80 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-zinc-400 flex items-center gap-1 text-[11px]">
              <Key className="w-3 h-3 text-amber-400" />
              Required Env Vars:
            </span>
            {data.summary?.requiredEnvVars && data.summary.requiredEnvVars.length > 0 ? (
              data.summary.requiredEnvVars.map((envVar) => (
                <code
                  key={envVar}
                  className="px-1.5 py-0.5 text-[11px] rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 font-mono"
                >
                  {envVar}
                </code>
              ))
            ) : (
              <span className="text-zinc-400 text-[11px]">None (No auth needed)</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onOpenTestPlayground}
              className="text-[11px] px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-indigo-300 hover:text-white border border-indigo-500/20 flex items-center gap-1 transition"
            >
              <Wrench className="w-3 h-3 text-indigo-400" />
              <span>Test Tools in Simulator ({data.summary?.toolsGenerated?.length || 1})</span>
            </button>
          </div>
        </div>
      </div>

      {/* File tabs bar */}
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950 px-3 overflow-x-auto">
        <div className="flex items-center space-x-1 py-1.5">
          {data.files.map((file) => {
            const isActive = file.path === activeFile?.path;
            return (
              <button
                key={file.path}
                onClick={() => setActiveFilePath(file.path)}
                className={`text-xs px-3 py-1.5 rounded-lg font-mono flex items-center gap-1.5 transition whitespace-nowrap ${
                  isActive
                    ? 'bg-zinc-800 text-white shadow-sm border border-zinc-700/80'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                }`}
              >
                <FileText className={`w-3.5 h-3.5 ${isActive ? 'text-indigo-400' : 'text-zinc-400'}`} />
                <span>{file.path}</span>
              </button>
            );
          })}
        </div>

        {/* Search within current file */}
        <div className="hidden sm:flex items-center gap-2 py-1.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Find in file..."
              className="pl-8 pr-2 py-1 text-xs bg-zinc-900 border border-zinc-800 rounded-md text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-700 w-36 font-mono"
            />
          </div>

          {activeFile && (
            <button
              onClick={() => handleCopy(activeFile.path, activeFile.content)}
              className="text-xs px-2.5 py-1 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-800 flex items-center gap-1 transition"
              title={`Copy ${activeFile.path}`}
            >
              {copiedFile === activeFile.path ? (
                <Check className="w-3 h-3 text-emerald-400" />
              ) : (
                <Copy className="w-3 h-3 text-zinc-400" />
              )}
              <span>{copiedFile === activeFile.path ? 'Copied' : 'Copy'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Code Editor View */}
      <div className="flex-1 overflow-auto bg-zinc-950 font-mono text-xs text-zinc-200 p-4 leading-relaxed select-text min-h-[380px]">
        {activeFile ? (
          <table className="w-full border-collapse">
            <tbody>
              {lines.map((line, idx) => {
                const lineNum = idx + 1;
                const isMatch = searchTerm && line.toLowerCase().includes(searchTerm.toLowerCase());
                return (
                  <tr
                    key={lineNum}
                    className={`hover:bg-zinc-900/60 transition ${
                      isMatch ? 'bg-indigo-950/40' : ''
                    }`}
                  >
                    <td className="w-10 pr-4 text-right text-zinc-400 select-none font-mono text-[11px] align-top">
                      {lineNum}
                    </td>
                    <td className="whitespace-pre-wrap break-all text-zinc-200">
                      {line || ' '}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="text-zinc-400 italic">No file selected.</p>
        )}
      </div>

      {/* Status footer */}
      <div className="px-4 py-2 bg-zinc-950/90 border-t border-zinc-800 text-[11px] text-zinc-400 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span>{lines.length} lines</span>
          <span>{activeFile?.content.length || 0} characters</span>
          <span className="hidden sm:inline">UTF-8</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-zinc-400">Model Context Protocol 2024-11-05 Spec</span>
        </div>
      </div>
    </div>
  );
};
