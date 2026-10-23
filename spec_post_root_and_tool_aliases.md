# SPECIFICATION: POST / Message Alias and Tool Aliases in mcpx Gateway

## 1. Objective & Context
Improve Developer Experience (DX) for Claude Code, Cursor, and custom agent integrations:
1. Allow `POST /` to handle JSON-RPC MCP calls identically to `POST /message`.
2. Register canonical aliases for tools so agents using shorthand names (such as `inspect_ast`) succeed seamlessly.
3. Preserve existing `GET /` content negotiation (HTML dashboard for browsers, JSON health check for API/curl).

---

## 2. Architectural Invariants & Changes

### 2.1 Request Router in `src/index.ts`
- If `request.method === "POST"` and `(url.pathname === "/" || url.pathname === "/message" || url.pathname === "/mcp/messages" || url.pathname === "/api/generate")`:
  - Route directly to the MCP JSON-RPC message handler.
- If `request.method === "GET"` and `url.pathname === "/"`:
  - Continue serving Midnight Gourmet HTML dashboard for browser `Accept: text/html` requests.
  - Continue serving JSON health data for API/curl requests.

### 2.2 Tool Aliases in `src/tools/domainTools.ts` & `src/index.ts`
- Register `TOOL_ALIASES`:
  - `inspect_ast` -> `analyze_jev_semantic_ast`
- `resolveCanonicalToolName(name: string): string` resolves incoming alias names to canonical tool names before validation, pricing, and execution.
- Pricing for `inspect_ast` is identical to `analyze_jev_semantic_ast` ($0.01 / 1 credit).

---

## 3. Verification Criteria
1. `npm run typecheck` passes with 0 errors.
2. `npm test` passes with 100% PASS across all existing test suites and new alias tests.
3. Live curl test against `https://mcpx.harrykrauze.com/`:
   ```bash
   curl -X POST https://mcpx.harrykrauze.com/ \
     -H "Authorization: Bearer <KEY>" \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"inspect_ast","arguments":{"code":"const x = 1;"}}}'
   ```
   Must return HTTP 200 with result verdict and debit 1 cent.
