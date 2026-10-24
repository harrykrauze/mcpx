import { GoogleGenAI } from "@google/genai";
import { buildL2RepairPrompt } from "./l2RepairPrompt.js";
import type { RepairPayload } from "./router.js";

export async function executeL2Repair(
  sourceCode: string,
  payload: RepairPayload,
  apiKey?: string
): Promise<string> {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("Missing GEMINI_API_KEY environment variable for L2 repairer.");
  }

  const ai = new GoogleGenAI({ apiKey: key });
  const schemaErrors = payload.summary.startsWith("MCP tool manifest schema error:")
    ? [payload.summary.replace("MCP tool manifest schema error: ", "")]
    : undefined;

  const { systemInstruction, userPrompt } = buildL2RepairPrompt({
    sourceCode,
    diagnostics: payload.trimmedDiagnostics,
    schemaErrors
  });

  const response = await ai.models.generateContent({
    model: "gemini-4-argon",
    contents: userPrompt,
    config: {
      systemInstruction,
      temperature: 0.1,
      thinkingConfig: {
        thinkingBudget: 2048 // Moderate thinking budget for structural analysis
      }
    }
  });

  const rawText = response.text || "";
  return sanitizeOutput(rawText);
}

export function sanitizeOutput(raw: string): string {
  let clean = raw.trim();
  if (clean.startsWith("```typescript")) {
    clean = clean.slice("```typescript".length);
  } else if (clean.startsWith("```ts")) {
    clean = clean.slice("```ts".length);
  } else if (clean.startsWith("```")) {
    clean = clean.slice(3);
  }

  if (clean.endsWith("```")) {
    clean = clean.slice(0, -3);
  }

  return clean.trim();
}
