import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import compression from 'compression';
import express from 'express';
import { createAuth } from './auth.mjs';
import { createDatabase } from './database.mjs';

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
const APP_URL = process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL'
  ? process.env.APP_URL.replace(/\/$/, '')
  : `http://localhost:${process.env.NODE_ENV === 'development' && PORT !== 3000 ? 3000 : PORT}`;
const DAILY_PRICE_LOOKUP_URL = process.env.DAILY_PRICE_LOOKUP_URL || DEFAULT_DAILY_PRICE_LOOKUP_URL;
const DAILY_PRICE_TOKEN = process.env.DAILY_PRICE_TOKEN || process.env.DAILY_PRICE_API_TOKEN || '';
const DATABASE_PATH = path.resolve(appRoot, process.env.DATABASE_PATH || 'data/price-rival.sqlite');

const db = createDatabase(DATABASE_PATH);
const app = express();
const auth = createAuth({ db, env: process.env, appUrl: APP_URL });

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(compression());
app.use(express.json({ limit: '30mb' }));
app.use((req, res, next) => {
  req.requestId = req.get('x-request-id') || crypto.randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
});

auth.registerRoutes(app);

const requireSameOrigin = (req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    next();
    return;
  }
  const origin = req.get('origin');
  if (!origin) {
    next();
    return;
  }
  const expectedOrigin = `${req.protocol}://${req.get('host')}`;
  if (origin !== expectedOrigin && origin !== APP_URL) {
    res.status(403).json({ success: false, error: '请求来源校验失败' });
    return;
  }
  next();
};

app.use('/api', auth.requireAuth, requireSameOrigin);

const auditFailure = (req, action, error, resourceId = null) => {
  db.writeAudit({
    ...auth.requestContext(req),
    action,
    outcome: 'FAILED',
    resourceType: 'tracking_batch',
    resourceId,
    details: { error: error instanceof Error ? error.message : String(error) }
  });
};

app.get('/api/tracking-batches', (req, res) => {
  const channelId = req.query.channelId ? String(req.query.channelId) : null;
  res.json({ success: true, batches: db.listBatches(channelId) });
});

app.get('/api/tracking-batches/:id', (req, res) => {
  const batch = db.getBatch(req.params.id);
  if (!batch) {
    res.status(404).json({ success: false, error: '历史批次不存在' });
    return;
  }
  res.json({ success: true, batch });
});

app.post('/api/tracking-batches', (req, res) => {
  try {
    const batch = db.createBatch(req.body?.batch, auth.requestContext(req));
    res.status(201).json({ success: true, batch });
  } catch (error) {
    auditFailure(req, 'BATCH_WRITE_FAILED', error, req.body?.batch?.id || null);
    res.status(error.statusCode || 500).json({ success: false, error: error.message || '保存失败' });
  }
});

app.post('/api/tracking-batches/import', (req, res) => {
  try {
    const result = db.importBatches(req.body?.batches, auth.requestContext(req));
    res.json({ success: true, ...result });
  } catch (error) {
    auditFailure(req, 'BATCH_IMPORT_FAILED', error);
    res.status(error.statusCode || 500).json({ success: false, error: error.message || '迁移失败' });
  }
});

app.delete('/api/tracking-batches/:id', (req, res) => {
  try {
    const batch = db.deleteBatch(req.params.id, auth.requestContext(req));
    res.json({ success: true, batch });
  } catch (error) {
    auditFailure(req, 'BATCH_DELETE_FAILED', error, req.params.id);
    res.status(error.statusCode || 500).json({ success: false, error: error.message || '删除失败' });
  }
});

app.get('/api/audit-logs', (req, res) => {
  res.json({ success: true, logs: db.listAuditLogs(req.query.limit) });
});

app.post('/api/daily-price/lookup', async (req, res) => {
  const ppv = req.body?.ppv || req.body?.ppvs || [];
  const headers = { 'content-type': 'application/json' };
  if (DAILY_PRICE_LOOKUP_URL.includes('/api/') && !DAILY_PRICE_TOKEN) {
    res.status(500).json({ success: false, error: 'daily price token 未配置，请在服务端设置 DAILY_PRICE_TOKEN' });
    return;
  }
  if (DAILY_PRICE_TOKEN) headers.authorization = `Bearer ${DAILY_PRICE_TOKEN}`;
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

const loginPage = () => `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>竞争追价系统登录</title><style>
*{box-sizing:border-box}body{margin:0;background:#e4e3e0;color:#141414;font-family:Arial,"PingFang SC",sans-serif}
.wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}.card{width:420px;background:#fff;border:2px solid #141414}
.head{background:#141414;color:#fff;padding:18px 22px;font-size:18px;font-weight:900}.body{padding:28px}.tag{display:inline-block;border:1px solid #141414;background:#f0efec;padding:4px 8px;font-size:12px;font-weight:700}
h1{font-size:24px;margin:18px 0 8px}p{font-size:13px;line-height:1.7;color:#555}.btn{display:block;width:100%;margin-top:22px;border:2px solid #141414;background:#141414;color:#fff;padding:13px;text-align:center;text-decoration:none;font-size:14px;font-weight:900;cursor:pointer}
.dev{background:#fff;color:#141414;margin-top:10px}.foot{border-top:1px solid #141414;background:#f0efec;padding:12px 22px;font-size:11px;color:#555}
</style></head><body><main class="wrap"><section class="card"><div class="head">线上竞争追价系统</div><div class="body"><span class="tag">公司内部系统</span><h1>使用飞书账号登录</h1><p>仅飞书部门白名单内成员可访问。确认落数、历史迁移和删除操作均会记录操作人与时间。</p><a class="btn" href="/api/auth/login">飞书授权登录</a>${auth.devLoginEnabled ? '<button class="btn dev" onclick="devLogin()">本地验收登录</button>' : ''}</div><div class="foot">未在白名单中请联系系统管理员</div></section></main><script>
async function devLogin(){const r=await fetch('/api/auth/dev-login',{method:'POST'});if(r.ok)location.reload();else alert((await r.json()).error||'登录失败')}
</script></body></html>`;

if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.method !== 'GET' || auth.getUser(req)) {
      next();
      return;
    }
    res.status(401).set('cache-control', 'no-store').type('html').send(loginPage());
  });
  app.use(express.static(path.join(appRoot, 'dist')));
  app.get('*', (_req, res) => res.sendFile(path.join(appRoot, 'dist', 'index.html')));
}

const server = app.listen(PORT, HOST, () => {
  console.log(`Competition pricing server listening on ${HOST}:${PORT}`);
  console.log(`SQLite database: ${DATABASE_PATH}`);
  console.log(`Feishu auth configured: ${auth.authConfigured ? 'yes' : 'no'}; dev login: ${auth.devLoginEnabled ? 'enabled' : 'disabled'}`);
});

const shutdown = () => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
