import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateMcpServer } from './src/core/generator.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

app.use(express.json({ limit: '10mb' }));

// API endpoint to generate MCP server
app.post('/api/generate', async (req, res) => {
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
});

// API health endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    time: new Date().toISOString(),
  });
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
