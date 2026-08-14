import assert from 'node:assert/strict';
import { CalculatedProduct, TrackingBatch } from '../types';
import { buildCompetitivenessTrendExportPayload } from './competitivenessTrendExport';

const product = (brand: string, win: boolean) => ({
  brand,
  quoteVolume: 100,
  tmPrice: 100,
  tmHandPrice: 120,
  zzPrice: 90,
  zzHandPrice: 110,
  postTmItemWin: win,
  postTmHandWin: win,
  postZzItemWin: win,
  postAhsZzHandWin: win
} as CalculatedProduct);

const historyBatches = [{
  id: 'BATCH-20260801',
  date: '2026-08-01',
  competitivenessDate: '2026-08-01',
  isCompetitivenessConfirmed: true,
  products: [product('小米', true), product('OPPO', false)]
}] as TrackingBatch[];

const overallTimeline = Array.from({ length: 16 }, (_, index) => ({
  date: `08-${String(index + 1).padStart(2, '0')}`,
  batchName: `批次${index + 1}`,
  tmDirectScore: index,
  tmItemScore: index + 1,
  ahsVsZzDirectScore: index + 2,
  zzItemScore: index + 3
}));

const current = [product('小米', false), product('vivo', true)];

const recentPayload = buildCompetitivenessTrendExportPayload({
  overallTimeline,
  historyBatches,
  currentCalculatedItems: current,
  brandOptions: ['OPPO', 'vivo', '小米'],
  trendRange: 'recent15',
  channelId: 'tradeIn'
});

assert.equal(recentPayload.rangeLabel, '近15次追价');
assert.deepEqual(recentPayload.sheets.map(sheet => sheet.sheetName), ['总盘走势', 'OPPO', 'vivo', '小米']);
assert.equal(recentPayload.sheets[0].points.length, 15);
assert.equal(recentPayload.sheets[0].points[0].batchName, '批次2');
assert.equal(recentPayload.sheets[0].points[0].nodeType, '历史正式');
assert.equal(recentPayload.sheets[1].points.length, 1);
assert.equal(recentPayload.sheets[2].points[0].nodeType, '实时草稿');
assert.equal(recentPayload.sheets[3].points.at(-1)?.nodeType, '实时草稿');

const allPayload = buildCompetitivenessTrendExportPayload({
  overallTimeline,
  historyBatches,
  currentCalculatedItems: current,
  brandOptions: ['OPPO', 'vivo', '小米', '无数据品牌'],
  trendRange: 'all',
  channelId: 'tradeIn'
});

assert.equal(allPayload.rangeLabel, '全部');
assert.equal(allPayload.sheets[0].points.length, 16);
assert.equal(allPayload.sheets.some(sheet => sheet.sheetName === '无数据品牌'), false);
assert.equal(allPayload.sheets[0].chartTitle, '总盘竞争力波动走势');
assert.equal(allPayload.sheets[3].chartTitle, '小米 竞争力波动走势');

console.log('competitiveness trend export model checks passed');
