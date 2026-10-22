# Antigravity Rules — mcpx Workspace (GEMINI.md)

Šie noteikumi ir saistoši ikvienam autonomajam aģentam un izstrādātājam `mcpx` projektā. Tie nodrošina deterministisku koda kvalitāti, drošību un arhitektūras integritāti saskaņā ar Agentic Harness Protocol (AHP).

---

## 1. No Vibe Coding
- Aizliegts veikt jebkādas koda izmaiņas bez iepriekš izstrādātas un apstiprinātas `/spec`.
- Katram faila labojumam jābūt tieši pamatotam ar apstiprināto specifikāciju.
- Jebkura neparedzēta prasība vai robežgadījums vispirms tiek atrunāts specifikācijā pirms koda modifikācijas.

## 2. No Head Math
- Aprēķinus, bītu nobīdes, IP masku diapazonus, tokenu derīguma termiņus (clock skew) un citus skaitliskus aprēķinus stingri aizliegts veikt "prātā" (LLM iekšējās halucinācijās).
- Visi aprēķini un datu transformācijas jādeleģē deterministiskiem skriptiem (Python, Node.js vai PowerShell CLI) un jānodrošina ar automatizētiem testiem.

## 3. Konteksta Higiēna
- Sensitīvi dati (API atslēgas, JWT noslēpumi, servisa akreditācijas dati) nekad netiek tieši iekodēti (hardcoded) koda failos.
- Visi noslēpumi tiek iegūti no vides mainīgajiem (`process.env.*`, `env.*`).
- Faili `.env`, `.env.local`, `.wrangler/`, `.antigravity/`, `test-output/` un žurnālu faili (`*.log`) nedrīkst tikt pievienoti Git repozitorija indeksam.

## 4. Stingras Tīkla Robežas (Network Boundary Enforcement)
- SSRF Aizsardzība: Stingra protokolu kontrole (atļauts tikai HTTPS; nešifrēts HTTP atļauts TIKAI lokālajai izstrādei uz `localhost` / `127.0.0.1`).
- Privāto IP un Metadatu bloķēšana: RFC 1918 (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16), Link-Local (169.254.169.254), Loopback (127.0.0.0/8, 0.0.0.0/8) un IPv6 (::1, fc00::/7, fe80::/10) tiek noraidīti pirms tīkla pieprasījuma izsūtīšanas.
- Origin Lock & Credential Pinning: Aizliegts nosūtīt slepenās galvenes (`Authorization`, `x-api-key`) uz ārējiem URL, ja mērķa adrese nesakrīt ar iepriekš apstiprināto `ALLOWED_ORIGIN` (`isTrustedOrigin: true`). HTTP pāradresāciju (301/302) gadījumā slepenās galvenes obligāti jānoņem (credential stripping) vai pāradresācijas jāatslēdz (`redirect: 'manual'` / `follow_redirects=False`).
- CDN Header Normalization: Verificējot SSE straumēšanu aiz Cloudflare Edge vai līdzīgiem reversajiem starpniekiem, par bāzes kritēriju izmantot `Content-Type: text/event-stream` un `Cache-Control: no-cache, no-transform`. Neuzskatīt par kļūdu to, ka CDN noņem iekšējās hop-by-hop galvenes (piem., `X-Accel-Buffering`).

## 5. Verifikācija un Vārtu Procedūra
- Pēc katras izmaiņas jāveic termināļa verifikācija:
  - `npx tsc --noEmit` (prasība: 0 tipu kļūdu).
  - Integrācijas un drošības testi (prasība: visi testi sekmīgi).
