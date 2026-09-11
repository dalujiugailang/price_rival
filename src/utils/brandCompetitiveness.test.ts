import assert from 'node:assert/strict';
import { CalculatedProduct, TrackingBatch } from '../types';
import {
  ALL_BRANDS,
  ALL_SERIES,
  buildBrandCompetitivenessTimeline,
  buildFilteredCompetitivenessTimeline,
  filterCompetitivenessProducts,
  listCompetitivenessBrands,
  listCompetitivenessSeries,
  resolveCompetitivenessBrand,
  selectCompetitivenessTimeline
} from './brandCompetitiveness';

const product = (
  brand: string,
  quoteVolume: number,
  win: boolean,
  rawFields: Record<string, string> = {},
  newSeries = ''
) => ({
  brand,
  newSeries,
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
      product('小米', 30, true, {}, '小米 15'),
      product('小米', 70, false, {}, '小米 14'),
      product('OPPO', 100, true, {}, 'Find X8'),
      product('17系列', 100, true, {}, 'iPhone 17'),
      product('旧兜底值', 100, true, { 'BK_品牌名称': '华为' }, 'Mate 70'),
      product('Redmi', 100, true, {}, 'Redmi K80')
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
  product('小米', 50, true, {}, '小米 15'),
  product('vivo', 50, false, {}, 'vivo X200'),
  product('Find', 50, true, {}, 'Find X8'),
  product('moto', 50, true, {}, 'moto razr')
];

assert.deepEqual(
  listCompetitivenessBrands(historyBatches, current),
  ['OPPO', 'vivo', '华为', '摩托罗拉', '小米']
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

assert.deepEqual(
  listCompetitivenessSeries(historyBatches, current, '小米'),
  ['Redmi K80', '小米 14', '小米 15']
);

const seriesTimeline = buildFilteredCompetitivenessTimeline({
  historyBatches,
  currentCalculatedItems: current,
  newSeries: '小米 15',
  channelId: 'tradeIn'
});

assert.equal(seriesTimeline.length, 2);
assert.equal(seriesTimeline[0].tmItemScore, 100);
assert.equal(seriesTimeline[1].batchName, '当前工作台(小米 15实时计算草稿)');

const combinedTimeline = buildFilteredCompetitivenessTimeline({
  historyBatches,
  currentCalculatedItems: current,
  brand: '小米',
  newSeries: '小米 14',
  channelId: 'tradeIn'
});

assert.equal(combinedTimeline.length, 1);
assert.equal(combinedTimeline[0].tmItemScore, 0);
assert.deepEqual(
  filterCompetitivenessProducts(historyBatches[1].products, '小米', '小米 15').map(item => item.newSeries),
  ['小米 15']
);
assert.deepEqual(buildFilteredCompetitivenessTimeline({
  historyBatches,
  currentCalculatedItems: current,
  brand: ALL_BRANDS,
  newSeries: ALL_SERIES,
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

for (const [brand, oldModel, expected] of [
  ['Mate', '华为 Mate 60', '华为'], ['Find', 'OPPO Find N2', 'OPPO'],
  ['17系列', '小米 15 Pro', '小米'], ['Z80', '努比亚 Z50 Ultra', '努比亚'],
  ['红魔11S系列', '红魔 9 Pro', '努比亚'], ['S26', '三星 Galaxy Z Flip5', '三星'],
  ['GT8', 'realme GT5', '真我'], ['X300Ultra', 'vivo X100 Ultra', 'vivo'],
  ['Ace', '一加 12', '一加'], ['WIN', '荣耀 Magic6', '荣耀'],
  ['G100', '摩托罗拉 Moto G55', '摩托罗拉'], ['17', 'REDMI K80', '小米'],
  ['Unknown', 'iQOO 13', 'iQOO'], ['Find', 'Find X8', ''],
  ['Unknown', 'vivobook 15', '']
]) {
  assert.equal(resolveCompetitivenessBrand({ ...product(brand, 100, true), oldModel }), expected);
}
assert.equal(resolveCompetitivenessBrand({ ...product('华为', 100, true), oldModel: '小米 15' }), '华为', 'saved valid brands retain priority');
assert.equal(resolveCompetitivenessBrand({ ...product('华为', 100, true, { 'BK_品牌名称': '荣耀' }), oldModel: '小米 15' }), '荣耀');
