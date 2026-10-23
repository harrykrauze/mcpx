# Agentic Harness Protocol (AHP) — mcpx Project Operational Framework

Šis dokuments definē sešu fāžu vārtu (Gates 1–6) procedūru, deterministiskos ierobežojumus un kvalitātes standartus projekta `mcpx` uzturēšanai un attīstībai Google Antigravity vidē.

---

## AHP Pamatprincipi (Core Axioms)

1. **No Vibe Coding:** Aizliegts veikt jebkādas koda izmaiņas, pirms nav izstrādāta, verificēta un apstiprināta `/spec`. Katrai koda rindai jābūt pamatotai ar konkrētu specifikācijas prasību.
2. **No Head Math:** Visi skaitļošanas, adrešu masku aprēķinu, tokenu skew un veiktspējas mērījumi tiek deleģēti deterministiskiem Python/Node.js/CLI skriptiem, nevis LLM iekšējām aplēsēm.
3. **Konteksta Higiēna:** Noslēpumi (`.env`, privātās atslēgas, JWT noslēpumi) un lokālie keši nekad netiek iekļauti Git indeksā vai nodoti neizolētās perifērijās.
4. **Stingras Tīkla Robežas (Network Boundary Enforcement):** Visi ārējie pieprasījumi tiek pakļauti stingrai SSRF aizsardzībai (RFC 1918, link-local, loopback bloķēšana), origin lock un pāradresāciju kontrolei.

---

## Sešu Fāžu Vārtu Sistēma (Six Phase Gates)

### GATE 1: `/spec` (Specifikācijas un Risku Analīze)
- **Mērķis:** Izstrādāt detalizētu tehnisko specifikāciju pirms koda skāruma.
- **Prasības:**
  - Risku un apdraudējumu modelēšana (threat modeling).
  - Precīzi datu tipi, shēmas (Zod / JSON Schema / Pydantic) un interfeisi.
  - Kļūdu apstrādes un drošības protokoli (SSRF filtri, OAuth 2.1 RFC, rate-limit).
- **Verifikācijas Vārti:** Izpilde tiek APTURĒTA pirms koda labojumiem līdz cilvēka (operatora) apstiprinājumam.

### GATE 2: `/build` (Atomāra Implementācija)
- **Mērķis:** Veikt precīzas, minimālas un atomāras izmaiņas koda bāzē saskaņā ar apstiprināto `/spec`.
- **Prasības:**
  - Stingra tipu drošība (TypeScript `strict: true`, bez `any` nepamatotas lietošanas).
  - Nulles tolerances politika pret nepārbaudītiem ārējiem datiem.
- **Verifikācijas Vārti:** `npx tsc --noEmit` jāatgriež precīzi 0 kļūdu (Exit code 0).

### GATE 3: `/test` (Deterministiska Verifikācija)
- **Mērķis:** Pārbaudīt uzvedības atbilstību un robežgadījumus ar automatizētiem testu skriptiem.
- **Prasības:**
  - Negatīvie testi: neautorizēti pieprasījumi (401), privāto/metadatu IP bloķēšana (SSRF).
  - Pozitīvie testi: autorizēta plūsma, tokenu apmaiņa, atļautie HTTPS izsaukumi.
  - Ātruma ierobežošana (Rate Limiting) un `Retry-After` galvenes.
- **Verifikācijas Vārti:** Visiem automatizētajiem testiem jāizpildās ar 100% sekmību (`Exit code 0`).

### GATE 4: `/audit` (Drošības un Atbilstības Audits)
- **Mērķis:** Novērtēt koda bāzi pret zināmajām ievainojamībām un nozares standartiem.
- **Prasības:**
  - Pārskatīt atklāto ievainojamību matricu (`AUDIT_MCPX_REPORT.md`).
  - Pārbaudīt P1 (kritiskās) un P2 (augstās) ievainojamības, atzīmējot remediācijas statusu kā `RESOLVED`.
  - RFC atbilstības audits: OAuth 2.1 (RFC 6749bis), RFC 8414, RFC 9728, RFC 7517.
  - **Credential Pinning & Origin Isolation:** Aizliegts nosūtīt slepenās galvenes (`Authorization`, `x-api-key`) uz ārējiem URL, ja mērķa adrese nesakrīt ar iepriekš apstiprināto `ALLOWED_ORIGIN`. HTTP pāradresāciju (301/302) gadījumā slepenās galvenes obligāti jānoņem (credential stripping) vai pāradresācijas jāatslēdz.
