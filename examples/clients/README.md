# mcpx Client Integration (Claude Code & Cursor)

This directory contains deterministic configuration templates for connecting the `mcpx` MCP gateway (`https://mcpx.harrykrauze.com`) to AI developer agents — **Claude Code** and **Cursor IDE**.

---

## 1. Claude Code Integration

### Option A: Direct Terminal Command (Recommended)
Add the remote `mcpx` server to your Claude Code session using the official CLI command:

```bash
claude mcp add --transport sse mcpx https://mcpx.harrykrauze.com/mcp/sse --header "Authorization: Bearer <YOUR_MCPX_API_KEY>"
```

### Option B: Configuration File (`claude-code.json`)
Copy the file contents into your project root `.mcp.json` or global `~/.claude.json` configuration:

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

Ensure the environment variable `MCPX_API_KEY` is exported in your shell environment (`export MCPX_API_KEY="..."` or `.env`).

---

## 2. Cursor IDE Integration

Cursor supports MCP servers via project-level `.cursor/mcp.json` or global settings (*Settings -> Features -> MCP*).

### Configuration: `.cursor/mcp.json`
Create `.cursor/mcp.json` in your project root with the following content:

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

Replace `YOUR_MCPX_API_KEY` with your active API key.

---

## 3. API Key Provisioning and Management

The `mcpx` gateway supports two-tier authentication:
1. **Master Administrator Key:** Stored in Cloudflare secrets (`MCPX_API_KEY`).
2. **Multi-tenant Scoped Keys:** Stored in Cloudflare KV (`MCPX_KEYS`).

### Provisioning a New Scoped API Key:
Using the Master administrator key, send a POST request to the provisioning endpoint:

```bash
curl -X POST https://mcpx.harrykrauze.com/keys/provision \
  -H "Authorization: Bearer <MASTER_ADMIN_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"tenantId": "developer-alice", "plan": "pro", "initialBalanceCents": 1000}'
```

You will receive the newly generated active key in the JSON response:
```json
{
  "success": true,
  "apiKey": "mcpx_live_...",
  "keyId": "key_...",
  "tenantId": "developer-alice",
  "plan": "pro",
  "status": "active",
  "billing": {
    "balanceCents": 1000,
    "totalSpentCents": 0
  }
}
```

---

## 4. Connection Verification

To deterministically verify that the client can complete the SSE handshake and list available tools (`tools/list`), execute:

```bash
npm run test:client-connection
```
