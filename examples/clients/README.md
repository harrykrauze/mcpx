# mcpx Klientu Integrācija (Claude Code & Cursor)

Šī mape satur deterministiskus konfigurācijas šablonus `mcpx` MCP vārtejas (`https://mcpx.harrykrauze.com`) pieslēgšanai AI izstrādes aģentos — **Claude Code** un **Cursor IDE**.

---

## 1. Claude Code Integrācija

### A variants: Tiešā termināļa komanda (Ieteicams)
Pievienojiet attālināto `mcpx` serveri savai Claude Code sesijai, izmantojot oficiālo CLI komandu:

```bash
claude mcp add --transport sse mcpx https://mcpx.harrykrauze.com/mcp/sse --header "Authorization: Bearer <TAVA_MCPX_API_ATSLĒGA>"
```

### B variants: Konfigurācijas fails (`claude-code.json`)
Iekopējiet faila saturu savā projekta saknes `.mcp.json` vai globālajā `~/.claude.json` konfigurācijā:

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

Pārliecinieties, ka vides mainīgais `MCPX_API_KEY` ir definēts jūsu čaulā (`export MCPX_API_KEY="..."` vai `.env`).

---

## 2. Cursor IDE Integrācija

Cursor atbalsta MCP serverus caur projekta saknes `.cursor/mcp.json` failu vai globālajiem iestatījumiem (*Settings -> Features -> MCP*).

### Konfigurācija: `.cursor/mcp.json`
Izveidojiet failu `.cursor/mcp.json` sava projekta saknē ar šādu saturu:

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

Aizstājiet `YOUR_MCPX_API_KEY` ar savu aktīvo API atslēgu.

---

## 3. API Atslēgas Iegūšana un Pārvaldība

`mcpx` vārteja atbalsta divu līmeņu autentifikāciju:
1. **Master Administratora atslēga:** Izvietota Cloudflare noslēpumos (`MCPX_API_KEY`).
2. **Daudzlietotāju Scoped atslēgas:** Glabātas Cloudflare KV (`MCPX_KEYS`).

### Jaunas Scoped API atslēgas izsniegšana:
Izmantojot Master administratora atslēgu, nosūtiet pieprasījumu uz provisionēšanas galapunktu:

```bash
curl -X POST https://mcpx.harrykrauze.com/keys/provision \
  -H "Authorization: Bearer <MASTER_ADMIN_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"userId": "developer-alice", "plan": "pro"}'
```

Atbildē saņemsiet jaunu aktīvu atslēgu:
```json
{
  "success": true,
  "apiKey": "mcpx_live_...",
  "userId": "developer-alice",
  "plan": "pro",
  "status": "active"
}
```

---

## 4. Savienojuma Verifikācija

Lai deterministiski pārbaudītu, vai klients spēj veiksmīgi veikt SSE rokasspiedienu un izgūt rīku sarakstu (`tools/list`), palaidiet:

```bash
npm run test:client-connection
```
