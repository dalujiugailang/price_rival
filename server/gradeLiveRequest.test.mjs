import test from 'node:test';
import assert from 'node:assert/strict';
import {createGradeRequestCache,gradeRequestKey} from '../shared/gradeLiveRequest.mjs';
const request=()=>({volumeId:'v',templateId:'t',workspaceVersion:'V1',skuIds:['1'],prices:[{id:'p',skuId:'1',ppv:'A phone',model:'phone',level:'A',price:100,newSeries:'new',display:{recommendAdjustment:10}}],priceChoices:{},subsidyRules:[]});
test('equivalent workspace inputs share in-flight calculation; changed prices remain separate even when responses finish out of order',async()=>{
  const pending=[];
  const load=createGradeRequestCache(input=>new Promise(resolve=>pending.push({input,resolve})));
  const a=request(),b=request();b.prices[0].price=120;
  const old=load(a),same=load(structuredClone(a)),latest=load(b);
  assert.equal(old,same);assert.notEqual(old,latest);
  await Promise.resolve();assert.equal(pending.length,2);
  pending[1].resolve({price:120});assert.deepEqual(await latest,{price:120});
  pending[0].resolve({price:100});assert.deepEqual(await old,{price:100});
  assert.deepEqual(await load(b),{price:120});
});
test('new SKU, data source, series, subsidy and snapshot changes invalidate the previous result',()=>{
  const original=request();
  for(const mutate of [r=>r.skuIds.push('2'),r=>r.templateId='t2',r=>r.volumeId='v2',r=>r.trackingBatchId='batch2',r=>r.prices[0].newSeries='other',r=>r.prices[0].display.recommendAdjustment=0,r=>r.subsidyRules.push({threshold:100,ahsInput:20,jdSubsidy:30,newSeries:'new'})]) {
    const changed=request();mutate(changed);assert.notEqual(gradeRequestKey(changed),gradeRequestKey(original));
  }
});
test('refresh, expiry, failure retry and saved-state updates do not reuse stale results',async()=>{
  let calls=0,clock=0;
  const load=createGradeRequestCache(async()=>({id:++calls}),{now:()=>clock,ttl:100});const r=request();
  assert.deepEqual(await load(r),{id:1});assert.deepEqual(await load(r),{id:1});
  assert.deepEqual(await load(r,true),{id:2});
  load.update(r,{id:2,saved:true});assert.deepEqual(await load(r),{id:2,saved:true});
  clock=101;assert.deepEqual(await load(r),{id:3});
  let failed=true;
  const retry=createGradeRequestCache(async()=>{if(failed){failed=false;throw new Error('offline');}return 'ok';});
  await assert.rejects(retry(r),/offline/);assert.equal(await retry(r),'ok');
});
