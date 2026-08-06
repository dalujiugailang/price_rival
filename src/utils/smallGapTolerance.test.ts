import assert from 'node:assert/strict';
import { CHANNELS } from '../config/channels';
import { Product, SubsidyRule } from '../types';
import { applyManualRecommendedPrice, calculateProductPrice } from './formulas';
import { evaluateSmallGapTolerance } from './smallGapTolerance';

const baseProduct: Product = {
  id: 'small-gap',
  sourceSheet: 'Sheet1',
  sourceRowNumber: 2,
  sourceFieldCount: 0,
  rawFields: {},
  newSeries: '测试系列',
  oldModel: '测试型号',
  ppv: 'small-gap-ppv',
  brand: '测试品牌',
  level: 'A',
  skuId: 1,
  levelId: '1',
  quoteVolume: 100,
  soldVolume: 20,
  description: '',
  jdPrice: 1000,
  ahsInput: 0,
  jdSubsidy: 0,
  tmPrice: 1068,
  tmSubsidyManual: 0,
  tmSubsidySheet: 0,
  zzPrice: 0,
  basePrice: 1300
};

const subsidyRules: SubsidyRule[] = [
  { newSeries: '测试系列', threshold: 0, ahsInput: 0, jdSubsidy: 0, rawFields: {} },
  { newSeries: '测试系列', threshold: 1100, ahsInput: 100, jdSubsidy: 20, rawFields: {} }
];

const calculated = calculateProductPrice(baseProduct, 0.5, subsidyRules);
const smallGapProduct = applyManualRecommendedPrice(calculated, 1060, 0.5, subsidyRules);

const firstEvaluation = evaluateSmallGapTolerance({
  products: [smallGapProduct],
  toleranceMargin: -0.5,
  subsidyRules,
  channel: CHANNELS.tradeIn
})[0];

assert.equal(firstEvaluation.smallGapTolerancePrice, 1100);
assert.equal(firstEvaluation.smallGapToleranceEligible, true);
assert.ok(firstEvaluation.smallGapOpportunityRemark?.includes('取整容忍价¥1,100.00'));
assert.ok(firstEvaluation.smallGapOpportunityRemark?.includes('可容忍'));
assert.ok(Number.isFinite(firstEvaluation.smallGapToleranceMargin));

const exactFloor = firstEvaluation.smallGapToleranceMargin as number;
const exactBoundary = evaluateSmallGapTolerance({
  products: [smallGapProduct],
  toleranceMargin: exactFloor,
  subsidyRules,
  channel: CHANNELS.tradeIn
})[0];
assert.equal(exactBoundary.smallGapToleranceEligible, true);

const belowFloor = evaluateSmallGapTolerance({
  products: [smallGapProduct],
  toleranceMargin: exactFloor + 0.0001,
  subsidyRules,
  channel: CHANNELS.tradeIn
})[0];
assert.equal(belowFloor.smallGapToleranceEligible, false);
assert.ok(belowFloor.smallGapOpportunityRemark?.includes('低于容忍底线'));

const missingTm = evaluateSmallGapTolerance({
  products: [{ ...smallGapProduct, tmPrice: 0 }],
  toleranceMargin: -0.02,
  subsidyRules,
  channel: CHANNELS.tradeIn
})[0];
assert.equal(missingTm.smallGapOpportunity, undefined);
assert.equal(missingTm.smallGapTolerancePrice, undefined);

const alreadyEqual = evaluateSmallGapTolerance({
  products: [{ ...smallGapProduct, recommendJdPrice: 1068, recommendAdjustment: 68 }],
  toleranceMargin: -0.02,
  subsidyRules,
  channel: CHANNELS.tradeIn
})[0];
assert.equal(alreadyEqual.smallGapOpportunity, undefined);
assert.equal(alreadyEqual.smallGapToleranceEligible, undefined);

console.log('small-gap tolerance checks passed');
