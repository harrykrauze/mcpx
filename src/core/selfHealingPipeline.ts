import { verifyMcpTool, type VerificationResult } from "./verifier.js";
import { routeDiagnostics, type RepairPayload } from "./router.js";
import { executeL1Repair } from "./l1Repairer.js";
import { executeL2Repair } from "./l2Repairer.js";

export interface PipelineExecutionRecord {
  iteration: number;
  tier: RepairPayload["tier"];
  targetModel: string | null;
  diagnosticsCount: number;
}

export interface SelfHealingResult {
  success: boolean;
  code: string;
  totalIterations: number;
  history: PipelineExecutionRecord[];
  errorReport?: {
    reason: string;
    finalDiagnostics?: VerificationResult["diagnostics"];
    schemaErrors?: string[];
  };
}

export async function runSelfHealingPipeline(params: {
  initialCode: string;
  schemaErrors?: string[];
  maxIterations?: number;
  apiKey?: string;
  repairerOverride?: (code: string, payload: RepairPayload) => Promise<string>;
}): Promise<SelfHealingResult> {
  const maxIterations = params.maxIterations ?? 2;
  let currentCode = params.initialCode;
  let currentSchemaErrors = params.schemaErrors;
  const history: PipelineExecutionRecord[] = [];

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    // Step 1: Deterministic compilation and schema verification (Tier 0 Gate)
    const verification = await verifyMcpTool(currentCode);

    // Step 2: Routing and error diagnostics classification
    const routing = routeDiagnostics(verification, currentSchemaErrors);

    history.push({
      iteration,
      tier: routing.tier,
      targetModel: routing.targetModel,
      diagnosticsCount: routing.trimmedDiagnostics.length
    });

    // If code is clean – successful completion
    if (routing.tier === "CLEAN") {
      return {
        success: true,
        code: currentCode,
        totalIterations: iteration,
        history
      };
    }

    // Step 3 & 4: Repair according to designated tier
    try {
      if (params.repairerOverride) {
        currentCode = await params.repairerOverride(currentCode, routing);
      } else if (routing.tier === "L1_FLASH") {
        currentCode = await executeL1Repair(currentCode, routing, params.apiKey);
      } else if (routing.tier === "L2_ARGON") {
        currentCode = await executeL2Repair(currentCode, routing, params.apiKey);
      }
    } catch (repairError: any) {
      return {
        success: false,
        code: currentCode,
        totalIterations: iteration,
        history,
        errorReport: {
          reason: `Error during repair execution (${repairError.message || repairError}). Self-healing halted.`,
          finalDiagnostics: routing.trimmedDiagnostics
        }
      };
    }

    // After first repair, schema errors are re-verified via tsc and updated code
    currentSchemaErrors = undefined;
  }

  // Final verification after reaching maximum iterations
  const finalVerification = await verifyMcpTool(currentCode);
  if (finalVerification.valid) {
    return {
      success: true,
      code: currentCode,
      totalIterations: maxIterations,
      history
    };
  }

  // Step 5: Circuit Breaker trip (graceful failure)
  return {
    success: false,
    code: currentCode,
    totalIterations: maxIterations,
    history,
    errorReport: {
      reason: `Maximum self-healing iteration limit reached (${maxIterations}). Code still contains unresolved type or compiler errors.`,
      finalDiagnostics: finalVerification.diagnostics
    }
  };
}
