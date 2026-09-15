import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createDatabase } from './database.mjs';
import { createAuth } from './auth.mjs';
import { listAuthorizedBatches } from './accessProjection.mjs';
import { ALL_ACCESS_SCOPES, DEFAULT_VIEWER_SCOPES, canAccess, canEdit } from '../shared/accessPolicy.mjs';

const admin = { openId: 'ou_testadmin', name: '测试管理员', role: 'admin', tenantKey: 'test', loginType: 'feishu' };
const context = { actor: admin, requestId: 'access-test', ip: '127.0.0.1', userAgent: 'test' };
const seed = { editors: [admin.openId, 'ou_testeditor'], viewers: ['ou_testviewer'], admins: [admin.openId], profiles: {} };
const product = { id: 'test-product', ppv: 'test-ppv', brand: '测试品牌', newSeries: '测试系列', oldModel: '测试机型',
  quoteVolume: 100, soldVolume: 10, recommendJdPrice: 1000, postAhsPrice: 1020, postJdHandPrice: 1050,
  tmPrice: 990, tmHandPrice: 1060, zzPrice: 980, zzHandPrice: 1030, basePrice: 123456,
  postMargin: 0.99, rawFields: { 'B_品牌名称': '测试品牌', '秘密底表字段': 'NEVER_SEND_TO_TREND' } };
const batch = (channel, date, extra = {}) => ({ id: `${channel}-${date}`, channelId: channel, date, operator: '测试运营',
  dataDate: date, marginBottomLine: 0.03, products: [product], investmentRateInputs: { androidSalesAmount30d: 999 },
  sourceUploadRecords: [{ id: 'source-test', fileName: '测试文件.xlsx', rowCount: 1 }], ...extra });
const fixture = () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'price-rival-access-test-'));
  const file = path.join(directory, 'test.sqlite'); const db = createDatabase(file); db.initializeAccess(seed);
  return { db, directory, file, close: () => { db.close(); rmSync(directory, { recursive: true, force: true }); } };
};
const session = (db, openId, role = 'admin', extra = {}) => {
  const token = crypto.randomBytes(24).toString('hex');
  db.createSession(crypto.createHash('sha256').update(token).digest('hex'), { ...admin, openId, role, ...extra }, new Date(Date.now() + 3600000).toISOString());
  return `price_rival_session=${token}`;
};

test('business viewers have four read-only pages; tutorial alone cannot read business snapshots', () => {
  const user = { role: 'viewer', enabled: true, scopes: DEFAULT_VIEWER_SCOPES };
  assert.deepEqual(DEFAULT_VIEWER_SCOPES, ['tradeIn.history', 'tradeIn.competitiveness', 'tradeIn.tmHandGap', 'tradeIn.tutorial']);
  for (const page of ['history', 'competitiveness', 'tmHandGap', 'tutorial']) {
    assert.equal(canAccess(user, 'tradeIn', page), true);
    assert.equal(canEdit(user, 'tradeIn', page), false);
  }
  for (const page of ['workspace', 'upload', 'audit']) assert.equal(canAccess(user, 'tradeIn', page), false);
  assert.equal(canAccess(user, 'selfOperated', 'tutorial'), false);
  const f = fixture();
  try {
    f.db.createBatch(batch('tradeIn', '2026-09-11'), context);
    assert.deepEqual(listAuthorizedBatches(f.db, { ...user, scopes: ['tradeIn.tutorial'] }), []);
    assert.equal(listAuthorizedBatches(f.db, user).length, 1);
  } finally { f.close(); }
});

