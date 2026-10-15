# MCP Client Registration Guide

This document describes how to register the **MCP Server Generator** as an official Model Context Protocol (MCP) tool in **Google Antigravity**, **Claude Desktop**, and **Cursor**.

Once registered, your AI assistant can directly call the `generate_mcp_server` tool to convert any cURL command, OpenAPI 3.0/3.1 definition, or JSON schema into a ready-to-run TypeScript (`@modelcontextprotocol/sdk`) or Python (`FastMCP`) server.

---

## Tool Signature

- **Tool Name:** `generate_mcp_server`
- **Description:** Generates a fully functional MCP server (TypeScript or Python) from an OpenAPI spec, cURL command, or JSON API schema.
- **Input Parameters:**
  - `spec` *(string, required)*: The raw API specification, OpenAPI YAML/JSON, cURL snippet, or JSON structure.
  - `target_language` *(string, optional, default: `"typescript"`)*: Target framework (`"typescript"` or `"python"`).
  - `server_name` *(string, optional, default: `"generated-mcp-server"`)*: Slug or human-readable identifier for the generated server.

---

## 1. Google Antigravity Registration

To register the generator in Google Antigravity:

### Option A: Via Antigravity Configuration / Sidecar
Add the following entry to your Antigravity client configuration or tool registry:

```json
{
  "mcpServers": {
    "mcp-server-generator": {
      "command": "node",
      "args": [
        "c:/Users/A/Documents/mcpx/dist/mcp-server.js"
      ],
      "env": {
        "GEMINI_API_KEY": "YOUR_GEMINI_API_KEY"
      }
    }
  }
}
```

*Or via TSX directly (no build required):*
```json
{
  "mcpServers": {
    "mcp-server-generator": {
      "command": "npx",
      "args": [
        "-y",
        "tsx",
        "c:/Users/A/Documents/mcpx/src/mcp-server.ts"
      ],
      "env": {
        "GEMINI_API_KEY": "YOUR_GEMINI_API_KEY"
      }
    }
  }
}
```

---

## 2. Claude Desktop Registration

### Config File Location
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

### Configuration Snippet
Add `mcp-server-generator` inside the `"mcpServers"` object:

```json
{
  "mcpServers": {
    "mcp-server-generator": {
      "command": "node",
      "args": [
        "C:\\Users\\A\\Documents\\mcpx\\dist\\mcp-server.js"
      ],
      "env": {
        "GEMINI_API_KEY": "YOUR_GEMINI_API_KEY"
      }
    }
  }
}
```

*Note: Restart Claude Desktop after saving the configuration.*

---

## 3. Cursor Registration

### Location
Create or edit `.cursor/mcp.json` in your workspace root, or navigate in Cursor to:
`Cursor Settings` → `Features` → `MCP Servers` → `Add New MCP Server`.

### Configuration Snippet (`.cursor/mcp.json`)
```json
{
  "mcpServers": {
    "mcp-server-generator": {
      "command": "node",
      "args": [
        "c:/Users/A/Documents/mcpx/dist/mcp-server.js"
      ],
      "env": {
        "GEMINI_API_KEY": "YOUR_GEMINI_API_KEY"
      }
    }
  }
}
```

---

## 4. Testing with the Official MCP Inspector

You can test the tool interactively in your browser without attaching an LLM:

```bash
# Build the server first:
npm run build:mcp

# Launch with MCP Inspector:
npx @modelcontextprotocol/inspector node dist/mcp-server.js
```

The inspector will open at `http://localhost:5173`. You will see `generate_mcp_server` under the **Tools** tab.
