import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { backfillTmRecyclerCompetitivenessBatch } from '../shared/tmRecyclerCompetitiveness.mjs';

const args = process.argv.slice(2);
const databaseFlagIndex = args.indexOf('--database');
const databasePath = path.resolve(databaseFlagIndex >= 0 ? args[databaseFlagIndex + 1] : 'data/price-rival.sqlite');
const shouldApply = args.includes('--apply');

if (!fs.existsSync(databasePath)) {
  throw new Error(`数据库不存在：${databasePath}`);
}

const db = new DatabaseSync(databasePath, { timeout: 5000 });
const rows = db.prepare(`
  SELECT id, payload_json, is_summary_only
  FROM tracking_batches
  WHERE deleted_at IS NULL AND channel_id = 'tradeIn'
  ORDER BY COALESCE(competitiveness_date, batch_date), created_at
`).all();

const updates = rows.map(row => {
  const batch = JSON.parse(row.payload_json);
  const nextBatch = backfillTmRecyclerCompetitivenessBatch({
    ...batch,
    channelId: 'tradeIn',
    isSummaryOnly: Boolean(row.is_summary_only)
  });
  const payload = JSON.stringify(nextBatch);
  return {
    id: row.id,
    payload,
    changed: payload !== row.payload_json,
    summaryOnly: Boolean(row.is_summary_only),
    productCount: Array.isArray(nextBatch.products) ? nextBatch.products.length : 0,
    ahsVsTmRecyclerScore: nextBatch.competitivenessMetrics?.ahsVsTmRecyclerScore ?? null,
    jdVsZzDirectScore: nextBatch.competitivenessMetrics?.jdVsZzDirectScore ?? null
  };
});

const report = {
  mode: shouldApply ? 'apply' : 'dry-run',
  databasePath,
  totalBatches: rows.length,
  changedBatches: updates.filter(update => update.changed).length,
  detailedBatches: updates.filter(update => !update.summaryOnly && update.productCount > 0).length,
  summaryOnlyBatches: updates.filter(update => update.summaryOnly).length,
  detailedProducts: updates.reduce((sum, update) => sum + (update.summaryOnly ? 0 : update.productCount), 0),
  summaryOnlyMetricPolicy: 'new metrics remain null without PPV detail'
};

if (shouldApply) {
  const backupDir = path.join(path.dirname(databasePath), 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const backupPath = path.join(backupDir, `price-rival-before-tm-recycler-${timestamp}.sqlite`);
  db.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`);

  const updateStatement = db.prepare('UPDATE tracking_batches SET payload_json = ?, updated_at = ? WHERE id = ?');
  const auditStatement = db.prepare(`
    INSERT INTO audit_logs (
      action, outcome, resource_type, resource_id, details_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const now = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    updates.filter(update => update.changed).forEach(update => {
      updateStatement.run(update.payload, now, update.id);
    });
    auditStatement.run(
      'TM_RECYCLER_COMPETITIVENESS_BACKFILL',
      'SUCCESS',
      'tracking_batch',
      null,
      JSON.stringify(report),
      now
    );
    db.exec('COMMIT');
    report.backupPath = backupPath;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

db.close();
console.log(JSON.stringify(report, null, 2));
