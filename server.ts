import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import { generateMcpServer } from './src/core/generator.js';
import { OAuth2SecurityGuard } from './src/core/oauthGuard.js';
import { RemoteMcpSseGateway } from './src/core/remoteSseAdapter.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

app.use(express.json({ limit: '10mb' }));

// Remote MCP SSE Gateway & OAuth 2.1 Security Guard (Steps 6 & 7)
export const securityGuard = new OAuth2SecurityGuard({
  issuerUrl: `http://localhost:${PORT}`,
});
export const remoteGateway = new RemoteMcpSseGateway({
  keepAliveIntervalMs: 15000,
});
remoteGateway.mountRoutes(app, securityGuard);

// Rate limiting for code generation (10 requests/min per API key / IP)
export const generatorLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req) => {
    const key = (req.headers['x-api-key'] as string) || req.headers.authorization || req.ip || 'anonymous';
    return String(key);
  },
  handler: (req, res, _next, options) => {
    const retryAfter = Math.ceil(options.windowMs / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({
      error: 'too_many_requests',
      error_description: 'Rate limit exceeded (maximum 10 requests per minute). Please try again later.',
      retryAfter,
    });
  },
});

// API endpoint to generate MCP server (Protected with OAuth 2.1 / API key & Rate Limiting)
app.post(
  '/api/generate',
  generatorLimiter,
  securityGuard.requireAuth('mcp:generate'),
  async (req, res) => {
    const { inputSnippet, language = 'typescript', serverName, transport = 'stdio' } = req.body;

    if (!inputSnippet || typeof inputSnippet !== 'string' || !inputSnippet.trim()) {
      return res.status(400).json({ error: 'Input snippet is required (cURL command, OpenAPI YAML/JSON, or API schema).' });
    }

    try {
      const result = await generateMcpServer({
        inputSnippet,
        language,
        serverName,
        transport,
        logger: console,
      });
      return res.json(result);
    } catch (error: any) {
      console.error('[MCP Generator Error]', error);
      return res.status(500).json({ error: error.message || 'Internal generation error' });
    }
  }
);

// API health endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    time: new Date().toISOString(),
  });
});

// Machine-readable specification for LLMs / AI agents (llms.txt)
app.get('/llms.txt', (_req, res) => {
  res.sendFile(path.resolve(__dirname, 'llms.txt'));
});

// Serve frontend in production or hook up Vite middlewares in development
async function startServer() {
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[MCP Server Generator] Running at http://localhost:${PORT} in ${isProduction ? 'production' : 'development'} mode`);
  });
}

startServer();
