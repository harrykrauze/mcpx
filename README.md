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
Add the `mcpx` server to `~/.claude.json` or your project's `.claude/config.json`:

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
Navigate to **Cursor Settings > Features > MCP**, click **Add New MCP Server**:
- **Name:** `mcpx`
- **Type:** `sse`
- **URL:** `https://mcpx.harrykrauze.com/mcp/sse`

Add the authorization header with your key:
```text
Authorization: Bearer YOUR_MCPX_API_KEY
```

### 3. Windsurf / Codeium Cascade
In `~/.codeium/windsurf/mcp_config.json`:

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

If the balance reaches `0`, the gateway returns a standard **HTTP 402 Payment Required** response with a direct Creem.io top-up link.

---

## Top-Up & Key Management

Credit top-ups are available directly at [mcpx.harrykrauze.com](https://mcpx.harrykrauze.com):
- **$10.00** — 1,000 credits (1,000 AST checks / 200 V8 executions)
- **$25.00** — 2,500 credits (2,500 AST checks / 500 V8 executions)
- **$50.00** — 5,000 credits (5,000 AST checks / 1,000 V8 executions)

---

## CLI & Local Development

```bash
# Install dependencies
npm ci --legacy-peer-deps

# Type checking and unit tests
npm run typecheck
npm test

# Local development server
npx wrangler dev
```
