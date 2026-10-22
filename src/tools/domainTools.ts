/**
 * src/tools/domainTools.ts
 * 
 * Deterministiski inženiertehniskie un semantiskās drošības domēna rīki:
 * 1. calculateUValueIso6946: EN ISO 6946 daudzslāņu būvkonstrukciju siltuma caurlaidības un pretestības kalkulators.
 * 2. analyzeJevSemanticAst: Statiskās koda analīzes un injekciju noteikšanas rīks balstīts uz Jev filtru.
 */

import { TypeSafeJevFilter } from "../core/jevFilter";

// ============================================================================
// 1. EN ISO 6946 Būvfizikas Kalkulators
// ============================================================================

export interface LayerInput {
  name: string;
  thickness_m: number;
  lambda_w_mk: number;
}

export interface UValueCalculationInput {
  direction?: "horizontal" | "upwards" | "downwards";
  rsi?: number;
  rse?: number;
  layers: LayerInput[];
}

export interface LayerResistance {
  name: string;
  thickness_m: number;
  lambda_w_mk: number;
  r_value_m2k_w: number;
  percentage: number;
}

export interface UValueCalculationResult {
  standard: "EN ISO 6946";
  direction: "horizontal" | "upwards" | "downwards";
  rsi: number;
  rse: number;
  total_r_m2k_w: number;
  u_value_w_m2k: number;
  layer_resistances: LayerResistance[];
  condensation_risk_warning: boolean;
  notes?: string[];
}

const ISO6946_DEFAULTS = {
  horizontal: { rsi: 0.13, rse: 0.04 },
  upwards: { rsi: 0.10, rse: 0.04 },
  downwards: { rsi: 0.17, rse: 0.04 },
};

export function calculateUValueIso6946(input: UValueCalculationInput): UValueCalculationResult {
  const direction = input.direction || "horizontal";
  const defaults = ISO6946_DEFAULTS[direction] || ISO6946_DEFAULTS.horizontal;

  const rsi = typeof input.rsi === "number" && input.rsi >= 0 ? input.rsi : defaults.rsi;
  const rse = typeof input.rse === "number" && input.rse >= 0 ? input.rse : defaults.rse;

  if (!Array.isArray(input.layers) || input.layers.length === 0) {
    throw new Error("Norobežojošajai konstrukcijai jābūt vismaz vienam slānim ('layers').");
  }

  let sumR = 0;
  const rawLayers: Array<{ name: string; d: number; lambda: number; r: number }> = [];

  for (let i = 0; i < input.layers.length; i++) {
    const l = input.layers[i];
    const d = Number(l.thickness_m);
    const lambda = Number(l.lambda_w_mk);

    if (isNaN(d) || d <= 0) {
      throw new Error(`Slānim #${i + 1} ('${l.name || "unnamed"}') biezumam 'thickness_m' jābūt pozitīvam skaitlim.`);
    }
    if (isNaN(lambda) || lambda <= 0) {
      throw new Error(`Slānim #${i + 1} ('${l.name || "unnamed"}') siltumvadītspējai 'lambda_w_mk' jābūt pozitīvam skaitlim.`);
    }

    const r = d / lambda;
    sumR += r;
    rawLayers.push({
      name: l.name || `Slānis ${i + 1}`,
      d,
      lambda,
      r,
    });
  }

  const rTot = rsi + sumR + rse;
  const uValue = 1 / rTot;

  const layerResistances: LayerResistance[] = rawLayers.map((l) => ({
    name: l.name,
    thickness_m: Math.round(l.d * 1000) / 1000,
    lambda_w_mk: Math.round(l.lambda * 1000) / 1000,
    r_value_m2k_w: Math.round(l.r * 1000) / 1000,
    percentage: Math.round((l.r / rTot) * 1000) / 10,
  }));

  // Kondensācijas riska analīze (Heuristiskā pārbaude pēc būvfizikas principiem):
  // Riska faktors: siltumizolācija izvietota iekšpusē pirms masīvas nesošās konstrukcijas
  let condensationRisk = false;
  const notes: string[] = [];

  // Meklējam galveno siltumizolācijas slāni (lielākā R vērtība)
  let maxRIdx = 0;
  let maxRVal = 0;
  for (let i = 0; i < rawLayers.length; i++) {
    if (rawLayers[i].r > maxRVal) {
      maxRVal = rawLayers[i].r;
      maxRIdx = i;
    }
  }

  // Ja galvenā izolācija veido > 50% no pretestības un atrodas kā pirmais slānis (iekšpusē),
  // bet aiz tās seko biezs masīvs materiāls (d >= 0.1m, lambda >= 0.8), pastāv kondensāta risks
  if (maxRIdx === 0 && rawLayers.length > 1) {
    const nextLayer = rawLayers[1];
    if (nextLayer.d >= 0.1 && nextLayer.lambda >= 0.7) {
      condensationRisk = true;
      notes.push("Brīdinājums: Siltumizolācijas slānis izvietots konstrukcijas iekšpusē pirms masīva nesošā slāņa — augsts iekšējā kondensāta risks pie starpslāņa saskares.");
    }
  }

  return {
    standard: "EN ISO 6946",
    direction,
    rsi: Math.round(rsi * 1000) / 1000,
    rse: Math.round(rse * 1000) / 1000,
    total_r_m2k_w: Math.round(rTot * 1000) / 1000,
    u_value_w_m2k: Math.round(uValue * 1000) / 1000,
    layer_resistances: layerResistances,
    condensation_risk_warning: condensationRisk,
    notes: notes.length > 0 ? notes : undefined,
  };
}

