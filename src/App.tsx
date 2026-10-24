import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { InputPanel } from './components/InputPanel';
import { CodeViewer } from './components/CodeViewer';
import { SetupGuideModal } from './components/SetupGuideModal';
import { BlueprintModal } from './components/BlueprintModal';
import { ToolPlayground } from './components/ToolPlayground';
import { McpLanguage, McpServerResponse, PresetSnippet } from './types/mcp';
import { PRESET_SNIPPETS } from './constants/presets';
import { AlertCircle, History, Sparkles, CheckCircle2, ArrowRight, CreditCard } from 'lucide-react';

const CREEM_CHECKOUT_URLS = {
  10: "https://www.creem.io/payment/prod_6ByC0UlwmUHrR0IBSL1j66",
  25: "https://www.creem.io/payment/prod_39gjR08cFRZlFbmUe660Sr",
  50: "https://www.creem.io/payment/prod_4ygL3mb9sT5U6OptAtfJUp",
} as const;

type CreditTier = keyof typeof CREEM_CHECKOUT_URLS;

function handleCreemCheckout(tier: CreditTier, activeKey: string) {
  if (!activeKey) {
    alert("Please provision or select an API key before topping up.");
    return;
  }

  const baseUrl = CREEM_CHECKOUT_URLS[tier];
  const checkoutUrl = new URL(baseUrl);

  // Parameters for webhook key identification and redirect routing
  checkoutUrl.searchParams.set("custom_field_key_id", activeKey);
  checkoutUrl.searchParams.set("key_id", activeKey);
  checkoutUrl.searchParams.set("return_url", "https://mcpx.harrykrauze.com/?payment=success");
  checkoutUrl.searchParams.set("cancel_url", "https://mcpx.harrykrauze.com/?payment=cancelled");

  window.location.href = checkoutUrl.toString();
}

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

  // Billing & Creem Top-Up State
  const [currentApiKey, setCurrentApiKey] = useState<string>(
    () => localStorage.getItem('mcpx_client_api_key') || 'mcpx_live_test_client_key_123'
  );
  const [paymentNotice, setPaymentNotice] = useState<string | null>(null);

  // History
  const [history, setHistory] = useState<Array<{ id: string; serverName: string; language: string; date: string; result: McpServerResponse }>>([]);

  // Check server health and payment status on load
  useEffect(() => {
    // Check if returning from Creem checkout
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('payment') === 'success') {
      setPaymentNotice('Payment successful! Your credits have been funded via Creem.io webhook.');
    } else if (urlParams.get('payment') === 'cancelled') {
      setPaymentNotice('Payment checkout was cancelled. No charges were made.');
    }
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

        {/* Payment Notice if redirected from Creem checkout */}
        {paymentNotice && (
          <div className="p-3 bg-emerald-950/50 border border-emerald-800/80 rounded-xl flex items-center justify-between gap-2 text-xs text-emerald-200">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{paymentNotice}</span>
            </div>
            <button
              onClick={() => setPaymentNotice(null)}
              className="text-emerald-400 hover:text-emerald-200 font-mono"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Creem.io Live Top-Up Section */}
        <div className="rounded-xl bg-zinc-900/60 border border-zinc-800/80 p-4 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-800/80">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                <CreditCard className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                  Instant Credit Top-Up
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    Creem.io Live
                  </span>
                </h3>
                <p className="text-xs text-zinc-400">
                  Select a tier below to fund your API bearer key with USD credits via Creem.io.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 self-start sm:self-auto">
              <label htmlFor="active-api-key" className="text-xs text-zinc-400 font-medium">
                Active Key:
              </label>
              <input
                id="active-api-key"
                type="text"
                value={currentApiKey}
                onChange={(e) => {
                  const val = e.target.value.trim();
                  setCurrentApiKey(val);
                  localStorage.setItem('mcpx_client_api_key', val);
                }}
                className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1 text-xs font-mono text-zinc-200 w-48 sm:w-60 focus:outline-none focus:border-emerald-500/60"
                placeholder="mcpx_live_..."
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 my-6">
            {/* $10 pakete */}
            <button
              type="button"
              onClick={() => handleCreemCheckout(10, currentApiKey)}
              className="flex flex-col items-center justify-center p-4 rounded-xl border border-zinc-800 bg-zinc-950/60 hover:border-emerald-500/50 hover:bg-zinc-900/80 transition-all duration-200 group text-left cursor-pointer"
            >
              <span className="text-xl font-bold text-zinc-100 group-hover:text-emerald-400">
                $10.00
              </span>
              <span className="text-xs text-zinc-400 mt-1">1,000 credits</span>
              <span className="text-[10px] text-zinc-600 mt-2 font-mono">1,000 AST checks / 200 V8 runs</span>
            </button>

            {/* $25 pakete */}
            <button
              type="button"
              onClick={() => handleCreemCheckout(25, currentApiKey)}
              className="flex flex-col items-center justify-center p-4 rounded-xl border border-zinc-800 bg-zinc-950/60 hover:border-emerald-500/50 hover:bg-zinc-900/80 transition-all duration-200 group relative text-left cursor-pointer"
            >
              <div className="absolute -top-2.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-[9px] font-mono text-emerald-400 uppercase tracking-widest">
                Popular
              </div>
              <span className="text-xl font-bold text-zinc-100 group-hover:text-emerald-400">
                $25.00
              </span>
              <span className="text-xs text-zinc-400 mt-1">2,500 credits</span>
              <span className="text-[10px] text-zinc-600 mt-2 font-mono">2,500 AST checks / 500 V8 runs</span>
            </button>

            {/* $50 pakete */}
            <button
              type="button"
              onClick={() => handleCreemCheckout(50, currentApiKey)}
              className="flex flex-col items-center justify-center p-4 rounded-xl border border-zinc-800 bg-zinc-950/60 hover:border-emerald-500/50 hover:bg-zinc-900/80 transition-all duration-200 group text-left cursor-pointer"
            >
              <span className="text-xl font-bold text-zinc-100 group-hover:text-emerald-400">
                $50.00
              </span>
              <span className="text-xs text-zinc-400 mt-1">5,000 credits</span>
              <span className="text-[10px] text-zinc-600 mt-2 font-mono">5,000 AST checks / 1,000 V8 runs</span>
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
