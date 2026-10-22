export interface JevViolation {
  rule: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
  message: string;
}

export interface JevFilterResult {
  allowed: boolean;
  status: "allowed" | "security_violation";
  violations: JevViolation[];
}

interface BannedPatternRule {
  pattern: RegExp;
  rule: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
  message: string;
}

// Visaptverošs bīstamo šablonu un identifikatoru saraksts (Static AST & Lexical Gate)
const BANNED_PATTERNS: BannedPatternRule[] = [
  // 1. Prototipu piesārņošana un konstruktora izbēgšana
  {
    pattern: /\b__proto__\b/,
    rule: "PROTOTYPE_POLLUTION",
    severity: "CRITICAL",
    message: "Aizliegta prototipa piesārņošana vai piekļuve '__proto__'."
  },
  {
    pattern: /\bconstructor\s*\.\s*constructor\b/,
    rule: "CONSTRUCTOR_ESCAPE",
    severity: "CRITICAL",
    message: "Aizliegta konstruktora funkcijas izbēgšana (constructor.constructor)."
  },
  {
    pattern: /\bObject\s*\.\s*(defineProperty|setPrototypeOf|freeze|preventExtensions)\b/,
    rule: "OBJECT_MUTATION",
    severity: "CRITICAL",
    message: "Aizliegta globālo objektu modifikācija caur Object metodēm (defineProperty/setPrototypeOf)."
  },

  // 2. Dinamiskā koda kompilācija
  {
    pattern: /\beval\s*\(/,
    rule: "DYNAMIC_EVAL_PROHIBITED",
    severity: "CRITICAL",
    message: "Dinamiskā eval() izpilde ir stingri aizliegta."
  },
  {
    pattern: /\bFunction\s*\(/,
    rule: "FUNCTION_CONSTRUCTOR_PROHIBITED",
    severity: "CRITICAL",
    message: "Dinamiskā Function() konstruktora izveide ir aizliegta."
  },
  {
    pattern: /\b(AsyncFunction|GeneratorFunction)\b/,
    rule: "ASYNC_CONSTRUCTOR_PROHIBITED",
    severity: "CRITICAL",
    message: "Dinamiskā AsyncFunction konstruktora izmantošana ir aizliegta."
  },

  // 3. Vides un sistēmas bibliotēkas
  {
    pattern: /\bprocess(\.|\b)/,
    rule: "PROCESS_ACCESS_PROHIBITED",
    severity: "CRITICAL",
    message: "Piekļuve 'process' un vides mainīgajiem ir liegta."
  },
  {
    pattern: /\bchild_process\b/,
    rule: "CHILD_PROCESS_PROHIBITED",
    severity: "CRITICAL",
    message: "Piekļuve apakšprocesiem (child_process) ir liegta."
  },
  {
    pattern: /\bcluster\b/,
    rule: "CLUSTER_PROHIBITED",
    severity: "CRITICAL",
    message: "Piekļuve klasteru modulim (cluster) ir liegta."
  },
  {
    pattern: /\brequire\s*\(/,
    rule: "REQUIRE_PROHIBITED",
    severity: "CRITICAL",
    message: "Moduļu ielāde ar require() smilškastē ir aizliegta."
  },
  {
    pattern: /\bimport\s*\(/,
    rule: "DYNAMIC_IMPORT_PROHIBITED",
    severity: "CRITICAL",
    message: "Dinamiskā moduļu ielāde ar import() ir aizliegta."
  },
  {
    pattern: /\b(__dirname|__filename)\b/,
    rule: "FS_PATHS_PROHIBITED",
    severity: "HIGH",
    message: "Piekļuve failu sistēmas ceļiem (__dirname, __filename) ir aizliegta."
  },

  // 4. Tīkla API un moduļi (SSRF Aizsardzība)
  {
    pattern: /\bfetch\s*\(/,
    rule: "NETWORK_FETCH_PROHIBITED",
    severity: "CRITICAL",
    message: "SSRF aizsardzība: Tīkla piekļuve vai pieprasījumi ar 'fetch' ir liegti (security_violation)."
  },
  {
    pattern: /\b(XMLHttpRequest|WebSocket)\b/,
    rule: "NETWORK_SOCKET_PROHIBITED",
    severity: "CRITICAL",
    message: "SSRF aizsardzība: Tīkla savienojumi (XMLHttpRequest, WebSocket) ir liegti."
  },
  {
    pattern: /\b(http|https|net|tls|dgram)\b\s*\./,
    rule: "NETWORK_MODULE_PROHIBITED",
    severity: "CRITICAL",
    message: "SSRF aizsardzība: Tieša tīkla bibliotēku (http/https/net/tls) izmantošana ir aizliegta."
  },
  {
    pattern: /\bfs\b\s*\./,
    rule: "FS_MODULE_PROHIBITED",
    severity: "CRITICAL",
    message: "Destruktīvas failu sistēmas modifikācijas un fs piekļuve nav atļauta."
  }
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
   * Pārbauda ģenerētā rīka koda semantisko drošību pirms reģistrācijas vai izpildes.
   */
  public static inspectCode(sourceCode: string): JevFilterResult {
    const violations: JevViolation[] = [];

    for (const rule of BANNED_PATTERNS) {
      if (rule.pattern.test(sourceCode)) {
        violations.push({
          rule: rule.rule,
          severity: rule.severity,
          message: rule.message
        });
      }
    }

    return {
      allowed: violations.length === 0,
      status: violations.length === 0 ? "allowed" : "security_violation",
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
      status: violations.length === 0 ? "allowed" : "security_violation",
      violations
    };
  }
}
