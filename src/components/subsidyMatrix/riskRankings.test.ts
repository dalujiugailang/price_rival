import test from 'node:test';
import assert from 'node:assert/strict';
import type {CalculatedProduct, SubsidyRule} from '../../types';
import {buildWorkspaceMatrix} from './model';
import {buildRiskRankings} from './riskRankingModel';

test('rankings count cross-series pairs, group PPVs, separate pre-existing losses and exclude unknowns', () => {
  const products = [
    {id: '1', ppv: 'P1', oldModel: '旧机', newSeries: '原系列', basePrice: 1000, postMarginalProfit: .01, recommendJdPrice: 500, ahsSubsidyAfter: 20},
    {id: '2', ppv: 'P2', oldModel: '旧机', newSeries: '原系列', basePrice: 1000, postMarginalProfit: -.01, recommendJdPrice: 500, ahsSubsidyAfter: 20}
  ] as CalculatedProduct[];
  const rules = ['原系列', '高承担', '较高承担'].map((newSeries, i) => ({
    newSeries, threshold: 500, ahsInput: i * 100 + 20, jdSubsidy: 300
  })) as SubsidyRule[];
  const matrix = buildWorkspaceMatrix(rules, products);
  const args = {products, rows: matrix.rows, rules: matrix.rules, invalidSeries: new Set(['较高承担']), floor: .03};
  const result = buildRiskRankings(args);
  assert.equal(result.checked, 2);
  assert.equal(result.losses, 2);
  assert.equal(result.unknown, 2);
  assert.equal(result.newSeries[0].name, '高承担');
  assert.equal(result.oldModels[0].quotes.size, 2);
  assert.equal(result.oldModels[0].targets.size, 1);
  assert.equal(result.oldModels[0].alreadyNegative, 1);
  assert.equal(result.oldModels[0].worst?.product.ppv, 'P2');
  assert.equal([...result.newSeries[0].tiers.values()][0].losses, 2);
  const filtered = buildRiskRankings({...args, rows: matrix.rows.filter(row => row.series === '原系列')});
  assert.equal(filtered.checked, 0);
  assert.equal(filtered.newSeries.length, 0);
});

test('ratio summaries use AHS divided by original threshold, preserve over 100% and exclude zero thresholds', () => {
  const products = [500, 1000, 0].map((price, index) => ({
    id: String(index), ppv: String(index), oldModel: '同型号', newSeries: '原系列',
    basePrice: 1000, postMarginalProfit: 0, recommendJdPrice: price, ahsSubsidyAfter: 0
  })) as CalculatedProduct[];
  const rules = [
    {newSeries: '目标', threshold: 0, ahsInput: 10, jdSubsidy: 100},
    {newSeries: '目标', threshold: 500, ahsInput: 600, jdSubsidy: 800},
    {newSeries: '目标', threshold: 1000, ahsInput: 200, jdSubsidy: 800}
  ] as SubsidyRule[];
  const matrix = buildWorkspaceMatrix(rules, products);
  const result = buildRiskRankings({products, rows: matrix.rows.filter(row => row.series === '目标'), rules: matrix.rules, invalidSeries: matrix.invalidSeries, floor: .03});
  for (const group of [result.newSeries[0], result.oldModels[0]]) {
    assert.equal(group.losses, 3);
    assert.equal(group.ratioCount, 2);
    assert.equal(group.averageRatio, .7);
    assert.deepEqual([...group.tiers.values()].map(tier => tier.ratio), [1.2, .2, null]);
  }
});
