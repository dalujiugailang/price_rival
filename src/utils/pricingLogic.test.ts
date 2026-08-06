import assert from 'node:assert/strict';
import { Product } from '../types';
import {
  applyManualRecommendedPrice,
  calculateProductPrice,
  getRoundedCompetitivePrice
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

const calculated = calculateProductPrice(equalPriceProduct, 0.03);
assert.equal(calculated.tmItemWin, true);
assert.equal(calculated.tmHandWin, true);
assert.equal(calculated.zzItemWin, true);
assert.equal(calculated.ahsZzHandWin, true);
assert.equal(calculated.postTmItemWin, true);
assert.equal(calculated.postTmHandWin, true);
assert.equal(calculated.postZzItemWin, true);
assert.equal(calculated.postAhsZzHandWin, true);

const manuallyApplied = applyManualRecommendedPrice(calculated, 1000, 0.03);
assert.equal(manuallyApplied.postTmItemWin, true);
assert.equal(manuallyApplied.postTmHandWin, true);
assert.equal(manuallyApplied.postZzItemWin, true);
assert.equal(manuallyApplied.postAhsZzHandWin, true);

console.log('pricing logic checks passed');