- **Verifikācijas Vārti:** `AUDIT_MCPX_REPORT.md` satur pilnu pārbaudes žurnālu un apstiprinājumu.

### GATE 5: `/ship` (Izvietošanas Sagatavošana un Edge Vārteja)
- **Mērķis:** Sagatavot un verificēt izvietošanas konfigurāciju un infrastruktūru.
- **Prasības:**
  - `wrangler.jsonc` konfigurācijas verifikācija (Cloudflare Workers, KV piesaistes, Rate Limiter).
  - Mašīnlasāmo specifikāciju pieejamība (`/llms.txt`, Schema.org metadati, discovery galapunkti).
  - Testa simulācija vai sausā izvietošana (`npx wrangler deploy --dry-run`).
  - **CDN Header Normalization:** Verificējot SSE straumēšanu aiz Cloudflare Edge vai līdzīgiem reversajiem starpniekiem, par bāzes kritēriju izmantot `Content-Type: text/event-stream` un `Cache-Control: no-cache, no-transform`. Neuzskatīt par kļūdu to, ka CDN noņem iekšējās hop-by-hop galvenes (piem., `X-Accel-Buffering`).
- **Verifikācijas Vārti:** Sausās izvietošanas simulācijas un produkcijas dūmu testu sekmīgs iznākums (`DEPLOY_GATE5_REPORT.md`).

### GATE 6: `/dream` (Post-Execution Konsolidācija un Aģenta Atmiņa)
- **Mērķis:** Konsolidēt iegūtās atziņas un sagatavot sistēmu nākamajiem attīstības posmiem.
- **Prasības:**
  - Atziņu un arhitektūras lēmumu dokumentēšana (`SPEC_GATE6_CREEM_WEBHOOK.md`).
  - Backlog atjaunošana (P3/P4 zema riska uzlabojumi).
  - Aģenta noteikumu un shēmu atjaunināšana.
  - **USD Centu Standarts:** Bilances, debeti, kredīti un tarifi tiek glabāti un rēķināti TIKAI veselos USD centos (`integer cents`: `balanceCents`, `totalSpentCents`, kur 1 kredīts = 1 cents = $0.01 USD). Decimāldaļas, peldošā komata skaitļi (`float`) un matemātiskā noapaļošana runtime vidē ir kategoriski aizliegta; visi finanšu reģistri ir strikti veseli skaitļi.
  - **Finanšu Vienību Terminoloģija:** Stingrs aizliegums bilanci saistīt ar LLM žetoniem ("tokens") vai atmiņas apjomu. Vienīgā vienība ir naudas kredīti / USD centi ($).
  - **Ladder of Trust Likums:** `tools/list`, `initialize`, `/llms.txt`, `/health` un citi atklāšanas pieprasījumi vienmēr ir bezmaksas (`costCents: 0`, $0.00).
  - **x402 / L402 Pārtveršana:** Pie `balanceCents < toolCost` pieprasījums OBLIGĀTI jāpārtver ar `HTTP 402 Payment Required`, pievienojot galveni `WWW-Authenticate: L402 invoice="..."` un precīzu trūkstošo summu USD centos.
  - **Brīdinājuma Slieksnis:** Ja bilance pēc debeta ir `< 10` centi ($0.10), atbildē obligāti tiek iekļauta galvene `X-MCPX-Low-Balance: true`.
  - **Creem.io Webhook Vārteja:** Deterministiska, tipdroša webhook vārteja ar HMAC SHA-256 Web Crypto paraksta verifikāciju un 7 dienu KV idempotences garantiju (`webhook:processed:${id}`).
  - **Asinhronās Telemetrijas Standarts:** Visai telemetrijas reģistrēšanai obligāti jāizmanto `ctx.waitUntil(...)` bez bloķējošas ietekmes uz klienta atbildes laiku (<0.1 ms overhead).
  - **Graceful Degradation:** Telemetrijas nepieejamība (`env.ANALYTICS === undefined` vai kvotu pārtēriņš) nekad nedrīkst izsaukt 500 kļūdu klienta pieprasījumam. Visas kļūdas tiek klusi pārtvertas (`try/catch`).
  - **Stingra Datu Punktu Shēma (Analytics Engine Contract):** Fiksēt `blob1-5` (tenantId, method, toolName, status, clientType) un `double1-3` (executionTimeMs, statusCode, payloadSizeBytes vai costCents) un `index1` (tenantId) kā bāzes standartu visiem turpmākajiem malas servisiem.
