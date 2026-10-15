import React from 'react';
import { Terminal, Sparkles, BookOpen, FileCode, CheckCircle2 } from 'lucide-react';

interface HeaderProps {
  onOpenGuide: () => void;
  onOpenBlueprint: () => void;
  hasGeminiKey: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenGuide,
  onOpenBlueprint,
  hasGeminiKey,
}) => {
  return (
    <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 p-0.5 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <div className="h-full w-full bg-zinc-950 rounded-[10px] flex items-center justify-center">
              <Terminal className="w-5 h-5 text-indigo-400" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-bold text-white tracking-tight flex items-center gap-1.5">
                MCP Server Generator
              </h1>
              <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                Official Protocol
              </span>
            </div>
            <p className="text-xs text-zinc-400 hidden sm:block">
              cURL & OpenAPI 3.0/3.1 → TypeSafe Model Context Protocol Servers
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {/* AI Status pill */}
          <div
            className={`hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border ${
              hasGeminiKey
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                hasGeminiKey ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
              }`}
            />
            <span>{hasGeminiKey ? 'Gemini 2.5 Flash Connected' : 'Deterministic Mode'}</span>
          </div>

          <button
            onClick={onOpenBlueprint}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:text-white bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg transition"
            title="Inspect Blueprint Prompt and Parameters"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden sm:inline">AI Studio Blueprint</span>
            <span className="sm:hidden">Blueprint</span>
          </button>

          <button
            onClick={onOpenGuide}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition shadow-sm shadow-indigo-600/30"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Setup Guide</span>
          </button>
        </div>
      </div>
    </header>
  );
};
