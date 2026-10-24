import { describe, it, expect, vi } from 'vitest';
import worker, { ExecutionContext } from '../src/index';
import { INDEXNOW_KEY, INDEXNOW_KEY_FILE } from '../src/indexnow';

describe('IndexNow Protocol & x402 Billing Enforcement', () => {
  const mockEnv = {
    MCPX_KEYS: {
      get: vi.fn(),
      put: vi.fn(),
      list: vi.fn(),
    },
    ANALYTICS: {
      writeDataPoint: vi.fn(),
    },
    INDEXNOW_ADMIN_SECRET: 'dev_secret_bypass',
    ENVIRONMENT: 'test',
  };

  it('serves the IndexNow verification key file at /<KEY>.txt', async () => {
    const req = new Request(`https://mcpx.harrykrauze.com/${INDEXNOW_KEY_FILE}`, { method: 'GET' });
    const res = await worker.fetch(req, mockEnv as any, {} as ExecutionContext);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/plain');
    const text = await res.text();
    expect(text.trim()).toBe(INDEXNOW_KEY);
  });

  it('serves the IndexNow verification key file at /indexnow.txt fallback', async () => {
    const req = new Request('https://mcpx.harrykrauze.com/indexnow.txt', { method: 'GET' });
    const res = await worker.fetch(req, mockEnv as any, {} as ExecutionContext);

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.trim()).toBe(INDEXNOW_KEY);
  });

  it('rejects paid tool execution without auth header and returns HTTP 401 or 402', async () => {
    const payload = {
      tool: 'calculate_u_value_iso6946',
      params: {
        layers: [{ name: 'Concrete', thickness_m: 0.2, lambda_w_mk: 1.74 }]
      }
    };

    const req = new Request('https://mcpx.harrykrauze.com/tools/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const res = await worker.fetch(req, mockEnv as any, {} as ExecutionContext);
    expect([401, 402]).toContain(res.status);
    const body = await res.json() as any;
    expect(body.error).toBeDefined();
  });

  it('returns structured HTTP 402 with Creem top-up details when bearer key has 0 credits', async () => {
    mockEnv.MCPX_KEYS.get.mockResolvedValueOnce(
      JSON.stringify({
        keyId: 'test_depleted_key',
        tenantId: 'test_tenant',
        balanceCents: 0,
        status: 'ACTIVE',
      })
    );

    const payload = {
      tool: 'calculate_u_value_iso6946',
      params: {
        layers: [{ name: 'Mineral Wool', thickness_m: 0.1, lambda_w_mk: 0.035 }]
      }
    };

    const req = new Request('https://mcpx.harrykrauze.com/tools/execute', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': 'Bearer mcpx_live_depleted_key_test'
      },
      body: JSON.stringify(payload)
    });

    const res = await worker.fetch(req, mockEnv as any, {} as ExecutionContext);
    expect(res.status).toBe(402);
    expect(res.headers.get('WWW-Authenticate')).toContain('L402');
    const body = await res.json() as any;
    expect(body.error).toBe('INSUFFICIENT_CREDITS');
    expect(body.requiredCents).toBeGreaterThan(0);
  });

  it('handles POST /api/indexnow/submit with admin secret', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response('OK', { status: 200 })
    );

    const req = new Request('https://mcpx.harrykrauze.com/api/indexnow/submit', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer dev_secret_bypass'
      }
    });

    const res = await worker.fetch(req, mockEnv as any, {} as ExecutionContext);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);

    globalThis.fetch = originalFetch;
  });
});
