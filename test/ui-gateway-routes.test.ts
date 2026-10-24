import { describe, it, expect, vi } from 'vitest';
import worker, { ExecutionContext } from '../src/index';

describe('UI Modernization, Balance Alias & AEO Landing Suite', () => {
  const mockEnv = {
    MCPX_KEYS: {
      get: vi.fn(),
      put: vi.fn(),
      list: vi.fn(),
    },
    ANALYTICS: {
      writeDataPoint: vi.fn(),
    },
    ENVIRONMENT: 'test',
  };

  it('GET /api/v1/balance returns 401 on missing auth header', async () => {
    const req = new Request('https://mcpx.harrykrauze.com/api/v1/balance', {
      method: 'GET',
    });
    const res = await worker.fetch(req, mockEnv as any, {} as ExecutionContext);

    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.error).toContain('Missing or malformed Authorization header');
    expect(body.credits).toBe(0);
  });

  it('GET /api/v1/balance with valid key returns 200 and matches credits === balanceCents', async () => {
    mockEnv.MCPX_KEYS.get.mockResolvedValueOnce(
      JSON.stringify({
        keyId: 'test_key_001',
        tenantId: 'tenant_enterprise',
        balanceCents: 2500,
        status: 'ACTIVE',
      })
    );

    const req = new Request('https://mcpx.harrykrauze.com/api/v1/balance', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer mcpx_live_valid_key_test',
      },
    });
    const res = await worker.fetch(req, mockEnv as any, {} as ExecutionContext);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.keyId).toBe('test_key_001');
    expect(body.tenantId).toBe('tenant_enterprise');
    expect(body.status).toBe('ACTIVE');
    expect(body.credits).toBe(2500);
  });

  it('Root HTML payload contains the @type: SoftwareApplication JSON-LD block and the Creem top-up checkout link', async () => {
    const req = new Request('https://mcpx.harrykrauze.com/', {
      method: 'GET',
      headers: {
        Accept: 'text/html',
      },
    });
    const res = await worker.fetch(req, mockEnv as any, {} as ExecutionContext);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('"@type": "SoftwareApplication"');
    expect(html).toContain('https://checkout.creem.io/p/mcpx-tier1');
  });
});
