import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildWorkspaceMatrix,buildSeriesProfitResults,buildNewSeriesScenarios} from './model';
import {evaluateTradeInPrice} from '../../../shared/tradeInSubsidy.mjs';
import type {CalculatedProduct,SubsidyRule} from '../../types';
const make=(newSeries:string):SubsidyRule[]=>[
 {newSeries,threshold:0,ahsInput:20,jdSubsidy:50,inflationTotal:0,inflationAhs:0,ruleVersion:2,rawFields:{}},
 {newSeries,threshold:500,ahsInput:120,jdSubsidy:300,inflationTotal:200,inflationAhs:50,ruleVersion:2,rawFields:{}},
 {newSeries,threshold:1000,ahsInput:220,jdSubsidy:500,inflationTotal:300,inflationAhs:100,ruleVersion:2,rawFields:{}}
];
test('risk matrix shows net rules but evaluates target full AHS spend with its own inflation tiers',()=>{
 const subsidyRules=[...make('目标'),{newSeries:'当前',threshold:0,ahsInput:80,jdSubsidy:100,inflationTotal:0,inflationAhs:0,ruleVersion:2 as const,rawFields:{}}];
 const basePrice=1600,price=960,baseline=evaluateTradeInPrice(price,make('目标'),basePrice);
 const product={id:'p',newSeries:'原系列',ppv:'p',recommendJdPrice:price,basePrice,ahsSubsidyAfter:70,inflationAhsAfter:50,pricingAlgorithmVersion:'inflation-v2',postMarginalProfit:1-((price+120)*1.0466+basePrice*.0218+81)/basePrice} as CalculatedProduct;
 const matrix=buildWorkspaceMatrix(subsidyRules,[product]);
 const raw=matrix.rules.find(r=>r.series==='目标'&&r.threshold===1000)!;
 assert.equal(raw.ahs,120);assert.equal(raw.jd,200);assert.equal(raw.grossAhs,220);assert.equal(raw.grossJd,500);
 const result=buildSeriesProfitResults({rows:matrix.rows,rules:matrix.rules,product,floor:.03}).find(r=>r.row.series==='目标')!;
 assert.equal(result.hit.ahs,170);assert.equal(result.hit.regularAhs,120);assert.equal(result.hit.inflationAhs,50);assert.equal(result.hit.subsidyMatchPrice,1160);
 assert.equal(result.hit.rules[0].threshold,1000);assert.equal(result.comparison!.delta,50);
 assert.ok(Math.abs(result.comparison!.rate-baseline.marginalProfit!)<1e-12);
 const target=matrix.rows.find(r=>r.series==='目标')!;
 const scenario=buildNewSeriesScenarios({target,rules:matrix.rules,products:[product],floor:.03})[0];
 assert.equal(scenario.result.comparison!.profit,result.comparison!.profit);
});
test('current saved plan remains frozen and legacy baseline does not add unavailable inflation',()=>{
 const subsidyRules=make('目标'),basePrice=1600,price=960;
 const product={id:'p',newSeries:'目标',ppv:'p',recommendJdPrice:price,basePrice,ahsSubsidyAfter:999,inflationAhsAfter:123,pricingAlgorithmVersion:'inflation-v2',postMarginalProfit:.123} as CalculatedProduct;
 const matrix=buildWorkspaceMatrix(subsidyRules,[product]);
 const current=buildSeriesProfitResults({rows:matrix.rows,rules:matrix.rules,product,floor:.03})[0];
 assert.equal(current.comparison!.delta,0);assert.equal(current.comparison!.rate,.123);
 const legacy={...product,newSeries:'旧系列',pricingAlgorithmVersion:undefined,ahsSubsidyAfter:100};
 const compared=buildSeriesProfitResults({rows:matrix.rows,rules:matrix.rules,product:legacy,floor:.03})[0];
 assert.equal(compared.comparison!.delta,70);
});
test('negative split and conflicting inflation rules are unavailable rather than guessed',()=>{
 const rules=make('目标');
 const invalid=buildWorkspaceMatrix([...rules,{...rules[1],threshold:1500,inflationTotal:9999}],[]);
 assert.ok(invalid.invalidSeries.has('目标'));
 const conflict=buildWorkspaceMatrix([...rules,{...rules[1],inflationAhs:60}],[]);
 assert.ok(conflict.invalidSeries.has('目标'));
});
test('same net amounts with different gross inflation still conflict and cannot rank',async()=>{
 const {makeTier}=await import('./riskRankingModel');
 const source=make('目标');
 const matrix=buildWorkspaceMatrix([...source,{...source[1],ahsInput:130,jdSubsidy:310,inflationTotal:210,inflationAhs:60}],[]);
 assert.equal(matrix.rules.find(r=>r.sourceIndex===2)!.ahs,matrix.rules.find(r=>r.sourceIndex===4)!.ahs);
 assert.equal(matrix.rules.find(r=>r.sourceIndex===2)!.jd,matrix.rules.find(r=>r.sourceIndex===4)!.jd);
 assert.ok(matrix.invalidSeries.has('目标'));
 assert.equal(makeTier(matrix.rules[1],matrix.rules,new Set()).rank,null);
});
