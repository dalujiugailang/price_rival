import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as XLSX from 'xlsx';

const fail = message => { throw Object.assign(new Error(message), { statusCode: 400 }); };
const text = value => String(value ?? '').trim();
export const normalizeModel = value => text(value).normalize('NFKC').replace(/\s+/g, '').toLowerCase();
export const ceilSnapshotHour = timestamp => {
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(timestamp || '')) return null;
  const instant = Date.parse(timestamp);
  return Number.isFinite(instant) ? Math.ceil(instant / 3600000) * 3600000 : null;
};
export const beijingTime = instant => new Date(instant + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
const validDay = day => /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;

export function parseHourlyWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const fields = ['报价日期', '报价小时', '商品型号', 'A等级价位段', '报价量', '提交量'];
  let source;
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
    if (range.e.r > 500000 || range.e.c > 100) fail('文件范围过大，请分批上传');
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
    if (fields.every(key => rows[0]?.map(text).includes(key))) {
      const header = rows[0].map(text);
      source = rows.slice(1).map((r, index) => ({ line: index + 2, cells: Object.fromEntries(header.map((key, i) => [key, r[i]])) }));
      break;
    }
  }
  if (!source) fail(`首行需要字段：${fields.join('、')}`);
  const seen = new Set();
  const records = [];
  for (const { line, cells: v } of source) {
    if (fields.every(key => !text(v[key]))) continue;
    let day = text(v['报价日期']);
    if (typeof v['报价日期'] === 'number') {
      const date = XLSX.SSF.parse_date_code(v['报价日期']);
      day = date ? `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}` : '';
    }
    const hour = Number(v['报价小时']);
    const model = text(v['商品型号']), band = text(v['A等级价位段']);
    const quotes = Number(v['报价量']), submissions = Number(v['提交量']);
    if (!validDay(day) || !text(v['报价小时']) || !Number.isInteger(hour) || hour < 0 || hour > 23) fail(`第${line}行日期或小时无效`);
    if (!model || !band) fail(`第${line}行型号或价位段为空`);
    if (!text(v['报价量']) || !text(v['提交量']) || !Number.isSafeInteger(quotes) || !Number.isSafeInteger(submissions) || quotes < 0 || submissions < 0 || submissions > quotes) fail(`第${line}行报价量、提交量须为非负整数，且提交量不大于报价量`);
    const key = JSON.stringify([day, hour, normalizeModel(model), band]);
    if (seen.has(key)) fail(`第${line}行日期×小时×型号×价位段重复，请先合并后上传`);
    seen.add(key);
    records.push({ day, hour, model, band, quotes, submissions });
  }
  if (!records.length) fail('文件没有有效数据');
  return records;
}

