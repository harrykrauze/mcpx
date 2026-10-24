import type { VerificationResult } from "./verifier.js";

export type RepairTier = "L1_FLASH" | "L2_ARGON" | "CLEAN";

export interface RepairPayload {
  tier: RepairTier;
  targetModel: "gemini-3.8-flash" | "gemini-4-argon" | null;
  thinkingLevel: "low" | "medium" | null;
  summary: string;
  trimmedDiagnostics: Array<{
    code: string;
    line: number;
    column: number;
    message: string;
    snippet: string;
  }>;
}

// Deterministic list of L1 error codes
const L1_ERROR_CODES = new Set([
  "TS2304", // Cannot find name
  "TS2307", // Cannot find module
  "TS2322", // Type is not assignable (basic)
  "TS2554", // Expected N arguments, but got M
  "TS1005", // ';' expected
  "TS1109", // Expression expected
  "TS1128"  // Declaration or statement expected
]);

export function routeDiagnostics(
  verification: VerificationResult,
  schemaErrors?: string[]
): RepairPayload {
  if (verification.valid && (!schemaErrors || schemaErrors.length === 0)) {
    return {
      tier: "CLEAN",
      targetModel: null,
      thinkingLevel: null,
      summary: "Compilation and schema verification successful.",
      trimmedDiagnostics: []
    };
  }

  // If schema validation errors exist (MCP SDK manifest defect) -> route directly to L2 Argon
  if (schemaErrors && schemaErrors.length > 0) {
    return {
      tier: "L2_ARGON",
      targetModel: "gemini-4-argon",
      thinkingLevel: "medium",
      summary: `MCP tool manifest schema error: ${schemaErrors.join("; ")}`,
      trimmedDiagnostics: []
    };
  }

  const rawDiagnostics = verification.diagnostics || [];

  // Trim error diagnostics: retain top 3 critical diagnostics to preserve token context
  const trimmedDiagnostics = rawDiagnostics.slice(0, 3);

  // Check if all diagnostics fall under L1 category
  const isPureL1 =
    trimmedDiagnostics.length > 0 &&
    trimmedDiagnostics.every(d => L1_ERROR_CODES.has(d.code));

  if (isPureL1) {
    return {
      tier: "L1_FLASH",
      targetModel: "gemini-3.8-flash",
      thinkingLevel: "low",
      summary: `Isolated syntax/type defects (${trimmedDiagnostics.map(d => d.code).join(", ")}). Routing to fast L1 repair.`,
      trimmedDiagnostics
    };
  }

  // If containing structural defects or complex type mismatches -> route to L2 Argon
  return {
    tier: "L2_ARGON",
    targetModel: "gemini-4-argon",
    thinkingLevel: "medium",
    summary: `Structural or semantic errors (${trimmedDiagnostics.map(d => d.code).join(", ")}). Requires deeper logic reconstruction.`,
    trimmedDiagnostics
  };
}
