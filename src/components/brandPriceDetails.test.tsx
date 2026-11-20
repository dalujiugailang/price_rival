import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {detailChange, detailScales, sortDetailGroups, BrandSeriesChanges} from './PriceComparisonPanels';
import {aggregate} from '../utils/priceAnalysis';
type Agg = ReturnType<typeof aggregate>;
const group = (name: string, jd: number | null, tm: number | null) => ({name, agg: {count: 2, coverage: .5, points: [
  {totalSubsidy: jd === null ? null : 100, tmSubsidyManual: tm === null ? null : 100, recommendJdPrice: 100, tmPrice: 100},
  {totalSubsidy: jd === null ? null : 100 + jd, tmSubsidyManual: tm === null ? null : 100 + tm, recommendJdPrice: 110, tmPrice: 80}
]} as Agg});
const rows = [group('flat', 0, 0), group('negative', -300, null), group('positive', 30, 773.45), group('tie', null, -300), group('missing', null, null)];
assert.deepEqual(sortDetailGroups(rows, '1:both').map(r => r.name), ['positive', 'negative', 'tie', 'flat', 'missing']);
assert.deepEqual(sortDetailGroups(rows, '1:jd').map(r => r.name), ['negative', 'positive', 'flat', 'tie', 'missing']);
assert.deepEqual(sortDetailGroups(rows, '1:tm').map(r => r.name), ['positive', 'tie', 'flat', 'negative', 'missing']);
assert.equal(sortDetailGroups(rows, 'original'), rows);
assert.equal(detailScales(rows, 'amount')[1], 773.45);
assert.equal(detailScales(rows, 'amount')[0], 20);
assert.equal(detailScales(rows, 'rate')[0], 20);
assert.deepEqual(detailChange(group('missing', null, null).agg, 'totalSubsidy'), {delta: null, rate: null});
assert.equal(detailChange({points: [{totalSubsidy: 0}, {totalSubsidy: 50}], count: 1, coverage: 1}, 'totalSubsidy').rate, null);
assert.equal(detailChange({points: [{totalSubsidy: NaN}, {totalSubsidy: 50}], count: 1, coverage: 1}, 'totalSubsidy').delta, null);
const html = renderToStaticMarkup(<table><tbody><BrandSeriesChanges brand="测试" batches={[]}/></tbody></table>);
assert.ok(html.includes('value="1:both" selected=""'));
assert.ok(html.includes('min="50" max="500" step="10" value="100"'));
assert.ok(!html.includes('灰色底轨') && html.includes('突出重大异动'));
assert.ok(!html.includes('bg-blue-50'));
console.log('Brand detail sorting, shared scales, missing values and toolbar defaults passed.');
const batches = [0, 1].map(period => ({id: String(period), date: '2026-11-18', products: ['轻微', '重大'].map((name, index) => ({
  ppv: name, brand: '华为', newSeries: name, quoteVolume: 10,
  basePrice: 1000, recommendJdPrice: 1000 + period * 10, tmPrice: 1000,
  totalSubsidy: 100 + period * (index ? 200 : 10), tmSubsidyManual: 100,
  postJdHandPrice: 1100 + period * 10, tmHandPrice: 1100
}))})) as unknown as import('../types').TrackingBatch[];
const detail = renderToStaticMarkup(<table><tbody><BrandSeriesChanges brand="华为" batches={batches}/></tbody></table>);
assert.ok(detail.indexOf('华为新机系列：重大') < detail.indexOf('华为新机系列：轻微'));
assert.equal((detail.match(/class="brand-detail-metric"/g) || []).length, 6);
assert.equal((detail.match(/tabindex="0"/g) || []).length, 12);
assert.equal((detail.match(/brand-detail-major-up/g) || []).length, 1);
assert.equal((detail.match(/10 PPV/g) || []).length, 0);
assert.ok(detail.includes('1 PPV · 覆盖 100%'));
assert.ok(detail.includes('width:50%') && detail.includes('width:2.5%'));
assert.ok(!detail.includes('brand-detail-plot brand-detail-track'));
console.log('Real aggregation render: default subsidy order, all six platform metrics, per-cell highlight and default track passed.');

assert.ok(!html.includes('图形映射口径'), 'amount mapping is fixed; selector is removed');
