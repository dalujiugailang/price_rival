import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as XLSX from 'xlsx';
import { CalculatedProduct, SourceUploadRecord, TrackingBatch } from '../types';
import { SnapshotTable } from '../components/MainTable';
import HistoryPanel from '../components/HistoryPanel';
import { getSnapshotSourceFiles, selectSnapshotSourceFiles } from './snapshotSourceFiles';
import {
  compareSnapshotProducts, createSnapshotWorkbook, selectSnapshot, snapshotRemark,
  snapshotTimeLabel, snapshotPricingTimeLabel, sortSnapshots
} from './snapshotHistory';

// Sparse products reproduce older saved payloads which lack recently added fields.
const product = (overrides: Partial<CalculatedProduct> = {}) => ({
  id: 'p1', ppv: 'PPV-1', oldModel: '测试型号', newSeries: '测试系列', skuId: 1001,
  levelId: 'L1', jdPrice: 90, recommendJdPrice: 103, recommendAdjustment: 13,
  tmPrice: 100, postMarginalProfit: 0, quoteVolume: 100,
  postTmItemWin: true, rawFields: { 原始备注: '=1+1', 原始数字: 0 }, ...overrides
} as CalculatedProduct);
const batch = (overrides: Partial<TrackingBatch> = {}): TrackingBatch => ({
  id: 'TRACK-20260908-170000-A', channelId: 'tradeIn', channelName: '京东换新',
  date: '2026-09-08', dataDate: '2026-09-08', operator: '验收',
  marginBottomLine: 0.03, pricingMode: 'margin', products: [product()], ...overrides
});

const older = batch({ serverCreatedAt: '2026-09-08T07:00:00Z' });
const newer = batch({ id: 'TRACK-20260908-180000-B', competitivenessDate: '2026-08-01', serverCreatedAt: '2026-09-08T10:00:00Z' });
const summary = batch({ id: 'SUMMARY', products: [], isSummaryOnly: true, serverCreatedAt: '2026-09-09T01:00:00Z' });
const unsorted = [older, newer, summary];
const sorted = sortSnapshots(unsorted);
assert.deepEqual(sorted.map(item => item.id), [summary.id, newer.id, older.id]);
assert.equal(unsorted[0], older, 'sorting must not mutate the parent history');
assert.equal(selectSnapshot(sorted)?.id, newer.id, 'default opens the latest detailed snapshot');
assert.equal(selectSnapshot(sorted, summary.id)?.id, summary.id, 'explicit summary selection is preserved');
assert.equal(selectSnapshot(sorted, 'deleted')?.id, newer.id);
assert.equal(selectSnapshot([]), undefined);
assert.equal(snapshotTimeLabel(newer), '2026-09-08 18:00');
assert.equal(snapshotTimeLabel(batch(), true), '09/08 17:00');
const edited = batch({ pricingTimestamp: '2026-09-07 16:18', serverCreatedAt: '2026-09-08T10:00:00Z' });
assert.equal(snapshotPricingTimeLabel(edited, true), '09/07 16:18');
assert.equal(snapshotPricingTimeLabel({ ...edited, serverCreatedAt: '2026-09-10T10:00:00Z' }, true), '09/07 16:18');
assert.equal(snapshotPricingTimeLabel(batch(), true), '09/08 17:00');
assert.equal(snapshotPricingTimeLabel(batch({ pricingTimestamp: 'invalid' }), true), '09/08 17:00');
assert.equal(snapshotPricingTimeLabel(batch({ pricingTimestamp: '2026-09-07T08:18:00Z' }), true), '09/07 16:18');
assert.equal(snapshotRemark(batch({ remarks: '华为+小米；边际底线3.00%；京东换新；测算行 1 条' })), '华为+小米');

const rows = compareSnapshotProducts(
  batch({ products: [product({ recommendJdPrice: 0, postMarginalProfit: 0 }), product({ skuId: 1002, recommendJdPrice: 90 }), product({ skuId: 1003 })] }),
  batch({ products: [product({ recommendJdPrice: 103, postMarginalProfit: 0.02 }), product({ skuId: 1002, recommendJdPrice: 91 }), product({ skuId: 1004 })] })
);
assert.equal(rows.length, 4, 'repeated PPV across SKUs must not collapse');
assert.equal(rows[0].priceDiff, 103, 'zero saved price is valid');
assert.equal(rows[0].marginDiff, 0.02, 'zero saved margin is valid');
assert.equal(rows[1].priceDiff, 1);
assert.equal(rows[2].presence, '本期未包含');
assert.equal(rows[2].priceDiff, null);
assert.equal(rows[3].presence, '本期新增');
assert.equal(compareSnapshotProducts(batch({ products: [product(), product()] }), batch({ products: [product(), product()] })).length, 2);

