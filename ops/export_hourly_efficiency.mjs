import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEfficiencyWarehouse } from '../server/efficiencyWarehouse.mjs';
import { createDatabase } from '../server/database.mjs';
import { analyzeHourlyEfficiency } from '../server/efficiencyHourlyAnalysis.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const folder = path.join(root, 'data/competition-efficiency');
const store = createEfficiencyWarehouse(path.join(folder, 'hourly-warehouse.sqlite'));
const db = createDatabase(path.join(root, 'data/price-rival.sqlite'));
try {
  const data = analyzeHourlyEfficiency(store.rows(), db.listBatches('tradeIn'), store.summary().days.map(d=>d.day));
  if (!data || data.periods.length < 6) throw new Error('完整覆盖期不足6期，暂不拟合');
  const target = path.join(folder, 'latest.json'), archive = path.join(folder, '.archive');
  fs.mkdirSync(archive, { recursive:true });
  if (fs.existsSync(target)) fs.renameSync(target, path.join(archive, `latest-before-hourly-export-${Date.now()}.json`));
  fs.writeFileSync(target, JSON.stringify(data,null,2));
  console.log(JSON.stringify({ periods:data.periods.length, window:data.analysisWindow, inputFingerprint:data.inputFingerprint, latestSnapshot:data.latestSnapshotSavedAt }));
} finally { store.close(); db.close(); }
