import { Worker } from "node:worker_threads";
import { z } from "zod";
import { TypeSafeJevFilter } from "./jevFilter.js";

export const SandboxStatusSchema = z.enum([
  "success",
  "timeout",
  "runtime_error",
  "security_violation",
]);

export type SandboxStatus = z.infer<typeof SandboxStatusSchema>;

export const SandboxInputSchema = z.object({
  code: z
    .string()
    .min(1, "Code cannot be empty.")
    .max(64 * 1024, "Code size must not exceed 64 KB."),
  inputPayload: z
    .record(z.string(), z.unknown())
    .default({})
    .refine(
      (val) => {
        try {
          JSON.parse(JSON.stringify(val));
          return true;
        } catch {
          return false;
        }
      },
      { message: "inputPayload must contain strictly JSON-serializable data." }
    ),
  timeoutMs: z
    .number()
    .int()
    .min(100, "Minimum allowable timeout is 100 ms.")
    .max(5000, "Maximum allowable timeout is 5000 ms.")
    .default(2000),
});

export type SandboxInput = z.infer<typeof SandboxInputSchema>;

export const SandboxResultSchema = z.object({
  status: SandboxStatusSchema,
  result: z.unknown().nullable(),
  executionTimeMs: z.number().nonnegative(),
  errorDetails: z.string().nullable(),
});

export type SandboxResult = z.infer<typeof SandboxResultSchema>;

export interface SandboxExecutionOptions {
  timeoutMs?: number;
  allowedHosts?: string[];
}

/**
 * Sanitizes error messages to prevent leakage of filesystem paths and stack frames.
 */
export function sanitizeError(rawError: string): string {
  if (!rawError || typeof rawError !== "string") {
    return "Unknown error";
  }

  return rawError
    // Strip Windows absolute paths (e.g., C:\Users\... or C:/...)
    .replace(/[a-zA-Z]:[\\/][^:\r\n)]+/g, "[sanitized_path]")
    // Strip Unix/POSIX absolute paths (/home/..., /var/..., /tmp/...)
    .replace(/\/(?:home|var|tmp|usr|etc|opt|Users)[^\s:)]+/g, "[sanitized_path]")
    // Strip stack lines (at ...)
    .replace(/^\s*at\s+.*$/gm, "")
    // Strip internal node: module references
    .replace(/node:internal\/[^\s:)]+/g, "[internal]")
    // Collapse consecutive newlines
    .replace(/\n\s*\n/g, "\n")
    .trim();
}

// V8 memory and execution resource ceilings
export const SANDBOX_RESOURCE_LIMITS = {
  maxOldGenerationSizeMb: 64,
  maxYoungGenerationSizeMb: 16,
  codeRangeSizeMb: 16,
  stackSizeMb: 4,
};

// Inline Worker code providing sterilized environment and run-to-completion execution
const WORKER_BOOTSTRAP_CODE = `
const { parentPort, workerData } = require('node:worker_threads');

// 1. Sterilize dangerous globals in the Worker thread (Defense-in-depth)
try {
  delete globalThis.process;
  delete globalThis.fetch;
  delete globalThis.XMLHttpRequest;
  delete globalThis.WebSocket;
  delete globalThis.Buffer;
} catch (e) {}

// 2. Execute code in isolated async wrapper
(async () => {
  try {
    const fn = new Function('args', '"use strict"; return (async () => {\\n' + workerData.code + '\\n})();');
    // Once function is created, revoke dynamic Function constructor
    globalThis.eval = undefined;
    globalThis.Function = undefined;

    const result = await fn(workerData.args);
    parentPort.postMessage({ type: 'success', result });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    parentPort.postMessage({ type: 'error', error: msg });
  }
})();
`;

export class CodeSandbox {
  public static sanitizeError(rawError: string): string {
    return sanitizeError(rawError);
  }

