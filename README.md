<div align="center">
  <img width="1200" height="475" alt="MCP Server Generator Banner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# MCP Server Generator

> Deterministic, TypeSafe Model Context Protocol (MCP) server generator. Transform cURL commands, OpenAPI 3.0/3.1 specifications, and API schemas into production-ready MCP servers for AI agents (Claude, Cursor, Antigravity).

---

## Features

- **Multi-Format Input:** Ingest cURL requests, OpenAPI 3.0/3.1 definitions, Swagger YAML/JSON, or raw JSON schemas.
- **Dual Language Targets:**
  - **TypeScript:** Built with `@modelcontextprotocol/sdk` and strict `zod` input validation schemas.
  - **Python:** Built with `FastMCP` / `mcp.server` and typed `pydantic` models.
- **Security & Best Practices:** Automatic extraction of tokens and headers into environment variables (`.env.example`). No hardcoded secrets.
- **AI-Powered & Deterministic Fallback:** Powered by Google Gemini (`gemini-3.8-flash` / `gemini-2.5-flash`) with an instant deterministic regex parsing fallback if offline or unauthenticated.
- **Interactive Simulator:** Test generated MCP JSON-RPC 2.0 tool calls directly in the browser playground.
- **One-Click Export:** Download a complete, runnable server bundle as a `.zip` archive.

---

## Tech Stack

- **Frontend:** React 19, Vite 8, Tailwind CSS v4, Lucide Icons, Framer Motion
- **Backend:** Express, TypeScript, `@google/genai` SDK
- **Runtime:** Node.js (v18+)

---

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env` and provide your Gemini API key:
```bash
cp .env.example .env
```
Edit `.env`:
```env
GEMINI_API_KEY="your-gemini-api-key-here"
```

### 3. Run Development Server
```bash
npm run dev
```
Open your browser at `http://localhost:3000`.

---

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Starts the Express server and Vite development middleware |
| `npm run build` | Compiles the production frontend bundle into `dist/` |
| `npm run start` | Runs the production backend with prebuilt assets |
| `npm run lint` | Runs type verification (`tsc --noEmit`) |
| `npm run test:client-connection` | Runs live MCP client SSE & tools/list verification against production |
| `npm run test:live-smoke` | Runs production edge gateway live smoke tests |
| `npm run clean` | Removes build artifacts (`dist`, `server.js`) |

---

## Klientu Pieslēgšana (Claude Code & Cursor)

`mcpx` nodrošina attālinātu pieslēgumu AI izstrādes aģentiem caur **Model Context Protocol (MCP)** Server-Sent Events (SSE) transportu ar Bearer autorizāciju.

### 1. Claude Code (CLI)
Pievienojiet `mcpx` serveri tieši caur termināli:
```bash
claude mcp add --transport sse mcpx https://mcpx.harrykrauze.com/mcp/sse --header "Authorization: Bearer <TAVA_MCPX_API_ATSLĒGA>"
```

Vai pievienojiet projekta `.mcp.json` (vai globālajā `~/.claude.json`):
```json
{
  "mcpServers": {
    "mcpx": {
      "url": "https://mcpx.harrykrauze.com/mcp/sse",
      "headers": {
        "Authorization": "Bearer ${MCPX_API_KEY}"
      }
    }
  }
}
```

### 2. Cursor IDE
Izveidojiet failu `.cursor/mcp.json` projekta saknē:
```json
{
  "mcpServers": {
    "mcpx": {
      "url": "https://mcpx.harrykrauze.com/mcp/sse",
      "headers": {
        "Authorization": "Bearer YOUR_MCPX_API_KEY"
      }
    }
  }
}
```

Gatavi konfigurācijas šabloni un atslēgu provisionēšanas ceļvedis atrodams mapē [`examples/clients/`](examples/clients/README.md).

---

## License

MIT