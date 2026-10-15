import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const mcpProcess = spawn('node', ['dist/mcp-server.js'], {
  stdio: ['pipe', 'pipe', 'inherit'],
});

const requests = [
  JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'e2e-verifier', version: '1.0.0' },
    },
  }) + '\n',
  JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'generate_mcp_server',
      arguments: {
        server_name: 'crypto-price-mcp',
        target_language: 'typescript',
        spec: 'curl -X GET "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd,eur" -H "accept: application/json"',
      },
    },
  }) + '\n',
];

let buffer = '';

mcpProcess.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop(); // keep remainder

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line.trim());
      if (msg.id === 2) {
        console.log('--- RECEIVED TOOL RESPONSE (id: 2) ---');
        const content = msg.result?.content?.[0]?.text;
        if (!content) {
          console.error('No text content in response:', JSON.stringify(msg, null, 2));
          process.exit(1);
        }

        // Extract typescript code block
        const tsMatch = content.match(/```typescript\n([\s\S]*?)\n```/);
        if (!tsMatch) {
          console.error('Could not find typescript code block in markdown response.');
          console.log('Content preview:', content.slice(0, 500));
          process.exit(1);
        }

        const generatedCode = tsMatch[1];
        const outDir = path.resolve('test-output');
        if (!fs.existsSync(outDir)) {
          fs.mkdirSync(outDir, { recursive: true });
        }

        const outFile = path.join(outDir, 'crypto-price-server.ts');
        fs.writeFileSync(outFile, generatedCode, 'utf8');
        console.log(`Successfully saved generated server to ${outFile} (${generatedCode.length} bytes)`);

        // Also save full response markdown for inspection
        fs.writeFileSync(path.join(outDir, 'response.md'), content, 'utf8');

        mcpProcess.kill();
        process.exit(0);
      }
    } catch (err) {
      // Not a full JSON line or non-JSON output
    }
  }
});

for (const req of requests) {
  mcpProcess.stdin.write(req);
}
