import dotenv from "dotenv";
import { runSelfHealingPipeline } from "../src/core/selfHealingPipeline.js";

dotenv.config();

async function testPipeline() {
  console.log("=== STEP 5: DETERMINISTIC CIRCUIT BREAKER & ORCHESTRATOR TEST ===\n");

  // --- SCENARIO 1: Successful Self-Healing ---
  console.log("--- SCENARIO 1.1: Immediate acceptance of clean code (0 iterations consumed) ---");
  const repairableCode = `export interface ServerConfig {
  port: number;
}

export function initializePort(): ServerConfig {
  const defaultPort: number = 8080;
  return {
    port: defaultPort
  };
}
`;

  const cleanResult = await runSelfHealingPipeline({
    initialCode: repairableCode
  });
  console.log("Clean code result:", JSON.stringify(cleanResult, null, 2));

  if (!cleanResult.success || cleanResult.totalIterations !== 1 || cleanResult.history[0]?.tier !== "CLEAN") {
    throw new Error("Scenario 1.1 failed: Clean code should have succeeded in 1 iteration!");
  }

  console.log("\n--- SCENARIO 1.2: Code with L1 type defect (repair via orchestrator) ---");
  const minorErrorCode = `export interface UserGreeting {
  message: string;
}

export function getGreeting(): UserGreeting {
  const greetingText: string = process.env.APP_GREETING;
  return {
    message: greetingText
  };
}
`;

  const repairResult = await runSelfHealingPipeline({
    initialCode: minorErrorCode,
    maxIterations: 2
  });
  console.log("L1 defect repair result:", JSON.stringify(repairResult, null, 2));

  if (!repairResult.success || repairResult.totalIterations > 2) {
    throw new Error("Scenario 1.2 failed: Self-healing pipeline should have resolved L1 defect!");
  }

  // --- SCENARIO 2: Circuit Breaker Trigger (Bailout) ---
  console.log("\n--- SCENARIO 2: Circuit Breaker trigger on unrepairable code (limit 2) ---");
  const stubbornErrorCode = `export function brokenFunction(): number {
  return "STILL_NOT_A_NUMBER";
}
`;

  // Simulate stubborn defect (repairer returns invalid code)
  const breakerResult = await runSelfHealingPipeline({
    initialCode: stubbornErrorCode,
    maxIterations: 2,
    repairerOverride: async (code) => {
      return code.replace("STILL_NOT_A_NUMBER", "ANOTHER_INVALID_STRING");
    }
  });
  console.log("Circuit Breaker result:", JSON.stringify(breakerResult, null, 2));

  if (breakerResult.success) {
    throw new Error("Scenario 2 failed: Circuit breaker should have aborted and returned success: false!");
  }

  if (breakerResult.totalIterations !== 2) {
    throw new Error(`Scenario 2 failed: Expected totalIterations = 2, received ${breakerResult.totalIterations}`);
  }

  if (!breakerResult.errorReport || !breakerResult.errorReport.reason.includes("Maximum self-healing iteration limit reached (2)")) {
    throw new Error("Scenario 2 failed: Missing correct error message from errorReport!");
  }

  if (!breakerResult.errorReport.finalDiagnostics || breakerResult.errorReport.finalDiagnostics.length === 0) {
    throw new Error("Scenario 2 failed: errorReport missing finalDiagnostics compiler errors!");
  }

  console.log("\n All Step 5 orchestrator and Circuit Breaker tests passed successfully!");
}

testPipeline().catch(err => {
  console.error("Test error:", err);
  process.exit(1);
});
