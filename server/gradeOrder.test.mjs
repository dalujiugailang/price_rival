import assert from 'node:assert/strict';
import {test} from 'node:test';
import {stabilizeGradeOrder} from '../shared/gradeOrder.mjs';
import {applyGradeMarginFloor} from '../shared/gradeMargin.mjs';
import {applyGradeStrategyPrices} from '../shared/gradeExpansion.mjs';
import {addGradePresentation} from '../shared/gradePresentation.mjs';
const rules=[{newSeries:'系列甲',threshold:0,ahsInput:20,jdSubsidy:50}];
const row=(level,rank,ratio,price,origin='等级推算',skuId='1')=>({model:'型号甲',skuId,ppv:`${level}型号甲${skuId}`,level,rank,ratio,price,ratioPrice:price,status:[],origin,newSeries:'系列甲',soldVolume:2});
const daily=rows=>rows.map(r=>({ppv:r.ppv,BI基准价:2000,最终报价:500}));
const stabilize=rows=>stabilizeGradeOrder({rows},rules,daily(rows));
const ordered=rows=>{
  for(let i=1;i<rows.length;i++)assert.ok(rows[i].price<=rows[i-1].price);
};

test('cascade re-anchors again when an already cheaper intermediate grade leaves a later inversion',()=>{
  const rows=[row('A+',1,1,1000,'重点追价'),row('A1',2,.9,800),row('A',3,.8,900),row('B',4,.7,600),row('C',5,.69,700)];
  const before=JSON.stringify(rows),r=stabilize(rows);
  assert.equal(JSON.stringify(rows),before);assert.equal(r.orderSummary.rounds,2);assert.equal(r.orderSummary.unresolved,0);
  assert.deepEqual(r.rows.map(r=>r.price),[1000,800,710,600,590]);ordered(r.rows);
  assert.deepEqual(r.rows[4].orderSteps.map(s=>s.reference.level),['A1','B']);
  assert.equal(r.rows[4].orderReference.price,600);assert.equal(r.rows[4].priceBeforeOrder,700);
  assert.deepEqual(stabilize(r.rows).rows.map(r=>r.price),r.rows.map(r=>r.price));
});
test('fixed lower-grade conflicts remain visible and are never used as a new safe reference',()=>{
  const rows=[row('A+',1,1,700),row('A1',2,.9,900,'重点追价'),row('B',3,.8,1000)];
  const r=stabilize(rows);assert.equal(r.rows[1].price,900);assert.ok(r.rows[2].price<=700);
  assert.equal(r.orderIssues.length,1);assert.match(r.orderIssues[0].message,/已定价/);assert.ok(r.rows[1].status.includes('等级倒挂待人工确认'));
});
test('unknown grades are not treated as zero and no valid positive output fails closed',()=>{
  const r=stabilize([row('A+',1,1,500,'重点追价'),row('A',2,.9,null),row('B',3,.8,700)]);
  assert.equal(r.rows[1].price,null);assert.equal(r.rows[2].price,400);assert.equal(r.orderSummary.pendingRows,1);
  const tiny=stabilize([row('A+',1,1,1,'重点追价'),row('B',2,.5,2)]);
  assert.equal(tiny.rows[1].price,null);assert.equal(tiny.orderSummary.pendingRows,1);
});
test('SKUs remain isolated and an ordered ladder is left unchanged',()=>{
  const rows=[row('A',1,1,1000,'重点追价','1'),row('B',2,.8,900,'等级推算','1'),row('A',1,1,500,'重点追价','2'),row('B',2,.8,700,'等级推算','2')];
  const r=stabilize(rows);assert.deepEqual(r.rows.map(r=>r.price),[1000,900,500,400]);assert.equal(r.orderSummary.affectedSkus,1);
});
test('final subsidy, margin and spend reflect cascade price and cannot violate the 3% floor',()=>{
  const rows=[row('A+',1,1,1200,'重点追价'),row('A1',2,.9,800),row('B',3,.8,1000)];
  const tierRules=[{newSeries:'系列甲',threshold:0,ahsInput:20,jdSubsidy:50},{newSeries:'系列甲',threshold:900,ahsInput:200,jdSubsidy:250}];
  const lookup=daily(rows);const guarded=applyGradeMarginFloor({rows},tierRules,lookup);
  const result=addGradePresentation(applyGradeStrategyPrices(stabilizeGradeOrder(guarded,tierRules,lookup),lookup),{subsidyRules:tierRules},lookup);
  const b=result.rows[2];assert.equal(b.price,710);assert.equal(b.display.ahsSubsidyAfter,20);assert.equal(b.display.postJdHandPrice,760);assert.equal(b.investment,420);
  assert.ok(b.display.postMarginalProfit>=.03);assert.equal(b.display.postMarginalProfit,b.marginAfterCorrection);assert.match(b.display.pricingRemark,/第1轮参考/);
});
