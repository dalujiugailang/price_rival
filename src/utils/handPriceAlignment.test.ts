import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Product, SubsidyRule } from '../types';
import { applyManualRecommendedPrice, calculateProductPrice, roundUploadPrice } from './formulas';
import { applyHandPriceAdjustment, createHandPriceAdjustment, handPriceRowKey, updateHandPriceAdjustments } from './handPriceAlignment';

const source: Product = {
  id: 'row-1', sourceSheet: 'Sheet1', sourceRowNumber: 2, sourceFieldCount: 0, rawFields: {},
  newSeries: '系列A', oldModel: '测试型号', ppv: '同一PPV', brand: '测试', level: 'A', skuId: 1,
  quoteVolume: 100, soldVolume: 10, description: '', jdPrice: 900, ahsInput: 0, jdSubsidy: 0,
  tmPrice: 1200, tmSubsidyManual: 200, tmSubsidySheet: 0, zzPrice: 1000, basePrice: 1250
};
const rule = (threshold: number, ahsInput: number, jdSubsidy: number): SubsidyRule => ({
  newSeries: '系列A', threshold, ahsInput, jdSubsidy, rawFields: {}
});
const rules = [rule(0, 0, 50), rule(1100, 80, 200), rule(1300, 160, 500)];
const baseline = (overrides: Partial<Product> = {}, subsidies = rules) => calculateProductPrice({ ...source, ...overrides }, 0.03, subsidies);

test('two independent steps: 103% target then margin floor; both reasons retained', () => {
  const p = baseline();
  const first = createHandPriceAdjustment(p, rules, 'align', -0.05);
  const aligned = applyHandPriceAdjustment(p, first, rules, 0.03);
  assert.ok(aligned.postJdHandPrice >= p.tmHandPrice * 1.03);
  assert.equal(aligned.recommendJdPrice, 1245);
  assert.ok(aligned.postMarginalProfit < -0.05);
  const second = createHandPriceAdjustment(aligned, rules, 'rollback', -0.05);
  const rolled = applyHandPriceAdjustment(p, second, rules, 0.03);
  assert.ok(rolled.postMarginalProfit >= -0.05);
  assert.ok(rolled.recommendJdPrice < aligned.recommendJdPrice);
  assert.ok(rolled.postJdHandPrice < p.tmHandPrice * 1.03);
  assert.match(rolled.smallGapOpportunityRemark!, /到手价追至TM 103%.*\n边际底线回调/s);
  assert.match(rolled.smallGapOpportunityRemark!, /-5.00%/);
  assert.equal(rolled.smallGapToleranceEligible, false);
  assert.equal(applyHandPriceAdjustment(p, first, rules, 0.03).recommendJdPrice, aligned.recommendJdPrice, 'undo second step');
  assert.equal(applyHandPriceAdjustment(p, undefined, rules, 0.03), p, 'undo first step');
  assert.deepEqual(applyHandPriceAdjustment(p, JSON.parse(JSON.stringify(second)), rules, 0.03), rolled, 'draft reload');
});

test('selection is source-row scoped, including duplicate PPVs and more than 200 rows', () => {
  const rows = Array.from({ length: 205 }, (_, i) => baseline({ id: `row-${i}`, sourceRowNumber: i + 2 }));
  const other = baseline({ id: 'other', newSeries: '系列B' });
  const keys = rows.map(handPriceRowKey);
  const next = updateHandPriceAdjustments([...rows, other], keys, {}, rules, 'align', -0.05);
  assert.equal(Object.keys(next).length, 205);
  assert.equal(next[handPriceRowKey(other)], undefined);
  assert.equal(applyHandPriceAdjustment(other, next[handPriceRowKey(other)], rules, 0.03), other);
});

