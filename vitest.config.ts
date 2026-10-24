import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'test/aeo-discovery.test.ts',
      'test/indexnow-and-x402.test.ts',
      'test/ui-gateway-routes.test.ts',
    ],
  },
});
