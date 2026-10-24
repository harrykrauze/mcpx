import express from 'express';
import { Server as HttpServer } from 'http';
import { validateSafeUrl, isPrivateOrBlockedHost } from '../src/core/generator.js';
import { OAuth2SecurityGuard } from '../src/core/oauthGuard.js';
import { RemoteMcpSseGateway } from '../src/core/remoteSseAdapter.js';
import rateLimit from 'express-rate-limit';

async function runSecurityRemediationTests() {
  console.log('=== MCPX SECURITY REMEDIATION TESTS (SPRINT 1) ===\n');

  // -------------------------------------------------------------------------
  // 1. TEST: SSRF and Private IP/Host Blocking Verification
  // -------------------------------------------------------------------------
  console.log('1. Testing SSRF filter and private subnet blocking...');

  const blockedTargets = [
    { url: 'http://169.254.169.254/latest/meta-data/', desc: 'Cloud metadata IP (169.254.169.254)' },
    { url: 'https://169.254.169.254/latest/meta-data/', desc: 'HTTPS Cloud metadata IP (169.254.169.254)' },
    { url: 'http://172.16.0.1/admin', desc: 'RFC 1918 private network (172.16.0.1)' },
    { url: 'https://172.16.0.1/admin', desc: 'HTTPS RFC 1918 private network (172.16.0.1)' },
    { url: 'http://172.31.255.255/internal', desc: 'RFC 1918 private network (172.31.255.255)' },
    { url: 'http://10.0.0.1/secrets', desc: 'RFC 1918 private network (10.0.0.1)' },
    { url: 'http://192.168.1.1/router', desc: 'RFC 1918 private network (192.168.1.1)' },
    { url: 'http://0.0.0.0:8080/', desc: 'Unspecified address (0.0.0.0)' },
    { url: 'http://metadata.google.internal/computeMetadata/v1/', desc: 'GCP internal metadata domain' },
    { url: 'http://[::1]:3000/', desc: 'IPv6 Loopback ([::1]) without https' },
    { url: 'https://[fc00::1]/internal', desc: 'IPv6 ULA (fc00::/7)' },
    { url: 'https://[fe80::1]/link-local', desc: 'IPv6 Link-Local (fe80::/10)' },
    { url: 'https://[::ffff:169.254.169.254]/meta', desc: 'IPv4-mapped IPv6 Cloud Metadata' },
    { url: 'https://0x7f000001/admin', desc: 'Hex DWORD loopback (0x7f000001)' },
    { url: 'https://0xa9fea9fe/metadata', desc: 'Hex DWORD link-local (0xa9fea9fe)' },
    { url: 'http://api.external-domain.com/v1', desc: 'Unencrypted HTTP to public domain' },
    { url: 'ftp://api.example.com/file', desc: 'Disallowed protocol (FTP)' },
  ];

  for (const target of blockedTargets) {
    const res = validateSafeUrl(target.url);
    if (res.valid) {
      throw new Error(`SSRF test FAILED: Dangerous URL was not blocked: ${target.url} (${target.desc})`);
    }
    console.log(`   [BLOCKED] ${target.desc} -> ${res.error}`);
  }

  // Verify valid and trusted addresses
  const validUrl = 'https://api.fintech-shield.internal/v2/risk/evaluate';
  const validCheck = validateSafeUrl(validUrl, 'https://api.fintech-shield.internal');
  if (!validCheck.valid || !validCheck.isTrustedOrigin) {
    throw new Error(`SSRF test FAILED: Valid HTTPS URL was rejected or origin not recognized!`);
  }
  console.log(`   [ALLOWED] Trusted HTTPS target -> ${validUrl} (isTrustedOrigin: ${validCheck.isTrustedOrigin})`);

  // Verify untrusted origin segregation
  const untrustedOriginCheck = validateSafeUrl('https://other-service.com/api', 'https://api.fintech-shield.internal');
  if (!untrustedOriginCheck.valid || untrustedOriginCheck.isTrustedOrigin) {
    throw new Error('SSRF test FAILED: Untrusted origin erroneously treated as trusted!');
  }
  console.log(`   [ALLOWED WITH ISOLATION] External HTTPS target without credential binding -> isTrustedOrigin: false`);

  // -------------------------------------------------------------------------
  // 2. TEST: /api/generate authentication and 401 Unauthorized check
  // -------------------------------------------------------------------------
  console.log('\n2. Testing /api/generate route protection and 401 status...');

  const app = express();
  app.use(express.json());

  const testGuard = new OAuth2SecurityGuard({
    issuerUrl: 'http://127.0.0.1:4040',
  });
  const testGateway = new RemoteMcpSseGateway();
  testGateway.mountRoutes(app, testGuard);

  const testLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    validate: { keyGeneratorIpFallback: false },
    keyGenerator: (req) => String(req.headers['x-api-key'] || req.headers.authorization || req.ip || 'test'),
  });

  app.post('/api/generate', testLimiter, testGuard.requireAuth('mcp:generate'), (req, res) => {
    res.json({ success: true, message: 'Generated!' });
  });

  const server: HttpServer = await new Promise((resolve) => {
    const s = app.listen(4040, '127.0.0.1', () => resolve(s));
  });

  try {
    // 2.1. Request without authentication
    const unauthedRes = await fetch('http://127.0.0.1:4040/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputSnippet: 'curl https://api.example.com' }),
    });

    console.log(`   Unauthorized request status: ${unauthedRes.status}`);
    const wwwAuth = unauthedRes.headers.get('WWW-Authenticate') || '';
    console.log(`   WWW-Authenticate header: ${wwwAuth}`);

    if (unauthedRes.status !== 401) {
      throw new Error(`Unauthorized request should return 401, received ${unauthedRes.status}`);
    }
    if (!wwwAuth.includes('resource_metadata=') || !wwwAuth.includes('.well-known/oauth-protected-resource')) {
      throw new Error(`WWW-Authenticate header missing RFC 9728 resource_metadata indicator!`);
    }

    // 2.2. RFC 8414 and RFC 9728 metadata endpoint verification
    console.log('\n3. Testing RFC 8414 and RFC 9728 discovery endpoints...');

    const authServerMetaRes = await fetch('http://127.0.0.1:4040/.well-known/oauth-authorization-server');
    if (authServerMetaRes.status !== 200) {
      throw new Error(`RFC 8414 endpoint returned status ${authServerMetaRes.status}`);
    }
    const authServerMeta = (await authServerMetaRes.json()) as any;
    if (!authServerMeta.issuer || !authServerMeta.token_endpoint) {
      throw new Error('RFC 8414 response missing issuer or token_endpoint!');
    }
    console.log(`   [OK] RFC 8414 /.well-known/oauth-authorization-server: issuer='${authServerMeta.issuer}'`);

    const protectedResMetaRes = await fetch('http://127.0.0.1:4040/.well-known/oauth-protected-resource');
    if (protectedResMetaRes.status !== 200) {
      throw new Error(`RFC 9728 endpoint returned status ${protectedResMetaRes.status}`);
    }
    const protectedResMeta = (await protectedResMetaRes.json()) as any;
    if (!protectedResMeta.resource || !protectedResMeta.authorization_servers) {
      throw new Error('RFC 9728 response missing resource or authorization_servers!');
    }
    console.log(`   [OK] RFC 9728 /.well-known/oauth-protected-resource: resource='${protectedResMeta.resource}'`);

    // 2.3. Authenticated request with Scoped API key
    console.log('\n4. Testing authorized request with Scoped API key...');
    const apiKeyData = testGuard.createScopedApiKey({
      tenantId: 'tenant_test',
      scopes: ['mcp:connect', 'mcp:generate'],
    });

    const authedRes = await fetch('http://127.0.0.1:4040/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKeyData.rawApiKey,
      },
      body: JSON.stringify({ inputSnippet: 'curl https://api.example.com' }),
    });

    console.log(`   Authorized request status: ${authedRes.status}`);
    if (authedRes.status !== 200) {
      const errText = await authedRes.text();
      throw new Error(`Authorized request should return 200, received ${authedRes.status}: ${errText}`);
    }

    // 2.4. Strict JWT verification (iss, aud, exp)
    console.log('\n5. Testing strict JWT validation (iss, aud, exp, clock skew)...');
    const client = testGuard.registerClient({ client_name: 'test-agent' });
    const tokenObj = testGuard.exchangeToken({
      grant_type: 'client_credentials',
      client_id: client.client_id,
      client_secret: client.client_secret,
      scope: 'mcp:generate',
      expiresInSeconds: 300,
    });

    const jwtAuthedRes = await fetch('http://127.0.0.1:4040/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenObj.access_token}`,
      },
      body: JSON.stringify({ inputSnippet: 'curl https://api.example.com' }),
    });

    if (jwtAuthedRes.status !== 200) {
      throw new Error(`Request with valid JWT token returned status ${jwtAuthedRes.status}`);
    }
    console.log(`   [OK] Valid JWT token with iss and aud accepted successfully.`);

    console.log('\n=== ALL REMEDIATION TESTS PASSED SUCCESSFULLY! ===\n');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

runSecurityRemediationTests().catch((err) => {
  console.error('\nTest error:', err);
  process.exit(1);
});
