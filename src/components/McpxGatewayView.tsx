import React, { useState } from 'react';
import {
  CreditCard,
  ArrowRight,
  Shield,
  Zap,
  Calculator,
  Check,
  Copy,
  Terminal,
  Key,
  ExternalLink,
  RefreshCw,
  Cpu,
  Layers,
} from 'lucide-react';

interface BalanceResponse {
  keyId?: string;
  tenantId?: string;
  credits?: number;
  status?: string;
  error?: string;
}

export const McpxGatewayView: React.FC = () => {
  // Live API Key Verification State
  const [apiKeyInput, setApiKeyInput] = useState<string>('mcpx_live_test_client_key_123');
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [balanceData, setBalanceData] = useState<BalanceResponse | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);

  // Dynamic x402 Usage Calculator State
  const [callsPerDay, setCallsPerDay] = useState<number>(1000);
  const monthlyCostUsd = (callsPerDay * 30 * 0.025).toFixed(2);
  const monthlyCredits = Math.round(callsPerDay * 30 * 2.5);

  // Client Config Tabs State
  const [activeTab, setActiveTab] = useState<'claude' | 'cursor' | 'curl'>('claude');
  const [copiedTab, setCopiedTab] = useState<string | null>(null);

  // Handle Verify Key
  const handleVerifyKey = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = apiKeyInput.trim();
    if (!token) {
      setVerificationError('Please enter an API key to verify.');
      return;
    }

    setIsVerifying(true);
    setVerificationError(null);
    setBalanceData(null);

    try {
      const res = await fetch('/api/v1/balance', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = (await res.json()) as BalanceResponse;
      if (!res.ok) {
        throw new Error(data.error || `Verification failed (HTTP ${res.status})`);
      }

      setBalanceData(data);
    } catch (err: any) {
      setVerificationError(err.message || 'Failed to verify key balance.');
    } finally {
      setIsVerifying(false);
    }
  };

  // Config Snippets
  const claudeDesktopConfig = JSON.stringify(
    {
      mcpServers: {
        mcpx: {
          url: 'https://mcpx.harrykrauze.com/mcp/sse',
          headers: {
            Authorization: `Bearer ${apiKeyInput.trim() || 'YOUR_MCPX_API_KEY'}`,
          },
        },
      },
    },
    null,
    2
  );

  const cursorConfig = JSON.stringify(
    {
      mcpServers: {
        mcpx: {
          type: 'sse',
          url: 'https://mcpx.harrykrauze.com/mcp/sse',
          headers: {
            Authorization: `Bearer ${apiKeyInput.trim() || 'YOUR_MCPX_API_KEY'}`,
          },
        },
      },
    },
    null,
    2
  );

  const curlSnippet = `curl -s -X POST https://mcpx.harrykrauze.com/tools/execute \\
  -H "Authorization: Bearer ${apiKeyInput.trim() || 'YOUR_MCPX_API_KEY'}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "tool": "calculate_u_value_iso6946",
    "params": {
      "layers": [
        { "name": "Concrete", "thickness_m": 0.2, "lambda_w_mk": 1.74 }
      ]
    }
  }'`;

  const copyToClipboard = (text: string, tabName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedTab(tabName);
    setTimeout(() => setCopiedTab(null), 2000);
  };

  return (
    <section className="space-y-12">
      {/* 1. Dual-CTA Hero Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-indigo-950/40 via-zinc-900/60 to-zinc-950 border border-indigo-900/30 p-6 sm:p-10 shadow-2xl">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 mb-4">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            V8 Edge Isolated Mesh &bull; Native x402 Machine Billing
          </div>
          <h2 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight">
            Autonomous Model Context Protocol Gateway
          </h2>
          <p className="mt-3 text-sm sm:text-base text-zinc-300 leading-relaxed">
            Deterministic tool execution for Claude Desktop, Cursor, and autonomous agent loops. Free machine discovery tier, sub-250ms latency, and pay-as-you-go microbilling settled in integer USD cents.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-4">
            <a
              href="https://checkout.creem.io/p/mcpx-tier1"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm text-white bg-indigo-600 hover:bg-indigo-500 transition shadow-lg shadow-indigo-600/30 active:scale-95"
            >
              <CreditCard className="w-4 h-4" />
              Instant $10 Top-Up
              <ArrowRight className="w-4 h-4" />
            </a>
            <a
              href="#quickstart"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm text-zinc-300 hover:text-white bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-800 transition active:scale-95"
            >
              <Terminal className="w-4 h-4 text-zinc-400" />
              Quickstart Integration
            </a>
          </div>
        </div>
      </div>

      {/* 2. Grid: Key Verification & Usage Calculator */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" id="quickstart">
        {/* Live API Key Verification Module */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Key className="w-5 h-5 text-indigo-400" />
              <h3 className="text-base font-semibold text-white">Live API Key Balance Verification</h3>
            </div>
            <p className="text-xs text-zinc-400 mb-4">
              Query the edge KV registry directly via <code className="text-indigo-300 font-mono">/api/v1/balance</code> to inspect your active key status and credit balance.
            </p>

            <form onSubmit={handleVerifyKey} className="space-y-3">
              <div>
                <label className="block text-xs font-mono text-zinc-400 mb-1">
                  Bearer API Key:
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder="mcpx_live_..."
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-indigo-500 transition"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isVerifying}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-white border border-zinc-700 transition disabled:opacity-50"
              >
                {isVerifying ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                    Checking Edge KV...
                  </>
                ) : (
                  <>
                    <Shield className="w-3.5 h-3.5 text-emerald-400" />
                    Verify Balance
                  </>
                )}
              </button>
            </form>

            {verificationError && (
              <div className="mt-4 p-3 rounded-lg bg-red-950/40 border border-red-900/60 text-xs text-red-300 font-mono">
                {verificationError}
              </div>
            )}

            {balanceData && (
              <div className="mt-4 p-3.5 rounded-lg bg-zinc-950 border border-zinc-800 space-y-2 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Status:</span>
                  <span className="text-emerald-400 font-semibold">{balanceData.status}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Tenant:</span>
                  <span className="text-zinc-200">{balanceData.tenantId || 'anonymous'}</span>
                </div>
                <div className="flex justify-between border-t border-zinc-850 pt-2">
                  <span className="text-zinc-500">Available Credits:</span>
                  <span className="text-indigo-400 font-bold">
                    ${((balanceData.credits || 0) / 100).toFixed(2)} ({balanceData.credits || 0} credits)
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="mt-6 pt-4 border-t border-zinc-850 flex items-center justify-between text-[11px] text-zinc-500 font-mono">
            <span>Rate: 1 credit = $0.01 USD</span>
            <a
              href="https://checkout.creem.io/p/mcpx-tier1"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-400 hover:underline inline-flex items-center gap-1"
            >
              Top-up credits <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        {/* Dynamic x402 Usage Calculator */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Calculator className="w-5 h-5 text-indigo-400" />
              <h3 className="text-base font-semibold text-white">Dynamic x402 Usage Calculator</h3>
            </div>
            <p className="text-xs text-zinc-400 mb-6">
              Estimate your monthly autonomous agent workload cost based on the Ladder of Trust weighted average ($0.025/call).
            </p>

            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs font-mono mb-2">
                  <span className="text-zinc-400">Daily Agent Invocations:</span>
                  <span className="text-white font-bold">{callsPerDay.toLocaleString()} req/day</span>
                </div>
                <input
                  type="range"
                  min={100}
                  max={10000}
                  step={100}
                  value={callsPerDay}
                  onChange={(e) => setCallsPerDay(Number(e.target.value))}
                  className="w-full accent-indigo-500 bg-zinc-800 h-2 rounded-lg cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-zinc-600 font-mono mt-1">
                  <span>100/day</span>
                  <span>5,000/day</span>
                  <span>10,000/day</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800/80">
                  <span className="text-[11px] text-zinc-500 block">Est. Monthly Budget</span>
                  <span className="text-lg font-bold text-white font-mono">${monthlyCostUsd}</span>
                  <span className="text-[10px] text-zinc-500 block">USD / month</span>
                </div>
                <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800/80">
                  <span className="text-[11px] text-zinc-500 block">Required Credits</span>
                  <span className="text-lg font-bold text-indigo-400 font-mono">{monthlyCredits.toLocaleString()}</span>
                  <span className="text-[10px] text-zinc-500 block">Integer cents</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-zinc-850 text-[11px] text-zinc-500 flex items-center justify-between font-mono">
            <span>Discovery tier operations remain 100% free ($0.00).</span>
          </div>
        </div>
      </div>

      {/* 3. Client Integration Tabs */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-base font-semibold text-white">Client Configuration</h3>
            <p className="text-xs text-zinc-400">Copy and paste directly into your IDE or agent config file.</p>
          </div>

          <div className="flex rounded-lg bg-zinc-950 p-1 border border-zinc-800 self-start sm:self-auto text-xs">
            <button
              onClick={() => setActiveTab('claude')}
              className={`px-3 py-1 rounded-md transition ${
                activeTab === 'claude'
                  ? 'bg-zinc-800 text-white font-medium'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Claude Desktop
            </button>
            <button
              onClick={() => setActiveTab('cursor')}
              className={`px-3 py-1 rounded-md transition ${
                activeTab === 'cursor'
                  ? 'bg-zinc-800 text-white font-medium'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Cursor IDE
            </button>
            <button
              onClick={() => setActiveTab('curl')}
              className={`px-3 py-1 rounded-md transition ${
                activeTab === 'curl'
                  ? 'bg-zinc-800 text-white font-medium'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              cURL CLI
            </button>
          </div>
        </div>

        <div className="relative rounded-lg bg-zinc-950 border border-zinc-800/80 p-4 font-mono text-xs text-zinc-300 overflow-x-auto">
          <button
            onClick={() => {
              if (activeTab === 'claude') copyToClipboard(claudeDesktopConfig, 'claude');
              else if (activeTab === 'cursor') copyToClipboard(cursorConfig, 'cursor');
              else copyToClipboard(curlSnippet, 'curl');
            }}
            className="absolute top-3 right-3 inline-flex items-center gap-1 px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] border border-zinc-700 transition"
          >
            {copiedTab === activeTab ? (
              <>
                <Check className="w-3 h-3 text-emerald-400" />
                Copied
              </>
            ) : (
              <>
                <Copy className="w-3 h-3 text-zinc-400" />
                Copy
              </>
            )}
          </button>

          <pre>
            {activeTab === 'claude' && claudeDesktopConfig}
            {activeTab === 'cursor' && cursorConfig}
            {activeTab === 'curl' && curlSnippet}
          </pre>
        </div>
      </div>

      {/* 4. Structured Runtime Footer */}
      <footer className="border-t border-zinc-800/80 pt-8 pb-4 text-xs text-zinc-500 flex flex-col sm:flex-row items-center justify-between gap-4 font-mono">
        <div className="flex items-center gap-4">
          <a href="/llms.txt" className="hover:text-zinc-300 transition underline underline-offset-4">
            /llms.txt
          </a>
          <a href="/llms-full.txt" className="hover:text-zinc-300 transition underline underline-offset-4">
            /llms-full.txt
          </a>
          <a href="#privacy" className="hover:text-zinc-300 transition">
            Privacy
          </a>
          <a href="#terms" className="hover:text-zinc-300 transition">
            Terms
          </a>
        </div>

        <div className="flex items-center gap-2">
          <span>Support:</span>
          <a
            href="mailto:support@harrykrauze.com"
            className="text-zinc-400 hover:text-indigo-400 transition"
          >
            support@harrykrauze.com
          </a>
        </div>
      </footer>
    </section>
  );
};
