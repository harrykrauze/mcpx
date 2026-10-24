# mcpx Client Integration Guide (Claude Desktop & Cursor)

This guide provides official configuration profiles for integrating **Claude Desktop**, **Cursor IDE**, and **Claude Code CLI** with the remote **mcpx** Model Context Protocol (MCP) Server-Sent Events (SSE) server.

---

## Remote Endpoint & Authentication

- **SSE Transport Endpoint:** `https://mcpx.harrykrauze.com/mcp/sse`
- **JSON-RPC Message Endpoint:** `https://mcpx.harrykrauze.com/message` (or `POST /` / `POST /mcp/messages`)
- **Protocol Version:** MCP `2024-11-05`
- **Authentication:** Bearer token header (`Authorization: Bearer <YOUR_MCPX_API_KEY>`)

---

## 1. Claude Desktop Setup

### Configuration File Locations
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

### Configuration Snippet (`claude_desktop_config.json`)
Add the `mcpx` server under the `mcpServers` object:

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

> **Note:** Replace `YOUR_MCPX_API_KEY` with your active live key (e.g. `mcpx_live_...`). Restart Claude Desktop after saving the file.

---

## 2. Cursor Setup

### Configuration File Location
Create or edit `.cursor/mcp.json` in your workspace root, or navigate in Cursor to:
**Cursor Settings** → **Features** → **MCP Servers** → **Add New MCP Server**.

### Configuration Snippet (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "mcpx": {
      "type": "sse",
      "url": "https://mcpx.harrykrauze.com/mcp/sse",
      "headers": {
        "Authorization": "Bearer YOUR_MCPX_API_KEY"
      }
    }
  }
}
```

---

## 3. Claude Code CLI Setup

To connect Claude Code directly via CLI:

```bash
claude mcp add --transport sse mcpx https://mcpx.harrykrauze.com/mcp/sse --header "Authorization: Bearer YOUR_MCPX_API_KEY"
```

---

## 4. Available Tools & Metering Matrix

All discovery endpoints (`tools/list`, `initialize`, `ping`, `/health`, `/llms.txt`) are free of charge ($0.00).

When invoking tools via `tools/call`, credits are debited atomically in integer USD cents ($0.01 = 1 cent):

| Tool Name | Canonical Alias | Description | Cost (USD Cents) |
|---|---|---|---|
| `evaluate_fraud_transaction` | `evaluate_fraud` | Real-time transaction risk scoring and rule evaluation | **1¢** ($0.01) |
| `analyze_jev_semantic_ast` | `inspect_ast` | Static AST injection scanner & sandbox safety auditor | **1¢** ($0.01) |
| `calculate_u_value_iso6946` | `u_value_calc` | ISO 6946 building thermal transmittance & resistance calculator | **2¢** ($0.02) |
| `generate_mcp_server` | `generate_mcp` | Converts OpenAPI/cURL/JSON specs into TypeScript/Python MCP server code | **5¢** ($0.05) |

---

## 5. x402 Payment Interception

If your API key balance is insufficient for a tool call:
- The server responds with `HTTP 402 Payment Required`.
- A challenge header is returned: `WWW-Authenticate: L402 token="mcpx", invoice="https://mcpx.harrykrauze.com/billing/topup?tenant={tenantId}"`.
- The JSON-RPC error payload contains `code: 402` and the exact `requiredCents` and `balanceCents`.
- When the remaining balance is under 10 cents ($0.10), responses include the warning header `X-MCPX-Low-Balance: true`.

---

## 6. Handshake Verification

You can verify the connection manually using `curl`:

```bash
curl -N -H "Accept: text/event-stream" \
     -H "Authorization: Bearer YOUR_MCPX_API_KEY" \
     https://mcpx.harrykrauze.com/mcp/sse
```

Expected response:
```text
event: endpoint
data: /message
```
