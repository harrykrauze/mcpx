/**
 * scripts/test-sandbox-escape.ts
 * 
 * AHP GATE 3 (/test) — Sprint 2: Sandbox Escape & Isolation Tests
 * 11 attack and positive control test vectors.
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
        console.log(`          Message: ${res.errorDetails}`);
      }
    } else {
      console.log(`FAIL (${duration}ms) [expected: ${expectedStatus}, received: ${res.status}]`);
      if (res.errorDetails) {
        console.log(`          Error: ${res.errorDetails}`);
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
    console.log(`FAIL (Exception: ${err.message})`);
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
  console.log("  Engine: node:worker_threads (V8 ResourceLimits: 64 MB Heap)");
  console.log(`  Timestamp: ${new Date().toISOString()}`);
  console.log("======================================================================\n");

  // Vector 1: Prototype pollution via __proto__
  await runVector(
    1,
    "Blocking prototype pollution (__proto__)",
    `args.__proto__.polluted = true; return Object.prototype.polluted;`,
    {},
    "security_violation"
  );

  // Vector 2: Constructor escape via constructor.constructor
  await runVector(
    2,
    "Blocking constructor escape (constructor.constructor)",
    `return ({}).constructor.constructor("return process")().env;`,
    {},
    "security_violation"
  );

  // Vector 3: Global object modification (Object.defineProperty / setPrototypeOf)
  await runVector(
    3,
    "Blocking object modification (Object.defineProperty)",
    `Object.defineProperty(Object.prototype, "hacked", { value: 123 }); return true;`,
    {},
    "security_violation"
  );

  // Vector 4: Dynamic code execution blocking (eval)
  await runVector(
    4,
    "Blocking dynamic eval() execution",
    `return eval("2 + 2");`,
    {},
    "security_violation"
  );

  // Vector 5: Dynamic function constructor blocking (Function)
  await runVector(
    5,
    "Blocking dynamic Function() constructor",
    `return Function("return 42")();`,
    {},
    "security_violation"
  );

  // Vector 6: System process and environment access blocking (process)
  await runVector(
    6,
    "Blocking system process access (process.env / process.exit)",
    `return process.env.PATH || process.exit(1);`,
    {},
    "security_violation"
  );

  // Vector 7: Network access and SSRF blocking (fetch)
  await runVector(
    7,
    "Blocking network and SSRF calls (fetch)",
    `return await fetch("https://169.254.169.254/latest/meta-data");`,
    {},
    "security_violation"
  );

  // Vector 8: Infinite loop CPU abort (Timeout 300ms)
  await runVector(
    8,
    "Infinite loop CPU termination (while(true) -> timeout 300ms)",
    `let x = 0; while (true) { x++; }`,
    {},
    "timeout",
    300,
    (res) => res.executionTimeMs >= 250
  );

  // Vector 9: Memory limit (OOM) isolation (64 MB Heap)
  await runVector(
    9,
    "Memory limit (OOM) isolation (V8 maxOldGeneration: 64 MB)",
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

  // Vector 10: Information leak prevention (Sanitized error message)
  await runVector(
    10,
    "Information leak prevention (path and stack sanitization)",
    `throw new Error("System error at C:\\\\Users\\\\Admin\\\\Documents\\\\secret\\\\keys.ts:45:12");`,
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

  // Vector 11: Positive control (Valid business logic and data processing)
  await runVector(
    11,
    "Positive control (safe computational logic and object return)",
    `
      const numbers = args.numbers || [];
      const sum = numbers.reduce((acc, curr) => acc + curr, 0);
      return {
        count: numbers.length,
        sum,
        average: numbers.length > 0 ? sum / numbers.length : 0,
        greeting: "Hello, " + (args.user || "Guest") + "!"
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
        data.greeting === "Hello, Antigravity!"
      );
    }
  );

  console.log("\n======================================================================");
  console.log("  RESULTS SUMMARY:");
  const passed = reports.filter((r) => r.pass).length;
  const failed = reports.filter((r) => !r.pass).length;
  console.log(`  Total tests: ${reports.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log("======================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error("Fatal error during test execution:", err);
  process.exit(1);
});
