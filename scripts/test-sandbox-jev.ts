import { TypeSafeJevFilter } from "../src/core/jevFilter.js";
import { CodeSandbox } from "../src/core/codeSandbox.js";

async function runSecurityTests() {
  console.log("=== SOLIS 4: IZPILDES DROŠĪBA (TYPESAFE JEV FILTRS UN SANDBOX) ===\n");

  // -------------------------------------------------------------------------
  // 1. SCENĀRIJS: Jev Code Gate (Koda semantiskā pārbaude pirms reģistrācijas)
  // -------------------------------------------------------------------------
  console.log("1. Pārbaudām Jev Code Gate pret bīstamiem sistēmas izsaukumiem...");

  const maliciousCodes = [
    { name: "child_process", code: 'import { exec } from "child_process"; exec("whoami");' },
    { name: "process.exit", code: 'export function run() { process.exit(1); }' },
    { name: "eval()", code: 'export function run(payload: string) { return eval(payload); }' },
    { name: "Function constructor", code: 'const fn = new Function("return 42;");' },
    { name: "destructive fs", code: 'import fs from "fs"; fs.unlink("/etc/hosts", () => {});' },
    { name: "require('fs')", code: 'const fs = require("fs"); fs.rmdirSync("/tmp");' }
  ];

  for (const item of maliciousCodes) {
    const res = TypeSafeJevFilter.inspectCode(item.code);
    console.log(`   [${item.name}] atļauts: ${res.allowed}, pārkāpumi: ${res.violations.map(v => v.rule).join(", ")}`);
    if (res.allowed) {
      throw new Error(`Jev Code Gate neizdevās: Bīstamais kods '${item.name}' netika nobloķēts!`);
    }
  }

  // Pārbaudām, ka drošs kods tiek atļauts
  const cleanCode = `
export interface OrderInput { id: string; amount: number; }
export function processOrder(order: OrderInput) {
  return { status: "processed", total: order.amount * 1.21 };
}
`;
  const cleanCheck = TypeSafeJevFilter.inspectCode(cleanCode);
  console.log(`   [Drošs kods] atļauts: ${cleanCheck.allowed}`);
  if (!cleanCheck.allowed) {
    throw new Error("Jev Code Gate neizdevās: Drošs kods nepamatoti tika nobloķēts!");
  }

  // -------------------------------------------------------------------------
  // 2. SCENĀRIJS: Jev Input Gate (Parametru injekciju filtrs pirms izpildes)
  // -------------------------------------------------------------------------
  console.log("\n2. Pārbaudām Jev Input Gate pret parametru injekcijām...");

  const maliciousInputs: Array<{ name: string; params: Record<string, unknown> }> = [
    { name: "Bash komandu ķēde (rm -rf)", params: { target: "user_upload.png; rm -rf /" } },
    { name: "Bash izsaukums (kill)", params: { pid: "1234; kill -9 1" } },
    { name: "Directory traversal (Linux)", params: { filePath: "../../etc/passwd" } },
    { name: "Directory traversal (Windows)", params: { filePath: "..\\..\\windows\\system32" } },
    { name: "XSS Script injekcija", params: { comment: "<script>alert('pwned')</script>" } }
  ];

  for (const item of maliciousInputs) {
    const res = TypeSafeJevFilter.inspectInput(item.params);
    console.log(`   [${item.name}] atļauts: ${res.allowed}, pārkāpumi: ${res.violations.map(v => v.rule).join(", ")}`);
    if (res.allowed) {
      throw new Error(`Jev Input Gate neizdevās: Injekcija '${item.name}' netika nobloķēta!`);
    }
  }

  // Pārbaudām, ka normāli biznesa parametri tiek atļauti
  const validParams = {
    userId: "usr_9921",
    filter: "active",
    amount: 149.99,
    tags: ["electronics", "gpu", "sale"]
  };
  const validCheck = TypeSafeJevFilter.inspectInput(validParams);
  console.log(`   [Derīgi parametri] atļauts: ${validCheck.allowed}`);
  if (!validCheck.allowed) {
    throw new Error("Jev Input Gate neizdevās: Derīgi parametri nepamatoti tika nobloķēti!");
  }

  // -------------------------------------------------------------------------
  // 3. SCENĀRIJS: SSRF aizsardzība smilškastes Safe Fetch vārtejā
  // -------------------------------------------------------------------------
  console.log("\n3. Pārbaudām SSRF aizsardzību smilškastē (CodeSandbox Safe Fetch)...");

  const ssrfTargets = [
    "http://localhost:3000/api/health",
    "http://127.0.0.1:8080/internal",
    "http://169.254.169.254/latest/meta-data/",
    "http://192.168.1.1/admin",
    "http://10.0.0.1/secrets"
  ];

  for (const target of ssrfTargets) {
    const ssrfCode = `return await fetch("${target}");`;
    let blocked = false;
    try {
      await CodeSandbox.executeToolHandler(ssrfCode, {});
    } catch (err: any) {
      if (err.message.includes("SSRF aizsardzība")) {
        blocked = true;
        console.log(`   [Bloķēts SSRF mērķis: ${target}] -> ${err.message}`);
      } else {
        throw err;
      }
    }
    if (!blocked) {
      throw new Error(`SSRF aizsardzība neizdevās: Pieprasījums uz '${target}' netika nobloķēts!`);
    }
  }

  // -------------------------------------------------------------------------
  // 4. SCENĀRIJS: Izpildes izolācija, eval() bloķēšana un CPU taimauts
  // -------------------------------------------------------------------------
  console.log("\n4. Pārbaudām izpildes izolāciju un CPU resursu aizsardzību...");

  // 4.1. Pārbaudām, ka eval() ir pilnībā atslēgts V8 kontekstā
  const evalAttemptCode = `return eval("2 + 2");`;
  let evalBlocked = false;
  try {
    await CodeSandbox.executeToolHandler(evalAttemptCode, {});
  } catch (err: any) {
    evalBlocked = true;
    console.log(`   [Dinamisks eval() bloķēts V8 līmenī] -> ${err.message}`);
  }
  if (!evalBlocked) {
    throw new Error("Sandbox neizdevās: eval() netika nobloķēts V8 kontekstā!");
  }

  // 4.2. Pārbaudām bezgalīga cikla deterministisku pārtraukšanu (Timeout)
  console.log("   Pārbaudām bezgalīga cikla pārtraukšanu (timeout: 400ms)...");
  const infiniteLoopCode = `
    let counter = 0;
    while (true) {
      counter++;
    }
  `;
  const startTime = Date.now();
  let timedOut = false;
  try {
    await CodeSandbox.executeToolHandler(infiniteLoopCode, {}, { timeoutMs: 400 });
  } catch (err: any) {
    timedOut = true;
    const elapsed = Date.now() - startTime;
    console.log(`   [Bezgalīgs cikls pārtraukts ${elapsed}ms laikā] -> ${err.message || err.code}`);
  }
  if (!timedOut) {
    throw new Error("Sandbox neizdevās: Bezgalīgs cikls netika laicīgi pārtraukts ar timeout!");
  }

  // -------------------------------------------------------------------------
  // 5. SCENĀRIJS: Droša biznesa loģikas izpilde smilškastē
  // -------------------------------------------------------------------------
  console.log("\n5. Pārbaudām drošas biznesa loģikas izpildi smilškastē...");
  const validExecutionCode = `
    const user = args.user;
    const items = args.items || [];
    const sum = items.reduce((acc, curr) => acc + curr.price, 0);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            customer: user,
            totalItems: items.length,
            orderTotal: sum
          })
        }
      ],
      isError: false
    };
  `;

  const validResult = (await CodeSandbox.executeToolHandler(
    validExecutionCode,
    {
      user: "Juris Kalniņš",
      items: [
        { name: "Kabelis", price: 15 },
        { name: "Adapteris", price: 45 }
      ]
    },
    { timeoutMs: 1000 }
  )) as { content: Array<{ type: string; text: string }>; isError: boolean };

  console.log("   Drošas izpildes rezultāts:", JSON.stringify(validResult, null, 2));

  if (!validResult || validResult.isError || !validResult.content?.[0]?.text) {
    throw new Error("Sandbox neizdevās: Derīgs kods neizpildījās kā paredzēts!");
  }

  const parsed = JSON.parse(validResult.content[0].text);
  if (parsed.orderTotal !== 60 || parsed.customer !== "Juris Kalniņš") {
    throw new Error("Sandbox neizdevās: Nepareizs izpildes rezultāts!");
  }

  console.log("\nVisi Solis 4 (TypeSafe Jev filtrs un CodeSandbox) drošības testi sekmīgi izturēti!");
}

runSecurityTests().catch(err => {
  console.error("Drošības testa kļūda:", err);
  process.exit(1);
});
