import assert from 'node:assert/strict';
import { enrichDailyPricePayload, resolveBrandName } from './brand.mjs';

assert.equal(resolveBrandName({ '品牌名称': 'API品牌', ppv: 'A+小米 15' }), 'API品牌');
assert.equal(resolveBrandName({ brandName: '接口品牌', ppv: 'A+vivo X200' }), '接口品牌');
assert.equal(resolveBrandName({ '品牌名称': 'REDMI', ppv: 'A+Redmi K70' }), '小米');

const inferredCases = [
  ['A+OPPO Find X8 Ultra 大陆国行', 'OPPO'],
  ['A+Redmi K70 大陆国行', '小米'],
  ['A+iQOO 13 大陆国行', 'iQOO'],
  ['A+vivo X200 Ultra 大陆国行', 'vivo'],
  ['A1vivo X200 Pro mini 大陆国行', 'vivo'],
  ['A+摩托罗拉 Moto G55 大陆国行', '摩托罗拉'],
  ['A+三星 Galaxy S25 Ultra 大陆国行', '三星'],
  ['A+一加 13 大陆国行', '一加'],
  ['A+努比亚 红魔 10 Pro 大陆国行', '努比亚'],
  ['A+华为 Mate 70 Pro 大陆国行', '华为'],
  ['A+小米 15 Pro 大陆国行', '小米'],
  ['A+真我 GT7 大陆国行', '真我'],
  ['A+荣耀 Magic7 大陆国行', '荣耀']
];

inferredCases.forEach(([ppv, expected]) => {
  assert.equal(resolveBrandName({ ppv }), expected);
});
assert.equal(resolveBrandName({ ppv: 'A+未知型号 16G+512G' }), '');

const enriched = enrichDailyPricePayload({
  rows: [
    { ppv: 'A+小米 15 Pro 大陆国行', matched: false },
    { ppv: 'A+OPPO Find X8 Ultra', matched: true, '品牌名称': '欧珀' }
  ]
});
assert.equal(enriched.rows[0]['品牌名称'], '小米');
assert.equal(enriched.rows[1]['品牌名称'], '欧珀');

const merged = enrichDailyPricePayload(
  { rows: [{ ppv: 'A+未知型号', matched: true }] },
  { rows: [{ ppv: 'A+未知型号', matched: true, '品牌名称': '小米' }] }
);
assert.equal(merged.rows[0]['品牌名称'], '小米');

const unmatchedBrand = enrichDailyPricePayload(
  { rows: [{ ppv: 'A+Redmi K70', matched: true }] },
  { rows: [{ ppv: 'A+Redmi K70', matched: false, '品牌名称': null }] }
);
assert.equal(unmatchedBrand.rows[0]['品牌名称'], '');

console.log('daily price brand checks passed');
