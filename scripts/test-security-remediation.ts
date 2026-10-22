import express from 'express';
import { Server as HttpServer } from 'http';
import { validateSafeUrl, isPrivateOrBlockedHost } from '../src/core/generator.js';
import { OAuth2SecurityGuard } from '../src/core/oauthGuard.js';
import { RemoteMcpSseGateway } from '../src/core/remoteSseAdapter.js';
import rateLimit from 'express-rate-limit';

async function runSecurityRemediationTests() {
  console.log('=== MCPX DROŠĪBAS REMEDIĀCIJAS TESTI (SPRINT 1) ===\n');

  // -------------------------------------------------------------------------
  // 1. TESTS: SSRF un privāto IP/adrešu bloķēšanas pārbaude
  // -------------------------------------------------------------------------
  console.log('1. Pārbaudām SSRF filtru un privāto apakštīklu bloķēšanu...');

  const blockedTargets = [
    { url: 'http://169.254.169.254/latest/meta-data/', desc: 'Mākoņa metadatu IP (169.254.169.254)' },
    { url: 'https://169.254.169.254/latest/meta-data/', desc: 'HTTPS Mākoņa metadatu IP (169.254.169.254)' },
    { url: 'http://172.16.0.1/admin', desc: 'RFC 1918 privātais tīkls (172.16.0.1)' },
    { url: 'https://172.16.0.1/admin', desc: 'HTTPS RFC 1918 privātais tīkls (172.16.0.1)' },
    { url: 'http://172.31.255.255/internal', desc: 'RFC 1918 privātais tīkls (172.31.255.255)' },
    { url: 'http://10.0.0.1/secrets', desc: 'RFC 1918 privātais tīkls (10.0.0.1)' },
    { url: 'http://192.168.1.1/router', desc: 'RFC 1918 privātais tīkls (192.168.1.1)' },
    { url: 'http://0.0.0.0:8080/', desc: 'Nenoteiktā adrese (0.0.0.0)' },
    { url: 'http://metadata.google.internal/computeMetadata/v1/', desc: 'GCP iekšējais metadatu domēns' },
    { url: 'http://[::1]:3000/', desc: 'IPv6 Loopback ([::1]) bez https' },
    { url: 'https://[fc00::1]/internal', desc: 'IPv6 ULA (fc00::/7)' },
    { url: 'https://[fe80::1]/link-local', desc: 'IPv6 Link-Local (fe80::/10)' },
    { url: 'https://[::ffff:169.254.169.254]/meta', desc: 'IPv4-mapped IPv6 Cloud Metadata' },
    { url: 'https://0x7f000001/admin', desc: 'Hex DWORD loopback (0x7f000001)' },
    { url: 'https://0xa9fea9fe/metadata', desc: 'Hex DWORD link-local (0xa9fea9fe)' },
    { url: 'http://api.external-domain.com/v1', desc: 'Nešifrēts HTTP uz publisku domēnu' },
    { url: 'ftp://api.example.com/file', desc: 'Aizliegts protokols (FTP)' },
  ];

  for (const target of blockedTargets) {
    const res = validateSafeUrl(target.url);
    if (res.valid) {
      throw new Error(`SSRF tests NEIZDEVĀS: Bīstamais URL netika bloķēts: ${target.url} (${target.desc})`);
    }
    console.log(`   [BLOĶĒTS] ${target.desc} -> ${res.error}`);
  }

  // Pārbaudām derīgas un uzticamas adreses
  const validUrl = 'https://api.fintech-shield.internal/v2/risk/evaluate';
  const validCheck = validateSafeUrl(validUrl, 'https://api.fintech-shield.internal');
  if (!validCheck.valid || !validCheck.isTrustedOrigin) {
    throw new Error(`SSRF tests NEIZDEVĀS: Derīgs HTTPS URL tika kļūdaini noraidīts vai origin netika atpazīts!`);
  }
  console.log(`   [ATĻAUTS] Uzticams HTTPS mērķis -> ${validUrl} (isTrustedOrigin: ${validCheck.isTrustedOrigin})`);

  // Pārbaudām uzticamās izcelsmes (origin) nošķiršanu
  const untrustedOriginCheck = validateSafeUrl('https://other-service.com/api', 'https://api.fintech-shield.internal');
  if (!untrustedOriginCheck.valid || untrustedOriginCheck.isTrustedOrigin) {
    throw new Error('SSRF tests NEIZDEVĀS: Sveša izcelsme kļūdaini atzīta par uzticamu!');
  }
  console.log(`   [ATĻAUTS AR IZOLĀCIJU] Ārējs HTTPS mērķis bez atslēgas piesaistes -> isTrustedOrigin: false`);

  // -------------------------------------------------------------------------
  // 2. TESTS: /api/generate autentifikācija un 401 Unauthorized pārbaude
  // -------------------------------------------------------------------------
  console.log('\n2. Pārbaudām /api/generate maršruta aizsardzību un 401 statusu...');

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
    // 2.1. Pieprasījums bez autentifikācijas
    const unauthedRes = await fetch('http://127.0.0.1:4040/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputSnippet: 'curl https://api.example.com' }),
    });

    console.log(`   Neautorizēta pieprasījuma statuss: ${unauthedRes.status}`);
    const wwwAuth = unauthedRes.headers.get('WWW-Authenticate') || '';
    console.log(`   WWW-Authenticate galvene: ${wwwAuth}`);

    if (unauthedRes.status !== 401) {
      throw new Error(`Neautorizētam pieprasījumam jāatgriež 401, bet saņemts ${unauthedRes.status}`);
    }
    if (!wwwAuth.includes('resource_metadata=') || !wwwAuth.includes('.well-known/oauth-protected-resource')) {
      throw new Error(`WWW-Authenticate galvenē trūkst RFC 9728 resource_metadata norādes!`);
    }

    // 2.2. RFC 8414 un RFC 9728 metadatu galapunktu pārbaude
    console.log('\n3. Pārbaudām RFC 8414 un RFC 9728 atklāšanas galapunktus...');

    const authServerMetaRes = await fetch('http://127.0.0.1:4040/.well-known/oauth-authorization-server');
    if (authServerMetaRes.status !== 200) {
      throw new Error(`RFC 8414 galapunkts atgrieza statusu ${authServerMetaRes.status}`);
    }
    const authServerMeta = (await authServerMetaRes.json()) as any;
    if (!authServerMeta.issuer || !authServerMeta.token_endpoint) {
      throw new Error('RFC 8414 atbildē trūkst issuer vai token_endpoint!');
    }
    console.log(`   [OK] RFC 8414 /.well-known/oauth-authorization-server: issuer='${authServerMeta.issuer}'`);

    const protectedResMetaRes = await fetch('http://127.0.0.1:4040/.well-known/oauth-protected-resource');
    if (protectedResMetaRes.status !== 200) {
      throw new Error(`RFC 9728 galapunkts atgrieza statusu ${protectedResMetaRes.status}`);
    }
    const protectedResMeta = (await protectedResMetaRes.json()) as any;
    if (!protectedResMeta.resource || !protectedResMeta.authorization_servers) {
      throw new Error('RFC 9728 atbildē trūkst resource vai authorization_servers!');
    }
    console.log(`   [OK] RFC 9728 /.well-known/oauth-protected-resource: resource='${protectedResMeta.resource}'`);

    // 2.3. Autentificēts pieprasījums ar Scoped API atslēgu
    console.log('\n4. Pārbaudām autorizētu pieprasījumu ar Scoped API atslēgu...');
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

    console.log(`   Autorizēta pieprasījuma statuss: ${authedRes.status}`);
    if (authedRes.status !== 200) {
      const errText = await authedRes.text();
      throw new Error(`Autorizētam pieprasījumam bija jāatgriež 200, bet saņemts ${authedRes.status}: ${errText}`);
    }

    // 2.4. Strikta JWT pārbaude (iss, aud, exp)
    console.log('\n5. Pārbaudām striktu JWT validāciju (iss, aud, exp, clock skew)...');
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
      throw new Error(`Pieprasījums ar derīgu JWT tokenu atgrieza statusu ${jwtAuthedRes.status}`);
    }
    console.log(`   [OK] Derīgs JWT tokens ar iss un aud tika veiksmīgi pieņemts.`);

    console.log('\n=== VISI REMEDIĀCIJAS TESTI VEIKSMĪGI IZTURĒTI! ===\n');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

runSecurityRemediationTests().catch((err) => {
  console.error('\nTesta kļūda:', err);
  process.exit(1);
});
