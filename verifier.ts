import { exec } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const execAsync = promisify(exec);

export interface VerificationResult {
  valid: boolean;
  diagnostics?: Array<{
    code: string;
    line: number;
    column: number;
    message: string;
    snippet: string;
  }>;
}

export async function verifyMcpTool(sourceCode: string): Promise<VerificationResult> {
  const runId = crypto.randomBytes(6).toString("hex");
  const tempDir = path.resolve(`./sandbox/run-${runId}`);
  const targetFile = path.join(tempDir, "generatedTool.ts");

  try {
    await fs.mkdir(tempDir, { recursive: true });
    await fs.writeFile(targetFile, sourceCode, "utf8");

    // Izpilda tsc pārbaudi pret izolēto konfigurāciju
    const tscBin = path.resolve("./node_modules/typescript/bin/tsc");
    await execAsync(`node "${tscBin}" --project tsconfig.sandbox.json --pretty false`, {
      timeout: 15000,
      env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=512" }
    });

    // Ja kompilācija iziet ar kodu 0 - atgriež panākumu
    return { valid: true };
  } catch (error: any) {
    const stdout = error.stdout || "";
    const stderr = error.stderr || "";
    const rawOutput = `${stdout}\n${stderr}`;

    const diagnostics = parseCompilerOutput(rawOutput, sourceCode);
    return {
      valid: false,
      diagnostics
    };
  } finally {
    // Iztīra pagaidu failus
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function parseCompilerOutput(
  rawLog: string, 
  sourceCode: string
): VerificationResult["diagnostics"] {
  const lines = rawLog.split(/\r?\n/);
  const codeLines = sourceCode.split(/\r?\n/);
  const diagnostics: NonNullable<VerificationResult["diagnostics"]> = [];

  // Pārtver TS kļūdas formātā: file.ts(rinda,kolonna): error TSxxxx: ziņa
  const tsRegex = /\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)/;

  for (const line of lines) {
    const match = line.match(tsRegex);
    if (match) {
      const lineNum = parseInt(match[1], 10);
      const colNum = parseInt(match[2], 10);
      const errCode = match[3];
      const errMsg = match[4];

      // Izvelk 3 rindu konteksta logu ap kļūdu
      const startIdx = Math.max(0, lineNum - 2);
      const endIdx = Math.min(codeLines.length, lineNum + 1);
      const snippet = codeLines.slice(startIdx, endIdx).join("\n");

      diagnostics.push({
        code: errCode,
        line: lineNum,
        column: colNum,
        message: errMsg,
        snippet
      });
    }
  }

  return diagnostics;
}
