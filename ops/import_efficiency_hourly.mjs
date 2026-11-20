/** Import user-provided full-day JD hourly exports using the same rules as the UI. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEfficiencyWarehouse } from '../server/efficiencyWarehouse.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const replaceDates = args.includes('--replace-dates');
const files = args.filter(a => a !== '--replace-dates');
if (!files.length) throw new Error('Usage: node ops/import_efficiency_hourly.mjs [--replace-dates] file.xlsx ...');
const store = createEfficiencyWarehouse(path.join(root, 'data/competition-efficiency/hourly-warehouse.sqlite'));
const report = { importedAt: new Date().toISOString(), files: [] };
try {
  for (const file of files) {
    const buffer = fs.readFileSync(file), preview = store.inspect(buffer);
    const result = store.import(buffer, path.basename(file), 'user-provided-history', { completeDays: true, replaceDates, revision: preview.revision });
    const receipt = { file: path.basename(file), hash: preview.hash, duplicate: result.duplicate,
      days: preview.days.length, start: preview.days[0].day, end: preview.days.at(-1).day,
      rows: preview.records.length, quotes: preview.days.reduce((s,d) => s+d.quotes,0), submissions: preview.days.reduce((s,d) => s+d.submissions,0),
      replacedDays: preview.days.filter(d=>d.previous).map(d=>({ day:d.day, beforeQuotes:d.previous.quotes, beforeSubmissions:d.previous.submissions, afterQuotes:d.quotes, afterSubmissions:d.submissions })) };
    report.files.push(receipt);
    console.log(JSON.stringify(receipt));
  }
  const days = store.summary().days;
  report.total = { days: days.length, start: days[0]?.day, end: days.at(-1)?.day,
    rows: days.reduce((s,d)=>s+d.rowCount,0), quotes: days.reduce((s,d)=>s+d.quotes,0), submissions: days.reduce((s,d)=>s+d.submissions,0) };
  const target = path.join(root, 'data/competition-efficiency', `import-receipt-${Date.now()}.json`);
  fs.writeFileSync(target, JSON.stringify(report,null,2));
  console.log(JSON.stringify({ ...report.total, receipt: target }));
} finally { store.close(); }
