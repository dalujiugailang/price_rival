import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyGradeMarginFloor} from '../shared/gradeMargin.mjs';
import {addGradePresentation,gradeSourceDisplay} from '../shared/gradePresentation.mjs';
import {stabilizeGradeOrder} from '../shared/gradeOrder.mjs';
import {evaluateTradeInPrice,legalTradeInPrices} from '../shared/tradeInSubsidy.mjs';
const rules=[
 {newSeries:'新品',threshold:0,ahsInput:20,jdSubsidy:50,inflationTotal:0,inflationAhs:0,ruleVersion:2},
 {newSeries:'新品',threshold:500,ahsInput:120,jdSubsidy:300,inflationTotal:200,inflationAhs:50,ruleVersion:2},
 {newSeries:'新品',threshold:1000,ahsInput:220,jdSubsidy:500,inflationTotal:300,inflationAhs:100,ruleVersion:2},
 {newSeries:'新品',threshold:1500,ahsInput:180,jdSubsidy:600,inflationTotal:100,inflationAhs:10,ruleVersion:2}
];
const row=price=>({ppv:'B型号',skuId:'1',model:'型号',origin:'等级推算',newSeries:'新品',price,targetPrice:price,status:[]});
test('inflation grade guard matches legal-price search and preserves fixed rows',()=>{
 for(const base of [100,800,1600,3200])for(const price of [245,500,995,1400,1800]){
  const input=row(price),actual=applyGradeMarginFloor({rows:[input]},rules,[{ppv:input.ppv,BI基准价:base}]).rows[0];
  const eligible=[...legalTradeInPrices(2,price).keys()].filter(p=>evaluateTradeInPrice(p,rules,base).marginalProfit>=.03-1e-12);
  assert.equal(actual.price,eligible.length?Math.max(...eligible):null,JSON.stringify({base,price}));
  if(actual.price!=null)assert.ok(actual.marginAfterCorrection>=.03-1e-12);
 }
 const fixed=applyGradeMarginFloor({rows:[{...row(1600.25),origin:'重点追价'}]},rules,[]).rows[0];
 assert.equal(fixed.price,1600.25);
});
test('grade frozen presentation uses independently matched before/after inflation and net subsidies exactly once',()=>{
 const input={...row(960),strategyPrice:610,sourcePriceId:'a'};
 const present=addGradePresentation({rows:[input]}, {subsidyRules:rules},[{ppv:input.ppv,BI基准价:1600}]).rows[0].display;
 assert.equal(present.ahsInput,70);assert.equal(present.jdSubsidy,100);assert.equal(present.inflationAhsBefore,50);
 assert.equal(present.inflationItemPriceBefore,660);assert.equal(present.subsidyMatchPriceBefore,810);
 assert.equal(present.ahsQuotedPrice,730);assert.equal(present.jdHandPrice,910);
 assert.equal(present.ahsSubsidyAfter,120);assert.equal(present.inflationAhsAfter,50);assert.equal(present.inflationTotalAfter,200);
 assert.equal(present.inflationItemPriceAfter,1010);assert.equal(present.subsidyMatchPriceAfter,1160);
 assert.equal(present.postAhsPrice,1130);assert.equal(present.postJdHandPrice,1360);
 assert.ok(Math.abs(present.postMarginalProfit-(1-(1130*1.0466+1600*.0218+81)/1600))<1e-12);
 assert.equal(present.pricingAlgorithmVersion,'inflation-v2');
 const frozen=gradeSourceDisplay(present);assert.equal(frozen.pricingAlgorithmVersion,'inflation-v2');assert.equal(frozen.inflationAhsAfter,50);
 const pending=addGradePresentation({rows:[{...input,price:null}]},{subsidyRules:rules},[]).rows[0].display;
 assert.equal(pending.postMarginalProfit,null);assert.equal(pending.postAhsPrice,null);
});
test('saved inflation core display keeps its classification and uses effective C for TM gaps',()=>{
 const input={...row(960),origin:'重点追价',sourcePriceId:'a'};
 const source={jdPrice:610,recommendJdPrice:960,tmPrice:1000,tmHandPrice:1300,jdHandPrice:910,postJdHandPrice:1360,pricingAlgorithmVersion:'inflation-v2',inflationItemPriceBefore:660,inflationItemPriceAfter:1010,inflationAhsAfter:50,postMarginalProfit:.1};
 const display=addGradePresentation({rows:[input]},{prices:[{id:'a',display:source}],subsidyRules:rules},[]).rows[0].display;
 assert.equal(display.preItemGap,-340);assert.equal(display.postItemGap,10);assert.equal(display.postHandGap,60);
 assert.equal(display.postMarginalProfit,.1);assert.equal(display.inflationAhsAfter,50);
});
test('grade route freezes inflation rule fields and rejects invalid split amounts before generation',async()=>{
 const {registerGradeRoutes}=await import('./gradeRoutes.mjs');
 const sources={v:{id:'v',kind:'volume',createdAt:'2026-11-20',fileName:'volume',data:{rows:[{skuId:'1',model:'型号',sku:'型号 256G',level:'A',ppv:'A型号 256G',quoteVolume:1,soldVolume:1}]}},t:{id:'t',kind:'template',fileName:'template',data:{models:{型号:'模板'},rules:[{template:'模板',rank:1,level:'A',ratio:1}]}}};
 const handlers=new Map();let saved;
 registerGradeRoutes({get:()=>{},post:(path,...list)=>handlers.set(path,list.at(-1))},{store:{getSource:id=>sources[id],listSources:()=>[],createRun:run=>{saved={...run,id:'run'};return saved;}},lookupPrices:async()=>({rows:[{ppv:'A型号 256G',BI基准价:1600,最终报价:610}],dataDate:'2026-11-20',fetchedAt:'now'})});
 const body={volumeId:'v',templateId:'t',skuIds:['1'],prices:[{id:'a',ppv:'A型号 256G',skuId:'1',model:'型号',level:'A',price:960,newSeries:'新品'}],subsidyRules:rules};
 let status,payload;const response={status(code){status=code;return this;},json(value){payload=value;return this;}};
 await handlers.get('/api/grade-expansion/runs')({body,authUser:{openId:'test'}},response);
 assert.equal(status,201);assert.equal(saved.request.subsidyRules[1].inflationTotal,200);assert.equal(saved.request.subsidyRules[1].inflationAhs,50);assert.equal(saved.request.subsidyRules[1].ruleVersion,2);
 await handlers.get('/api/grade-expansion/runs')({body:{...body,subsidyRules:[{...rules[1],inflationAhs:999}]},authUser:{openId:'test'}},response);
 assert.equal(status,400);assert.match(payload.error,/膨胀|无效/);
});
