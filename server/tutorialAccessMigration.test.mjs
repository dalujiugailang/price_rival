import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase } from './database.mjs';
import { createAccessStore } from './accessStore.mjs';
import { createAuth } from './auth.mjs';
import { DEFAULT_VIEWER_SCOPES } from '../shared/accessPolicy.mjs';

const oldScopes = ['tradeIn.workspace', 'tradeIn.competitiveness', 'tradeIn.tmHandGap'];
const emptySeed = { editors: [], viewers: [], admins: [] };
const migrationId = 'trade-in-viewer-tutorial-v1';
const fixture = () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'tutorial-access-migration-'));
  const file = path.join(directory, 'test.sqlite');
  const db = createDatabase(file);
  const raw = new DatabaseSync(file);
  raw.prepare('INSERT INTO access_migrations VALUES (?, ?)').run('personal-access-v1', '2026-01-01');
  const cases = [
    ['viewer', 'viewer', oldScopes, 1],
    ['history-viewer', 'viewer', [...oldScopes, 'tradeIn.history'], 1],
    ['disabled', 'viewer', [...oldScopes].reverse(), 0],
    ['custom', 'viewer', ['tradeIn.competitiveness'], 1],
    ['extra', 'viewer', [...oldScopes, 'selfOperated.history'], 1],
    ['admin', 'admin', oldScopes, 1],
    ['editor', 'editor', oldScopes, 1]
  ];
  for (const [id, role, scopes, enabled] of cases) {
    raw.prepare('INSERT INTO access_members VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, `${id} name`, 'department', role, JSON.stringify(scopes), enabled, 'legacy-config', '2026-01-01', '2026-01-01', 7);
  }
  return { db, raw, file, close: () => { raw.close(); db.close(); rmSync(directory, { recursive: true, force: true }); } };
};

test('migrates only exact legacy viewer scopes, including disabled members, and audits each change', () => {
  const f = fixture();
  try {
    const before = Object.fromEntries(f.db.listMembers().map(member => [member.openId, member]));
    f.db.initializeAccess(emptySeed);
    for (const id of ['viewer', 'history-viewer', 'disabled']) {
      const after = f.db.getMember(id);
      assert.deepEqual(after.scopes, DEFAULT_VIEWER_SCOPES);
      assert.equal(after.version, 8);
      for (const field of ['enabled', 'name', 'department', 'role', 'source', 'createdAt']) assert.deepEqual(after[field], before[id][field]);
    }
    for (const id of ['custom', 'extra', 'admin', 'editor']) assert.deepEqual(f.db.getMember(id), before[id]);
    const logs = f.db.listAuditLogs().filter(log => log.action === 'ACCESS_SCOPE_MIGRATE');
    assert.equal(logs.length, 3);
    for (const log of logs) {
      assert.equal(log.details.migrationId, migrationId);
      assert.deepEqual(log.details.before.scopes, before[log.resourceId].scopes);
      assert.deepEqual(log.details.after.scopes, DEFAULT_VIEWER_SCOPES);
      assert.equal(log.details.after.version, 8);
      assert.equal(log.details.after.enabled, before[log.resourceId].enabled);
    }
  } finally { f.close(); }
});

test('existing sessions read migrated access immediately and restart never overwrites later manual changes', () => {
  const f = fixture();
  let restarted;
  try {
    // Hold an existing auth instance and session across the migration.
    const auth = createAuth({ db: { ...f.db, initializeAccess() {} }, env: {}, appUrl: 'http://localhost' });
    const token = crypto.randomBytes(24).toString('hex');
    f.db.createSession(crypto.createHash('sha256').update(token).digest('hex'),
      { openId: 'viewer', role: 'viewer', loginType: 'feishu' }, new Date(Date.now() + 3600000).toISOString());
    const request = { headers: { cookie: `price_rival_session=${token}` } };
    assert.deepEqual(auth.getUser(request).scopes, oldScopes);
    f.db.initializeAccess(emptySeed);
    assert.deepEqual(auth.getUser(request).scopes, DEFAULT_VIEWER_SCOPES);
    assert.equal(auth.getUser(request).accessVersion, 8);
    f.db.saveMember({ ...f.db.getMember('viewer'), scopes: oldScopes }, { actor: { openId: 'admin', role: 'admin' } });
    restarted = createDatabase(f.file);
    restarted.initializeAccess(emptySeed);
    assert.deepEqual(restarted.getMember('viewer').scopes, oldScopes);
    assert.equal(restarted.getMember('viewer').version, 9);
    assert.equal(restarted.listAuditLogs().filter(log => log.action === 'ACCESS_SCOPE_MIGRATE').length, 3);
    assert.equal(f.raw.prepare('SELECT COUNT(*) AS count FROM access_migrations WHERE id=?').get(migrationId).count, 1);
  } finally { restarted?.close(); f.close(); }
});

test('migration rolls back member updates and completion marker if auditing fails', () => {
  const f = fixture();
  try {
    const before = f.db.listMembers();
    const store = createAccessStore(f.raw, () => { throw new Error('audit unavailable'); });
    assert.throws(() => store.initializeAccess(emptySeed), /audit unavailable/);
    assert.deepEqual(f.db.listMembers(), before);
    assert.equal(f.raw.prepare('SELECT 1 FROM access_migrations WHERE id=?').get(migrationId), undefined);
    f.db.initializeAccess(emptySeed);
    assert.deepEqual(f.db.getMember('viewer').scopes, DEFAULT_VIEWER_SCOPES);
  } finally { f.close(); }
});
