import { verifyMcpTool } from '../verifier';
import { validateToolManifest } from '../schemaGuard';

async function runTests() {
  console.log('--- TEST 1: Valid Manifest ---');
  const validManifest = {
    name: 'fetch_weather',
    description: 'Fetches weather forecast for given city',
    inputSchema: {
      type: 'object',
      properties: {
        city: { type: 'string', description: 'City name' }
      },
      required: ['city']
    }
  };
  const manifestRes1 = validateToolManifest(validManifest);
  console.log('Valid manifest result:', manifestRes1);

  console.log('\n--- TEST 2: Invalid Manifest ---');
  const invalidManifest = {
    name: 'invalid tool name with spaces!',
    description: 'too',
    inputSchema: {
      type: 'string'
    }
  };
  const manifestRes2 = validateToolManifest(invalidManifest);
  console.log('Invalid manifest result:', manifestRes2);

  console.log('\n--- TEST 3: Valid TS Code ---');
  const validCode = `
export interface ToolArgs {
  city: string;
}

export function execute(args: ToolArgs): string {
  return \`Weather in \${args.city}\`;
}
`;
  const verifyRes1 = await verifyMcpTool(validCode);
  console.log('Valid TS code result:', verifyRes1);

  console.log('\n--- TEST 4: Invalid TS Code ---');
  const invalidCode = `
export function badFunction(a: number): string {
  return a; // Error: Type 'number' is not assignable to type 'string'.
}
`;
  const verifyRes2 = await verifyMcpTool(invalidCode);
  console.log('Invalid TS code result:\n', JSON.stringify(verifyRes2, null, 2));
}

runTests().catch(console.error);
