import assert from 'node:assert/strict';
import {test} from 'node:test';
import {calculateProductPrice,applyManualRecommendedPrice,roundUploadPrice} from './formulas';
import {evaluateTradeInPrice,findTradeInPrice,tradeInMarginUpper} from '../../shared/tradeInSubsidy.mjs';
import {createHandPriceAdjustment,applyHandPriceAdjustment} from './handPriceAlignment';
import {getTmPriceGaps} from './tmPriceGaps';
import {parseSubsidyRules} from '../components/UploadSection';
import {validateMatrixRows} from '../../shared/subsidyMatrix.mjs';
import * as XLSX from 'xlsx';
import type {Product,SubsidyRule} from '../types';
const r=(threshold:number,e:number,a:number,j:number,b:number):SubsidyRule=>({newSeries:'系列',threshold,ruleVersion:2,inflationTotal:e,inflationAhs:a,jdSubsidy:j+e,ahsInput:b+a,rawFields:{}});
const product=(extra:Partial<Product>={}):Product=>({id:'p',sourceSheet:'Sheet1',sourceRowNumber:2,sourceFieldCount:10,rawFields:{},newSeries:'系列',oldModel:'旧机',ppv:'p',brand:'iQOO',level:'A',skuId:1,quoteVolume:10,description:'',jdPrice:610,ahsInput:0,jdSubsidy:0,tmPrice:660,tmSubsidyManual:10000,tmSubsidySheet:0,zzPrice:650,basePrice:1600,...extra});

