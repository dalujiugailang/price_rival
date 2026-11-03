import { DatabaseSync, backup } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Explicit operator command only; never run automatically at application startup.
export const provisionExclusiveFeishuPushOwner = async (databasePath, ownerOpenId) => {
  const db = new DatabaseSync(databasePath, { timeout: 5000 });
  try {
    const owner = db.prepare('SELECT * FROM access_members WHERE open_id=?').get(ownerOpenId);
    if (!owner || !owner.enabled || owner.role !== 'admin') throw new Error('权限所有者必须是已启用的现有管理员');
    const directory = path.join(path.dirname(databasePath), '.archive', 'permission-backups');
    fs.mkdirSync(directory, { recursive: true });
    const backupPath = path.join(directory, `before-feishu-push-${Date.now()}-${crypto.randomUUID()}.sqlite`);
    await backup(db, backupPath);
    const beforeBatchCount = db.prepare('SELECT COUNT(*) AS count FROM tracking_batches').get().count;
    const changes = [];
    db.exec('BEGIN IMMEDIATE');
    try {
      const currentOwner = db.prepare('SELECT * FROM access_members WHERE open_id=?').get(ownerOpenId);
      if (!currentOwner?.enabled || currentOwner.role !== 'admin') throw new Error('所有者权限已变化');
      for (const row of db.prepare('SELECT open_id,name,scopes_json FROM access_members').all()) {
        const before = JSON.parse(row.scopes_json);
        const after = before.filter(scope => scope !== 'feishu.push');
        if (row.open_id === ownerOpenId) after.push('feishu.push');
        if (JSON.stringify(before) === JSON.stringify(after)) continue;
        const at = new Date().toISOString();
        db.prepare('UPDATE access_members SET scopes_json=?,updated_at=?,version=version+1 WHERE open_id=?')
          .run(JSON.stringify(after), at, row.open_id);
        db.prepare(`INSERT INTO audit_logs(action,outcome,actor_open_id,actor_name,resource_type,resource_id,details_json,created_at)
          VALUES(?,?,?,?,?,?,?,?)`).run('ACCESS_ACTION_PROVISION', 'SUCCESS', ownerOpenId, currentOwner.name, 'access_member', row.open_id,
            JSON.stringify({ permission: 'feishu.push', name: row.name, before: before.includes('feishu.push'), after: after.includes('feishu.push'), exclusive: true }), at);
        changes.push({ openId: row.open_id, name: row.name, enabled: after.includes('feishu.push') });
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return { owner: { openId: owner.open_id, name: owner.name }, changes, backupPath,
      beforeBatchCount, afterBatchCount: db.prepare('SELECT COUNT(*) AS count FROM tracking_batches').get().count,
      granted: db.prepare("SELECT open_id,name FROM access_members WHERE EXISTS (SELECT 1 FROM json_each(scopes_json) WHERE value='feishu.push')").all(),
      quickCheck: db.prepare('PRAGMA quick_check').get().quick_check };
  } finally { db.close(); }
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2] || !process.argv[3]) throw new Error('用法：node server/provisionFeishuPushOwner.mjs <数据库路径> <所有者 open_id>');
  console.log(JSON.stringify(await provisionExclusiveFeishuPushOwner(path.resolve(process.argv[2]), process.argv[3])));
}
