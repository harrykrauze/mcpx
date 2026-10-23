# SPEC_CURRENCY_MIGRATION_USD: mcpx Valūtas Modeļa un Saskarnes Migrācija uz USD ($)

## Statuss: APPROVED (AHP GATE 1)
## Mērķis: Cloudflare Edge Workers, Creem.io Webhooks & Browser Dashboard (`https://mcpx.harrykrauze.com/`)

---

## 1. Mērķis un Arhitektūras Nemainīgie Lielumi (Invariants)

`mcpx` migrē savu bāzes norēķinu valūtu no EUR (€) uz USD ($), lai pilnībā atbilstu globālajiem B2B SaaS, AI izstrādātāju un aģentu rīku standartiem.

### Saglabātie Arhitektūras Principi:
1. **Nemainīga Atomārā Krātuve:** Cloudflare KV krātuves shēma netiek mainīta. Bilances (`balanceCents`), patēriņš (`totalSpentCents`) un tarifi joprojām tiek glabāti un rēķināti **TIKAI kā veseli centi (`integer cents`)**, kur 1 cents = $0.01 USD.
2. **Nulles Peldošā Komata Politika:** Runtime kodā joprojām kategoriski aizliegts izmantot decimāldaļas / float matemātiku bilances aprēķinos.
3. **Atpakaļejošā Savietojamība:** Webhook shēma un API atbalsta gan `'USD'`, gan vēsturisko `'EUR'` valūtu bez datu zuduma.
4. **x402 / L402 Protokols:** Galvenes `X-MCPX-Balance-Cents`, `X-MCPX-Required-Cents` un L402 rēķini atspoguļo summas USD centos.

---

## 2. Detalizētas Izmaiņas Koda Bāzē

### 2.1. Skata Modulis (`src/views/dashboard.ts`)
- **x402 Cenu Matrica:**
  - Free Discovery: `$0.00 (0 c)`
  - Lightweight analysis: `$0.01 (1 credit / 1 c)`
  - Deep syntax parsing & calculations: `$0.02 (2 credits / 2 c)`
  - Edge code generation & sandbox execution: `$0.05 (5 credits / 5 c)`
- **Bilances un Patēriņa Formāts (`checkBalance()`):**
  - Bilance: `'$' + (data.balanceCents / 100).toFixed(2) + ' (' + data.balanceCents.toLocaleString() + ' credits)'`
  - Patēriņš: `'$' + (data.totalSpentCents / 100).toFixed(2) + ' (' + data.totalSpentCents.toLocaleString() + ' credits)'`
- **Top-up Līmeņi ar Creem.io:**
  - $10 (1,000 credits) -> `amount=1000&currency=USD`
  - $25 (2,500 credits) -> `amount=2500&currency=USD`
  - $50 (5,000 credits) -> `amount=5000&currency=USD`

### 2.2. Webhook & Tipu Shēmas (`src/types/creem.ts`, `src/routes/webhooks.ts`)
- `CreemOrderData.currency`: `'USD' | 'EUR'` (noklusējums: `'USD'`)
- `handleCreemWebhook`: Pārbauda `order.currency === 'USD' || order.currency === 'EUR'`.
- `amount` kartējas 1:1 uz `balanceCents` kā vesels skaitlis.

### 2.3. Protokolu un Noteikumu Sinhronizācija
- `AGENT_PROTOCOL.md`, `GEMINI.md`, `.antigravity/rules.md`:
  - Aizstāt visas atsauces uz EUR ar USD ($).
  - Pamatnoteikums: 1 kredīts = $0.01 USD.

### 2.4. Iekšējie Servisi (`src/auth.ts`, `src/index.ts`)
- `BillingDetails.currency`: `'USD' | 'EUR'` (noklusētā jaunajām atslēgām: `'USD'`).
- `POST /keys/verify` atgriež `currency: record.billing?.currency || "USD"`.
- `POST /keys/provision` inicializē `currency: "USD"`.
- `/llms.txt` atspoguļo USD ($) tarifus.