// ============================================================================
// 2. Jev Semantiskais AST Koda Drošības Rīks
// ============================================================================

export interface JevAstInput {
  code: string;
  language?: "typescript" | "javascript" | "python";
  strictness?: "standard" | "paranoid";
}

export interface JevAstResult {
  verdict: "SAFE" | "REJECTED" | "WARNING";
  risk_score: number;
  violations: string[];
  detected_patterns: {
    prototype_manipulation: boolean;
    dynamic_execution: boolean;
    process_or_env_access: boolean;
    network_or_ssrf_attempt: boolean;
  };
  language: string;
  strictness: string;
}

const PARANOID_PATTERNS = [
  { pattern: /\b(setTimeout|setInterval|setImmediate)\b/, rule: "TIMER_DELAY_PROHIBITED", msg: "Taimeru aizture ir bloķēta paranoid režīmā." },
  { pattern: /\bqueueMicrotask\b/, rule: "MICROTASK_PROHIBITED", msg: "queueMicrotask asinhronā manipulācija bloķēta paranoid režīmā." },
  { pattern: /\bwhile\s*\(\s*(true|1)\s*\)/, rule: "INFINITE_LOOP_RISK", msg: "Iespējama bezgalīgā cikla riska konstrukcija while(true)." },
];

export function analyzeJevSemanticAst(input: JevAstInput): JevAstResult {
  const code = typeof input.code === "string" ? input.code : "";
  const language = input.language || "typescript";
  const strictness = input.strictness || "standard";

  if (!code.trim()) {
    return {
      verdict: "SAFE",
      risk_score: 0,
      violations: [],
      detected_patterns: {
        prototype_manipulation: false,
        dynamic_execution: false,
        process_or_env_access: false,
        network_or_ssrf_attempt: false,
      },
      language,
      strictness,
    };
  }

  // 1. Pārbaude ar TypeSafeJevFilter (Bāzes kārtula)
  const jevRes = TypeSafeJevFilter.inspectCode(code);
  const violations: string[] = jevRes.violations.map((v) => `[${v.severity}] ${v.rule}: ${v.message}`);

  // 2. Specifisko šablonu klasifikācija
  const detected = {
    prototype_manipulation: /\b(__proto__|constructor\s*\.\s*constructor|setPrototypeOf|defineProperty)\b/.test(code),
    dynamic_execution: /\b(eval\s*\(|Function\s*\(|AsyncFunction|GeneratorFunction)\b/.test(code),
    process_or_env_access: /\b(process\b|child_process|cluster|os\.)/.test(code),
    network_or_ssrf_attempt: /\b(fetch\s*\(|XMLHttpRequest|WebSocket|http\.|https\.|net\.|tls\.)/.test(code),
  };

  // 3. Paranoid režīma papildu pārbaudes
  if (strictness === "paranoid") {
    for (const p of PARANOID_PATTERNS) {
      if (p.pattern.test(code)) {
        violations.push(`[MEDIUM] ${p.rule}: ${p.msg}`);
      }
    }
  }

  // 4. Deterministisks riska rādītāja aprēķins (0-100)
  let riskScore = 0;
  for (const v of jevRes.violations) {
    if (v.severity === "CRITICAL") riskScore += 45;
    else if (v.severity === "HIGH") riskScore += 25;
    else riskScore += 15;
  }

  if (strictness === "paranoid") {
    for (const p of PARANOID_PATTERNS) {
      if (p.pattern.test(code)) riskScore += 10;
    }
  }

  riskScore = Math.min(100, Math.max(0, riskScore));

  // 5. Sprieduma (Verdict) noteikšana
  let verdict: "SAFE" | "REJECTED" | "WARNING" = "SAFE";
  if (riskScore >= 40 || !jevRes.allowed) {
    verdict = "REJECTED";
  } else if (riskScore > 0 || violations.length > 0) {
    verdict = "WARNING";
  }

  return {
    verdict,
    risk_score: riskScore,
    violations,
    detected_patterns: detected,
    language,
    strictness,
  };
}
