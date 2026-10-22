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
    "Tu esi augstākā līmeņa TypeScript un Model Context Protocol (MCP) arhitekts.",
    "Tavs uzdevums ir veikt semantisku un strukturālu refaktorēšanu bojātam MCP rīka kodam.",
    "Stingri noteikumi:",
    "1. Nodrošini, ka katrs rīks atgriež derīgu CallToolResult: { content: [{ type: 'text', text: string }], isError?: boolean }.",
    "2. Rīka ievades shēmai (inputSchema) obligāti jāatbilst Zod vai JSON Schema specifikācijai ar derīgiem rekvizītiem un tipiem.",
    "3. Pareizi apstrādā asinhronos pieprasījumus (async/await), destrukturēšanu un API atbildes peilouda tipus.",
    "4. Saglabā esošo rīka nosaukumu un primāro biznesa mērķi.",
    "5. Atgriez TIKAI pilnu laboto TypeScript kodu bez paskaidrojumiem un bez markdown ievadiem."
  ].join(" ");

  const errorBlocks: string[] = [];

  if (params.schemaErrors && params.schemaErrors.length > 0) {
    errorBlocks.push(`[MCP Shēmas Validācijas Kļūdas]:\n${params.schemaErrors.map(e => `- ${e}`).join("\n")}`);
  }

  if (params.diagnostics && params.diagnostics.length > 0) {
    const tsErrors = params.diagnostics
      .map(d => `[Rinda ${d.line}:${d.column}] ${d.code}: ${d.message}\nKonteksts:\n${d.snippet}`)
      .join("\n\n");
    errorBlocks.push(`[TypeScript Kompilatora Diagnostika]:\n${tsErrors}`);
  }

  const userPrompt = [
    "Kods satur šādus strukturālus vai shēmas defektus:",
    errorBlocks.join("\n\n"),
    "",
    "Sākotnējais kods:",
    "```typescript",
    params.sourceCode,
    "```",
    "",
    "Veic nepieciešamo strukturālo rekonstrukciju un atdod pilnu derīgu TypeScript kodu."
  ].join("\n");

  return { systemInstruction, userPrompt };
}
