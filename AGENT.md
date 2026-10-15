# MCP Server Generator

Autonomous development and workspace rules for Google Antigravity.

## Stack
- **Frontend:** React 19, Vite 8, Tailwind CSS, Lucide icons
- **Backend:** Express, TypeScript, @google/genai (Gemini 2.5 / 3.8 Flash)
- **Target Exports:** TypeScript (@modelcontextprotocol/sdk), Python (FastMCP)

## Operational Commands
- `npm run build` - Production build (tsc + vite build)
- `npm run lint` - Type verification (tsc --noEmit)
- `npm run dev` - Local development server (Web UI + Express API)
- `npm run mcp:start` - Run standalone stdio MCP server via tsx
- `npm run build:mcp` - Bundle standalone stdio MCP server to `dist/mcp-server.js`

## Deterministic Constraints
- `.env` holds `GEMINI_API_KEY` and must NEVER be committed or logged.
- Maintain the deterministic fallback converter inside `server.ts` when modifying API transformations.
