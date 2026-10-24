export function buildL1RepairPrompt(params: {
  sourceCode: string;
  diagnostics: Array<{
    code: string;
    line: number;
    column: number;
    message: string;
    snippet: string;
  }>;
}): { systemInstruction: string; userPrompt: string } {
  const systemInstruction = [
    "You are a deterministic TypeScript code repairer.",
    "Your task is to fix only the specific compiler diagnostics (missing imports, simple type mismatches, or syntax errors).",
    "It is strictly forbidden to alter tool logic, rename identifiers, or remove functionality.",
    "Return ONLY the complete corrected TypeScript code without explanations and without markdown wrappers."
  ].join(" ");

  const errorList = params.diagnostics
    .map(d => `[Line ${d.line}:${d.column}] ${d.code}: ${d.message}\nContext:\n${d.snippet}`)
    .join("\n\n");

  const userPrompt = [
    "The code contains the following compiler errors:",
    errorList,
    "",
    "Original code:",
    "```typescript",
    params.sourceCode,
    "```",
    "",
    "Fix the errors and return the full valid TypeScript code."
  ].join("\n");

  return { systemInstruction, userPrompt };
}