test('migrate exact legacy members once; preserve roles, scopes and disabled state across restart', () => {
  const f = fixture();
  try {
    assert.equal(f.db.listMembers().length, 3);
    assert.deepEqual(f.db.getMember('ou_testviewer').scopes, DEFAULT_VIEWER_SCOPES);
    assert.deepEqual(f.db.getMember('ou_testeditor').scopes, ALL_ACCESS_SCOPES);
    const before = f.db.getMember('ou_testeditor');
    f.db.saveMember({ ...before, enabled: false, role: 'viewer', scopes: [] }, context);
    f.db.close(); const restarted = createDatabase(f.file);
    restarted.initializeAccess({ ...seed, editors: [...seed.editors, 'ou_newenv'] });
    assert.equal(restarted.getMember('ou_testeditor').enabled, false);
    assert.deepEqual(restarted.getMember('ou_testeditor').scopes, []);
    assert.equal(restarted.getMember('ou_newenv'), null);
    assert.equal(restarted.listAuditLogs().filter(log => log.action === 'ACCESS_MIGRATE').length, 1);
    restarted.close();
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test('member changes validate scopes, protect admin, require fresh version, and record before/after', () => {
  const f = fixture();
  try {
    const old = f.db.getMember('ou_testviewer');
    for (const patch of [{ role: 'admin' }, { scopes: [] }, { scopes: ['selfOperated.secret'] }, { enabled: 'false' }]) {
      assert.throws(() => f.db.saveMember({ ...old, ...patch }, context));
    }
    assert.throws(() => f.db.saveMember({ ...f.db.getMember(admin.openId), role: 'viewer' }, context), { statusCode: 403 });
    assert.throws(() => f.db.saveMember(old, { actor: { role: 'editor' } }), { statusCode: 403 });
    const updated = f.db.saveMember({ ...old, role: 'editor', scopes: ['selfOperated.history'] }, context);
    assert.deepEqual(updated.scopes, ['selfOperated.history']);
    assert.throws(() => f.db.saveMember(old, context), { statusCode: 409 });
    const log = f.db.listAuditLogs().find(item => item.action === 'ACCESS_UPDATE');
    assert.deepEqual(log.details.before.scopes, DEFAULT_VIEWER_SCOPES);
    assert.deepEqual(log.details.after.scopes, ['selfOperated.history']);
    assert.throws(() => f.db.saveMember({ openId: 'ou_unknown', role: 'viewer', enabled: true, scopes: DEFAULT_VIEWER_SCOPES }, context, true));
    f.db.rememberProfile({ openId: 'ou_newmember', name: '已核验成员', department: '测试部门' });
    const created = f.db.saveMember({ openId: 'ou_newmember', name: '伪造姓名', role: 'viewer', enabled: true, scopes: DEFAULT_VIEWER_SCOPES }, context, true);
    assert.equal(created.name, '已核验成员');
    assert.equal(f.db.listMembers().length, 4);
  } finally { f.close(); }
});

test('server projection limits each channel/page, including historic workspace data and source/raw fields', () => {
  const f = fixture();
  try {
    for (const channel of ['tradeIn', 'selfOperated']) {
      f.db.createBatch(batch(channel, '2026-09-08'), context);
      f.db.createBatch(batch(channel, '2026-09-09'), context);
      f.db.createBatch(batch(channel, '2026-09-10', { isSummaryOnly: true, products: [], competitivenessMetrics: { tmItem: 0.8 } }), context);
      for (const page of ['workspace', 'upload', 'history', 'competitiveness', 'tmHandGap', 'audit']) {
        const user = { role: 'viewer', enabled: true, scopes: [`${channel}.${page}`] };
        const result = listAuthorizedBatches(f.db, user);
        assert.ok(result.every(item => item.channelId === channel));
        assert.equal(result.length, ['history', 'competitiveness'].includes(page) ? 3 : page === 'audit' ? 0 : 1);
        if (result.length && !['workspace', 'history'].includes(page)) {
          const text = JSON.stringify(result);
          assert.ok(!text.includes('NEVER_SEND_TO_TREND'));
          assert.ok(!text.includes('basePrice'));
          assert.ok(!text.includes('postMargin'));
          assert.ok(!text.includes('investmentRateInputs'));
          assert.equal(text.includes('sourceUploadRecords'), page === 'upload');
        }
      }
      const combined = listAuthorizedBatches(f.db, { role: 'viewer', scopes: [`${channel}.workspace`, `${channel}.competitiveness`] });
      assert.equal(combined.find(item => item.date === '2026-09-09').products[0].basePrice, 123456);
      assert.equal(combined.find(item => item.date === '2026-09-08').products[0].basePrice, undefined);
    }
    assert.deepEqual(listAuthorizedBatches(f.db, { role: 'viewer', enabled: false, scopes: ALL_ACCESS_SCOPES }), []);
  } finally { f.close(); }
});

test('existing sessions always use current membership; department or legacy roles cannot restore access', () => {
  const f = fixture();
  try {
    const auth = createAuth({ db: f.db, env: { NODE_ENV: 'production', AUTH_DEV_BYPASS: 'true',
      FEISHU_ALLOWED_TENANT_KEYS: 'test', FEISHU_ALLOWED_DEPARTMENT_IDS: 'test-department' }, appUrl: 'http://localhost' });
    assert.equal(auth.devLoginEnabled, false);
    const cookie = session(f.db, 'ou_testviewer', 'admin');
    assert.equal(auth.getUser({ headers: { cookie } }).role, 'viewer');
    let member = f.db.getMember('ou_testviewer');
    member = f.db.saveMember({ ...member, scopes: ['selfOperated.audit'] }, context);
    assert.deepEqual(auth.getUser({ headers: { cookie } }).scopes, ['selfOperated.audit']);
    f.db.saveMember({ ...member, enabled: false }, context);
    assert.equal(auth.getUser({ headers: { cookie } }), null);
    assert.equal(auth.getUser({ headers: { cookie: session(f.db, 'ou_unknown', 'admin', { departmentIds: ['test-department'] }) } }), null);
    assert.equal(auth.getUser({ headers: { cookie: session(f.db, admin.openId, 'admin', { tenantKey: 'other' }) } }), null);
  } finally { f.close(); }
});

test('HTTP access enforcement: admin-only changes, read-only writes, channel scope, revocation, logs and exports', async () => {
  const f = fixture(); let server;
  try {
    for (const channel of ['tradeIn', 'selfOperated']) f.db.createBatch(batch(channel, '2026-09-09'), context);
    const cookies = Object.fromEntries([admin.openId, 'ou_testeditor', 'ou_testviewer'].map(id => [id, session(f.db, id)]));
    const listener = net.createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
    const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
    server = spawn(process.execPath, ['server/index.mjs'], { cwd: path.resolve(import.meta.dirname, '..'), env: {
      ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), APP_URL: `http://127.0.0.1:${port}`,
      DATABASE_PATH: f.file, AUTH_DEV_BYPASS: 'true', FEISHU_APP_ID: 'test', FEISHU_APP_SECRET: 'test',
      FEISHU_ALLOWED_TENANT_KEYS: 'test', FEISHU_ALLOWED_OPEN_IDS: '', FEISHU_READ_ONLY_OPEN_IDS: '',
      FEISHU_REDIRECT_URI: `http://127.0.0.1:${port}/api/auth/feishu/callback`, DAILY_PRICE_TOKEN: '', DAILY_PRICE_API_TOKEN: ''
    }, stdio: ['ignore', 'pipe', 'pipe'] });
    await Promise.race([new Promise((resolve, reject) => {
      server.stdout.on('data', data => { if (String(data).includes('server listening')) resolve(); });
      server.once('exit', code => reject(new Error(`server exited ${code}`)));
    }), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('startup timeout')), 10000); timer.unref(); })]);
    const call = async (openId, route, method = 'GET', body, headers = {}) => {
      const response = await fetch(`http://127.0.0.1:${port}${route}`, { method, headers: {
        ...(openId ? { cookie: cookies[openId] } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...headers
      }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, data: await response.json().catch(() => ({})) };
    };
    const viewer = 'ou_testviewer'; const editor = 'ou_testeditor';
    assert.equal((await call(null, '/api/access-members')).status, 401);
    assert.equal((await call(null, '/api/auth/dev-login', 'POST')).status, 404);
    for (const id of [viewer, editor]) {
      assert.equal((await call(id, '/api/access-members')).status, 403);
      assert.equal((await call(id, '/api/access-directory?q=测试')).status, 403);
      assert.equal((await call(id, '/api/access-members', 'POST', {})).status, 403);
      assert.equal((await call(id, `/api/access-members/${viewer}`, 'PUT', f.db.getMember(viewer))).status, 403);
    }
    assert.equal((await call(admin.openId, '/api/access-members')).data.members.length, 3);
    assert.equal((await call(viewer, '/api/tracking-batches?channelId=selfOperated')).status, 403);
    assert.equal((await call(viewer, '/api/android-revenue/latest')).status, 403);
    assert.equal((await call(viewer, '/api/tracking-batches/selfOperated-2026-09-09')).status, 403);
    assert.ok((await call(viewer, '/api/tracking-batches')).data.batches.every(item => item.channelId === 'tradeIn'));
    for (const [route, method, body] of [
      ['/api/tracking-batches', 'POST', { batch: batch('tradeIn', '2026-09-11') }],
      ['/api/tracking-batches/import', 'POST', { batches: [batch('tradeIn', '2026-09-11')] }],
      ['/api/tracking-batches/tradeIn-2026-09-09', 'DELETE'],
      ['/api/tracking-batches/brand-backfill', 'POST', { channelId: 'tradeIn', brandsByPpv: {} }],
      ['/api/daily-price/lookup', 'POST', { channelId: 'tradeIn', ppv: ['test'] }]
    ]) assert.equal((await call(viewer, route, method, body)).status, 403, route);
    assert.equal((await call(viewer, '/api/exports/competitiveness-trends', 'POST', { channelId: 'selfOperated' })).status, 403);
    assert.equal((await call(viewer, '/api/audit-logs')).status, 403);
    let member = f.db.getMember(viewer);
    assert.equal((await call(admin.openId, `/api/access-members/${viewer}`, 'PUT', { ...member, scopes: ['selfOperated.audit'] }, { origin: 'https://other.example' })).status, 403);
    const result = await call(admin.openId, `/api/access-members/${viewer}`, 'PUT', { ...member, scopes: ['selfOperated.audit'] });
    assert.equal(result.status, 200);
    assert.deepEqual((await call(viewer, '/api/auth/me')).data.user.scopes, ['selfOperated.audit']);
    assert.equal((await call(viewer, '/api/tracking-batches?channelId=tradeIn')).status, 403);
    const logs = await call(viewer, '/api/audit-logs?channelId=selfOperated');
    assert.equal(logs.status, 200); assert.ok(logs.data.logs.length > 0);
    assert.ok(logs.data.logs.every(log => log.resourceId?.startsWith('selfOperated') && !log.ip && !log.userAgent));
    assert.ok(!JSON.stringify(logs.data).includes('ACCESS_UPDATE'));
    assert.equal((await call(admin.openId, `/api/access-members/${viewer}`, 'PUT', member)).status, 409);
    member = result.data.member;
    assert.equal((await call(admin.openId, `/api/access-members/${viewer}`, 'PUT', { ...member, enabled: false })).status, 200);
    assert.equal((await call(viewer, '/api/auth/me')).status, 401);
    assert.equal((await call(viewer, '/api/tracking-batches')).status, 401);
    assert.equal((await call(admin.openId, `/api/access-members/${admin.openId}`, 'PUT', { ...f.db.getMember(admin.openId), role: 'viewer' })).status, 403);
    f.db.saveMember({ ...f.db.getMember(editor), scopes: ['selfOperated.workspace'] }, context);
    assert.equal((await call(editor, '/api/tracking-batches', 'POST', { batch: batch('tradeIn', '2026-09-11') })).status, 403);
    assert.equal((await call(editor, '/api/tracking-batches', 'POST', { batch: batch('selfOperated', '2026-09-11') })).status, 201);
    assert.equal((await call(editor, '/api/tracking-batches/import', 'POST', { batches: [batch('selfOperated', '2026-09-12')] })).status, 403);
    assert.equal((await call(editor, '/api/daily-price/lookup', 'POST', { channelId: 'selfOperated', ppv: ['test'] })).status, 403);
    assert.equal((await call(editor, '/api/android-revenue/latest')).status, 403);
  } finally {
    if (server && server.exitCode === null) { server.kill('SIGTERM'); await once(server, 'exit'); }
    f.close();
  }
});
