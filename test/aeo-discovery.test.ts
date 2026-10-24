import { describe, it, expect, vi } from 'vitest';
import worker, { ExecutionContext } from '../src/index';

describe('mcpx Machine Discovery & AEO Suite', () => {
  const mockEnv = {
    MCPX_KEYS: {
      get: vi.fn(),
      put: vi.fn(),
      list: vi.fn(),
    },
    ANALYTICS: {
      writeDataPoint: vi.fn(),
    },
  };

  it('serves /llms.txt with correct content and headers', async () => {
    const req = new Request('https://mcpx.harrykrauze.com/llms.txt', { method: 'GET' });
    const res = await worker.fetch(req, mockEnv as any, {} as ExecutionContext);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/markdown');
    const body = await res.text();
    expect(body).toContain('# mcpx gateway');
    expect(body).toContain('x402 Pricing Matrix');
    expect(body).toContain('Discovery Free Tier');
  });

  it('serves /llms-full.txt with protocol schemas and x402 error payloads', async () => {
    const req = new Request('https://mcpx.harrykrauze.com/llms-full.txt', { method: 'GET' });
    const res = await worker.fetch(req, mockEnv as any, {} as ExecutionContext);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/markdown');
    const body = await res.text();
    expect(body).toContain('Full Specification & JSON-RPC Protocol');
    expect(body).toContain('HTTP 402 Payment Required');
  });

  it('performs content negotiation on root route when Accept: text/markdown is requested', async () => {
    const req = new Request('https://mcpx.harrykrauze.com/', {
      method: 'GET',
      headers: { 'Accept': 'text/markdown' },
    });
    const res = await worker.fetch(req, mockEnv as any, {} as ExecutionContext);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/markdown');
    const body = await res.text();
    expect(body).toContain('# mcpx gateway');
  });

  it('injects Link discovery headers in HTML responses', async () => {
    const req = new Request('https://mcpx.harrykrauze.com/health', { method: 'GET' });
    const res = await worker.fetch(req, mockEnv as any, {} as ExecutionContext);

    const linkHeader = res.headers.get('Link') || '';
    expect(linkHeader).toContain('rel="llms-txt"');
    expect(res.headers.get('X-MCP-Discovery')).toBe('https://mcpx.harrykrauze.com/mcp/sse');
  });
});
