import assert from 'node:assert/strict';
import { Product } from '../types';
import {
  applyManualRecommendedPrice,
  calculateProductPrice,
  getRoundedCompetitivePrice,
  roundUploadPrice,
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
assert.equal(getRoundedCompetitivePrice(1068, 1068), 1070);
assert.deepEqual(
  [1, 4.99, 5, 9, 10, 14, 15, 94, 96, 100].map(roundUploadPrice),
  [2, 2, 5, 5, 10, 10, 15, 90, 95, 100]
);
assert.deepEqual(
  [101, 109, 250, 294, 499, 500].map(roundUploadPrice),
  [100, 100, 245, 290, 490, 500]
);
assert.deepEqual(
  [501, 504, 505, 506, 509, 735, 2938, 2943, 2956].map(roundUploadPrice),
  [500, 500, 505, 510, 510, 735, 2940, 2940, 2960]
);

const repricingProduct: Product = {
  ...equalPriceProduct,
  id: 'repricing-rounding',
  ppv: 'repricing-rounding',
  jdPrice: 2800,
  ahsInput: 0,
  jdSubsidy: 0,
  tmPrice: 2858,
  tmSubsidyManual: 0,
  tmSubsidySheet: 0,
  zzPrice: 0,
  basePrice: 6000
};

const fullCompetitionPrice = calculateProductPrice(repricingProduct, 0.03, [], 'fullCompetition');
assert.equal(roundUploadPrice(repricingProduct.tmPrice * 1.03), 2940);
assert.equal(fullCompetitionPrice.recommendJdPrice, 2940);

for (const [tmPrice, expected] of [
  [3, 2],
  [91.5, 90],
  [93.3, 95],
  [243, 245],
  [285.5, 290],
  [486.5, 500],
  [489, 500],
  [490.3, 505],
  [491.3, 510],
  [713.6, 735],
  [2858, 2940],
  [2870, 2960]
] as const) {
  const result = calculateProductPrice({
    ...repricingProduct,
    id: `full-competition-${tmPrice}`,
    ppv: `full-competition-${tmPrice}`,
    jdPrice: Math.max(1, tmPrice - 100),
    tmPrice
  }, 0.03, [], 'fullCompetition');
  assert.equal(result.recommendJdPrice, expected, `tm价${tmPrice}的追价结果`);
}

const marginTargetPrice = calculateProductPrice(repricingProduct, 0.03);
assert.equal(marginTargetPrice.recommendJdPrice, 2940);

const marginFallbackPrice = calculateProductPrice(repricingProduct, 0.46);
assert.equal(marginFallbackPrice.recommendJdPrice, 2890);

const manuallyRoundedPrice = applyManualRecommendedPrice(fullCompetitionPrice, 2943, 0.03);
assert.equal(manuallyRoundedPrice.recommendJdPrice, 2940);

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
