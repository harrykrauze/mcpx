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

// Comprehensive list of hazardous patterns and identifiers (Static AST & Lexical Gate)
const BANNED_PATTERNS: BannedPatternRule[] = [
  // 1. Prototype pollution and constructor escape
  {
    pattern: /\b__proto__\b/,
    rule: "PROTOTYPE_POLLUTION",
    severity: "CRITICAL",
    message: "Prototype pollution or access to '__proto__' is prohibited."
  },
  {
    pattern: /\bconstructor\s*\.\s*constructor\b/,
    rule: "CONSTRUCTOR_ESCAPE",
    severity: "CRITICAL",
    message: "Constructor function escape (constructor.constructor) is prohibited."
  },
  {
    pattern: /\bObject\s*\.\s*(defineProperty|setPrototypeOf|freeze|preventExtensions)\b/,
    rule: "OBJECT_MUTATION",
    severity: "CRITICAL",
    message: "Global object modification via Object methods (defineProperty/setPrototypeOf) is prohibited."
  },

  // 2. Dynamic code compilation
  {
    pattern: /\beval\s*\(/,
    rule: "DYNAMIC_EVAL_PROHIBITED",
    severity: "CRITICAL",
    message: "Dynamic eval() execution is strictly prohibited."
  },
  {
    pattern: /\bFunction\s*\(/,
    rule: "FUNCTION_CONSTRUCTOR_PROHIBITED",
    severity: "CRITICAL",
    message: "Dynamic Function() constructor creation is prohibited."
  },
  {
    pattern: /\b(AsyncFunction|GeneratorFunction)\b/,
    rule: "ASYNC_CONSTRUCTOR_PROHIBITED",
    severity: "CRITICAL",
    message: "Dynamic AsyncFunction/GeneratorFunction constructor usage is prohibited."
  },

  // 3. Environment and system modules
  {
    pattern: /\bprocess(\.|\b)/,
    rule: "PROCESS_ACCESS_PROHIBITED",
    severity: "CRITICAL",
    message: "Access to 'process' and environment variables is denied."
  },
  {
    pattern: /\bchild_process\b/,
    rule: "CHILD_PROCESS_PROHIBITED",
    severity: "CRITICAL",
    message: "Access to child processes (child_process) is denied."
  },
  {
    pattern: /\bcluster\b/,
    rule: "CLUSTER_PROHIBITED",
    severity: "CRITICAL",
    message: "Access to cluster module (cluster) is denied."
  },
  {
    pattern: /\brequire\s*\(/,
    rule: "REQUIRE_PROHIBITED",
    severity: "CRITICAL",
    message: "Module loading via require() is prohibited in sandbox."
  },
  {
    pattern: /\bimport\s*\(/,
    rule: "DYNAMIC_IMPORT_PROHIBITED",
    severity: "CRITICAL",
    message: "Dynamic module loading via import() is prohibited."
  },
  {
    pattern: /\b(__dirname|__filename)\b/,
    rule: "FS_PATHS_PROHIBITED",
    severity: "HIGH",
    message: "Access to filesystem paths (__dirname, __filename) is prohibited."
  },

  // 4. Network APIs and modules (SSRF Protection)
  {
    pattern: /\bfetch\s*\(/,
    rule: "NETWORK_FETCH_PROHIBITED",
    severity: "CRITICAL",
    message: "SSRF Protection: Network access or outbound requests via 'fetch' are denied (security_violation)."
  },
  {
    pattern: /\b(XMLHttpRequest|WebSocket)\b/,
    rule: "NETWORK_SOCKET_PROHIBITED",
    severity: "CRITICAL",
    message: "SSRF Protection: Direct socket/network connections (XMLHttpRequest, WebSocket) are denied."
  },
  {
    pattern: /\b(http|https|net|tls|dgram)\b\s*\./,
    rule: "NETWORK_MODULE_PROHIBITED",
    severity: "CRITICAL",
    message: "SSRF Protection: Direct network library access (http/https/net/tls) is prohibited."
  },
  {
    pattern: /\bfs\b\s*\./,
    rule: "FS_MODULE_PROHIBITED",
    severity: "CRITICAL",
    message: "Destructive filesystem modifications and fs access are prohibited."
  }
];

// Injection patterns in input parameters
const PARAM_INJECTION_PATTERNS = [
  /(\b(exec|spawn|fork)\b\s*\()/i,
  /(;\s*(rm|cat|kill|shutdown|reboot)\b)/i,
  /(\.\.\/|\.\.\\)/, // Directory traversal
  /(<script[\s\S]*?>[\s\S]*?<\/script>)/i
];

export class TypeSafeJevFilter {
  /**
   * Inspects generated tool code semantic safety before registration or execution.
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
   * Inspects tool runtime input arguments against injection payloads.
   */
  public static inspectInput(params: Record<string, unknown>): JevFilterResult {
    const violations: JevViolation[] = [];
    const serialized = JSON.stringify(params);

    for (const pattern of PARAM_INJECTION_PATTERNS) {
      if (pattern.test(serialized)) {
        violations.push({
          rule: "MALICIOUS_INPUT_PATTERN",
          severity: "HIGH",
          message: `Parameters contain suspicious injection pattern: ${pattern.toString()}`
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
