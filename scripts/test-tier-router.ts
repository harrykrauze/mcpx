import { routeDiagnostics } from '../router.js';
import type { VerificationResult } from '../verifier.js';

function runRouterTests() {
  console.log('--- TEST 1: CLEAN (No errors) ---');
  const cleanVerif: VerificationResult = { valid: true };
  const res1 = routeDiagnostics(cleanVerif);
  console.log('Result 1:', res1);
  if (res1.tier !== 'CLEAN' || res1.targetModel !== null) {
    throw new Error('Test 1 Failed: Expected CLEAN');
  }

  console.log('\n--- TEST 2: Schema Error -> L2_ARGON ---');
  const schemaErrors = ['inputSchema.properties: Invalid input'];
  const res2 = routeDiagnostics({ valid: true }, schemaErrors);
  console.log('Result 2:', res2);
  if (res2.tier !== 'L2_ARGON' || res2.targetModel !== 'gemini-4-argon' || res2.thinkingLevel !== 'medium') {
    throw new Error('Test 2 Failed: Expected L2_ARGON for schema errors');
  }

  console.log('\n--- TEST 3: Pure L1 Errors -> L1_FLASH ---');
  const l1Verif: VerificationResult = {
    valid: false,
    diagnostics: [
      { code: 'TS2304', line: 12, column: 5, message: "Cannot find name 'fetch'", snippet: 'fetch(url)' },
      { code: 'TS2322', line: 20, column: 3, message: "Type 'number' is not assignable to type 'string'", snippet: 'const x: string = 1;' }
    ]
  };
  const res3 = routeDiagnostics(l1Verif);
  console.log('Result 3:', res3);
  if (res3.tier !== 'L1_FLASH' || res3.targetModel !== 'gemini-3.8-flash' || res3.thinkingLevel !== 'low') {
    throw new Error('Test 3 Failed: Expected L1_FLASH');
  }

  console.log('\n--- TEST 4: Structural / Complex Error -> L2_ARGON ---');
  const l2Verif: VerificationResult = {
    valid: false,
    diagnostics: [
      { code: 'TS2339', line: 45, column: 10, message: "Property 'data' does not exist on type 'Response'", snippet: 'return res.data;' }
    ]
  };
  const res4 = routeDiagnostics(l2Verif);
  console.log('Result 4:', res4);
  if (res4.tier !== 'L2_ARGON' || res4.targetModel !== 'gemini-4-argon' || res4.thinkingLevel !== 'medium') {
    throw new Error('Test 4 Failed: Expected L2_ARGON');
  }

  console.log('\n--- TEST 5: Diagnostics Trimming (Max 3) ---');
  const manyErrorsVerif: VerificationResult = {
    valid: false,
    diagnostics: [
      { code: 'TS2304', line: 1, column: 1, message: 'err1', snippet: 'code1' },
      { code: 'TS2322', line: 2, column: 1, message: 'err2', snippet: 'code2' },
      { code: 'TS2554', line: 3, column: 1, message: 'err3', snippet: 'code3' },
      { code: 'TS1005', line: 4, column: 1, message: 'err4', snippet: 'code4' },
      { code: 'TS1109', line: 5, column: 1, message: 'err5', snippet: 'code5' }
    ]
  };
  const res5 = routeDiagnostics(manyErrorsVerif);
  console.log('Result 5 trimmed count:', res5.trimmedDiagnostics.length);
  if (res5.trimmedDiagnostics.length !== 3) {
    throw new Error('Test 5 Failed: Expected exactly 3 trimmed diagnostics');
  }

  console.log('\nAll router tests passed successfully!');
}

runRouterTests();
