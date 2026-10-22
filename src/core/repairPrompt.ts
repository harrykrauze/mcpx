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
    "Tu esi deterministisks TypeScript koda labotājs.",
    "Tavs uzdevums ir novērst tikai konkrētās kompilatora kļūdas (trūkstošs imports, vienkārša tipa neatbilstība vai sintakse).",
    "Stingri aizliegts mainīt rīka loģiku, nosaukumus vai noņemt funkcionalitāti.",
    "Atgriez TIKAI pilnu laboto TypeScript kodu bez paskaidrojumiem un bez markdown ievadiem."
  ].join(" ");

  const errorList = params.diagnostics
    .map(d => `[Rinda ${d.line}:${d.column}] ${d.code}: ${d.message}\nKonteksts:\n${d.snippet}`)
    .join("\n\n");

  const userPrompt = [
    "Kods satur šādas kompilācijas kļūdas:",
    errorList,
    "",
    "Sākotnējais kods:",
    "```typescript",
    params.sourceCode,
    "```",
    "",
    "Izlabo kļūdas un atdod pilnu derīgu TypeScript kodu."
  ].join("\n");

  return { systemInstruction, userPrompt };
}
