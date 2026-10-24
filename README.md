<div align="center">
  <img width="1200" height="475" alt="mcpx Gateway Banner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# mcpx — Edge-Native Model Context Protocol Gateway

Deterministic AST code inspection, V8 sandboxed execution, and prepaid L402/x402 micro-metering deployed on Cloudflare Workers.

---

## Architecture & Primitives

- **AST Validation Gateway:** Static syntax and AST safety audits for TypeScript and JavaScript before LLM execution ($0.01 / 1 credit).
- **V8 Sandbox Execution:** Deterministic edge runtime for evaluating pure computational code blocks ($0.05 / 5 credits).
- **Prepaid x402 Protocol:** Pay-per-call micro-billing backed by Cloudflare KV and Creem.io Merchant of Record.
- **Zero-Latency Telemetry:** Asynchronous payment and event logging via Cloudflare Workers Analytics Engine.

---

## Client Integration

### 1. Claude Code
Pievieno `mcpx` serveri failā `~/.claude.json` vai sava projekta `.claude/config.json`:

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

### 2. Cursor IDE
Dodies uz **Cursor Settings > Features > MCP**, spied **Add New MCP Server**:
- **Name:** `mcpx`
- **Type:** `sse`
- **URL:** `https://mcpx.harrykrauze.com/mcp/sse`

Pievieno autorizācijas galveni ar savu atslēgu:
```text
Authorization: Bearer YOUR_MCPX_API_KEY
```

### 3. Windsurf / Codeium Cascade
Failā `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "mcpx": {
      "serverUrl": "https://mcpx.harrykrauze.com/mcp/sse",
      "headers": {
        "Authorization": "Bearer YOUR_MCPX_API_KEY"
      }
    }
  }
}
```

---

## Micro-Metering & x402 Billing Matrix

| Operation | Unit Cost | Description |
| :--- | :--- | :--- |
| `ast_check` | **$0.01** (1 credit) | Deterministic syntax, regex injection, and AST linting |
| `v8_execute` | **$0.05** (5 credits) | Isolated V8 micro-sandbox evaluation |
| `health` / `keys/verify` | **Free** ($0.00) | Infrastructure status and active balance query |

Ja bilance sasniedz `0`, vārteja atgriež standarta **HTTP 402 Payment Required** atbildi ar tiešu Creem.io papildināšanas saiti.

---

## Top-Up & Key Management

Kredītu papildināšana pieejama tieši caur [mcpx.harrykrauze.com](https://mcpx.harrykrauze.com):
- **$10.00** — 1,000 kredīti (1,000 AST pārbaudes / 200 V8 izpildes)
- **$25.00** — 2,500 kredīti (2,500 AST pārbaudes / 500 V8 izpildes)
- **$50.00** — 5,000 kredīti (5,000 AST pārbaudes / 1,000 V8 izpildes)

---

## CLI & Local Development

```bash
# Atkarību instalēšana
npm ci --legacy-peer-deps

# Tipu pārbaude un vienībtesti
npm run typecheck
npm test

# Lokālā izpilde
npx wrangler dev
```
