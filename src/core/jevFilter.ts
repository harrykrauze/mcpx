export interface JevViolation {
  rule: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
  message: string;
}

export interface JevFilterResult {
  allowed: boolean;
  violations: JevViolation[];
}

// Bīstamo identifikatoru un izsaukumu saraksts
const PROHIBITED_IDENTIFIERS = [
  "child_process",
  "process.exit",
  "process.kill",
  "process.env",
  "require('fs')",
  "require(\"fs\")",
  "import('fs')",
  "cluster",
  "eval(",
  "Function(",
  "__proto__",
  "constructor.constructor"
];

// Injekciju paraugi ieejas parametros
const PARAM_INJECTION_PATTERNS = [
  /(\b(exec|spawn|fork)\b\s*\()/i,
  /(;\s*(rm|cat|kill|shutdown|reboot)\b)/i,
  /(\.\.\/|\.\.\\)/, // Directory traversal
  /(<script[\s\S]*?>[\s\S]*?<\/script>)/i
];

export class TypeSafeJevFilter {
  /**
   * Pārbauda ģenerētā rīka koda semantisko drošību pirms reģistrācijas.
   */
  public static inspectCode(sourceCode: string): JevFilterResult {
    const violations: JevViolation[] = [];

    for (const token of PROHIBITED_IDENTIFIERS) {
      if (sourceCode.includes(token)) {
        violations.push({
          rule: "PROHIBITED_SYSTEM_ACCESS",
          severity: "CRITICAL",
          message: `Konstatēts aizliegts sistēmas izsaukums vai modulis: '${token}'`
        });
      }
    }

    // Pārbauda failu sistēmas un tīkla neierobežotu piekļuvi
    if (/\bfs\b\.(rm|unlink|writeFileSync|appendFileSync)/.test(sourceCode)) {
      violations.push({
        rule: "DESTRUCTIVE_FS_OPERATION",
        severity: "CRITICAL",
        message: "Destruktīvas failu sistēmas modifikācijas nav atļautas."
      });
    }

    return {
      allowed: violations.length === 0,
      violations
    };
  }

  /**
   * Pārbauda rīkam padotos izpildes parametrus (runtime input) pret injekcijām.
   */
  public static inspectInput(params: Record<string, unknown>): JevFilterResult {
    const violations: JevViolation[] = [];
    const serialized = JSON.stringify(params);

    for (const pattern of PARAM_INJECTION_PATTERNS) {
      if (pattern.test(serialized)) {
        violations.push({
          rule: "MALICIOUS_INPUT_PATTERN",
          severity: "HIGH",
          message: `Parametri satur aizdomīgu injekcijas šablonu: ${pattern.toString()}`
        });
      }
    }

    return {
      allowed: violations.length === 0,
      violations
    };
  }
}
