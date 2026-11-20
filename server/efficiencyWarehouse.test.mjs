import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { createEfficiencyWarehouse, ceilSnapshotHour, beijingTime, parseHourlyWorkbook } from './efficiencyWarehouse.mjs';
import { analyzeHourlyEfficiency } from './efficiencyHourlyAnalysis.mjs';

const workbook = rows => {
  const w = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(w, XLSX.utils.aoa_to_sheet([['报价日期','报价小时','商品型号','A等级价位段','报价量','提交量'], ...rows]), '数据');
  return XLSX.write(w, { type: 'buffer', bookType: 'xlsx' });
};
const batch = (id, time, model = '竞争型号') => ({ id, channelId: 'tradeIn', batchType: 'regular', serverCreatedAt: time,
  products: [{ ppv: model, oldModel: model, quoteVolume: 10, tmHandPrice: 100, postJdHandPrice: 110 }], competitionCoveragePpvs: [model] });
test('保存时间向上取整，跨日与整点精确处理', () => {
  assert.equal(beijingTime(ceilSnapshotHour('2026-11-17T15:37:00+08:00')), '2026-11-17 16:00');
  assert.equal(beijingTime(ceilSnapshotHour('2026-11-17T15:58:00+08:00')), '2026-11-17 16:00');
  assert.equal(beijingTime(ceilSnapshotHour('2026-11-17T16:00:00+08:00')), '2026-11-17 16:00');
  assert.equal(beijingTime(ceilSnapshotHour('2026-11-17T23:59:00+08:00')), '2026-11-18 00:00');
  assert.equal(ceilSnapshotHour('2026-11-17'), null);
});
test('数仓按日期累计，替换整日不叠加，相同文件幂等，旧版本保留', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'efficiency-warehouse-')), 'warehouse.sqlite');
  const store = createEfficiencyWarehouse(file);
  try {
    const a = workbook([['2026-11-01', 16, '型号', '[1-500]', 10, 3]]);
    const b = workbook([['2026-11-01', 17, '型号', '[1-500]', 20, 7], ['2026-11-02', 18, '型号', '[1-500]', 30, 8]]);
    let p = store.inspect(a);
    store.import(a, 'a.xlsx', 'test', { completeDays: true, revision: p.revision });
    p = store.inspect(b);
    assert.throws(() => store.import(b, 'b.xlsx', 'test', { completeDays: true, revision: p.revision }), /整天替换/);
    store.import(b, 'b.xlsx', 'test', { completeDays: true, replaceDates: true, revision: p.revision });
    assert.equal(store.rows().length, 2);
    assert.equal(store.summary().days[0].quotes, 20);
    assert.equal(store.summary().imports.length, 2);
    assert.equal(store.import(b, 'b.xlsx', 'test', { completeDays: true, replaceDates: true, revision: store.inspect(b).revision }).duplicate, true);
    assert.throws(() => store.import(a, 'a.xlsx', 'test', { completeDays: true, revision: p.revision }), /重新预览/);
  } finally { store.close(); }
});
test('拒绝重复主键与非法小时和提交量', () => {
  const row = ['2026-11-01', 16, '型号', '[1-500]', 10, 3];
  assert.throws(() => parseHourlyWorkbook(workbook([row, row])), /重复/);
  assert.throws(() => parseHourlyWorkbook(workbook([['2026-11-01', 24, '型号', '档', 10, 3]])), /小时无效/);
  assert.throws(() => parseHourlyWorkbook(workbook([['2026-11-01', 16, '型号', '档', 10, 11]])), /不大于/);
});
test('整点半开区间分配，同一生效小时最后快照胜出，当期实际报价权重', () => {
  const batches = [batch('old', '2026-11-01T15:37:00+08:00', '旧型号'), batch('one', '2026-11-01T15:58:00+08:00'), batch('two', '2026-11-02T15:58:00+08:00'), batch('three', '2026-11-03T15:01:00+08:00')];
  const rows = [
    { day:'2026-11-01',hour:15,model:'竞争型号',band:'低',quotes:1000,submissions:1000 },
    { day:'2026-11-01',hour:16,model:'竞争型号',band:'低',quotes:90,submissions:45 },
    { day:'2026-11-01',hour:16,model:'对照型号',band:'低',quotes:10,submissions:3 },
    { day:'2026-11-01',hour:16,model:'段外型号',band:'竞争未涉及段',quotes:1000,submissions:1000 },
    { day:'2026-11-02',hour:15,model:'竞争型号',band:'高',quotes:10,submissions:1 },
    { day:'2026-11-02',hour:15,model:'对照型号',band:'高',quotes:10,submissions:2 },
    { day:'2026-11-02',hour:16,model:'竞争型号',band:'低',quotes:20,submissions:2 },
    { day:'2026-11-02',hour:16,model:'对照型号',band:'低',quotes:10,submissions:2 }
  ];
  const output = analyzeHourlyEfficiency(rows, batches, ['2026-11-01','2026-11-02','2026-11-03']);
  assert.equal(output.periods.length, 2);
  assert.equal(output.periods[0].batchId, 'one');
  assert.equal(output.periods[0].competitionQuotes, 100);
  assert.equal(output.periods[0].controlQuotes, 20);
  assert.equal(output.periods[0].excludedNonCompetitionBandQuotes, 1000);
  assert.ok(Math.abs(output.periods[0].difference - 17) < 1e-8);
  assert.equal(output.periods[1].competitionQuotes, 20);
  assert.equal(output.periods[0].hours, 24);
  const missing = analyzeHourlyEfficiency(rows, batches, ['2026-11-01','2026-11-03']);
  assert.equal(missing.periods.length, 0);
  assert.ok(missing.excludedPeriods.some(p => p.reason.includes('2026-11-02')));
  assert.equal(output.inputFingerprint, analyzeHourlyEfficiency(rows, batches, ['2026-11-01','2026-11-02','2026-11-03']).inputFingerprint);
  assert.notEqual(output.inputFingerprint, analyzeHourlyEfficiency(rows.map(r => ({...r, submissions:0})), batches, ['2026-11-01','2026-11-02','2026-11-03']).inputFingerprint);
});