export function createEfficiencyWarehouse(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS imports(id TEXT PRIMARY KEY,hash TEXT NOT NULL UNIQUE,file_name TEXT NOT NULL,created_at TEXT NOT NULL,actor TEXT NOT NULL,original BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS hourly(import_id TEXT NOT NULL,day TEXT NOT NULL,hour INTEGER NOT NULL,model TEXT NOT NULL,band TEXT NOT NULL,quotes INTEGER NOT NULL,submissions INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS hourly_import_day ON hourly(import_id,day);
    CREATE TABLE IF NOT EXISTS active_days(day TEXT PRIMARY KEY,import_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS day_versions(id INTEGER PRIMARY KEY,day TEXT NOT NULL,import_id TEXT NOT NULL,replaced_import_id TEXT,created_at TEXT NOT NULL);
    CREATE VIEW IF NOT EXISTS fact_jd_tradein_quote_hourly AS
      SELECT '京东换新' channel,h.day quote_date,h.hour quote_hour,
        h.day || 'T' || printf('%02d',h.hour) || ':00:00+08:00' quote_time,
        h.model model,h.band submission_a_price_band,h.quotes quote_count,h.submissions submission_count,
        h.import_id source_import_id
      FROM hourly h JOIN active_days a ON h.day=a.day AND h.import_id=a.import_id;`);
  const summary = () => ({ channel: '京东换新', days: db.prepare(`SELECT a.day,COUNT(*) rowCount,SUM(h.quotes) quotes,SUM(h.submissions) submissions,i.file_name fileName,i.created_at importedAt
    FROM active_days a JOIN hourly h ON h.day=a.day AND h.import_id=a.import_id JOIN imports i ON i.id=a.import_id GROUP BY a.day ORDER BY a.day`).all(),
    imports: db.prepare('SELECT id,file_name fileName,created_at createdAt FROM imports ORDER BY created_at DESC LIMIT 20').all() });
  const inspect = buffer => {
    const records = parseHourlyWorkbook(buffer);
    const grouped = new Map();
    const old = new Map(summary().days.map(d => [d.day, d]));
    for (const row of records) {
      if (!grouped.has(row.day)) grouped.set(row.day, { day: row.day, rowCount: 0, quotes: 0, submissions: 0, previous: old.get(row.day) || null });
      const day = grouped.get(row.day); day.rowCount++; day.quotes += row.quotes; day.submissions += row.submissions;
    }
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const revision = crypto.createHash('sha256').update(JSON.stringify([...grouped.keys()].sort().map(day => [day, db.prepare('SELECT import_id FROM active_days WHERE day=?').get(day)?.import_id || null]))).digest('hex');
    return { records, hash, revision, days: [...grouped.values()].sort((a, b) => a.day.localeCompare(b.day)), duplicate: !!db.prepare('SELECT id FROM imports WHERE hash=?').get(hash) };
  };
  return {
    summary, inspect,
    import(buffer, fileName, actor, options = {}) {
      const preview = inspect(buffer);
      if (!options.completeDays) fail('请确认文件包含所列日期的全天完整数据');
      const today = beijingTime(Date.now()).slice(0, 10);
      if (preview.days.some(d => d.day >= today)) fail('仅接受已结束日期的全天数据，今天及未来日期请次日再上传');
      db.exec('BEGIN IMMEDIATE');
      try {
        const current = inspect(buffer);
        if (current.revision !== options.revision) fail('数仓已更新，请重新预览后确认');
        if (current.duplicate) { db.exec('ROLLBACK'); return { duplicate: true, summary: summary() }; }
        if (current.days.some(d => d.previous) && !options.replaceDates) fail('存在已有日期，请确认按整天替换；旧版本将保留');
        const id = crypto.randomUUID(), now = new Date().toISOString();
        db.prepare('INSERT INTO imports VALUES(?,?,?,?,?,?)').run(id, current.hash, text(fileName).slice(0, 250), now, text(actor), buffer);
        const insert = db.prepare('INSERT INTO hourly VALUES(?,?,?,?,?,?,?)');
        for (const r of current.records) insert.run(id, r.day, r.hour, r.model, r.band, r.quotes, r.submissions);
        for (const d of current.days) {
          const previous = db.prepare('SELECT import_id FROM active_days WHERE day=?').get(d.day)?.import_id || null;
          db.prepare('INSERT INTO day_versions(day,import_id,replaced_import_id,created_at) VALUES(?,?,?,?)').run(d.day, id, previous, now);
          db.prepare('INSERT INTO active_days VALUES(?,?) ON CONFLICT(day) DO UPDATE SET import_id=excluded.import_id').run(d.day, id);
        }
        db.exec('COMMIT');
        return { duplicate: false, summary: summary() };
      } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
    },
    rows: () => db.prepare('SELECT source_import_id import_id,quote_date day,quote_hour hour,model,submission_a_price_band band,quote_count quotes,submission_count submissions FROM fact_jd_tradein_quote_hourly ORDER BY quote_date,quote_hour').all(),
    close: () => db.close()
  };
}
