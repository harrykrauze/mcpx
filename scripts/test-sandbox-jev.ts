import { TypeSafeJevFilter } from "../src/core/jevFilter.js";
import { CodeSandbox } from "../src/core/codeSandbox.js";

async function runSecurityTests() {
  console.log("=== STEP 4: EXECUTION SECURITY (TYPESAFE JEV FILTER & SANDBOX) ===\n");

  // -------------------------------------------------------------------------
  // SCENARIO 1: Jev Code Gate (Semantic Code Inspection prior to registration)
  // -------------------------------------------------------------------------
  console.log("1. Testing Jev Code Gate against hazardous system calls...");

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
    console.log(`   [${item.name}] allowed: ${res.allowed}, violations: ${res.violations.map(v => v.rule).join(", ")}`);
    if (res.allowed) {
      throw new Error(`Jev Code Gate failed: Hazardous code '${item.name}' was not blocked!`);
    }
  }

  // Verify that clean code is allowed
  const cleanCode = `
export interface OrderInput { id: string; amount: number; }
export function processOrder(order: OrderInput) {
  return { status: "processed", total: order.amount * 1.21 };
}
`;
  const cleanCheck = TypeSafeJevFilter.inspectCode(cleanCode);
  console.log(`   [Clean code] allowed: ${cleanCheck.allowed}`);
  if (!cleanCheck.allowed) {
    throw new Error("Jev Code Gate failed: Clean code was unexpectedly blocked!");
  }

  // -------------------------------------------------------------------------
  // SCENARIO 2: Jev Input Gate (Parameter Injection Filter prior to execution)
  // -------------------------------------------------------------------------
  console.log("\n2. Testing Jev Input Gate against parameter injections...");

  const maliciousInputs: Array<{ name: string; params: Record<string, unknown> }> = [
    { name: "Bash command chaining (rm -rf)", params: { target: "user_upload.png; rm -rf /" } },
    { name: "Bash invocation (kill)", params: { pid: "1234; kill -9 1" } },
    { name: "Directory traversal (Linux)", params: { filePath: "../../etc/passwd" } },
    { name: "Directory traversal (Windows)", params: { filePath: "..\\..\\windows\\system32" } },
    { name: "XSS Script injection", params: { comment: "<script>alert('pwned')</script>" } }
  ];

  for (const item of maliciousInputs) {
    const res = TypeSafeJevFilter.inspectInput(item.params);
    console.log(`   [${item.name}] allowed: ${res.allowed}, violations: ${res.violations.map(v => v.rule).join(", ")}`);
    if (res.allowed) {
      throw new Error(`Jev Input Gate failed: Injection '${item.name}' was not blocked!`);
    }
  }

  // Verify that normal business parameters are allowed
  const validParams = {
    userId: "usr_9921",
    filter: "active",
    amount: 149.99,
    tags: ["electronics", "gpu", "sale"]
  };
  const validCheck = TypeSafeJevFilter.inspectInput(validParams);
  console.log(`   [Valid parameters] allowed: ${validCheck.allowed}`);
  if (!validCheck.allowed) {
    throw new Error("Jev Input Gate failed: Valid parameters were unexpectedly blocked!");
  }

  // -------------------------------------------------------------------------
  // SCENARIO 3: SSRF Protection in Sandbox Safe Fetch Gateway
  // -------------------------------------------------------------------------
  console.log("\n3. Testing SSRF protection in sandbox (CodeSandbox Safe Fetch)...");

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
      if (err.message.includes("SSRF protection") || err.message.includes("SSRF")) {
        blocked = true;
        console.log(`   [Blocked SSRF target: ${target}] -> ${err.message}`);
      } else {
        throw err;
      }
    }
    if (!blocked) {
      throw new Error(`SSRF protection failed: Request to '${target}' was not blocked!`);
    }
  }

  // -------------------------------------------------------------------------
  // SCENARIO 4: Execution Isolation, eval() blocking, and CPU Timeout
  // -------------------------------------------------------------------------
  console.log("\n4. Testing execution isolation and CPU resource guards...");

  // 4.1. Verify eval() is disabled in V8 context
  const evalAttemptCode = `return eval("2 + 2");`;
  let evalBlocked = false;
  try {
    await CodeSandbox.executeToolHandler(evalAttemptCode, {});
  } catch (err: any) {
    evalBlocked = true;
    console.log(`   [Dynamic eval() blocked at V8 level] -> ${err.message}`);
  }
  if (!evalBlocked) {
    throw new Error("Sandbox failed: eval() was not blocked in V8 context!");
  }

  // 4.2. Verify deterministic termination of infinite loop (Timeout)
  console.log("   Testing infinite loop termination (timeout: 400ms)...");
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
    console.log(`   [Infinite loop terminated within ${elapsed}ms] -> ${err.message || err.code}`);
  }
  if (!timedOut) {
    throw new Error("Sandbox failed: Infinite loop was not terminated by timeout!");
  }

  // -------------------------------------------------------------------------
  // SCENARIO 5: Safe Business Logic Execution in Sandbox
  // -------------------------------------------------------------------------
  console.log("\n5. Testing safe business logic execution in sandbox...");
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
      user: "John Doe",
      items: [
        { name: "Cable", price: 15 },
        { name: "Adapter", price: 45 }
      ]
    },
    { timeoutMs: 1000 }
  )) as { content: Array<{ type: string; text: string }>; isError: boolean };

  console.log("   Safe execution result:", JSON.stringify(validResult, null, 2));

  if (!validResult || validResult.isError || !validResult.content?.[0]?.text) {
    throw new Error("Sandbox failed: Valid code failed to execute as expected!");
  }

  const parsed = JSON.parse(validResult.content[0].text);
  if (parsed.orderTotal !== 60 || parsed.customer !== "John Doe") {
    throw new Error("Sandbox failed: Invalid execution result!");
  }

  console.log("\nAll Step 4 (TypeSafe Jev filter & CodeSandbox) security tests passed successfully!");
}

runSecurityTests().catch(err => {
  console.error("Security test error:", err);
  process.exit(1);
});
