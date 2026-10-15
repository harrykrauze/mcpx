import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

function invokeMcpTool(serverName, targetLanguage, spec) {
  return new Promise((resolve, reject) => {
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
            server_name: serverName,
            target_language: targetLanguage,
            spec,
          },
        },
      }) + '\n',
    ];

    let buffer = '';

    mcpProcess.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line.trim());
          if (msg.id === 2) {
            mcpProcess.kill();
            resolve(msg);
            return;
          }
        } catch {
          // not JSON line
        }
      }
    });

    mcpProcess.on('error', reject);
    mcpProcess.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        reject(new Error(`MCP process exited with code ${code}`));
      }
    });

    for (const req of requests) {
      mcpProcess.stdin.write(req);
    }
  });
}

async function main() {
  const args = process.argv.slice(2);
  const target = args.find((a) => a.startsWith('--lang='))?.split('=')[1] || 'all';

  const outDir = path.resolve('test-output');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const spec = 'curl -X GET "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd,eur" -H "accept: application/json"';

  if (target === 'typescript' || target === 'all') {
    console.log('\n[E2E] Testing TypeScript generation: crypto-price-mcp...');
    const resTs = await invokeMcpTool('crypto-price-mcp', 'typescript', spec);
    const textTs = resTs.result?.content?.[0]?.text || '';
    const tsMatch = textTs.match(/```typescript\n([\s\S]*?)\n```/);
    if (!tsMatch) {
      throw new Error('Failed to find TypeScript code in MCP response.');
    }
    const outFileTs = path.join(outDir, 'crypto-price-server.ts');
    fs.writeFileSync(outFileTs, tsMatch[1], 'utf8');
    fs.writeFileSync(path.join(outDir, 'response-typescript.md'), textTs, 'utf8');
    console.log(`[E2E] Saved TypeScript server to ${outFileTs} (${tsMatch[1].length} bytes)`);
  }

  if (target === 'python' || target === 'all') {
    console.log('\n[E2E] Testing Python (FastMCP) generation: crypto-price-fastmcp...');
    const resPy = await invokeMcpTool('crypto-price-fastmcp', 'python', spec);
    const textPy = resPy.result?.content?.[0]?.text || '';
    const pyMatch = textPy.match(/```python\n([\s\S]*?)\n```/);
    if (!pyMatch) {
      throw new Error('Failed to find Python code in MCP response.');
    }
    const outFilePy = path.join(outDir, 'crypto_price_server.py');
    fs.writeFileSync(outFilePy, pyMatch[1], 'utf8');
    fs.writeFileSync(path.join(outDir, 'response-python.md'), textPy, 'utf8');
    console.log(`[E2E] Saved Python server to ${outFilePy} (${pyMatch[1].length} bytes)`);
  }

  console.log('\n[E2E] Test suite completed successfully!');
}

main().catch((err) => {
  console.error('[E2E Error]', err);
  process.exit(1);
});