test('two-stage matching uses raw P max inflation, paired A, then P+E and row-specific net subsidies',()=>{
 const rules=[r(500,200,50,100,70),r(1000,300,100,200,120),r(2000,200,10,300,150)];
 const x=evaluateTradeInPrice(960,rules,2000);
 assert.equal(x.inflationTotal,200);assert.equal(x.inflationAhs,50);assert.equal(x.subsidyMatchPrice,1160);assert.equal(x.regularThreshold,1000);
 assert.equal(x.regularAhs,120);assert.equal(x.regularJd,200);assert.equal(x.costPrice,1130);assert.equal(x.handPrice,1360);assert.equal(x.itemPrice,1010);
 const y=evaluateTradeInPrice(2200,rules,4000);assert.equal(y.inflationTotal,300);assert.equal(y.inflationAhs,100);
 const paired=evaluateTradeInPrice(1700,[r(500,200,100,0,0),r(1500,200,40,0,0)],3000);assert.equal(paired.inflationAhs,40);
});
test('sample iQOO16 decreasing inflation does not iterate or switch to a lower inflation',()=>{
 const rules=[r(1500,200,0,700,300),r(2400,300,0,790,390),r(4000,200,0,1160,500)];
 const x=evaluateTradeInPrice(3750,rules,6000);assert.equal(x.inflationTotal,300);assert.equal(x.subsidyMatchPrice,4050);assert.equal(x.regularJd,1160);assert.equal(x.handPrice,5210);
});
test('manual prices, equality wins, price gaps and both costs use their separate inflation amounts',()=>{
 const rules=[r(500,200,50,120,70)];const p=product();const result=applyManualRecommendedPrice(calculateProductPrice(p,.03,rules),610,.03,rules);
 assert.equal(result.recommendJdPrice,610);assert.equal(result.inflationItemPriceAfter,660);assert.equal(result.postTmItemWin,true);assert.equal(result.postAhsPrice,730);assert.equal(result.postJdHandPrice,930);assert.equal(result.ahsSubsidyAfter,70);assert.equal(result.totalSubsidy,120);
 assert.equal(getTmPriceGaps(result).postItemGap,0);assert.ok(Math.abs(result.postMarginalProfit-(1-(730*1.0466+1600*.0218+81)/1600))<1e-12);
});
// Independent source-row oracle: intentionally does not call the evaluator.
function oracle(price:number,rules:SubsidyRule[],base:number){
 const available=rules.filter(r=>r.threshold<=price).sort((a,b)=>(b.inflationTotal!-a.inflationTotal!)||b.threshold-a.threshold),inflation=available[0],e=inflation?.inflationTotal??0,a=inflation?.inflationAhs??0;
 const hit=rules.filter(r=>r.threshold<=price+e).sort((a,b)=>b.threshold-a.threshold)[0];
 const b=hit?hit.ahsInput-hit.inflationAhs!:0,j=hit?hit.jdSubsidy-hit.inflationTotal!:0;
 return {item:price+a,hand:price+e+j,margin:1-((price+a+b)*1.0466+base*.0218+81)/base};
}
test('automatic candidate search matches exhaustive independent oracle across nonmonotonic tiers',()=>{
 const rules=[r(100,100,30,80,20),r(500,200,90,150,200),r(800,150,60,100,20),r(1000,250,100,100,180)];
 for(const floor of [.03,.12,.25]){
  const p=product({jdPrice:100,tmPrice:900,basePrice:1900}),actual=calculateProductPrice(p,floor,rules);
  const legal=[...new Set(Array.from({length:2200},(_,i)=>roundUploadPrice(i+1)))].filter(x=>x>=100&&x<=tradeInMarginUpper(1900,floor));
  const feasible=legal.filter(x=>oracle(x,rules,1900).margin+1e-12>=floor),target=feasible.filter(x=>oracle(x,rules,1900).item+1e-9>=927);
  const expected=target.length?Math.min(...target):feasible.length?Math.max(...feasible):100;
  assert.equal(actual.recommendJdPrice,expected);assert.ok(actual.postMarginalProfit+1e-12>=floor || expected===100);
 }
});
test('hand-price actions reevaluate inflation and changes invalidate their stored signatures',()=>{
 const rules=[r(100,100,0,150,30),r(900,200,80,200,80)];
 const p=calculateProductPrice(product({jdPrice:500,tmPrice:1000,tmSubsidyManual:200,basePrice:1800}),.03,rules);
 const record=createHandPriceAdjustment(p,rules,'align',-.05),aligned=applyHandPriceAdjustment(p,record,rules,.03);
 assert.ok(aligned.postJdHandPrice+1e-9>=1236);assert.equal(aligned.postJdHandPrice,evaluateTradeInPrice(aligned.recommendJdPrice,rules,1800).handPrice);
 assert.equal(applyHandPriceAdjustment(p,record,[{...rules[0],inflationAhs:10},rules[1]],.03),p);
});
test('blank inflation fields become zero and archive-only columns cannot replace total inputs',async()=>{
 const headers=['品牌','新机系列','门槛','京东总补贴','-爱回收承担补贴','京东总补贴（含京东券）','爱回收承担总补贴','旧机膨胀款','旧机膨胀款-爱回收承担'];
 const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([headers,['iQOO','系列',500,9999,9999,660,60,200,'']]),'Sheet1');
 const file=new File([XLSX.write(workbook,{type:'array',bookType:'xlsx'})],'new.xlsx');const parsed=await parseSubsidyRules(file);
 assert.equal(parsed[0].jdSubsidy,660);assert.equal(parsed[0].ahsInput,60);assert.equal(parsed[0].inflationAhs,0);assert.equal(parsed[0].rawFields['京东总补贴'],9999);
 const checked=validateMatrixRows([{品牌:'iQOO',新机系列:'系列',门槛:500,'京东总补贴（含京东券）':600,爱回收承担总补贴:50,旧机膨胀款:'','旧机膨胀款-爱回收承担':''}]);assert.equal(checked.rules[0].inflationTotal,0);
});
test('invalid rules cannot silently produce an automatic quote',()=>{
 const bad=[r(100,200,30,-50,0)];assert.throws(()=>evaluateTradeInPrice(100,bad,1500),/无效/);
 const p=calculateProductPrice(product(),.03,bad);assert.equal(p.recommendJdPrice,610);assert.match(p.pricingRemark,/待核验/);assert.equal(p.riskWarning,'CRITICAL');
});
