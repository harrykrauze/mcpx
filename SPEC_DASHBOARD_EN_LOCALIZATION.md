# SPEC_DASHBOARD_EN_LOCALIZATION: mcpx Statusa Lapas Lokalizācija uz Angļu Valodu (EN)

## Statuss: APPROVED (AHP GATE 1)
## Mērķis: Cloudflare Edge Workers & Browser UX (`https://mcpx.harrykrauze.com/`)

---

## 1. Mērķis un Konteksts

Lokalizēt `src/views/dashboard.ts` saturu uz angļu valodu (`lang="en"`), nodrošinot globālajiem izstrādātājiem un aģentu operatoriem viendabīgu angļu valodas saskarni, saglabājot Midnight Gourmet tumšo estētiku, x402 cenu matricu un Creem.io papildināšanas loģiku ar trim cenu līmeņiem (€10 / €25 / €50).

---

## 2. Prasības un Izmaiņas

1. **HTML Dokuments:**
   - Valodas atribūts: `<html lang="en">`
   - Virsraksts: `<title>mcpx | Autonomous Edge MCP Gateway</title>`
   - Statusa birka: `Edge V8 Mesh Active` (saglabāta testu saderībai)
2. **Midnight Gourmet Dizains:**
   - Palete: Obsidian bāze (`--bg: #0a0b0e`, `--card-bg: #12141c`), Kiber-ciāns (`--cyan: #00f2ff`), Smaragds (`--emerald: #10b981`), Rose kļūdām (`--rose: #f43f5e`).
   - Kartītes ar x402 cenu matricu un API atslēgas pārbaudi.
3. **Bilances Pārbaudes un Creem.io Papildināšanas Loģika:**
   - Ievades lauks: `id="api-key"`, poga `id="check-btn"`, kļūdas lauks `id="error-msg"`, rezultātu bloks `id="key-result"`.
   - Asinhrona `checkBalance()` funkcija, kas izsauc `POST /keys/verify`.
   - Dinamiskas Creem.io saites:
     - `topup-10`: 1,000 c (€10.00)
     - `topup-25`: 2,500 c (€25.00)
     - `topup-50`: 5,000 c (€50.00)
   - Tīri URL bez markdown artefaktiem: `https://www.creem.io/payment/prod_mcpx_topup` un `https://harrykrauze.substack.com`.
4. **Verifikācija un Izvietošana:**
   - `npm run typecheck` (0 kļūdu)
   - `npm test` (100% PASS)
   - `npx wrangler deploy`
