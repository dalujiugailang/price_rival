import assert from 'node:assert/strict';
import { CalculatedProduct, TrackingBatch } from '../types';
import {
  ALL_BRANDS,
  buildBrandCompetitivenessTimeline,
  filterCompetitivenessProducts,
  listCompetitivenessBrands,
  selectCompetitivenessTimeline
} from './brandCompetitiveness';

const product = (
  brand: string,
  quoteVolume: number,
  win: boolean,
  rawFields: Record<string, string> = {}
) => ({
  brand,
  rawFields,
  quoteVolume,
  tmPrice: 100,
  tmHandPrice: 120,
  zzPrice: 90,
  zzHandPrice: 110,
  postTmItemWin: win,
  postTmHandWin: win,
  postZzItemWin: win,
  postAhsZzHandWin: win
} as CalculatedProduct);

const historyBatches = [
  {
    id: 'SUMMARY',
    date: '2026-08-01',
    competitivenessDate: '2026-08-01',
    isCompetitivenessConfirmed: true,
    isSummaryOnly: true,
    products: [product('纯汇总品牌', 100, true)]
  },
  {
    id: 'DETAILED',
    date: '2026-08-02',
    competitivenessDate: '2026-08-02',
    isCompetitivenessConfirmed: true,
    products: [
      product('小米', 30, true),
      product('小米', 70, false),
      product('OPPO', 100, true),
      product('17系列', 100, true),
      product('旧兜底值', 100, true, { 'BK_品牌名称': '华为' }),
      product('Redmi', 100, true)
    ]
  },
  {
    id: 'UNCONFIRMED',
    date: '2026-08-03',
    isCompetitivenessConfirmed: false,
    products: [product('小米', 100, true)]
  }
] as TrackingBatch[];

const current = [
  product('小米', 50, true),
  product('vivo', 50, false),
  product('Find', 50, true),
  product('moto', 50, true)
];

assert.deepEqual(
  listCompetitivenessBrands(historyBatches, current),
  ['vivo', '摩托罗拉', '小米']
);

const timeline = buildBrandCompetitivenessTimeline({
  historyBatches,
  currentCalculatedItems: current,
  brand: '小米',
  channelId: 'tradeIn'
});

assert.equal(timeline.length, 2);
assert.equal(timeline[0].date, '08-02');
assert.equal(timeline[0].tmItemScore, 65);
assert.equal(timeline[0].tmDirectScore, 65);
assert.equal(timeline[0].zzItemScore, 65);
assert.equal(timeline[0].ahsVsZzDirectScore, 65);
assert.equal(timeline[1].date, '今日(工作台)');
assert.equal(timeline[1].tmItemScore, 100);
assert.equal(timeline[1].isDraft, true);

assert.deepEqual(buildBrandCompetitivenessTimeline({
  historyBatches,
  currentCalculatedItems: current,
  brand: '不存在品牌',
  channelId: 'tradeIn'
}), []);

const overallTimeline = [{ date: '08-01', tmItemScore: 60 }];
const brandOnlyTimeline = [{ date: '08-02', tmItemScore: 30 }];

assert.equal(
  selectCompetitivenessTimeline(overallTimeline, brandOnlyTimeline, ALL_BRANDS),
  overallTimeline
);
assert.equal(
  selectCompetitivenessTimeline(overallTimeline, brandOnlyTimeline, '小米'),
  brandOnlyTimeline
);

assert.equal(filterCompetitivenessProducts(current, ALL_BRANDS), current);
assert.deepEqual(
  filterCompetitivenessProducts(current, '小米').map(item => item.brand),
  ['小米']
);
assert.equal(
  filterCompetitivenessProducts(historyBatches[1].products, '华为')[0].brand,
  '旧兜底值'
);

console.log('brand competitiveness checks passed');
