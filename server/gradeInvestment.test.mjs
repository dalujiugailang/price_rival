import test from 'node:test';
import assert from 'node:assert/strict';
import {createGradeStore} from './gradeStore.mjs';
import {gradeInvestmentContribution,withGradeInvestment} from '../shared/gradeInvestment.mjs';
const row=(level,investment,brand='Redmi')=>({skuId:'1',level,model:'小米 13',origin:'等级推算',investment,soldVolume:10,display:{brand}});
const price={id:'p',skuId:'1',ppv:'A 小米13',model:'小米13',price:100,newSeries:'series'};
const batch={id:'batch',channelId:'tradeIn',products:[{id:'p',skuId:1,ppv:price.ppv,oldModel:price.model,recommendJdPrice:100,newSeries:'series'}],
  investmentRateMetrics:{estimatedInvestmentAmount:1000,adjustedPpvCount:1,adjustedDealVolume30d:10,androidOverallRate:.01,androidJdTradeInRate:.02},
  investmentRateInputs:{androidSalesAmount30d:100000,androidJdTradeInSalesAmount30d:50000},competitivenessMetrics:{tmItemScore:70}};
const payload=(amount)=>({title:'实时测算',request:{prices:[price],trackingBatchId:'batch'},issues:[],rows:[row('B',amount),row('C',null),row('D',0),{...row('A',5000),origin:'重点追价'}]});

test('unsaved or unconfirmed runs never contribute; only confirmed final inferred costs count',()=>{
  const run={...payload(200),id:'run',trackingBatchId:'batch',saved:false,isFinal:false};
  assert.equal(gradeInvestmentContribution(run),null);
  assert.equal(gradeInvestmentContribution({...run,saved:true,isFinal:true}),null);
  const confirmed={...run,saved:true,isFinal:true,investmentConfirmedAt:'now'};
  const extra=gradeInvestmentContribution(confirmed);
  assert.equal(extra.amount,200);assert.equal(extra.ppvCount,1);assert.equal(extra.pendingRows,1);
  assert.equal(extra.byBrand[0].brand,'小米');
  assert.equal(gradeInvestmentContribution({...confirmed,isFinal:false}),null);
  const projected=withGradeInvestment(batch,confirmed);
  assert.equal(projected.totalInvestmentRateMetrics.estimatedInvestmentAmount,1200);
  assert.equal(projected.totalInvestmentRateMetrics.androidOverallRate,.012);
  assert.equal(projected.totalInvestmentRateMetrics.androidJdTradeInRate,.024);
  assert.deepEqual(projected.competitivenessMetrics,batch.competitivenessMetrics);
  assert.equal(batch.investmentRateMetrics.estimatedInvestmentAmount,1000);
  assert.equal(withGradeInvestment({...batch,id:'other'},confirmed).gradeInvestment,undefined);
});

test('saving a new final replaces old contribution atomically, repeated saves do not accumulate, and new drafts do not affect it',()=>{
  const store=createGradeStore(':memory:');
  try {
    const first=store.createRun(payload(200),'test');
    assert.equal(store.getFinalRun('batch'),null);
    const saved=store.saveRun(first.id,'batch','test',{confirmInvestment:true});
    assert.ok(saved.investmentConfirmedAt);
    store.saveRun(first.id,'batch','test',{confirmInvestment:true});
    assert.equal(gradeInvestmentContribution(store.getFinalRun('batch')).amount,200);
    const second=store.createRun(payload(350),'test');
    assert.equal(gradeInvestmentContribution(store.getFinalRun('batch')).amount,200);
    store.saveRun(second.id,'batch','test',{confirmInvestment:true});
    assert.equal(store.listBatchRuns('batch').length,1);
    assert.equal(gradeInvestmentContribution(store.getFinalRun('batch')).amount,350);
    assert.equal(gradeInvestmentContribution(store.getRun(first.id)),null);
    assert.equal(store.getRun(first.id).rows[0].investment,200);
    assert.throws(()=>store.saveRun(first.id,'batch','test',{confirmInvestment:true}),/替换/);
  } finally {store.close();}
});
