import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as XLSX from 'xlsx';
import { CalculatedProduct, TrackingBatch } from '../types';
import { SnapshotTable } from '../components/MainTable';
import HistoryPanel from '../components/HistoryPanel';
import {
  compareSnapshotProducts, createSnapshotWorkbook, selectSnapshot, snapshotRemark,
  snapshotTimeLabel, sortSnapshots
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
console.log('Snapshot history: selection, historical values, row identity, export and sparse rendering passed.');