  /**
   * Executes code in isolated node:worker_threads layer with strict resource ceilings and Jev filter.
   */
  public static async execute(input: SandboxInput): Promise<SandboxResult> {
    const startTime = Date.now();

    // 1. Validate input data with Zod
    const parsedInput = SandboxInputSchema.safeParse(input);
    if (!parsedInput.success) {
      return {
        status: "security_violation",
        result: null,
        executionTimeMs: 0,
        errorDetails: parsedInput.error.issues.map((e: any) => e.message).join("; "),
      };
    }

    const { code, inputPayload, timeoutMs } = parsedInput.data;

    // 2. TypeSafe Jev static AST code inspection
    const jevCheck = TypeSafeJevFilter.inspectCode(code);
    if (!jevCheck.allowed) {
      return {
        status: "security_violation",
        result: null,
        executionTimeMs: 0,
        errorDetails: jevCheck.violations.map((v) => v.message).join("; "),
      };
    }

    // 3. TypeSafe Jev input arguments inspection
    const inputCheck = TypeSafeJevFilter.inspectInput(inputPayload);
    if (!inputCheck.allowed) {
      return {
        status: "security_violation",
        result: null,
        executionTimeMs: 0,
        errorDetails: inputCheck.violations.map((v) => v.message).join("; "),
      };
    }

    // 4. Create Worker thread with V8 resourceLimits
    return new Promise<SandboxResult>((resolve) => {
      let isSettled = false;

      const worker = new Worker(WORKER_BOOTSTRAP_CODE, {
        eval: true,
        workerData: {
          code,
          args: inputPayload,
        },
        resourceLimits: SANDBOX_RESOURCE_LIMITS,
      });

      const settle = async (res: SandboxResult) => {
        if (isSettled) return;
        isSettled = true;
        clearTimeout(timer);
        try {
          await worker.terminate();
        } catch {
          // Ignore terminate error if worker is already stopped
        }
        resolve(res);
      };

      // Timeout watchdog
      const timer = setTimeout(async () => {
        await settle({
          status: "timeout",
          result: null,
          executionTimeMs: Date.now() - startTime,
          errorDetails: `ERR_SCRIPT_EXECUTION_TIMEOUT: Execution time exceeded ${timeoutMs}ms limit.`,
        });
      }, timeoutMs);

      worker.on("message", (msg: { type: "success" | "error"; result?: unknown; error?: string }) => {
        const executionTimeMs = Date.now() - startTime;
        if (msg.type === "success") {
          settle({
            status: "success",
            result: msg.result ?? null,
            executionTimeMs,
            errorDetails: null,
          });
        } else {
          settle({
            status: "runtime_error",
            result: null,
            executionTimeMs,
            errorDetails: sanitizeError(msg.error || "Runtime execution failed"),
          });
        }
      });

      worker.on("error", (err) => {
        settle({
          status: "runtime_error",
          result: null,
          executionTimeMs: Date.now() - startTime,
          errorDetails: sanitizeError(err.message || String(err)),
        });
      });

      worker.on("exit", (code) => {
        if (!isSettled && code !== 0) {
          settle({
            status: "runtime_error",
            result: null,
            executionTimeMs: Date.now() - startTime,
            errorDetails: `Worker exited with abnormal code: ${code}`,
          });
        }
      });
    });
  }

  /**
   * Backwards-compatible execution method for existing tools and integration tests.
   */
  public static async executeToolHandler(
    handlerCode: string,
    args: Record<string, unknown>,
    options: SandboxExecutionOptions = {}
  ): Promise<unknown> {
    const timeoutMs = options.timeoutMs ?? 2000;
    const res = await CodeSandbox.execute({
      code: handlerCode,
      inputPayload: args,
      timeoutMs,
    });

    if (res.status === "security_violation") {
      throw new Error(`Security Violation: ${res.errorDetails}`);
    }
    if (res.status === "timeout") {
      throw new Error(`ERR_SCRIPT_EXECUTION_TIMEOUT: ${res.errorDetails}`);
    }
    if (res.status === "runtime_error") {
      throw new Error(`Runtime Error: ${res.errorDetails}`);
    }

    return res.result;
  }
}
