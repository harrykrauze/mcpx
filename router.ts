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

// L1 kļūdu deterministiskais saraksts
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
      summary: "Kompilācija un shēmas pārbaude sekmīga.",
      trimmedDiagnostics: []
    };
  }

  // Ja ir shēmas validācijas kļūdas (MCP SDK manifesta defekts) -> uzreiz L2 Argon
  if (schemaErrors && schemaErrors.length > 0) {
    return {
      tier: "L2_ARGON",
      targetModel: "gemini-4-argon",
      thinkingLevel: "medium",
      summary: `MCP rīka manifesta shēmas kļūda: ${schemaErrors.join("; ")}`,
      trimmedDiagnostics: []
    };
  }

  const rawDiagnostics = verification.diagnostics || [];

  // Apgriež kļūdu skaitu: ņem maksimums pirmās 3 būtiskākās kļūdas, lai netērētu tokenus
  const trimmedDiagnostics = rawDiagnostics.slice(0, 3);

  // Pārbauda, vai visas kļūdas ietilpst L1 kategorijā
  const isPureL1 =
    trimmedDiagnostics.length > 0 &&
    trimmedDiagnostics.every(d => L1_ERROR_CODES.has(d.code));

  if (isPureL1) {
    return {
      tier: "L1_FLASH",
      targetModel: "gemini-3.8-flash",
      thinkingLevel: "low",
      summary: `Izolēti sintakses/tipu defekti (${trimmedDiagnostics.map(d => d.code).join(", ")}). Virzīt uz ātru labojumu.`,
      trimmedDiagnostics
    };
  }

  // Ja satur vismaz vienu strukturālu defektu vai kompleksu tipu kļūdu -> L2 Argon
  return {
    tier: "L2_ARGON",
    targetModel: "gemini-4-argon",
    thinkingLevel: "medium",
    summary: `Strukturālas vai semantiskas kļūdas (${trimmedDiagnostics.map(d => d.code).join(", ")}). Nepieciešama dziļāka loģikas rekonstrukcija.`,
    trimmedDiagnostics
  };
}
