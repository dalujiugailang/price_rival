import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'path';
import {defineConfig, loadEnv, type Plugin} from 'vite';

const DEFAULT_DAILY_PRICE_LOOKUP_URL = 'https://daily-price.gtmdudu.xyz/api/lookup';

const readJsonBody = async (req: IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
};

const sendJson = (res: ServerResponse, status: number, payload: unknown) => {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(body);
};

const dailyPriceProxyPlugin = (lookupUrl: string, token: string): Plugin => ({
  name: 'daily-price-proxy',
  configureServer(server) {
    server.middlewares.use('/api/daily-price/lookup', async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { success: false, error: 'method not allowed' });
        return;
      }

      try {
        const body = await readJsonBody(req);
        const headers: Record<string, string> = { 'content-type': 'application/json' };

        if (lookupUrl.includes('/api/') && !token) {
          sendJson(res, 500, {
            success: false,
            error: 'daily price token 未配置，请在服务端设置 DAILY_PRICE_TOKEN'
          });
          return;
        }

        if (token) {
          headers.authorization = `Bearer ${token}`;
        }

        const upstream = await fetch(lookupUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ppv: body.ppv || body.ppvs || [] })
        });
        const payload = await upstream.json();
        sendJson(res, upstream.status, payload);
      } catch (error) {
        sendJson(res, 503, {
          success: false,
          error: `daily price API 请求失败，请检查 ${lookupUrl} 是否可访问`,
          detail: error instanceof Error ? error.message : String(error)
        });
      }
    });
  }
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const dailyPriceLookupUrl = env.DAILY_PRICE_LOOKUP_URL || DEFAULT_DAILY_PRICE_LOOKUP_URL;
  const dailyPriceToken = env.DAILY_PRICE_TOKEN || env.DAILY_PRICE_API_TOKEN || '';

  return {
    plugins: [dailyPriceProxyPlugin(dailyPriceLookupUrl, dailyPriceToken), react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
