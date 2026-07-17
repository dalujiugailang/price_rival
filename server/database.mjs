import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const nowText = () => new Date().toISOString();
const jsonText = value => JSON.stringify(value ?? null);

const parseJson = (value, fallback) => {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

export const createDatabase = databasePath => {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath, { timeout: 5000 });
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS tracking_batches (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      batch_date TEXT NOT NULL,
      competitiveness_date TEXT,
      pricing_timestamp TEXT,
      confirmed_at TEXT,
      operator TEXT NOT NULL,
      is_confirmed INTEGER NOT NULL DEFAULT 0,
      is_summary_only INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL,
      created_by_open_id TEXT,
      created_by_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      deleted_by_open_id TEXT
    ) STRICT;

    CREATE UNIQUE INDEX IF NOT EXISTS tracking_batches_one_confirmed_date
      ON tracking_batches(channel_id, competitiveness_date)
      WHERE is_confirmed = 1 AND deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS tracking_batches_channel_date
      ON tracking_batches(channel_id, batch_date DESC);

    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      user_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS auth_sessions_expiry ON auth_sessions(expires_at);

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      outcome TEXT NOT NULL,
      actor_open_id TEXT,
      actor_name TEXT,
      resource_type TEXT,
      resource_id TEXT,
      request_id TEXT,
      ip TEXT,
      user_agent TEXT,
      details_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS audit_logs_created_at ON audit_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS audit_logs_resource ON audit_logs(resource_type, resource_id);
  `);

  const insertAuditStatement = db.prepare(`
    INSERT INTO audit_logs (
      action, outcome, actor_open_id, actor_name, resource_type, resource_id,
      request_id, ip, user_agent, details_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const writeAudit = ({
    action,
    outcome = 'SUCCESS',
    actor,
    resourceType,
    resourceId,
    requestId,
    ip,
    userAgent,
    details = {}
  }) => {
    insertAuditStatement.run(
      action,
      outcome,
      actor?.openId || null,
      actor?.name || null,
      resourceType || null,
      resourceId || null,
      requestId || null,
      ip || null,
      userAgent || null,
      jsonText(details),
      nowText()
    );
  };

  const rowToBatch = row => {
    const batch = parseJson(row.payload_json, {});
    return {
      ...batch,
      id: row.id,
      channelId: row.channel_id,
      date: row.batch_date,
      operator: row.operator,
      isCompetitivenessConfirmed: Boolean(row.is_confirmed),
      competitivenessDate: row.competitiveness_date || undefined,
      pricingTimestamp: row.pricing_timestamp || undefined,
      confirmedAt: row.confirmed_at || undefined,
      isSummaryOnly: Boolean(row.is_summary_only),
      serverCreatedAt: row.created_at,
      serverCreatedBy: row.created_by_name || undefined
    };
  };

  const listBatchStatement = db.prepare(`
    SELECT * FROM tracking_batches
    WHERE deleted_at IS NULL AND (? IS NULL OR channel_id = ?)
    ORDER BY COALESCE(competitiveness_date, batch_date) DESC, created_at DESC
  `);
  const getBatchStatement = db.prepare('SELECT * FROM tracking_batches WHERE id = ? AND deleted_at IS NULL');
  const getAnyBatchStatement = db.prepare('SELECT id FROM tracking_batches WHERE id = ?');
  const getConfirmedStatement = db.prepare(`
    SELECT id, confirmed_at FROM tracking_batches
    WHERE channel_id = ? AND competitiveness_date = ? AND is_confirmed = 1 AND deleted_at IS NULL
  `);
  const downgradeConfirmedStatement = db.prepare(`
    UPDATE tracking_batches SET is_confirmed = 0, updated_at = ?
    WHERE channel_id = ? AND competitiveness_date = ? AND is_confirmed = 1 AND deleted_at IS NULL
  `);
  const insertBatchStatement = db.prepare(`
    INSERT INTO tracking_batches (
      id, channel_id, batch_date, competitiveness_date, pricing_timestamp,
      confirmed_at, operator, is_confirmed, is_summary_only, payload_json,
      created_by_open_id, created_by_name, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertBatch = (batch, actor, forceConfirmed = undefined) => {
    const createdAt = nowText();
    const isConfirmed = forceConfirmed ?? Boolean(batch.isCompetitivenessConfirmed);
    insertBatchStatement.run(
      batch.id,
      batch.channelId || 'tradeIn',
      batch.date,
      batch.competitivenessDate || null,
      batch.pricingTimestamp || null,
      batch.confirmedAt || (isConfirmed ? createdAt : null),
      batch.operator,
      isConfirmed ? 1 : 0,
      batch.isSummaryOnly ? 1 : 0,
      jsonText(batch),
      actor?.openId || null,
      actor?.name || null,
      createdAt,
      createdAt
    );
    return isConfirmed;
  };

  const validateBatch = batch => {
    if (!batch || typeof batch !== 'object') return '缺少批次数据';
    if (!batch.id || !batch.date || !batch.operator) return '批次编号、日期和操作人不能为空';
    if (!Array.isArray(batch.products)) return '批次明细格式错误';
    if (batch.isCompetitivenessConfirmed && !batch.competitivenessDate) return '正式落数必须包含落数日期';
    return '';
  };

  const withTransaction = callback => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = callback();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };

  return {
    close: () => db.close(),

    listBatches(channelId = null) {
      return listBatchStatement.all(channelId, channelId).map(rowToBatch);
    },

    getBatch(id) {
      const row = getBatchStatement.get(id);
      return row ? rowToBatch(row) : null;
    },

    createBatch(batch, context) {
      const validationError = validateBatch(batch);
      if (validationError) throw Object.assign(new Error(validationError), { statusCode: 400 });
      if (getAnyBatchStatement.get(batch.id)) throw Object.assign(new Error('批次编号已存在'), { statusCode: 409 });

      return withTransaction(() => {
        if (batch.isCompetitivenessConfirmed) {
          downgradeConfirmedStatement.run(nowText(), batch.channelId || 'tradeIn', batch.competitivenessDate);
        }
        insertBatch(batch, context.actor);
        writeAudit({
          ...context,
          action: batch.isCompetitivenessConfirmed ? 'BATCH_CONFIRM' : 'BATCH_CREATE',
          resourceType: 'tracking_batch',
          resourceId: batch.id,
          details: {
            channelId: batch.channelId || 'tradeIn',
            competitivenessDate: batch.competitivenessDate || null,
            productCount: batch.products.length
          }
        });
        return this.getBatch(batch.id);
      });
    },

    importBatches(batches, context) {
      if (!Array.isArray(batches)) throw Object.assign(new Error('迁移数据格式错误'), { statusCode: 400 });
      if (batches.length > 500) throw Object.assign(new Error('单次最多迁移 500 个批次'), { statusCode: 400 });

      return withTransaction(() => {
        let imported = 0;
        let skipped = 0;
        const invalid = [];

        for (const batch of batches) {
          const validationError = validateBatch(batch);
          if (validationError) {
            invalid.push({ id: batch?.id || '', error: validationError });
            continue;
          }
          if (getAnyBatchStatement.get(batch.id)) {
            skipped += 1;
            continue;
          }

          let importAsConfirmed = Boolean(batch.isCompetitivenessConfirmed);
          if (importAsConfirmed) {
            const channelId = batch.channelId || 'tradeIn';
            const current = getConfirmedStatement.get(channelId, batch.competitivenessDate);
            const incomingTime = batch.confirmedAt || batch.pricingTimestamp || batch.date;
            if (current && (current.confirmed_at || '') > incomingTime) {
              importAsConfirmed = false;
            } else {
              downgradeConfirmedStatement.run(nowText(), channelId, batch.competitivenessDate);
            }
          }
          insertBatch(batch, context.actor, importAsConfirmed);
          imported += 1;
        }

        writeAudit({
          ...context,
          action: 'BATCH_IMPORT',
          resourceType: 'tracking_batch',
          details: { requested: batches.length, imported, skipped, invalid }
        });
        return { requested: batches.length, imported, skipped, invalid };
      });
    },

    deleteBatch(id, context) {
      return withTransaction(() => {
        const existing = getBatchStatement.get(id);
        if (!existing) throw Object.assign(new Error('历史批次不存在'), { statusCode: 404 });
        db.prepare(`
          UPDATE tracking_batches
          SET is_confirmed = 0, deleted_at = ?, deleted_by_open_id = ?, updated_at = ?
          WHERE id = ?
        `).run(nowText(), context.actor?.openId || null, nowText(), id);
        writeAudit({
          ...context,
          action: 'BATCH_DELETE',
          resourceType: 'tracking_batch',
          resourceId: id,
          details: { softDelete: true }
        });
        return rowToBatch(existing);
      });
    },

    createSession(tokenHash, user, expiresAt) {
      const createdAt = nowText();
      db.prepare(`
        INSERT INTO auth_sessions(token_hash, user_json, created_at, expires_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(tokenHash, jsonText(user), createdAt, expiresAt, createdAt);
    },

    getSession(tokenHash) {
      const now = nowText();
      const row = db.prepare(`
        SELECT user_json FROM auth_sessions WHERE token_hash = ? AND expires_at > ?
      `).get(tokenHash, now);
      if (!row) return null;
      db.prepare('UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?').run(now, tokenHash);
      return parseJson(row.user_json, null);
    },

    deleteSession(tokenHash) {
      db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(tokenHash);
    },

    cleanupSessions() {
      db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(nowText());
    },

    writeAudit,

    listAuditLogs(limit = 200) {
      const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 1000));
      return db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?').all(safeLimit).map(row => ({
        id: row.id,
        action: row.action,
        outcome: row.outcome,
        actorOpenId: row.actor_open_id,
        actorName: row.actor_name,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        requestId: row.request_id,
        ip: row.ip,
        userAgent: row.user_agent,
        details: parseJson(row.details_json, {}),
        createdAt: row.created_at
      }));
    }
  };
};
