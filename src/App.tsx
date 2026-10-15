import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { InputPanel } from './components/InputPanel';
import { CodeViewer } from './components/CodeViewer';
import { SetupGuideModal } from './components/SetupGuideModal';
import { BlueprintModal } from './components/BlueprintModal';
import { ToolPlayground } from './components/ToolPlayground';
import { McpLanguage, McpServerResponse, PresetSnippet } from './types/mcp';
import { PRESET_SNIPPETS } from './constants/presets';
import { AlertCircle, History, Sparkles, CheckCircle2, ArrowRight } from 'lucide-react';

const STORAGE_KEY = 'mcp_generator_current_result';
const HISTORY_STORAGE_KEY = 'mcp_generator_history';

export default function App() {
  const [inputSnippet, setInputSnippet] = useState<string>(PRESET_SNIPPETS[0].snippet);
  const [language, setLanguage] = useState<McpLanguage>(PRESET_SNIPPETS[0].language);
  const [serverName, setServerName] = useState<string>(PRESET_SNIPPETS[0].serverName);
  const [transport, setTransport] = useState<'stdio' | 'sse'>('stdio');
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(PRESET_SNIPPETS[0].id);

  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generationResult, setGenerationResult] = useState<McpServerResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasGeminiKey, setHasGeminiKey] = useState<boolean>(true);

  // Modals
  const [isGuideOpen, setIsGuideOpen] = useState<boolean>(false);
  const [isBlueprintOpen, setIsBlueprintOpen] = useState<boolean>(false);
  const [isPlaygroundOpen, setIsPlaygroundOpen] = useState<boolean>(false);

  // History
  const [history, setHistory] = useState<Array<{ id: string; serverName: string; language: string; date: string; result: McpServerResponse }>>([]);

  // Check server health on load
  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => {
        if (data && typeof data.hasGeminiKey === 'boolean') {
          setHasGeminiKey(data.hasGeminiKey);
        }
      })
      .catch((err) => console.warn('Could not check server health', err));

    // Load cached result or generate default Test Case 1
    const cached = localStorage.getItem(STORAGE_KEY);
    const cachedHistory = localStorage.getItem(HISTORY_STORAGE_KEY);

    if (cachedHistory) {
      try {
        setHistory(JSON.parse(cachedHistory));
      } catch (e) {
        // ignore
      }
    }

    if (cached) {
      try {
        setGenerationResult(JSON.parse(cached));
        return;
      } catch (e) {
        // ignore
      }
    }

    // Auto-generate test case 1 on initial load
    handleGenerate();
  }, []);

  const handleSelectPreset = (preset: PresetSnippet) => {
    setSelectedPresetId(preset.id);
    setInputSnippet(preset.snippet);
    setLanguage(preset.language);
    setServerName(preset.serverName);
  };

  const handleGenerate = async () => {
    if (!inputSnippet.trim()) {
      setError('Please provide a cURL command or OpenAPI specification.');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputSnippet,
          language,
          serverName: serverName.trim() || undefined,
          transport,
        }),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || `Server responded with HTTP ${response.status}`);
      }

      const data: McpServerResponse = await response.json();
      setGenerationResult(data);

      // Save to localStorage
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        const newHistoryItem = {
          id: `${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          serverName: data.serverName,
          language: data.language,
          date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          result: data,
        };
        const updatedHistory = [newHistoryItem, ...history.slice(0, 9)];
        setHistory(updatedHistory);
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updatedHistory));
      } catch (e) {
        // local storage quota or privacy mode
      }
    } catch (err: any) {
      console.error('Generation error:', err);
      setError(err.message || 'Failed to generate MCP server.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-indigo-500/30 selection:text-white">
      {/* Top Header */}
      <Header
        onOpenGuide={() => setIsGuideOpen(true)}
        onOpenBlueprint={() => setIsBlueprintOpen(true)}
        hasGeminiKey={hasGeminiKey}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex flex-col space-y-4">
        {/* Banner with quick summary and protocol badge */}
        <div className="rounded-xl bg-gradient-to-r from-indigo-950/40 via-purple-950/20 to-zinc-900 border border-indigo-900/30 p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-indigo-400 animate-ping hidden sm:block" />
            <div>
              <p className="text-xs sm:text-sm font-semibold text-white">
                Deterministic TypeSafe API Bridge for AI Agents
              </p>
              <p className="text-[11px] sm:text-xs text-zinc-400">
                Transforms any HTTP API into official Model Context Protocol (MCP) servers with strict Zod/Pydantic validation.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <button
              onClick={() => handleSelectPreset(PRESET_SNIPPETS[0])}
              className="text-xs px-2.5 py-1 rounded bg-zinc-900 hover:bg-zinc-800 text-indigo-300 border border-indigo-500/30 transition flex items-center gap-1"
            >
              <span>Test Case 1 (cURL)</span>
            </button>
            <button
              onClick={() => handleSelectPreset(PRESET_SNIPPETS[1])}
              className="text-xs px-2.5 py-1 rounded bg-zinc-900 hover:bg-zinc-800 text-purple-300 border border-purple-500/30 transition flex items-center gap-1"
            >
              <span>Test Case 2 (OpenAPI)</span>
            </button>
          </div>
        </div>

        {/* Error notification if any */}
        {error && (
          <div className="p-3 bg-red-950/50 border border-red-800/80 rounded-xl flex items-center gap-2 text-xs text-red-200">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span className="flex-1">{error}</span>
            <button
              onClick={() => setError(null)}
              className="text-red-400 hover:text-red-200 font-mono"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Dual Pane Workspace */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 flex-1 min-h-[640px]">
          {/* Left Column: Input and configuration (5 cols on lg) */}
          <div className="lg:col-span-5 flex flex-col">
            <InputPanel
              inputSnippet={inputSnippet}
              setInputSnippet={(snippet) => {
                setInputSnippet(snippet);
                setSelectedPresetId(null);
              }}
              language={language}
              setLanguage={setLanguage}
              serverName={serverName}
              setServerName={setServerName}
              transport={transport}
              setTransport={setTransport}
              onGenerate={handleGenerate}
              isGenerating={isGenerating}
              selectedPresetId={selectedPresetId}
              onSelectPreset={handleSelectPreset}
            />
          </div>

          {/* Right Column: Code Viewer and outputs (7 cols on lg) */}
          <div className="lg:col-span-7 flex flex-col">
            <CodeViewer
              data={generationResult}
              onOpenTestPlayground={() => setIsPlaygroundOpen(true)}
            />
          </div>
        </div>

        {/* Quick History bar if history exists */}
        {history.length > 1 && (
          <div className="pt-2 border-t border-zinc-900 flex items-center justify-between text-xs text-zinc-400">
            <div className="flex items-center gap-2 overflow-x-auto py-1">
              <span className="flex items-center gap-1 text-[11px] text-zinc-400 font-medium">
                <History className="w-3.5 h-3.5" />
                Recent:
              </span>
              {history.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setGenerationResult(item.result);
                    setServerName(item.serverName);
                    setLanguage(item.language as McpLanguage);
                  }}
                  className={`text-[11px] px-2.5 py-1 rounded-md border font-mono transition whitespace-nowrap ${
                    generationResult?.serverName === item.serverName
                      ? 'bg-zinc-800 text-white border-zinc-700'
                      : 'bg-zinc-950 text-zinc-400 border-zinc-900 hover:bg-zinc-900'
                  }`}
                >
                  {item.serverName} ({item.language})
                </button>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Modals */}
      {isGuideOpen && (
        <SetupGuideModal
          serverName={generationResult?.serverName || serverName}
          onClose={() => setIsGuideOpen(false)}
        />
      )}

      {isBlueprintOpen && (
        <BlueprintModal onClose={() => setIsBlueprintOpen(false)} />
      )}

      {isPlaygroundOpen && generationResult && (
        <ToolPlayground
          data={generationResult}
          onClose={() => setIsPlaygroundOpen(false)}
        />
      )}
    </div>
  );
}
