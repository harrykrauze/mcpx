# SPEC_SPRINT2_SANDBOX.md: codeSandbox.ts Drošā Izolācijas Arhitektūra

**Projekts:** `mcpx` (Model Context Protocol Gateway & Generation Engine)  
**Fāze:** AHP GATE 1 (/spec) — Sprint 2  
**Mērķa komponents:** `src/core/codeSandbox.ts`  
**Datums:** 2026-10-22  
**Autors:** Antigravity Agentic Security & Architecture Team  
**Statuss:** `PROPOSED / AWAITING ARCHITECT APPROVAL` (Koda izmaiņas nav veiktas)  

---

## 1. Konteksts un Pašreizējā Risinājuma Vājības (Problem Statement)

Sprint 1 auditā ([`AUDIT_MCPX_REPORT.md`](file:///c:/Users/A/Documents/mcpx/AUDIT_MCPX_REPORT.md), punkts `SEC-02`) tika konstatēts:
> *"Esošā `codeSandbox.ts` implementācija balstās uz Node.js iebūvēto `node:vm` moduli. Saskaņā ar oficiālo Node.js drošības dokumentāciju `node:vm` nav drošības barjera (`The node:vm module is not a security mechanism. Do not use it to run untrusted code`)."*

### Galvenie apdraudējumi ar `node:vm`:
1. **Konteksta izbēgšana (Sandbox Escape) caur prototipu ķēdi:**  
   Objekti, kas tiek nodoti kontekstā, saglabā saiti ar galvenā procesa prototipu. Izmantojot konstrukcijas kā `this.constructor.constructor("return process")().mainModule.require("child_process")`, uzbrucējs var piekļūt galvenā procesa failu sistēmai, tīklam un vides mainīgajiem.
2. **Atmiņas un resursu koplietošana (Shared Heap):**  
   `node:vm` izpildās tajā pašā V8 izsaukumu kaudzē (heap) un pavedienā, kurā darbojas galvenā Express lietotne. Liels atmiņas patēriņš vai atmiņas noplūde smilškastē tieši izraisa visa servera avāriju (OOM crash).
3. **Galvenā pavediena bloķēšana (Event Loop Starvation):**  
   Sinhrona bezgalīga cilpa (`while(true) {}`) vai masīvs regulāro izteiksmju ReDoS bloķē galveno notikumu ciklu, liedzot serverim apstrādāt citus ienākošos API pieprasījumus.

---

## 2. Sadaļa A: Izolācijas Dzinēja Izvēle un Datu Plūsma

### 2.1. Arhitektūras Izvērtējums (Architecture Decision Record — ADR)

Tika izvērtētas trīs izolācijas pieejas:

| Kriterijs | 1. `isolated-vm` (C++ V8) | 2. `child_process.fork` | 3. `node:worker_threads` (Izvēlēts) |
|---|---|---|---|
| **Izolācijas līmenis** | Pilnīga V8 Isolate izolācija | Pilnīga OS procesa izolācija | Nodalīts V8 Isolate un pavediens |
| **Atmiņas griesti** | V8 Snapshot ierobežojumi | OS līmeņa cgroups / ulimit | V8 `resourceLimits` iebūvēts atbalsts |
| **Native Atkarības** | Prasa `node-gyp`, Python, C++ | Zero dependencies | **Zero external dependencies (Pure Node)** |
| **Iniciēšanas laiks** | ~2–5 ms | ~30–60 ms (OS process) | **~5–12 ms (In-process thread)** |
| **CPU bloķēšanas riski** | Nav (atsevišķs pavediens) | Nav (atsevišķs process) | **Nav (atsevišķs Event Loop)** |
| **Starpplatformu atbilstība** | Biežas kompilācijas kļūdas Win/Mac/Linux | Atšķirīgi OS signāli un resursu kontrole | **100% deterministisks visās OS (Win/Linux/Mac)** |

### 2.2. Izvēlētā Arhitektūra: `node:worker_threads` ar V8 `resourceLimits`
Tiek izvēlēts `node:worker_threads` modelis, kur katrs rīka izsaukums tiek izpildīts izolētā Worker pavedienā ar stingri ierobežotiem V8 resursiem un sterilizētu globālo tvērumu.

### 2.3. Stateless Run-to-Completion Dzīvescikla Modelis

Katrs rīka izsaukums darbojas kā vienreizējs (ephemeral) izpildes cikls:

```
[Ienākošais Rīka Izsaukums (args, code)]
               │
               ▼
┌──────────────────────────────────────────────┐
│ 1. TypeSafe Jev Static AST Gate              │
│    (Sintaktiskā un leksiskā pārbaude)        │
└──────────────────────┬───────────────────────┘
                       │ (Ja atļauts)
                       ▼
┌──────────────────────────────────────────────┐
│ 2. Worker Thread Inicializācija              │
│    - V8 resourceLimits (Max Heap 64 MB)      │
│    - Global Scope Sterilizācija (No process) │
│    - Data passthrough caur workerData        │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│ 3. Izpilde un Time-to-Live Uzraudzība        │
│    - Hard deadline: AbortController / Timer  │
│    - Izpilde izolētā asinhronā funkcijā     │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│ 4. Rezultāta Saņemšana vai Taimauts          │
│    - parentPort.postMessage(result)          │
│    - worker.terminate() (Piespiedu cleanup)  │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│ 5. Izejas Sanitizācija (Zod Schema)          │
│    - Stack trace noplūžu noņemšana           │
│    - Tipdrošas atbildes atgriešana           │
└──────────────────────────────────────────────┘
```

---

## 3. Sadaļa B: Resursu Griesti un DoS Aizsardzība (Envelopes)

Lai garantētu, ka nekāds lietotāja kods nevar destabilizēt serveri, tiek definētas stingras deterministiskās robežas:

### 3.1. Laika Limits (Execution Timeout)
- **Noklusētais taimauts (`DEFAULT_TIMEOUT_MS`):** `2000 ms` (2 sekundes).
- **Maksimālais pieļaujamais griests (`MAX_TIMEOUT_MS`):** `5000 ms` (5 sekundes).
- **Pārsniegšanas rīcība:**
  - Iestājoties taimautam, galvenais process nekavējoties izsauc `worker.terminate()`.
  - Pavediena OS resursi un V8 atmiņa tiek tūlītēji atbrīvota.
  - Atbilde tiek marķēta ar statusu `'timeout'` un precīzu patērēto laiku `executionTimeMs`.

### 3.2. Atmiņas Limits (V8 Memory Ceiling)
Worker pavediena inicializācijā tiek nodots V8 konfigurācijas objekts `resourceLimits`:
```typescript
export const SANDBOX_RESOURCE_LIMITS = {
  maxOldGenerationSizeMb: 64,  // Maksimālā pastāvīgā kaudzes atmiņa (64 MB)
  maxYoungGenerationSizeMb: 16, // Jaunās paaudzes atmiņa (16 MB)
  codeRangeSizeMb: 16,         // JIT koda apgabals (16 MB)
  stackSizeMb: 4               // Izsaukumu steka dziļums (4 MB)
};
```
- Ja kods pārsniedz 64 MB atmiņas robežu, V8 automātiski ģenerē kļūdu un Worker tiek terminēts ar statusu `'runtime_error'` (`ERR_WORKER_OUT_OF_MEMORY`), neietekmējot galveno serveri.

### 3.3. CPU Noslodzes Kontrole
- Tā kā Worker darbojas atsevišķā OS pavedienā, pat 100% CPU patēriņš Workerī nebloķē Express servera un SSE maršrutētāja galveno Event Loop.
- `while(true) {}` vai dziļas rekursijas gadījumā nostrādā `setTimeout` uzraudzības taimeris, kas nogalina Worker pavedienu.

---

## 4. Sadaļa C: TypeSafe API Līgums un Ieejas/Izejas Shēmas

Visi dati, kas šķērso smilškastes robežu, tiek validēti ar Zod shēmām.

### 4.1. Ieejas Datu Līgums (`SandboxInputSchema`)

```typescript
import { z } from "zod";

export const SandboxInputSchema = z.object({
  /**
   * Izpildāmais TypeScript/JavaScript koda fragments.
   * Ierobežots maksimālais koda garums līdz 64 KB.
   */
  code: z
    .string({ required_error: "Koda fragments ir obligāts." })
    .min(1, "Kods nedrīkst būt tukšs.")
    .max(64 * 1024, "Koda izmērs nedrīkst pārsniegt 64 KB."),

  /**
   * Datu objekts, kas tiek padots kodam kā 'args'.
   * Obligāti jābūt tīriem JSON primitīviem bez funkcijām vai cirkulārām saitēm.
   */
  inputPayload: z
    .record(z.string(), z.unknown())
    .default({})
    .refine(
      (val) => {
        try {
          JSON.parse(JSON.stringify(val));
          return true;
        } catch {
          return false;
        }
      },
      { message: "inputPayload jāsatur tikai stingri JSON-serializējami dati." }
    ),

  /**
   * Izpildes taimauts milisekundēs.
   */
  timeoutMs: z
    .number()
    .int()
    .min(100, "Minimālais pieļaujamais taimauts ir 100 ms.")
    .max(5000, "Maksimālais pieļaujamais taimauts ir 5000 ms.")
    .default(2000),
});

export type SandboxInput = z.infer<typeof SandboxInputSchema>;
```

### 4.2. Izejas Datu Līgums (`SandboxResultSchema`)

```typescript
export const SandboxStatusSchema = z.enum([
  "success",
  "timeout",
  "runtime_error",
  "security_violation",
]);

export type SandboxStatus = z.infer<typeof SandboxStatusSchema>;

export const SandboxResultSchema = z.object({
  status: SandboxStatusSchema,
  result: z.unknown().nullable(),
  executionTimeMs: z.number().nonnegative(),
  errorDetails: z.string().nullable(),
});

export type SandboxResult = z.infer<typeof SandboxResultSchema>;
```

### 4.3. Kļūdu Sanitizācija (Information Disclosure Prevention)
Aizliegts nodot klientam iekšējās sistēmas failu ceļus (`c:\Users\A\...`, `/home/...`) vai iekšējā steka izsaukumus.  
Sanitizācijas algoritms:
1. Regex noņem failu ceļus: `s/([a-zA-Z]:|\/)[^\s:)]+/[sanitized_path]/g`.
2. Noņem iekšējās Node.js worker moduļu atsauces (`node:internal/*`).
3. Atgriež tikai kļūdas ziņojuma pamatbūtību (piemēram: `ReferenceError: x is not defined`).

---

## 5. Sadaļa D: Jev Semantiskais Pirmfiltrs (Static AST Gate)

Pirms jebkura koda nodošanas Worker pavedienam tas tiek pārbaudīts ar statisko analīzi. Ja tiek konstatēts kaut viens neatļauts marķieris, kods tiek noraidīts bez Worker palaišanas ar statusu `security_violation`.

### 5.1. Bloķējamie Identifikatori un Konstrukcijas

```typescript
export const BANNED_PATTERNS = [
  // Dinamiskā koda kompilācija
  /\beval\s*\(/,
  /\bFunction\s*\(/,
  /\bAsyncFunction\b/,
  /\bGeneratorFunction\b/,

  // Sistēmas un vides izsaukumi
  /\bprocess\b/,
  /\bchild_process\b/,
  /\bcluster\b/,
  /\brequire\s*\(/,
  /\bimport\s*\(/,
  /\b__dirname\b/,
  /\b__filename\b/,

  // Prototipu piesārņošana un V8 iekšiene
  /\b__proto__\b/,
  /\bconstructor\s*\.\s*constructor\b/,
  /\bObject\s*\.\s*(defineProperty|freeze|preventExtensions|setPrototypeOf)\b/,

  // Tīkla un I/O pieeja no koda iekšienes (Strict Network Boundary)
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\bhttp\b/,
  /\bhttps\b/,
  /\bnet\b/,
  /\btls\b/,
  /\bdgram\b/,
  /\bfs\b/,
];
```

### 5.2. Worker Globālā Tvēruma Sterilizācija (Defense-in-Depth)
Worker faila (`sandboxWorker.ts`) pašā sākumā pirms koda palaišanas tiek veikta vides sterilizācija:
```typescript
// Noņem atlikušos bīstamos globālos objektus
delete (globalThis as any).process;
delete (globalThis as any).fetch;
delete (globalThis as any).XMLHttpRequest;
delete (globalThis as any).WebSocket;
(globalThis as any).eval = undefined;
(globalThis as any).Function = undefined;
```

---

## 6. Verifikācijas Plāns un Testu Scenāriji (GATE 3 Sagatavošana)

Pēc specifikācijas apstiprināšanas GATE 2/3 fāzēs tiks ieviesti šādi deterministiskie automatizētie testi ([`scripts/test-sandbox-worker.ts`](file:///c:/Users/A/Documents/mcpx/scripts/test-sandbox-worker.ts)):

1. **Test-1: Prototipu izbēgšanas bloķēšana:**
   - Kods: `return ({}).constructor.constructor('return process')().env;`
   - Gaidāmais rezultāts: statuss `security_violation` vai `runtime_error`, `result: null`.
2. **Test-2: Bezgalīgā cikla CPU apturēšana:**
   - Kods: `while(true) {}` ar `timeoutMs: 300`.
   - Gaidāmais rezultāts: statuss `timeout`, `executionTimeMs: ~300-350ms`, galvenā procesa atsaucība saglabāta.
3. **Test-3: Atmiņas limita (OOM) pārsniegšana:**
   - Kods: `const arr = []; while(true) arr.push(new Uint8Array(1024*1024));`
   - Gaidāmais rezultāts: statuss `runtime_error`, kļūdas apstrāde bez galvenā procesa avārijas.
4. **Test-4: Tīkla bloķēšana no koda:**
   - Kods: `return await fetch("https://google.com");`
   - Gaidāmais rezultāts: statuss `security_violation` (Jev filtrs aptur pirms izpildes).
5. **Test-5: Derīgas biznesa loģikas izpilde:**
   - Kods: `return { sum: args.a + args.b, message: "Hello " + args.name };`
   - Gaidāmais rezultāts: statuss `success`, `result: { sum: 42, message: "Hello Antigravity" }`.

---

## 7. Definition of Done (DoD) Sprint 2 Ieviešanai

1. `SPEC_SPRINT2_SANDBOX.md` ir apstiprināts no cilvēka-arhitekta puses.
2. `node:vm` ir pilnībā aizstāts ar `node:worker_threads` + Jev statisko filtru.
3. Visi 5 izolācijas un resursu testi izpildās ar 100% sekmību (`Exit Code: 0`).
4. `npx tsc --noEmit` uzrāda 0 kļūdu.
5. Esošais `CodeSandbox.executeToolHandler` saglabā atpakaļejošu savietojamību esošajiem rīkiem un integrācijas testiem.

---

> **GATE 1 VĀRTI:** Izpilde ir apturēta. Gaidām cilvēka-arhitekta izvērtējumu un apstiprinājumu pirms pārejas uz GATE 2 (/build).