const saved = batch();
const before = JSON.stringify(saved);
const workbook = createSnapshotWorkbook(saved, saved.products, [
  { code: 'AY', label: '京东物品价-追价后', width: 120, getValue: p => p.recommendJdPrice },
  { code: 'BE', label: '追后边际利润率', width: 120, numberFormat: '0.00%', getValue: p => p.postMarginalProfit },
  { code: 'MISSING', label: '历史缺失列', width: 120, getValue: p => p.tmRecyclerSubsidy }
]);
const loaded = XLSX.read(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer', cellNF: true });
assert.equal(loaded.Sheets['快照明细'].A3.v, 103);
assert.equal(loaded.Sheets['快照明细'].B3.v, 0);
assert.equal(loaded.Sheets['快照明细'].B3.z, '0.00%');
assert.equal(loaded.Sheets['快照明细'].C3, undefined, 'missing history values must not become zero');
for (const sheet of Object.values(loaded.Sheets)) {
  for (const [address, cell] of Object.entries(sheet)) {
    if (!address.startsWith('!')) assert.equal(cell.f, undefined, 'historical workbooks must contain no live formulas');
  }
}
assert.equal(JSON.stringify(saved), before, 'export must not mutate a saved snapshot');
const html = renderToStaticMarkup(<SnapshotTable batch={saved} />);
assert.match(html, /快照明细/);
assert.match(html, /商品SKUID/);
assert.match(html, /京东物品价-追价后调整金额/);
assert.match(html, /保存模式/);
assert.doesNotMatch(html, /双击手动改价|保存快照|容忍\(/);
assert.doesNotMatch(html, /到手价两步追价|回调边际底线/, 'historical snapshots must not expose repricing actions');
assert.doesNotMatch(html, /100\.0%/, 'do not recalculate missing saved competitiveness with current rules');
assert.match(html, /—/);
const emptyHtml = renderToStaticMarkup(<HistoryPanel historyBatches={[]} onSelectBatch={() => {}} />);
assert.match(emptyHtml, /暂无快照/);
const summaryHtml = renderToStaticMarkup(<HistoryPanel historyBatches={[summary]} onSelectBatch={() => {}} />);
assert.match(summaryHtml, /本期仅保存了竞争力汇总/);
assert.doesNotMatch(summaryHtml, /导出快照/);
const sourceRecord = (id: string, type: SourceUploadRecord['type'], uploadedAt: string, sourceFileId?: string): SourceUploadRecord => ({
  id, type, uploadedAt, sourceFileId, fileName: `${id}.xlsx`, rowCount: 1
});
const sourceHistory = [
  sourceRecord('old-base', 'base', '2026-09-28 10:00:00', 'file-old-base'),
  sourceRecord('latest-subsidy', 'subsidy', '2026-09-30 10:00:00', 'file-latest-subsidy'),
  sourceRecord('old-subsidy', 'subsidy', '2026-09-29 10:00:00', 'file-old-subsidy'),
  sourceRecord('latest-base', 'base', '2026-09-30 11:00:00', 'file-latest-base'),
  sourceRecord('daily-price', 'dailyPrice', '2026-09-30 12:00:00')
];
assert.deepEqual(selectSnapshotSourceFiles(sourceHistory).map(record => record.id), ['latest-base', 'latest-subsidy']);
const sourcedBatch = batch({ sourceUploadRecords: sourceHistory, subsidyFileName: 'latest-subsidy.xlsx' });
const sourceHtml = renderToStaticMarkup(<HistoryPanel historyBatches={[sourcedBatch]} onSelectBatch={() => {}} />);
assert.match(sourceHtml, /下载 latest-base.xlsx/);
assert.match(sourceHtml, /下载 latest-subsidy.xlsx/);
assert.doesNotMatch(sourceHtml, /old-base.xlsx|old-subsidy.xlsx|daily-price.xlsx/);
assert.equal((sourceHtml.match(/\/api\/source-files\//g) || []).length, 2, 'history shows at most two downloads');
assert.equal(sourcedBatch.sourceUploadRecords?.length, 5, 'the full upload history stays available');
const boundBatch = batch({ sourceUploadRecords: sourceHistory, snapshotSourceFiles: [sourceHistory[0], sourceHistory[2]] });
assert.deepEqual(getSnapshotSourceFiles(boundBatch).map(record => record.id), ['old-base', 'old-subsidy'], 'explicit snapshot binding wins over later upload history');
const missingLatest = batch({ sourceUploadRecords: [sourceRecord('missing-base', 'base', '2026-10-01 10:00:00'), ...sourceHistory] });
assert.equal(getSnapshotSourceFiles(missingLatest)[0].sourceFileId, undefined, 'missing latest original must not fall back to an older file');
console.log('Snapshot history: selection, historical values, row identity, export and sparse rendering passed.');
