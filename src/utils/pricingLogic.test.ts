import assert from 'node:assert/strict';
import { Product } from '../types';
import {
  applyManualRecommendedPrice,
  calculateProductPrice,
  getRoundedCompetitivePrice,
  tmRecyclerSubsidyAtPrice
} from './formulas';

const equalPriceProduct: Product = {
  id: 'equal-price',
  sourceSheet: 'Sheet1',
  sourceRowNumber: 2,
  sourceFieldCount: 1,
  rawFields: { 'AI_zz券后价': 1100 },
  newSeries: '测试系列',
  oldModel: '测试型号',
  ppv: 'test-equal-price',
  brand: '测试品牌',
  level: 'A',
  skuId: 1,
  levelId: '1',
  quoteVolume: 100,
  soldVolume: 10,
  description: '',
  jdPrice: 1000,
  ahsInput: 100,
  jdSubsidy: 50,
  tmPrice: 1000,
  tmSubsidyManual: 50,
  tmSubsidySheet: 50,
  zzPrice: 1000,
  basePrice: 1600
};

assert.equal(getRoundedCompetitivePrice(1060, 1060), 1060);
assert.equal(getRoundedCompetitivePrice(1068, 1068), 1100);
assert.deepEqual(
  [199, 200, 299, 300, 399, 400, 799, 800, 1199, 1200, 3499, 3500, 4999, 5000, 9999]
    .map(tmRecyclerSubsidyAtPrice),
  [0, 45, 45, 45, 45, 90, 90, 180, 180, 280, 350, 480, 480, 630, 630]
);

const calculated = calculateProductPrice(equalPriceProduct, 0.03);
assert.equal(calculated.tmItemWin, true);
assert.equal(calculated.tmHandWin, true);
assert.equal(calculated.zzItemWin, true);
assert.equal(calculated.ahsZzHandWin, true);
assert.equal(calculated.postTmItemWin, true);
assert.equal(calculated.tmRecyclerSubsidy, 180);
assert.equal(calculated.tmRecyclerQuotedPrice, 1180);
assert.equal(calculated.postAhsTmRecyclerWin, false);
assert.equal(calculated.postTmHandWin, true);
assert.equal(calculated.postZzItemWin, true);
assert.equal(calculated.postAhsZzHandWin, true);
assert.equal(calculated.postJdZzHandWin, false);

const manuallyApplied = applyManualRecommendedPrice(calculated, 1000, 0.03);
assert.equal(manuallyApplied.postTmItemWin, true);
assert.equal(manuallyApplied.postAhsTmRecyclerWin, false);
assert.equal(manuallyApplied.postTmHandWin, true);
assert.equal(manuallyApplied.postZzItemWin, true);
assert.equal(manuallyApplied.postAhsZzHandWin, true);
assert.equal(manuallyApplied.postJdZzHandWin, false);

console.log('pricing logic checks passed');
