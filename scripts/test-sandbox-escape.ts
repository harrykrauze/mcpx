/**
 * scripts/test-sandbox-escape.ts
 * 
 * AHP GATE 3 (/test) — Sprint 2: Smilškastes Ielaušanās un Drošības Pārbaudes
 * 11 stingri uzbrukuma un pozitīvās kontroles testu vektori.
 */

import { CodeSandbox, SandboxResult } from "../src/core/codeSandbox.js";

interface TestReport {
  id: number;
  name: string;
  expectedStatus: string;
  actualStatus: string;
  pass: boolean;
  durationMs: number;
  details?: string;
}

const reports: TestReport[] = [];

async function runVector(
  id: number,
  name: string,
  code: string,
  args: Record<string, unknown>,
  expectedStatus: "success" | "timeout" | "runtime_error" | "security_violation",
  timeoutMs: number = 2000,
  validator?: (res: SandboxResult) => boolean
): Promise<void> {
  const start = Date.now();
  process.stdout.write(`[Test-${id.toString().padStart(2, "0")}] ${name}... `);

  try {
    const res = await CodeSandbox.execute({
      code,
      inputPayload: args,
      timeoutMs,
    });

    const duration = Date.now() - start;
    const statusPass = res.status === expectedStatus;
    const customPass = validator ? validator(res) : true;
    const pass = statusPass && customPass;

    if (pass) {
      console.log(`PASS (${duration}ms) [status: ${res.status}]`);
      if (res.errorDetails) {
        console.log(`          Paziņojums: ${res.errorDetails}`);
      }
    } else {
      console.log(`FAIL (${duration}ms) [gaidīts: ${expectedStatus}, saņemts: ${res.status}]`);
      if (res.errorDetails) {
        console.log(`          Kļūda: ${res.errorDetails}`);
      }
    }

    reports.push({
      id,
      name,
      expectedStatus,
      actualStatus: res.status,
      pass,
      durationMs: duration,
      details: res.errorDetails || (res.result ? JSON.stringify(res.result) : undefined),
    });
  } catch (err: any) {
    const duration = Date.now() - start;
    console.log(`FAIL (Izņēmums: ${err.message})`);
    reports.push({
      id,
      name,
      expectedStatus,
      actualStatus: "exception",
      pass: false,
      durationMs: duration,
      details: err.message,
    });
  }
}

async function runAllTests() {
  console.log("======================================================================");
  console.log("  AHP GATE 3: SPRINT 2 SANDBOX ESCAPE & ISOLATION TEST SUITE");
  console.log("  Dzinējs: node:worker_threads (V8 ResourceLimits: 64 MB Heap)");
  console.log(`  Laiks: ${new Date().toISOString()}`);
  console.log("======================================================================\n");

  // Vektors 1: Prototipu piesārņošana caur __proto__
  await runVector(
    1,
    "Prototipu piesārņošanas bloķēšana (__proto__)",
    `args.__proto__.polluted = true; return Object.prototype.polluted;`,
    {},
    "security_violation"
  );

  // Vektors 2: Konstruktora izbēgšana caur constructor.constructor
  await runVector(
    2,
    "Konstruktora izbēgšanas bloķēšana (constructor.constructor)",
    `return ({}).constructor.constructor("return process")().env;`,
    {},
    "security_violation"
  );

  // Vektors 3: Globālo objektu modifikācija (Object.defineProperty / setPrototypeOf)
  await runVector(
    3,
    "Objektu modifikācijas bloķēšana (Object.defineProperty)",
    `Object.defineProperty(Object.prototype, "hacked", { value: 123 }); return true;`,
    {},
    "security_violation"
  );

  // Vektors 4: Dinamiskā koda izpildes bloķēšana (eval)
  await runVector(
    4,
    "Dinamiskās eval() izpildes bloķēšana",
    `return eval("2 + 2");`,
    {},
    "security_violation"
  );

  // Vektors 5: Dinamiskā funkcijas konstruktora bloķēšana (Function)
  await runVector(
    5,
    "Dinamiskā Function() konstruktora bloķēšana",
    `return Function("return 42")();`,
    {},
    "security_violation"
  );

  // Vektors 6: Sistēmas procesa un vides piekļuves bloķēšana (process)
  await runVector(
    6,
    "Sistēmas procesa (process.env / process.exit) bloķēšana",
    `return process.env.PATH || process.exit(1);`,
    {},
    "security_violation"
  );

  // Vektors 7: Tīkla piekļuves un SSRF bloķēšana (fetch)
  await runVector(
    7,
    "Tīkla un SSRF izsaukumu bloķēšana (fetch)",
    `return await fetch("https://169.254.169.254/latest/meta-data");`,
    {},
    "security_violation"
  );

  // Vektors 8: Bezgalīgā cikla CPU bloķēšanas apturēšana (Timeout 300ms)
  await runVector(
    8,
    "Bezgalīgā cikla CPU apturēšana (while(true) -> timeout 300ms)",
    `let x = 0; while (true) { x++; }`,
    {},
    "timeout",
    300,
    (res) => res.executionTimeMs >= 250
  );

  // Vektors 9: Atmiņas limita (OOM) pārsniegšanas izolēšana (64 MB Heap)
  await runVector(
    9,
    "Atmiņas limita (OOM) izolēšana (V8 maxOldGeneration: 64 MB)",
    `
      const chunks = [];
      while (true) {
        chunks.push(new Array(1024 * 1024).fill("M"));
      }
    `,
    {},
    "runtime_error",
    3000
  );

  // Vektors 10: Informācijas noplūdes novēršana (Sanitizēts kļūdas ziņojums)
  await runVector(
    10,
    "Informācijas noplūdes novēršana (ceļu un steka sanitizācija)",
    `throw new Error("Sistēmas kļūda pie C:\\\\Users\\\\Admin\\\\Documents\\\\secret\\\\keys.ts:45:12");`,
    {},
    "runtime_error",
    2000,
    (res) => {
      const err = res.errorDetails || "";
      const hasNoWindowsPaths = !err.includes("C:\\Users\\") && !err.includes("Admin");
      const hasSanitizedMarker = err.includes("[sanitized_path]") || !err.includes(".ts:");
      return hasNoWindowsPaths && hasSanitizedMarker;
    }
  );

  // Vektors 11: Pozitīvā kontrole (Derīgas biznesa loģikas un datu apstrāde)
  await runVector(
    11,
    "Pozitīvā kontrole (droša aprēķinu loģika un objekta atgriešana)",
    `
      const numbers = args.numbers || [];
      const sum = numbers.reduce((acc, curr) => acc + curr, 0);
      return {
        count: numbers.length,
        sum,
        average: numbers.length > 0 ? sum / numbers.length : 0,
        greeting: "Labdien, " + (args.user || "Viesis") + "!"
      };
    `,
    { numbers: [10, 20, 30, 40], user: "Antigravity" },
    "success",
    2000,
    (res) => {
      const data = res.result as any;
      return (
        data &&
        data.sum === 100 &&
        data.average === 25 &&
        data.greeting === "Labdien, Antigravity!"
      );
    }
  );

  console.log("\n======================================================================");
  console.log("  REZULTĀTU KOPSAVILKUMS:");
  const passed = reports.filter((r) => r.pass).length;
  const failed = reports.filter((r) => !r.pass).length;
  console.log(`  Kopā testu: ${reports.length} | Izturēti: ${passed} | Neveiksmīgi: ${failed}`);
  console.log("======================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error("Neatgriezeniska kļūda testa izpildē:", err);
  process.exit(1);
});
