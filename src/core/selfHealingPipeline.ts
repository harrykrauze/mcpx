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
    // 1. Solis: Deterministiskā kompilācija un shēmas pārbaude (Tier 0 Gate)
    const verification = await verifyMcpTool(currentCode);

    // 2. Solis: Maršrutēšana un kļūdu klasifikācija
    const routing = routeDiagnostics(verification, currentSchemaErrors);

    history.push({
      iteration,
      tier: routing.tier,
      targetModel: routing.targetModel,
      diagnosticsCount: routing.trimmedDiagnostics.length
    });

    // Ja kods ir tīrs – veiksmīgs noslēgums
    if (routing.tier === "CLEAN") {
      return {
        success: true,
        code: currentCode,
        totalIterations: iteration,
        history
      };
    }

    // 3. & 4. Solis: Labošana atbilstoši slānim
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
          reason: `Kļūda labotāja izpildē (${repairError.message || repairError}). Pašārstēšanās apturēta.`,
          finalDiagnostics: routing.trimmedDiagnostics
        }
      };
    }

    // Pēc pirmā labojuma shēmas kļūdas tiek atkārtoti pārbaudītas ar tsc un kodu
    currentSchemaErrors = undefined;
  }

  // Pēdējā gala pārbaude pēc maksimālo iterāciju sasniegšanas
  const finalVerification = await verifyMcpTool(currentCode);
  if (finalVerification.valid) {
    return {
      success: true,
      code: currentCode,
      totalIterations: maxIterations,
      history
    };
  }

  // 5. Solis: Circuit Breaker nostrāde (atteikums)
  return {
    success: false,
    code: currentCode,
    totalIterations: maxIterations,
    history,
    errorReport: {
      reason: `Sasniegts maksimālais pašārstēšanās iterāciju limits (${maxIterations}). Kods joprojām satur neizlabotas tipu vai kompilācijas kļūdas.`,
      finalDiagnostics: finalVerification.diagnostics
    }
  };
}
