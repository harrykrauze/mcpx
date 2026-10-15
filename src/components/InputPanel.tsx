import React from 'react';
import { Play, Sparkles, Terminal, Code, RotateCcw, Copy, Check } from 'lucide-react';
import { McpLanguage, PresetSnippet } from '../types/mcp';
import { PRESET_SNIPPETS } from '../constants/presets';

interface InputPanelProps {
  inputSnippet: string;
  setInputSnippet: (val: string) => void;
  language: McpLanguage;
  setLanguage: (val: McpLanguage) => void;
  serverName: string;
  setServerName: (val: string) => void;
  transport: 'stdio' | 'sse';
  setTransport: (val: 'stdio' | 'sse') => void;
  onGenerate: () => void;
  isGenerating: boolean;
  selectedPresetId: string | null;
  onSelectPreset: (preset: PresetSnippet) => void;
}

export const InputPanel: React.FC<InputPanelProps> = ({
  inputSnippet,
  setInputSnippet,
  language,
  setLanguage,
  serverName,
  setServerName,
  transport,
  setTransport,
  onGenerate,
  isGenerating,
  selectedPresetId,
  onSelectPreset,
}) => {
  const [copied, setCopied] = React.useState(false);
  const [generationStep, setGenerationStep] = React.useState(0);

  const GENERATION_STEPS = [
    'Analyzing API specification & paths...',
    'Extracting headers into environment variables...',
    'Synthesizing deterministic TypeSafe Zod schemas...',
    'Wiring up @modelcontextprotocol/sdk handlers...',
    'Packaging project files and client configuration...',
  ];

  React.useEffect(() => {
    let interval: any;
    if (isGenerating) {
      setGenerationStep(0);
      interval = setInterval(() => {
        setGenerationStep((prev) => (prev + 1) % GENERATION_STEPS.length);
      }, 2500);
    } else {
      setGenerationStep(0);
    }
    return () => clearInterval(interval);
  }, [isGenerating]);

  const handleCopyInput = () => {
    if (!inputSnippet) return;
    navigator.clipboard.writeText(inputSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!isGenerating && inputSnippet.trim()) {
        onGenerate();
      }
    }
  };

  return (
    <div className="flex flex-col h-full bg-zinc-900/60 border border-zinc-800 rounded-2xl overflow-hidden shadow-xl backdrop-blur">
      {/* Top Presets bar */}
      <div className="p-4 border-b border-zinc-800 bg-zinc-950/40">
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            Quick Test Cases & Presets
          </span>
          <span className="text-[11px] text-zinc-400">Blueprint Test Cases Included</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {PRESET_SNIPPETS.map((preset) => {
            const isSelected = selectedPresetId === preset.id;
            return (
              <button
                key={preset.id}
                onClick={() => onSelectPreset(preset)}
                className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/40 shadow-sm'
                    : 'bg-zinc-800/80 hover:bg-zinc-800 text-zinc-300 border-zinc-700/60 hover:text-white'
                }`}
              >
                <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-zinc-900/80 text-zinc-400 border border-zinc-700/50">
                  {preset.category}
                </span>
                <span>{preset.title.split(':')[0]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Target configuration bar */}
      <div className="p-4 border-b border-zinc-800 bg-zinc-900/30 grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Language switch */}
        <div>
          <label className="block text-[11px] font-medium text-zinc-400 mb-1.5">
            Target Language & SDK
          </label>
          <div className="grid grid-cols-2 p-0.5 bg-zinc-950 border border-zinc-800 rounded-lg">
            <button
              type="button"
              onClick={() => setLanguage('typescript')}
              className={`py-1.5 text-xs font-medium rounded-md transition flex items-center justify-center gap-1.5 ${
                language === 'typescript'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Code className="w-3.5 h-3.5" />
              TypeScript (Zod)
            </button>
            <button
              type="button"
              onClick={() => setLanguage('python')}
              className={`py-1.5 text-xs font-medium rounded-md transition flex items-center justify-center gap-1.5 ${
                language === 'python'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              Python (FastMCP)
            </button>
          </div>
        </div>

        {/* Server name */}
        <div>
          <label className="block text-[11px] font-medium text-zinc-400 mb-1.5">
            MCP Server Name
          </label>
          <input
            type="text"
            value={serverName}
            onChange={(e) => setServerName(e.target.value)}
            placeholder="e.g. resend-mcp, weather-mcp"
            className="w-full px-3 py-1.5 text-xs bg-zinc-950 border border-zinc-800 rounded-lg text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500 font-mono"
          />
        </div>

        {/* Transport */}
        <div>
          <label className="block text-[11px] font-medium text-zinc-400 mb-1.5">
            MCP Transport
          </label>
          <div className="grid grid-cols-2 p-0.5 bg-zinc-950 border border-zinc-800 rounded-lg">
            <button
              type="button"
              onClick={() => setTransport('stdio')}
              className={`py-1.5 text-xs font-medium rounded-md transition ${
                transport === 'stdio'
                  ? 'bg-zinc-800 text-white border border-zinc-700/60'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              stdio (Desktop)
            </button>
            <button
              type="button"
              onClick={() => setTransport('sse')}
              className={`py-1.5 text-xs font-medium rounded-md transition ${
                transport === 'sse'
                  ? 'bg-zinc-800 text-white border border-zinc-700/60'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              sse (HTTP/Cloud)
            </button>
          </div>
        </div>
      </div>

      {/* Editor text area */}
      <div className="flex-1 flex flex-col p-4 min-h-[300px]">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-zinc-300">
              Input API Specification or Snippet
            </span>
            <span className="text-[11px] text-zinc-400">
              (cURL, OpenAPI 3.0/3.1, Swagger, or JSON Schema)
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {inputSnippet && (
              <button
                type="button"
                onClick={handleCopyInput}
                className="text-[11px] px-2 py-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded flex items-center gap-1 transition"
                title="Copy snippet"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            )}
            {inputSnippet && (
              <button
                type="button"
                onClick={() => setInputSnippet('')}
                className="text-[11px] px-2 py-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded flex items-center gap-1 transition"
                title="Clear input"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Clear</span>
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 relative rounded-xl border border-zinc-800 bg-zinc-950 focus-within:border-indigo-500/80 transition overflow-hidden">
          <textarea
            value={inputSnippet}
            onChange={(e) => setInputSnippet(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Paste your cURL command, OpenAPI 3.0/3.1 YAML or JSON schema here...

Example:
curl -X POST "https://api.resend.com/emails" \\
  -H "Authorization: Bearer re_123456789" \\
  -H "Content-Type: application/json" \\
  -d '{"from": "onboarding@resend.dev", "to": "user@example.com", "subject": "Welcome!", "html": "<p>Hello</p>"}'`}
            className="w-full h-full p-3.5 bg-transparent text-xs font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none resize-none leading-relaxed"
            spellCheck={false}
          />
        </div>

        {/* Footer actions */}
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[11px] text-zinc-400 hidden sm:inline">
            Press <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 font-mono text-[10px]">Ctrl / ⌘ + Enter</kbd> to generate
          </span>

          <button
            type="button"
            onClick={onGenerate}
            disabled={isGenerating || !inputSnippet.trim()}
            className={`w-full sm:w-auto px-5 py-2.5 rounded-xl font-medium text-xs sm:text-sm text-white flex items-center justify-center gap-2 transition shadow-lg ${
              isGenerating || !inputSnippet.trim()
                ? 'bg-zinc-800 text-zinc-400 cursor-not-allowed border border-zinc-700/50'
                : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 shadow-indigo-600/25 active:scale-[0.98]'
            }`}
          >
            {isGenerating ? (
              <>
                <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                <span className="font-mono text-xs">{GENERATION_STEPS[generationStep]}</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-white" />
                <span>Generate MCP Server</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