test('rule thresholds, rounding and non-monotone subsidies agree with exhaustive search', () => {
  // The independent oracle enumerates every legal price, so it can catch interval-bound errors.
  for (let i = 0; i < 20; i++) {
    const subsidies = [rule(75 + i, 20, 10), rule(250, 10, 90), rule(505 + i, 100, 40), rule(1100, 30, 300)];
    const p = baseline({ jdPrice: 100 + i * 5, tmPrice: 230 + i * 80,
      tmSubsidyManual: i * 11, basePrice: 350 + i * 65 }, subsidies);
    const finalPrices = new Map<number, number>();
    for (let raw = 1; raw <= 3500; raw++) finalPrices.set(roundUploadPrice(raw), raw);
    const all = [...finalPrices.values()].map(raw => applyManualRecommendedPrice(p, raw, -0.05, subsidies));
    const expectedAlign = all.filter(c => c.recommendJdPrice >= p.recommendJdPrice
      && c.postJdHandPrice + 1e-9 >= p.tmHandPrice * 1.03)
      .sort((a, b) => a.recommendJdPrice - b.recommendJdPrice)[0];
    const record = createHandPriceAdjustment(p, subsidies, 'align', -0.05);
    const aligned = applyHandPriceAdjustment(p, record, subsidies, 0.03);
    assert.equal(aligned.recommendJdPrice, p.postJdHandPrice >= p.tmHandPrice * 1.03 ? p.recommendJdPrice : expectedAlign.recommendJdPrice, `align case ${i}`);
    const floor = -0.01 - i / 100;
    const expectedRollback = all.filter(c => c.recommendJdPrice <= aligned.recommendJdPrice
      && c.postMarginalProfit + 1e-12 >= floor).sort((a, b) => b.recommendJdPrice - a.recommendJdPrice)[0];
    const rolled = applyHandPriceAdjustment(p, createHandPriceAdjustment(aligned, subsidies, 'rollback', floor), subsidies, 0.03);
    assert.equal(rolled.recommendJdPrice, aligned.postMarginalProfit >= floor || !expectedRollback
      ? aligned.recommendJdPrice : expectedRollback.recommendJdPrice, `rollback case ${i}`);
  }
});

test('special 245/250 outputs survive application and exact floor is inclusive', () => {
  for (const target of [245, 250, 505, 2943]) {
    const p = baseline({ jdPrice: 100, tmPrice: target / 1.03, tmSubsidyManual: 0, basePrice: 5000 }, []);
    const record = createHandPriceAdjustment(p, [], 'align', -0.05);
    const aligned = applyHandPriceAdjustment(p, record, [], 0.03);
    assert.ok(aligned.postJdHandPrice + 1e-9 >= target);
    if (target !== 2943) assert.equal(aligned.recommendJdPrice, target);
    const rolled = applyHandPriceAdjustment(p, createHandPriceAdjustment(aligned, [], 'rollback', aligned.postMarginalProfit), [], 0.03);
    assert.equal(rolled.recommendJdPrice, aligned.recommendJdPrice);
  }
  const p = baseline({ jdPrice: 100, tmPrice: 600, tmSubsidyManual: 0, basePrice: 700 }, []);
  const aligned = applyHandPriceAdjustment(p, createHandPriceAdjustment(p, [], 'align', -0.05), [], 0.03);
  const exactFloor = applyManualRecommendedPrice(p, 400, 0.03, []).postMarginalProfit;
  const rolled = applyHandPriceAdjustment(p, createHandPriceAdjustment(aligned, [], 'rollback', exactFloor), [], 0.03);
  assert.equal(rolled.recommendJdPrice, 400, 'search must include a price exactly on the margin boundary');
});

test('unprocessed, missing data, unmatched subsidies, satisfied floor and impossible floor', () => {
  const p = baseline();
  assert.match(createHandPriceAdjustment(p, rules, 'rollback', -0.05).rollbackReason!, /请先完成/);
  for (const bad of [{ tmPrice: 0 }, { basePrice: 0 }, { newSeries: '不存在' }]) {
    const invalid = baseline(bad);
    const record = createHandPriceAdjustment(invalid, rules, 'align', -0.05);
    assert.equal(record.aligned, false);
    assert.equal(record.rawPrice, undefined);
  }
  const aligned = applyHandPriceAdjustment(p, createHandPriceAdjustment(p, rules, 'align', -0.05), rules, 0.03);
  assert.match(createHandPriceAdjustment(aligned, rules, 'rollback', -0.5).rollbackReason!, /无需回调/);
  assert.match(createHandPriceAdjustment(aligned, rules, 'rollback', 1).rollbackReason!, /无法回调/);
  assert.match(createHandPriceAdjustment(aligned, rules, 'rollback', NaN).rollbackReason!, /有效数值/);
  const negativeBefore = baseline({ basePrice: 800 });
  assert.ok(negativeBefore.preMarginalProfit < 0);
  assert.equal(createHandPriceAdjustment(negativeBefore, rules, 'align', -0.05).aligned, true);
});

test('changed input, subsidy rules or manual price invalidate old actions', () => {
  const p = baseline();
  const record = createHandPriceAdjustment(p, rules, 'align', -0.05);
  for (const changed of [baseline({ basePrice: 1300 }), baseline({ tmPrice: 1300 }), applyManualRecommendedPrice(p, 1000, 0.03, rules)]) {
    assert.equal(applyHandPriceAdjustment(changed, record, rules, 0.03), changed);
  }
  assert.equal(applyHandPriceAdjustment(p, record, [...rules, rule(2000, 200, 700)], 0.03), p);
});
