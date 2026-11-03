import test from 'node:test';
import assert from 'node:assert/strict';
import {groupThresholds,buildMatrix,validateMatrixRows,hitMatrixRules,compareSubsidyProfit} from './subsidyMatrix.mjs';
const r=(threshold,ahs,series='A',brand='品牌')=>({threshold,ahs,jd:ahs+20,series,brand});
test('bounded threshold groups never extend a transitive chain',()=>{
  const g=groupThresholds([r(199,1),r(200,1),r(209,1),r(210,1),r(219,1),r(199,2)]);
  assert.deepEqual(g.map(x=>x.values),[[199,200,209],[210,219]]);
  assert.ok(g.every(x=>x.max-x.min<=10));
});
test('aggregation preserves multiple amounts and original thresholds; global minimum ignores display filters',()=>{
  const input=[r(141,100),r(146,180),r(145,50,'B')],m=buildMatrix(input);
  assert.equal(m.rows[0].cells['141'].length,2);
  assert.deepEqual(m.rows[0].cells['141'].map(x=>[x.threshold,x.ahs]),[[141,100],[146,180]]);
  assert.equal(m.groups[0].low,50);assert.equal(m.groups[0].delta,130);
  assert.deepEqual(m.stats,{series:2,rules:3,rawThresholds:3,mergedThresholds:1,maxDelta:130});
});
test('raw price matching does not apply the merged-group maximum; highest reached tier is exclusive',()=>{
  const input=[r(141,100),r(146,180),r(200,300)];
  assert.equal(hitMatrixRules(input,'品牌','A',140).ahs,0);
  assert.equal(hitMatrixRules(input,'品牌','A',145).ahs,100);
  assert.equal(hitMatrixRules(input,'品牌','A',146).ahs,180);
  assert.equal(hitMatrixRules(input,'品牌','A',200).ahs,300);
  assert.equal(hitMatrixRules(input,'品牌','missing',200).ahs,null);
  assert.equal(hitMatrixRules(input,'品牌','A',NaN).ahs,null);
});
test('conflicting same-threshold rules require verification; exact duplicates remain traceable',()=>{
  const conflict=hitMatrixRules([r(141,100),r(141,180)],'品牌','A',146);
  assert.equal(conflict.status,'conflict');assert.equal(conflict.ahs,null);assert.equal(conflict.rules.length,2);
  assert.equal(hitMatrixRules([r(141,100),r(141,100)],'品牌','A',146).ahs,100);
});
test('validation rejects missing/invalid amounts, retains duplicates with warning',()=>{
  const raw={'品牌':'品牌','新机系列':'A','门槛':199,'京东总补贴（含京东券）':200,'爱回收承担总补贴':100};
  const parsed=validateMatrixRows([raw,{...raw},{...raw,'门槛':'非法'},{...raw,'爱回收承担总补贴':null},{...raw,'门槛':-1}]);
  assert.equal(parsed.rules.length,2);assert.equal(parsed.warnings.length,1);assert.equal(parsed.errors.length,3);
  assert.equal(parsed.rules[0].sourceRow,2);assert.deepEqual(parsed.rules[0].raw,raw);
});
test('fixed-cost example, denominator and system cost effect; floor boundaries',()=>{
  const args={baseProfit:0,basePrice:1200,baselineSubsidy:100,subsidy:180,floor:.03};
  assert.deepEqual(compareSubsidyProfit(args),{delta:80,profit:-80,rate:-80/1200,risk:'亏损风险'});
  assert.ok(Math.abs(compareSubsidyProfit({...args,mode:'system'}).profit+83.728)<1e-10);
  assert.equal(compareSubsidyProfit({...args,baseProfit:80}).risk,'低利润风险');
  assert.equal(compareSubsidyProfit({...args,baseProfit:116}).risk,'正常');
  assert.equal(compareSubsidyProfit({...args,basePrice:0}),null);
});

test('floating point noise at zero and at the workspace floor does not create false risk',()=>{
  const args={baseProfit:.03*545,basePrice:545,baselineSubsidy:100,subsidy:100,floor:.03,mode:'system'};
  assert.equal(compareSubsidyProfit(args).risk,'正常');
  const zero=compareSubsidyProfit({...args,baseProfit:83.728,subsidy:180});
  assert.equal(zero.profit,0);
  assert.equal(zero.risk,'低利润风险');
});
