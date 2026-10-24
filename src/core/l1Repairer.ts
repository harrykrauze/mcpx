import { GoogleGenAI } from "@google/genai";
import { buildL1RepairPrompt } from "./repairPrompt.js";
import type { RepairPayload } from "./router.js";

export async function executeL1Repair(
  sourceCode: string,
  payload: RepairPayload,
  apiKey?: string
): Promise<string> {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("Missing GEMINI_API_KEY environment variable for L1 repairer.");
  }

  const ai = new GoogleGenAI({ apiKey: key });
  const { systemInstruction, userPrompt } = buildL1RepairPrompt({
    sourceCode,
    diagnostics: payload.trimmedDiagnostics
  });

  const response = await ai.models.generateContent({
    model: "gemini-3.8-flash",
    contents: userPrompt,
    config: {
      systemInstruction,
      temperature: 0.1,
      // Minimal thinking budget in Flash mode for deterministic quick repair
      thinkingConfig: {
        thinkingBudget: 0
      }
    }
  });

  const rawText = response.text || "";
  return sanitizeOutput(rawText);
}

export function sanitizeOutput(raw: string): string {
  // Strip code block fences if included by model output
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
