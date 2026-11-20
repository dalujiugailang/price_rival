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

test('all losing thresholds retain global exact-threshold ranks, ties and original plans', () => {
  const products = [500, 1000, 1500].map((price, index) => ({
    id: String(index), ppv: String(index), oldModel: '旧机', newSeries: '原系列',
    basePrice: 1000, postMarginalProfit: .01, recommendJdPrice: price, ahsSubsidyAfter: 20
  })) as CalculatedProduct[];
  const rules = [500, 1000, 1500].flatMap(threshold => [
    {newSeries: '原系列', threshold, ahsInput: 20, jdSubsidy: 500},
    {newSeries: '目标', threshold, ahsInput: 100, jdSubsidy: 500},
    {newSeries: '并列', threshold, ahsInput: 100, jdSubsidy: 500},
    {newSeries: '更高', threshold, ahsInput: 200, jdSubsidy: 500}
  ]) as SubsidyRule[];
  const matrix = buildWorkspaceMatrix(rules, products);
  const result = buildRiskRankings({products, rows: matrix.rows.filter(row => row.series === '目标'), rules: matrix.rules, invalidSeries: matrix.invalidSeries, floor: .03});
  assert.equal(result.newSeries[0].tiers.size, 3);
  assert.deepEqual([...result.newSeries[0].tiers.values()].map(t => [t.rank, t.rankTotal]), [[2, 4], [2, 4], [2, 4]]);
  assert.deepEqual([...result.oldModels[0].originalTiers.values()].map(t => [t.series, t.threshold, t.ahs, t.rank]), [
    ['原系列', 500, 20, 4], ['原系列', 1000, 20, 4], ['原系列', 1500, 20, 4]
  ]);
});

test('model drill-down includes all PPVs and exactly reconciles ranking losses', async () => {
  const {buildProfitView} = await import('./model');
  const products = [
    {id:'a',ppv:'A',oldModel:'同型号',newSeries:'原配',basePrice:1000,postMarginalProfit:.01,recommendJdPrice:500,ahsSubsidyAfter:20},
    {id:'b',ppv:'B',oldModel:'同型号',newSeries:'原配',basePrice:1000,postMarginalProfit:.01,recommendJdPrice:1000,ahsSubsidyAfter:20},
    {id:'c',ppv:'C',oldModel:'其他型号',newSeries:'原配',basePrice:1000,postMarginalProfit:.01,recommendJdPrice:1000,ahsSubsidyAfter:20}
  ] as CalculatedProduct[];
  const rules = ['原配','高承担','另一系列'].map((newSeries,i) => ({newSeries, threshold:500,ahsInput:20+i*100,jdSubsidy:500})) as SubsidyRule[];
  const matrix=buildWorkspaceMatrix(rules,products);
  const args={products, rows:matrix.rows, rules:matrix.rules,invalidSeries:matrix.invalidSeries,floor:.03};
  const ranking=buildRiskRankings(args);
  const old=buildProfitView({...args,selection:{view:'old',productId:'a',targetSeries:'',onlyRisks:true,lossesOnly:true,excludeCurrent:true,oldModel:'同型号'}});
  assert.equal(old.oldScenarios.length,ranking.oldModels.find(row=>row.name==='同型号')!.losses);
  assert.deepEqual(new Set(old.oldScenarios.map(row=>row.product.ppv)),new Set(['A','B']));
  assert.ok(old.oldScenarios.every(row=>!row.result.current&&row.result.comparison?.risk==='亏损风险'));
  const fresh=buildProfitView({...args,selection:{view:'new',productId:'',targetSeries:'高承担',onlyRisks:true,lossesOnly:true,excludeCurrent:true}});
  assert.equal(fresh.visibleScenarios.length,ranking.newSeries.find(row=>row.name==='高承担')!.losses);
});
