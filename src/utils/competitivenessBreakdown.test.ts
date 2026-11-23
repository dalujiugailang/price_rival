import assert from 'node:assert/strict';
import type { CalculatedProduct, TrackingBatch } from '../types';
import { buildCompetitivenessBreakdown } from './competitivenessBreakdown';
import { buildCompetitivenessView, getPreviousCompetitivenessSnapshot, LIVE_DRAFT } from './competitivenessView';
const product = (brand: string, newSeries: string, weight: number, win: boolean, handWin = win) => ({
  brand, newSeries, quoteVolume: weight, tmPrice: 100, tmHandPrice: 120,
  postTmItemWin: win, postTmHandWin: handWin,
} as CalculatedProduct);
const products = [product('华为', 'Mate 80', 10, true, false), product('华为', 'Mate 80', 90, false, true), product('小米', '17', 10, true)];
const before = JSON.stringify(products);
const rows = buildCompetitivenessBreakdown(products, false);
const huawei = rows.find(row => row.brand === '华为')!;
assert.equal(huawei.tmItemScore, 10, 'aggregate by quote weight, not average PPV win rate');
assert.equal(huawei.tmDirectScore, 90);
assert.equal(huawei.itemWeight, 100);
assert.equal(huawei.count, 2);
const series = buildCompetitivenessBreakdown(products.filter(p => p.brand === '华为'), true);
assert.equal(series.length, 1);
assert.equal(series[0].series, 'Mate 80');
assert.equal(series[0].tmItemScore, 10);
const missing = buildCompetitivenessBreakdown([{ ...products[0], tmPrice: 0, tmHandPrice: 0 }], false)[0];
assert.equal(missing.tmItemScore, null);
assert.equal(missing.tmDirectScore, null);
assert.equal(missing.itemWeight, 0);
assert.equal(buildCompetitivenessBreakdown([product('华为', 'Mate 80', 10, false)], false)[0].tmItemScore, 0);
assert.equal(buildCompetitivenessBreakdown([product('华为', 'Mate 80', 0, true)], false)[0].tmItemScore, null);
assert.equal(buildCompetitivenessBreakdown([product('华为', '同名', 10, true), product('小米', '同名', 10, false)], true).length, 2, 'do not merge same-name series from different brands');
assert.equal(JSON.stringify(products), before);
const history = [
  { id: 'legacy', date: '2026-10-20', products, isCompetitivenessConfirmed: true },
  { id: 'regular', date: '2026-10-21', batchType: 'regular', products, isCompetitivenessConfirmed: true },
  { id: 'launch', date: '2026-10-22', batchType: 'launch', products: [products[2]], isCompetitivenessConfirmed: true },
  { id: 'unconfirmed', date: '2026-10-23', products, isCompetitivenessConfirmed: false }
] as TrackingBatch[];
const view = buildCompetitivenessView({ historyBatches: history, currentCalculatedItems: products, brand: '华为' });
assert.equal(view.timeline.at(-1)?.batchId, LIVE_DRAFT);
assert.equal(getPreviousCompetitivenessSnapshot(view.snapshots, view.details)?.batchId, 'launch');
assert.equal(getPreviousCompetitivenessSnapshot(view.snapshots, view.details)?.metrics.tmItemScore, null, 'missing previous dimension cannot fall back to an older batch');
const launch = buildCompetitivenessView({ historyBatches: history, currentCalculatedItems: products, sourceId: 'launch' });
assert.equal(getPreviousCompetitivenessSnapshot(launch.snapshots, launch.details)?.batchId, 'regular', 'history comparison crosses batch types');
const regular = buildCompetitivenessView({ historyBatches: history.filter(batch => batch.batchType === 'regular'), currentCalculatedItems: products });
assert.equal(regular.details?.batchId, LIVE_DRAFT);
assert.equal(getPreviousCompetitivenessSnapshot(regular.snapshots, regular.details)?.batchId, 'regular');
const first = buildCompetitivenessView({ historyBatches: history, currentCalculatedItems: products, sourceId: 'legacy' });
assert.equal(getPreviousCompetitivenessSnapshot(first.snapshots, first.details), undefined);
console.log('breakdown weighting, missing values, series separation, cross-type baseline and live-node regressions passed');
