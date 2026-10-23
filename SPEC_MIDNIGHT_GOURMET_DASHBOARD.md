# SPEC_MIDNIGHT_GOURMET_DASHBOARD: mcpx Statusa Lapa, Satura Saskaņošana un Bilances Logrīks

## Statuss: APPROVED (AHP GATE 1)
## Mērķis: Cloudflare Edge Workers & Browser UX (`https://mcpx.harrykrauze.com/`)

---

## 1. Mērķis un Konteksts

Nodrošināt, ka pārlūkprogrammā, atverot `https://mcpx.harrykrauze.com/`, tiek attēlota pašpietiekama, augstas veiktspējas *Midnight Gourmet* statusa un pašapkalpošanās saskarne ar x402 cenu matricu un Creem.io papildināšanas saitēm, vienlaikus saglabājot tīru JSON atbildi MCP aģentiem un API vaicājumiem (`Content Negotiation`).

---

## 2. Arhitektūra un Prasības

### 2.1. Satura Saskaņošana (`Content Negotiation` saknes maršrutā `GET /`)
- Pārbauda pieprasījuma galveni `Accept`.
- Ja `accept.includes("text/html") && !accept.includes("application/json")`:
  - Atgriež `text/html; charset=utf-8` ar Midnight Gourmet HTML/CSS/JS šablonu.
  - Galvene: `Cache-Control: public, max-age=30, s-maxage=60`.
- Ja pieprasījums nāk no cURL, MCP klienta (Claude Code, Cursor) vai pieprasa JSON (`application/json`, `*/*`):
  - Atgriež tīru JSON struktūru ar `Cache-Control: no-store` un CORS galvenēm.
- `GET /health` vienmēr atgriež JSON `healthData`.

### 2.2. Skata Modulis (`src/views/dashboard.ts`)
- Eksportē saskarni `HealthStatus`:
  ```typescript
  export interface HealthStatus {
    status: string;
    domain: string;
    geminiConfigured: boolean;
    authConfigured: boolean;
    kvConfigured: boolean;
    rateLimiterConfigured: boolean;
    analyticsConfigured: boolean;
  }
  ```
- Eksportē funkciju `renderDashboardHtml(health: HealthStatus): string`.
- **Midnight Gourmet vizuālā identitāte:**
  - Obsidian bāze: `#0a0b0e`, `#12151f`, `#1a1f2e`.
  - Kiber-ciāns: `#00f2ff`, `#38bdf8`.
  - Smaragds: `#10b981`.
  - Amber brīdinājums: `#f59e0b`.
  - Statusa indikators: ar animētu spīdumu un precīzu tekstu `"Edge V8 Mesh Active"`.
- **Bilances Pārbaudes Logrīks:**
  - Asinhrona klienta puses funkcija `checkBalance()`.
  - Ievades lauks API atslēgai (`mcpx_live_...`).
  - Veic pieprasījumu uz `POST /keys/verify` ar JSON `{ "key": "..." }`.
  - Attēlo atslēgas ID, bilanci eirocentos un eiro (`€X.XX`), kopējo patēriņu un statusu.
  - Saite uz Creem.io papildināšanu.
- **x402 Cenu Matricas Bloks:**
  - Ladder of Trust: Free discovery (0c).
  - Paid domain tools (1c, 2c, 5c).

### 2.3. Pašapkalpošanās Galapunkts (`POST /keys/verify`)
- Pieņem JSON pamattekstu: `{ "key": "mcpx_live_..." }` vai `{ "keyId": "..." }`.
- Veic lookup Cloudflare KV krātuvē `MCPX_KEYS`.
- Atgriež:
  ```json
  {
    "success": true,
    "keyId": "key_...",
    "tenantId": "...",
    "balanceCents": 100,
    "totalSpentCents": 50,
    "status": "active",
    "plan": "pro",
    "currency": "EUR"
  }
  ```
- Ja atslēga nav atrasta -> `HTTP 404 Not Found`.
- Nodrošina CORS preflight un galvenes vienādas izcelsmes un ārējiem pieprasījumiem.
