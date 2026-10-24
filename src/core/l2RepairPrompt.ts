export function buildL2RepairPrompt(params: {
  sourceCode: string;
  diagnostics: Array<{
    code: string;
    line: number;
    column: number;
    message: string;
    snippet: string;
  }>;
  schemaErrors?: string[];
}): { systemInstruction: string; userPrompt: string } {
  const systemInstruction = [
    "You are a principal TypeScript and Model Context Protocol (MCP) architect.",
    "Your task is to perform semantic and structural refactoring on damaged MCP tool code.",
    "Strict rules:",
    "1. Ensure every tool returns a valid CallToolResult: { content: [{ type: 'text', text: string }], isError?: boolean }.",
    "2. The tool inputSchema must strictly comply with Zod or JSON Schema specifications with valid properties and types.",
    "3. Correctly handle asynchronous operations (async/await), destructuring, and API response payload types.",
    "4. Retain the original tool name and core business objective.",
    "5. Return ONLY the complete corrected TypeScript code without explanations and without markdown wrappers."
  ].join(" ");

  const errorBlocks: string[] = [];

  if (params.schemaErrors && params.schemaErrors.length > 0) {
    errorBlocks.push(`[MCP Schema Validation Errors]:\n${params.schemaErrors.map(e => `- ${e}`).join("\n")}`);
  }

  if (params.diagnostics && params.diagnostics.length > 0) {
    const tsErrors = params.diagnostics
      .map(d => `[Line ${d.line}:${d.column}] ${d.code}: ${d.message}\nContext:\n${d.snippet}`)
      .join("\n\n");
    errorBlocks.push(`[TypeScript Compiler Diagnostics]:\n${tsErrors}`);
  }

  const userPrompt = [
    "The code contains the following structural or schema defects:",
    errorBlocks.join("\n\n"),
    "",
    "Original code:",
    "```typescript",
    params.sourceCode,
    "```",
    "",
    "Perform the required structural reconstruction and return the full valid TypeScript code."
  ].join("\n");

  return { systemInstruction, userPrompt };
}
