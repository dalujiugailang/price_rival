import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AUTH_ROLES, createAuth, resolveAuthRole } from './auth.mjs';
import { loadAccessBootstrap } from './accessBootstrap.mjs';

const bootstrapDir = fs.mkdtempSync(path.join(os.tmpdir(), 'price-rival-bootstrap-test-'));
try {
  const filePath = path.join(bootstrapDir, 'access-bootstrap.json');
  assert.deepEqual(loadAccessBootstrap(filePath), { admins: [], profiles: {} }, '源码不内置部署人员');
  const config = { admins: ['open-admin'], profiles: { 'open-admin': { name: '示例管理员', department: '示例部门' } } };
  fs.writeFileSync(filePath, JSON.stringify(config));
  assert.deepEqual(loadAccessBootstrap(filePath), config, '本地配置保留迁移管理员及显示信息');
  fs.writeFileSync(filePath, '{invalid');
  assert.throws(() => loadAccessBootstrap(filePath), SyntaxError);
  fs.writeFileSync(filePath, JSON.stringify({ admins: 'open-admin' }));
  assert.throws(() => loadAccessBootstrap(filePath), /权限初始化配置/);

  let migrated;
  createAuth({ db: { initializeAccess: config => { migrated = config; } },
    env: { FEISHU_ALLOWED_OPEN_IDS: 'open-admin', FEISHU_ADMIN_OPEN_IDS: 'open-admin' },
    appUrl: 'http://localhost:3000' });
  assert.deepEqual(migrated.admins, ['open-admin'], '显式管理员环境配置优先于本地默认值');
} finally {
  fs.rmSync(bootstrapDir, { recursive: true, force: true });
}

const accessLists = {
  allowedDepartments: new Set(['dept-editor']),
  allowedOpenIds: new Set(['open-editor']),
  readOnlyDepartments: new Set(['dept-viewer']),
  readOnlyOpenIds: new Set(['open-viewer'])
};

assert.equal(resolveAuthRole({ openId: 'open-editor', departmentIds: [] }, accessLists), AUTH_ROLES.EDITOR);
assert.equal(resolveAuthRole({ openId: 'someone', departmentIds: ['dept-viewer'] }, accessLists), AUTH_ROLES.TRADE_IN_VIEWER);
assert.equal(
  resolveAuthRole({ openId: 'open-viewer', departmentIds: ['dept-editor'] }, accessLists),
  AUTH_ROLES.TRADE_IN_VIEWER,
  '个人只读配置优先于部门权限'
);
assert.equal(resolveAuthRole({ openId: 'unknown', departmentIds: ['other'] }, accessLists), null);

const auditRows = [];
const auth = createAuth({
  db: {
    writeAudit(row) {
      auditRows.push(row);
    }
  },
  env: {},
  appUrl: 'http://localhost:3000'
});

const response = () => ({
  statusCode: 200,
  payload: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.payload = payload;
    return this;
  }
});

{
  let nextCalled = false;
  const res = response();
  auth.requireEditor({
    authUser: { role: 'tradeInViewer', openId: 'viewer-1', name: '只读用户' },
    method: 'POST',
    originalUrl: '/api/tracking-batches',
    requestId: 'request-viewer',
    ip: '127.0.0.1',
    get: () => ''
  }, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.match(res.payload.error, /只读权限/);
  assert.equal(auditRows.at(-1)?.action, 'AUTHORIZATION_DENIED');
  assert.equal(auditRows.at(-1)?.outcome, 'DENIED');
}

{
  let nextCalled = false;
  const res = response();
  auth.requireEditor({
    authUser: { role: 'editor', openId: 'editor-1', name: '编辑用户' },
    method: 'POST',
    originalUrl: '/api/tracking-batches',
    requestId: 'request-editor',
    ip: '127.0.0.1',
    get: () => ''
  }, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
}

console.log('auth permission tests passed');
