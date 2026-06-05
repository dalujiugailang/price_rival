import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');

const loadLocalEnv = () => {
  for (const fileName of ['.env.local', '.env']) {
    const filePath = path.join(appRoot, fileName);
    if (!fs.existsSync(filePath)) continue;

    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const equalsIndex = trimmed.indexOf('=');
      if (equalsIndex === -1) continue;

      const key = trimmed.slice(0, equalsIndex).trim();
      const value = trimmed.slice(equalsIndex + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  }
};

loadLocalEnv();

const DEFAULT_DAILY_PRICE_LOOKUP_URL = 'https://daily-price.gtmdudu.xyz/api/lookup';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DAILY_PRICE_LOOKUP_URL = process.env.DAILY_PRICE_LOOKUP_URL || DEFAULT_DAILY_PRICE_LOOKUP_URL;
const DAILY_PRICE_TOKEN = process.env.DAILY_PRICE_TOKEN || process.env.DAILY_PRICE_API_TOKEN || '';

const app = express();

app.use(express.json({ limit: '2mb' }));

app.post('/api/daily-price/lookup', async (req, res) => {
  const ppv = req.body?.ppv || req.body?.ppvs || [];
  const headers = { 'content-type': 'application/json' };

  if (DAILY_PRICE_LOOKUP_URL.includes('/api/') && !DAILY_PRICE_TOKEN) {
    res.status(500).json({
      success: false,
      error: 'daily price token 未配置，请在服务端设置 DAILY_PRICE_TOKEN'
    });
    return;
  }

  if (DAILY_PRICE_TOKEN) {
    headers.authorization = `Bearer ${DAILY_PRICE_TOKEN}`;
  }

  try {
    const upstream = await fetch(DAILY_PRICE_LOOKUP_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ppv })
    });
    const text = await upstream.text();
    res.status(upstream.status).type('application/json').send(text || '{}');
  } catch (error) {
    res.status(503).json({
      success: false,
      error: `daily price API 请求失败，请检查 ${DAILY_PRICE_LOOKUP_URL} 是否可访问`,
      detail: error instanceof Error ? error.message : String(error)
    });
  }
});

app.use(express.static(path.join(appRoot, 'dist')));

app.get('*', (_req, res) => {
  res.sendFile(path.join(appRoot, 'dist', 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`Competition pricing server listening on ${HOST}:${PORT}`);
  console.log(`Daily price lookup upstream: ${DAILY_PRICE_LOOKUP_URL}`);
});
