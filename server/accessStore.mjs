import { ALL_ACCESS_SCOPES, DEFAULT_VIEWER_SCOPES, validateAccess } from '../shared/accessPolicy.mjs';
const now = () => new Date().toISOString();
const error = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

export const createAccessStore = (db, writeAudit) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS access_members (
      open_id TEXT PRIMARY KEY, name TEXT NOT NULL, department TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL CHECK(role IN ('admin','editor','viewer')),
      scopes_json TEXT NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
      source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1
    ) STRICT;
    CREATE TABLE IF NOT EXISTS access_directory (
      open_id TEXT PRIMARY KEY, name TEXT NOT NULL, department TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS access_migrations (id TEXT PRIMARY KEY, completed_at TEXT NOT NULL) STRICT;
  `);
  const member = row => row ? {
    openId: row.open_id, name: row.name, department: row.department, role: row.role,
    scopes: JSON.parse(row.scopes_json), enabled: !!row.enabled, source: row.source,
    createdAt: row.created_at, updatedAt: row.updated_at, version: row.version,
    lastLoginAt: row.last_login_at || null
  } : null;
  const get = openId => member(db.prepare(`SELECT m.*, (SELECT MAX(a.created_at) FROM audit_logs a
    WHERE a.actor_open_id=m.open_id AND a.action='AUTH_LOGIN_SUCCESS' AND a.outcome='SUCCESS') last_login_at
    FROM access_members m WHERE open_id = ?`).get(openId));
  const rememberProfile = profile => {
    if (!profile?.openId || !profile?.name) return;
    db.prepare(`INSERT INTO access_directory VALUES (?, ?, ?, ?)
      ON CONFLICT(open_id) DO UPDATE SET name=excluded.name,
        department=CASE WHEN excluded.department <> '' THEN excluded.department ELSE access_directory.department END,
        updated_at=excluded.updated_at`).run(profile.openId, profile.name, profile.department || '', now());
    db.prepare(`UPDATE access_members SET name=?, department=CASE WHEN ? <> '' THEN ? ELSE department END WHERE open_id=?`)
      .run(profile.name, profile.department || '', profile.department || '', profile.openId);
  };
  const transaction = callback => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = callback(); db.exec('COMMIT'); return result; }
    catch (err) { db.exec('ROLLBACK'); throw err; }
  };
  const insert = (profile, access, source) => {
    const timestamp = now();
    db.prepare('INSERT INTO access_members VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)')
      .run(profile.openId, profile.name, profile.department || '', access.role, JSON.stringify(access.scopes), Number(access.enabled), source, timestamp, timestamp);
  };
  const migrateViewerTutorialAccess = () => transaction(() => {
    const migrationId = 'trade-in-viewer-tutorial-v1';
    if (db.prepare('SELECT 1 FROM access_migrations WHERE id=?').get(migrationId)) return;
    const legacyScopes = new Set(['tradeIn.workspace', 'tradeIn.competitiveness', 'tradeIn.tmHandGap']);
    for (const row of db.prepare("SELECT * FROM access_members WHERE role='viewer'").all()) {
      const before = member(row);
      const scopes = new Set(before.scopes);
      // The deployed viewer preset also includes history; retain that page in the new preset.
      scopes.delete('tradeIn.history');
      if (scopes.size !== legacyScopes.size || [...scopes].some(scope => !legacyScopes.has(scope))) continue;
      db.prepare('UPDATE access_members SET scopes_json=?, updated_at=?, version=version+1 WHERE open_id=?')
        .run(JSON.stringify(DEFAULT_VIEWER_SCOPES), now(), before.openId);
      const after = get(before.openId);
      writeAudit({ action: 'ACCESS_SCOPE_MIGRATE', resourceType: 'access_member', resourceId: before.openId,
        details: { migrationId, name: before.name,
          before: { role: before.role, scopes: before.scopes, enabled: before.enabled, version: before.version },
          after: { role: after.role, scopes: after.scopes, enabled: after.enabled, version: after.version } } });
    }
    db.prepare('INSERT INTO access_migrations VALUES (?, ?)').run(migrationId, now());
  });
  return {
    getMember: get,
    hasMembers: () => !!db.prepare('SELECT 1 FROM access_members LIMIT 1').get(),
    rememberProfile,
    getProfile: openId => {
      const row = db.prepare('SELECT * FROM access_directory WHERE open_id=?').get(openId);
      return row ? { openId: row.open_id, name: row.name, department: row.department } : null;
    },
    searchProfiles(query) {
      // instr treats %, _ and backslashes as ordinary name characters.
      return db.prepare(`SELECT * FROM access_directory WHERE instr(lower(name || ' ' || department || ' ' || open_id), lower(?)) > 0
        ORDER BY name LIMIT 30`).all(query).map(row => ({ openId: row.open_id, name: row.name, department: row.department }));
    },
    initializeAccess({ editors, viewers, admins, profiles = {} }) {
      migrateViewerTutorialAccess();
      if (db.prepare("SELECT 1 FROM access_migrations WHERE id='personal-access-v1'").get()) return;
      if (editors.length + viewers.length === 0) return;
      const ids = [...new Set([...editors, ...viewers])];
      if (!admins.some(id => ids.includes(id))) throw error('初始化权限管理需要指定现有成员为管理员', 503);
      transaction(() => {
        for (const openId of ids) {
          const recorded = db.prepare(`SELECT actor_name FROM audit_logs WHERE actor_open_id=? AND actor_name <> '' ORDER BY id DESC LIMIT 1`).get(openId);
          const profile = { openId, name: profiles[openId]?.name || recorded?.actor_name || openId, department: profiles[openId]?.department || '' };
          rememberProfile(profile);
          if (!get(openId)) insert(profile, {
            role: admins.includes(openId) ? 'admin' : editors.includes(openId) ? 'editor' : 'viewer', enabled: true,
            scopes: editors.includes(openId) || admins.includes(openId) ? [...ALL_ACCESS_SCOPES] : [...DEFAULT_VIEWER_SCOPES]
          }, 'legacy-config');
        }
        db.prepare("INSERT INTO access_migrations VALUES ('personal-access-v1', ?)").run(now());
        writeAudit({ action: 'ACCESS_MIGRATE', resourceType: 'access_member', details: { memberCount: ids.length } });
      });
    },
    listMembers() {
      return db.prepare(`SELECT m.*, (SELECT MAX(a.created_at) FROM audit_logs a
        WHERE a.actor_open_id=m.open_id AND a.action='AUTH_LOGIN_SUCCESS' AND a.outcome='SUCCESS') last_login_at
        FROM access_members m ORDER BY CASE m.role WHEN 'admin' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, m.name`).all().map(member);
    },
    saveMember(input, context, create = false) {
      if (context.actor?.role !== 'admin') throw error('只有管理员可以管理权限', 403);
      let access;
      try { access = validateAccess(input); } catch (err) { throw error(err.message); }
      return transaction(() => {
        const before = get(input.openId);
        if (create && before) throw error('该成员已开通，请在名单中修改权限', 409);
        if (!create && !before) throw error('成员不存在', 404);
        if (input.role === 'admin' || before?.role === 'admin' || input.openId === context.actor.openId) {
          throw error('管理员账号受保护，不能在此修改', 403);
        }
        if (before && input.version !== before.version) throw error('该成员权限已被更新，请刷新后重试', 409);
        if (create) {
          const profile = this.getProfile(input.openId);
          if (!profile) throw error('请先搜索并选择已核验的飞书成员');
          insert(profile, access, 'admin');
        } else {
          db.prepare(`UPDATE access_members SET role=?, scopes_json=?, enabled=?, updated_at=?, version=version+1 WHERE open_id=?`)
            .run(access.role, JSON.stringify(access.scopes), Number(access.enabled), now(), input.openId);
        }
        const after = get(input.openId);
        writeAudit({ ...context, action: create ? 'ACCESS_CREATE' : 'ACCESS_UPDATE', resourceType: 'access_member', resourceId: input.openId,
          details: { name: after.name, before: before ? { role: before.role, scopes: before.scopes, enabled: before.enabled } : null,
            after: { role: after.role, scopes: after.scopes, enabled: after.enabled } } });
        return after;
      });
    }
  };
};
