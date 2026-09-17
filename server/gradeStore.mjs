import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { parseGradeTemplate, parseGradeVolume, validatePeriod } from './gradeSources.mjs';
import { normalizeGradeActivity } from '../shared/gradeExpansion.mjs';

export function createGradeStore(databasePath) {
  const db = new DatabaseSync(databasePath, { timeout: 5000 });
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS grade_sources (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, file_name TEXT NOT NULL,
      hash TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL,
      row_count INTEGER NOT NULL, payload_json TEXT NOT NULL, original BLOB NOT NULL,
      created_at TEXT NOT NULL, created_by TEXT NOT NULL,
      UNIQUE(kind,hash,period_start,period_end)
    );
    CREATE TABLE IF NOT EXISTS grade_runs (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL,
      saved INTEGER NOT NULL DEFAULT 0, payload_json TEXT NOT NULL, created_by TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS grade_run_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, action TEXT NOT NULL,
      created_at TEXT NOT NULL, actor_id TEXT NOT NULL, actor_name TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS grade_events_run ON grade_run_events(run_id, id);`);
  const columns = db.prepare('PRAGMA table_info(grade_runs)').all().map(c => c.name);
  if (!columns.includes('tracking_batch_id')) db.exec('ALTER TABLE grade_runs ADD COLUMN tracking_batch_id TEXT');
  if (!columns.includes('saved_at')) db.exec('ALTER TABLE grade_runs ADD COLUMN saved_at TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS grade_runs_batch ON grade_runs(tracking_batch_id, saved)');
  db.exec(`CREATE TABLE IF NOT EXISTS grade_batch_final (
    batch_id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE, confirmed_at TEXT, confirmed_by TEXT,
    revenue_json TEXT
  );
  INSERT OR IGNORE INTO grade_batch_final(batch_id,run_id)
    SELECT tracking_batch_id,id FROM (
      SELECT tracking_batch_id,id,ROW_NUMBER() OVER(PARTITION BY tracking_batch_id ORDER BY saved_at DESC,created_at DESC,id DESC) AS position
      FROM grade_runs WHERE saved=1 AND tracking_batch_id IS NOT NULL
    ) WHERE position=1;`);
  const actorFields = actor => typeof actor === 'string' ? { openId: actor, name: actor } : actor || {};
  const addEvent = (id, action, actor) => {
    const user = actorFields(actor);
    db.prepare('INSERT INTO grade_run_events(run_id,action,created_at,actor_id,actor_name) VALUES(?,?,?,?,?)')
      .run(id, action, new Date().toISOString(), user.openId || '', user.name || user.openId || '');
  };
  const sourceView = (row, detail = false) => row ? ({ id: row.id, kind: row.kind, fileName: row.file_name, hash: row.hash,
    periodStart: row.period_start, periodEnd: row.period_end, rowCount: row.row_count, createdAt: row.created_at,
    ...(detail ? { data: JSON.parse(row.payload_json) } : {}) }) : null;
  return {
    listSources: () => db.prepare('SELECT id,kind,file_name,hash,period_start,period_end,row_count,created_at FROM grade_sources ORDER BY created_at DESC').all().map(r => sourceView(r)),
    getSource: id => sourceView(db.prepare('SELECT * FROM grade_sources WHERE id=?').get(id), true),
    getFile: id => db.prepare('SELECT file_name,original FROM grade_sources WHERE id=?').get(id),
    saveSource({ kind, fileName, buffer, periodStart = '', periodEnd = '', actor = '' }) {
      if (!['volume', 'template'].includes(kind)) throw Object.assign(new Error('文件类型无效'), { statusCode: 400 });
      if (kind === 'volume') validatePeriod(periodStart, periodEnd);
      else { periodStart = ''; periodEnd = ''; }
      if (!buffer.length || buffer.length > 18 * 1024 * 1024) throw Object.assign(new Error('文件需为非空且不超过18MB'), { statusCode: 400 });
      const hash = crypto.createHash('sha256').update(buffer).digest('hex');
      const existing = db.prepare('SELECT * FROM grade_sources WHERE kind=? AND hash=? AND period_start=? AND period_end=?').get(kind, hash, periodStart, periodEnd);
      if (existing) return { source: sourceView(existing), reused: true };
      const data = kind === 'volume' ? parseGradeVolume(buffer) : parseGradeTemplate(buffer);
      const id = crypto.randomUUID(), createdAt = new Date().toISOString();
      db.prepare('INSERT INTO grade_sources VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id, kind, fileName, hash, periodStart, periodEnd,
        kind === 'volume' ? data.rows.length : data.rules.length, JSON.stringify(data), buffer, createdAt, actor);
      return { source: sourceView(db.prepare('SELECT * FROM grade_sources WHERE id=?').get(id)), reused: false };
    },
    createRun(payload, actor) {
      const run = { ...payload, id: crypto.randomUUID(), createdAt: new Date().toISOString(), saved: false };
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT INTO grade_runs(id,title,created_at,saved,payload_json,created_by,tracking_batch_id) VALUES(?,?,?,?,?,?,?)')
          .run(run.id, run.title, run.createdAt, 0, JSON.stringify(run), actorFields(actor).openId || '', run.request?.trackingBatchId || null);
        addEvent(run.id, run.parentRunId ? 'refreshed' : 'generated', actor);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return run;
    },
    listRuns: () => db.prepare('SELECT id,title,created_at AS createdAt,saved FROM grade_runs ORDER BY created_at DESC LIMIT 100').all().map(r => ({ ...r, saved: Boolean(r.saved) })),
    listBatchRuns: id => db.prepare(`SELECT r.id,r.title,r.created_at AS createdAt,r.saved_at AS savedAt,f.confirmed_at AS investmentConfirmedAt
      FROM grade_batch_final f JOIN grade_runs r ON r.id=f.run_id WHERE f.batch_id=?`).all(id).map(r => ({ ...r, saved: true, isFinal:true })),
    getFinalRun(id) { const final=db.prepare('SELECT run_id FROM grade_batch_final WHERE batch_id=?').get(id);return final ? this.getRun(final.run_id) : null; },
    listBatchEvents: id => db.prepare(`SELECT e.id,e.run_id AS runId,r.title,e.action,e.created_at AS createdAt,e.actor_name AS actorName
      FROM grade_run_events e JOIN grade_runs r ON r.id=e.run_id WHERE r.tracking_batch_id=? AND r.saved=1 ORDER BY e.id DESC`).all(id),
    addEvent,
    getRun(id) {
      const row = db.prepare('SELECT * FROM grade_runs WHERE id=?').get(id);
      const final=row && db.prepare('SELECT * FROM grade_batch_final WHERE run_id=?').get(id);
      return row ? { ...normalizeGradeActivity(JSON.parse(row.payload_json)), saved: Boolean(row.saved), trackingBatchId: row.tracking_batch_id || undefined, savedAt: row.saved_at || undefined,
        isFinal:Boolean(final),investmentConfirmedAt:final?.confirmed_at || undefined,investmentRevenue:final?.revenue_json ? JSON.parse(final.revenue_json) : undefined } : null;
    },
    saveRun(id, trackingBatchId, actor, {confirmInvestment=false,revenue=null}={}) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const run = this.getRun(id);
        if (!run) { db.exec('COMMIT'); return null; }
        if (!trackingBatchId) throw new Error('请关联对应的京东换新已保存快照');
        if (run.trackingBatchId && run.trackingBatchId !== trackingBatchId) throw new Error('已关联的测算不能移动到其他快照');
        if (run.saved && run.trackingBatchId && !run.isFinal) throw new Error('本版已被最终版替换，请重新计算后保存');
        const previous=db.prepare('SELECT * FROM grade_batch_final WHERE batch_id=?').get(trackingBatchId);
        if (!run.saved || !run.trackingBatchId) {
          db.prepare('UPDATE grade_runs SET saved=1,tracking_batch_id=?,saved_at=? WHERE id=?').run(trackingBatchId, new Date().toISOString(), id);
          addEvent(id, 'saved', actor);
        }
        const confirmedAt=confirmInvestment ? run.investmentConfirmedAt || new Date().toISOString() : null;
        db.prepare(`INSERT INTO grade_batch_final(batch_id,run_id,confirmed_at,confirmed_by,revenue_json) VALUES(?,?,?,?,?)
          ON CONFLICT(batch_id) DO UPDATE SET run_id=excluded.run_id,confirmed_at=excluded.confirmed_at,confirmed_by=excluded.confirmed_by,revenue_json=excluded.revenue_json`)
          .run(trackingBatchId,id,confirmedAt,confirmInvestment?actorFields(actor).openId || '':null,
            JSON.stringify(run.investmentRevenue || revenue));
        if(previous && previous.run_id!==id)addEvent(previous.run_id,'superseded',actor);
        if(confirmInvestment&&!run.investmentConfirmedAt)addEvent(id,'investment_confirmed',actor);
        db.exec('COMMIT');
        return this.getRun(id);
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    close: () => db.close()
  };
}
