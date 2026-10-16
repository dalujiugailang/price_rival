import assert from 'node:assert/strict';
import { Product } from '../types';
import { CHANNELS } from '../config/channels';
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

const topUpProduct: Product = {
  ...equalPriceProduct, jdPrice: 1700, tmPrice: 1700, ahsInput: 0,
  jdSubsidy: 0, tmSubsidyManual: 30, basePrice: 2000
};
const topUp = calculateProductPrice(topUpProduct, 0.05);
assert.equal(topUp.recommendJdPrice, 1730);
assert.equal(topUp.postTmHandWin, true);
assert.ok(topUp.postMarginalProfit < 0.05 && topUp.postMarginalProfit >= 0.03);
assert.equal(topUp.riskWarning, 'WARNING');
assert.equal(topUp.isBelowBottomLine, false);
assert.equal(topUp.automaticHandTopUp?.firstRoundPrice, 1700);
assert.equal(topUp.automaticHandTopUp?.applied, true);
// First-round fallback can also qualify (not only an initially competitive item).
const fallbackTopUp = calculateProductPrice({ ...topUpProduct, jdPrice: 1600, tmPrice: 1690, tmSubsidyManual: 35 }, 0.05);
assert.equal(fallbackTopUp.automaticHandTopUp?.applied, true);
assert.equal(fallbackTopUp.recommendJdPrice, 1725);
for (const gap of [0, -10, 30.01, 31]) {
  const result = calculateProductPrice({ ...topUpProduct, tmSubsidyManual: gap }, 0.05);
  assert.equal(result.recommendJdPrice, 1700, `gap ${gap} must not qualify`);
  assert.equal(result.automaticHandTopUp, undefined);
}
const unaffordable = calculateProductPrice(topUpProduct, 0.06);
assert.equal(unaffordable.recommendJdPrice, 1700);
assert.equal(unaffordable.automaticHandTopUp?.applied, false);
const exactFloor = calculateProductPrice(topUpProduct, topUp.postMarginalProfit + 0.02);
assert.equal(exactFloor.recommendJdPrice, 1730, 'exact relaxed floor is accepted');
const zeroProfit = calculateProductPrice({ ...topUpProduct, basePrice: 1900 }, -0.03);
assert.equal(zeroProfit.recommendJdPrice, 1700);
assert.equal(zeroProfit.automaticHandTopUp, undefined);
const missingTm = calculateProductPrice({ ...topUpProduct, tmPrice: 0 }, 0.05);
assert.equal(missingTm.recommendJdPrice, 1700);
assert.equal(missingTm.automaticHandTopUp, undefined);
const itemBehind = calculateProductPrice({ ...topUpProduct, tmPrice: 1800 }, 0.05);
assert.equal(itemBehind.automaticHandTopUp, undefined);
// A JD subsidy threshold means ¥10 item uplift closes the ¥30 hand-price gap.
const thresholdRules = [
  { newSeries: topUpProduct.newSeries, threshold: 0, ahsInput: 0, jdSubsidy: 0, rawFields: {} },
  { newSeries: topUpProduct.newSeries, threshold: 1710, ahsInput: 0, jdSubsidy: 20, rawFields: {} }
];
assert.equal(calculateProductPrice(topUpProduct, 0.05, thresholdRules).recommendJdPrice, 1710);
// AHS subsidy jumps can make every competitive price unaffordable.
const costlyRules = thresholdRules.map(rule => ({ ...rule, ahsInput: rule.threshold ? 100 : 0 }));
assert.equal(calculateProductPrice(topUpProduct, 0.05, costlyRules).recommendJdPrice, 1700);
// Continue searching after a failed margin candidate when a later tier lowers cost.
const recoveryRules = [
  ...costlyRules,
  { newSeries: topUpProduct.newSeries, threshold: 1720, ahsInput: 0, jdSubsidy: 20, rawFields: {} }
];
assert.equal(calculateProductPrice(topUpProduct, 0.05, recoveryRules).recommendJdPrice, 1720);
assert.equal(calculateProductPrice(topUpProduct, 0.05, [], 'fullCompetition').recommendJdPrice, 1700);
const selfOnly = calculateProductPrice({ ...topUpProduct, zzPrice: 1700 }, 0.05, [], 'margin', { channel: CHANNELS.selfOperated });
assert.equal(selfOnly.recommendJdPrice, 1700);
assert.equal(selfOnly.automaticHandTopUp, undefined);
assert.equal(applyManualRecommendedPrice(topUp, 1700, 0.05).automaticHandTopUp, undefined);
assert.ok(!applyManualRecommendedPrice(topUp, 1700, 0.05).pricingRemark.includes('补追达标'));

console.log('pricing logic checks passed');
