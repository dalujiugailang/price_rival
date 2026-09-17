import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import * as XLSX from 'xlsx';
import { buildGradePlan, applyGradeStrategyPrices, resolveGradeInputLevel, gradePriceChoiceKey } from '../shared/gradeExpansion.mjs';
import { parseGradeVolume, parseGradeTemplate, validatePeriod } from './gradeSources.mjs';
import { createGradeStore } from './gradeStore.mjs';
import { createGradePriceClient, createGradeWorkbook, registerGradeRoutes } from './gradeRoutes.mjs';

const levels=['S','A+','A2','B1','B','B2','C','D'];
const template={models:{型号甲:'模板甲'},rules:levels.map((level,i)=>({template:'模板甲',rank:i+1,level,ratio:1.05-i*.05}))};
const volume={rows:['101','102'].flatMap(skuId=>levels.map(level=>({model:'型号甲',sku:`型号甲 ${skuId==='101'?'256G':'512G'}`,skuId,level,ppv:`${level}型号甲 ${skuId==='101'?'256G':'512G'}`,quoteVolume:10,soldVolume:2,sourceRows:[2]})))};
const price=(skuId='101',level='A+',value=2000,id=`${skuId}-${level}`)=>({id,ppv:volume.rows.find(r=>r.skuId===skuId&&r.level===level).ppv,skuId,model:'型号甲',level,price:value,newSeries:'新机系列',display:{recommendAdjustment:100}});
const plan=(overrides={})=>buildGradePlan({volume,template,prices:[price()],skuIds:['101'],...overrides});
const workbook=sheets=>{
  const w=XLSX.utils.book_new();for(const [name,rows] of Object.entries(sheets))XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet(rows),name);
  return XLSX.write(w,{type:'buffer',bookType:'xlsx'});
};
const volumeFile=()=>workbook({底表:[['商品型号','商品SKUID','商品SKU','商品LEVEL','报价量','成交量'],...volume.rows.map(r=>[r.model,r.skuId,r.sku,r.level,r.quoteVolume,r.soldVolume])]});
const templateFile=()=>workbook({'型号对应等级模板':[['型号名称','等级模板名称'],['型号甲','模板甲']],
  '等级模板对应等级降序':[['等级模板名称','等级顺位','等级','等级比'],...template.rules.map(r=>[r.template,r.rank,r.level,r.ratio])]});

test('legacy empty levels distinguish different grades without a volume match',()=>{
  const rules=['A','A+','A1','99-S','99-S1'].map(level=>({level}));
  for(const level of ['A+','A1','99-S','99-S1']) {
    assert.equal(resolveGradeInputLevel({ppv:`${level}型号甲 256G`,model:'型号甲',level:''},rules),level);
  }
  assert.notEqual(gradePriceChoiceKey('101',resolveGradeInputLevel({ppv:'A+型号甲 256G',model:'型号甲'},rules)),
    gradePriceChoiceKey('101',resolveGradeInputLevel({ppv:'A1型号甲 256G',model:'型号甲'},rules)));
  assert.equal(resolveGradeInputLevel({ppv:'未知型号甲 256G',model:'型号甲'},rules),'');
  assert.equal(resolveGradeInputLevel({ppv:'A+其他型号 256G',model:'型号甲'},rules),'');
});

test('SKU uses its model template; six downward levels include the highest priced grade',()=>{
  const result=plan();assert.equal(result.rows.length,6);assert.deepEqual(result.rows.map(r=>r.level),['A+','A2','B1','B','B2','C']);
  assert.equal(result.rows[0].origin,'重点追价');assert.equal(result.rows[1].price,1900);
  assert.ok(result.rows.every(r=>r.skuId==='101'));
});
test('two SKUs generate 12 separate PPVs',()=>{
  const result=plan({prices:[price(),price('102','A+',3000)],skuIds:['101','102']});
  assert.equal(result.rows.length,12);assert.equal(new Set(result.rows.map(r=>r.ppv)).size,12);
  assert.equal(result.rows.find(r=>r.skuId==='102'&&r.level==='A2').price,2850);
});
test('zero adjustment SKU is skipped before requiring grade or volume data',()=>{
  const p={...price(),display:{recommendAdjustment:0}};
  const result=plan({prices:[p],volume:{rows:[]},template:{models:{},rules:[]}});
  assert.equal(result.rows.length,0);assert.equal(result.issues.length,0);
  assert.equal(result.skippedSkus[0].skuId,'101');assert.match(result.skippedSkus[0].reason,/全部为0/);
  const mixedSkus=plan({prices:[p,price('102')],skuIds:['101','102']});
  assert.ok(mixedSkus.rows.every(r=>r.skuId==='102'));assert.equal(mixedSkus.rows.length,6);
});
test('zero adjustment record cannot anchor a SKU with an actually raised grade',()=>{
  const zero={...price('101','A+',1000),display:{recommendAdjustment:0}};
  const raised=price('101','A2',1500);
  const r=plan({prices:[zero,raised]});
  assert.equal(r.rows.length,6);assert.equal(r.skippedSkus.length,0);
  assert.ok(r.rows.every(p=>p.anchorPrice===1500&&p.anchorPpv===raised.ppv));
  assert.equal(r.rows.find(p=>p.level==='A+').price,1000);
});
test('missing adjustment is not zero and can only be reconstructed from the same saved original price',()=>{
  assert.match(plan({prices:[{...price(),display:{}}]}).issues[0].message,/缺少.*调整额/);
  assert.equal(plan({prices:[{...price(),display:{jdPrice:2000}}]}).skippedSkus.length,1);
  assert.equal(plan({prices:[{...price(),display:{jdPrice:1900}}]}).rows.length,6);
});
test('lowest saved final price is anchor regardless of grade; coverage and existing prices stay unchanged',()=>{
  const result=plan({prices:[price('101','B',1999),price()]});
  assert.equal(result.rows.find(r=>r.level==='B').price,1999);
  assert.ok(result.rows.every(r=>r.anchorPrice===1999&&r.anchorPpv===price('101','B').ppv));
  assert.deepEqual(result.rows.map(r=>r.level),['A+','A2','B1','B','B2','C']);
  assert.equal(result.rows[0].price,2000);
  const inverted=plan({prices:[price('101','A+',1000),price('101','B',1500)]});
  assert.ok(inverted.rows.every(r=>r.anchorPrice===1000));
  const tied=plan({prices:[price('101','B',1000),price('101','A+',1000)]});
  assert.ok(tied.rows.every(r=>r.anchorPpv===price().ppv));
});
test('fewer remaining grades stays shorter; existing prices outside six are retained',()=>{
  assert.equal(plan({prices:[price('101','C',500)]}).rows.length,2);
  const r=plan({prices:[price(),price('101','D',500)]});assert.equal(r.rows.length,7);
  assert.equal(r.rows.at(-1).price,500);assert.ok(r.rows.at(-1).status.includes('六档外已定价'));
});
test('same PPV across series counts once, differing prices need explicit choice',()=>{
  const a=price(),b={...a,id:'duplicate',newSeries:'另一个系列'};
  assert.equal(plan({prices:[a,b]}).rows.length,6);
  b.price=2200;assert.equal(plan({prices:[a,b]}).rows.length,0);
  const chosen=plan({prices:[a,b],priceChoices:{'101:a+':'duplicate'}});
  assert.equal(chosen.rows[0].price,2200);
});
test('missing template, mismatched model and wrong PPV fail visibly',()=>{
  assert.match(plan({template:{...template,models:{}}}).issues[0].message,/模板/);
  assert.match(plan({prices:[{...price(),model:'错误型号'}]}).issues[0].message,/不一致/);
  assert.match(plan({prices:[{...price(),ppv:'A+错误规格'}]}).issues[0].message,/不一致/);
});
test('missing activity defaults to zero spend, while missing prices with sales stay pending',()=>{
  const r=plan();r.rows[1].soldVolume=0;r.rows[2].soldVolume=null;
  const result=applyGradeStrategyPrices(r,r.rows.slice(0,3).map(row=>({ppv:row.ppv,最终报价:row.price+100,matched:true})));
  assert.equal(result.rows[0].adjustment,-100);assert.equal(result.rows[0].investment,0);
  assert.ok(result.rows[0].status.includes('低于策略价'));
  assert.equal(result.rows[1].investment,0);assert.equal(result.rows[2].investment,0);
  assert.equal(result.rows[2].soldVolume,0);
  const positive=applyGradeStrategyPrices(r,[{ppv:r.rows[2].ppv,最终报价:r.rows[2].price-100}]);
  assert.equal(positive.rows[2].investment,0);
  assert.equal(positive.rows[1].investment,0);
  assert.equal(result.rows[3].strategyPrice,null);assert.equal(result.rows[3].investment,null);
  assert.equal(result.summary.pendingRows,3);
});
test('final quote only; subsidy/cost/base/competitor data cannot affect expansion',()=>{
  const r=plan(),before=structuredClone(r);
  const result=applyGradeStrategyPrices(r,[{ppv:r.rows[0].ppv,BI基准价:5000,报价:8000,costPrice:123}]);
  assert.equal(result.rows[0].strategyPrice,null);assert.deepEqual(r,before);
  assert.ok(result.rows.every(row=>!('postTmItemWin'in row)&&!('totalSubsidy'in row)));
});
test('summary separately accounts for core and expanded investment once',()=>{
  const r=plan();const result=applyGradeStrategyPrices(r,r.rows.map(row=>({ppv:row.ppv,最终报价:row.price-10})));
  assert.deepEqual([result.summary.coreInvestment,result.summary.expansionInvestment,result.summary.totalInvestment],[20,100,120]);
});
test('raw parser preserves all grades and treats blank activity as zero when aggregating',()=>{
  const parsed=parseGradeVolume(volumeFile());assert.equal(parsed.rows.length,16);assert.equal(parsed.rows[0].level,'S');
  const b=workbook({表:[['商品型号','商品SKUID','商品SKU','商品LEVEL','报价量','成交量'],['甲','1','甲256','S',null,null],['甲','1','甲256','A+',0,0],['甲','1','甲256','A+',5,2]]});
  const r=parseGradeVolume(b).rows;assert.equal(r[0].soldVolume,0);assert.equal(r[0].quoteVolume,0);assert.equal(r[1].soldVolume,2);assert.equal(r[1].quoteVolume,5);
});
test('grades absent from the activity source default both counts to zero',()=>{
  const partial={rows:volume.rows.filter(r=>r.level==='A+')};
  const result=plan({volume:partial});
  const missing=result.rows.filter(r=>r.level!=='A+');
  assert.equal(missing.length,5);
  assert.ok(missing.every(r=>r.quoteVolume===0&&r.soldVolume===0&&!r.status.includes('未匹配成交量')));
  const priced=applyGradeStrategyPrices(result,[]);
  assert.ok(priced.rows.filter(r=>r.level!=='A+').every(r=>r.investment===0));
});
test('template validates one-to-one model mapping, rank order and ratio monotonicity',()=>{
  const parsed=parseGradeTemplate(templateFile());assert.equal(parsed.rules.length,8);
  const b=workbook({'型号对应等级模板':[['型号名称','等级模板名称'],['甲','模板']],
    '等级模板对应等级降序':[['等级模板名称','等级顺位','等级','等级比'],['模板',1,'A+',1],['模板',2,'B',1.1]]});
  assert.throws(()=>parseGradeTemplate(b),/回升/);
});
test('period must be exactly 30 days; malformed count and conflicting SKU rejected',()=>{
  validatePeriod('2026-08-17','2026-09-15');assert.throws(()=>validatePeriod('2026-09-01','2026-09-15'));
  const b=workbook({表:[['商品型号','商品SKUID','商品SKU','商品LEVEL','报价量','成交量'],['甲','1','甲256','S','无',2]]});
  assert.throws(()=>parseGradeVolume(b),/非负数/);
});
test('raw files and data survive reopening; same hash and period is idempotent',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'grade-store-'));const file=path.join(dir,'db.sqlite');let store=createGradeStore(file);
  const bytes=volumeFile();const result=store.saveSource({kind:'volume',fileName:'源.xlsx',buffer:bytes,periodStart:'2026-08-17',periodEnd:'2026-09-15'});
  assert.equal(store.saveSource({kind:'volume',fileName:'重复.xlsx',buffer:bytes,periodStart:'2026-08-17',periodEnd:'2026-09-15'}).reused,true);
  store.close();store=createGradeStore(file);assert.equal(store.listSources().length,1);
  assert.equal(store.getSource(result.source.id).data.rows.length,16);
  assert.ok(Buffer.from(store.getFile(result.source.id).original).equals(bytes));store.close();fs.rmSync(dir,{recursive:true});
});
test('run snapshots freeze data even after original object changes; saved flag survives reopening',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'grade-runs-'));const store=createGradeStore(path.join(dir,'db.sqlite'));
  const payload={title:'本版',rows:[{price:100}],request:{prices:[{price:100}]}};const run=store.createRun(payload,'test');payload.rows[0].price=999;
  assert.equal(store.getRun(run.id).rows[0].price,100);store.saveRun(run.id,'batch','test');assert.equal(store.getRun(run.id).saved,true);
  store.close();fs.rmSync(dir,{recursive:true});
});
test('Daily Price batched responses must come from one date',async()=>{
  let calls=0;const client=createGradePriceClient({url:'https://example.test',token:'test',fetchImpl:async()=>({ok:true,json:async()=>({rows:[],dataDate:String(++calls)})})});
  await assert.rejects(()=>client(Array.from({length:201},(_,i)=>String(i))),/更新了数据/);
});
test('export preserves price results and status without algorithm explanation columns',()=>{
  const r=plan();const result=applyGradeStrategyPrices(r,r.rows.map(row=>({ppv:row.ppv,最终报价:row.price+10})));
  const source={id:'src',fileName:'file.xlsx',periodStart:'2026-08-17',periodEnd:'2026-09-15',data:template};
  const bytes=createGradeWorkbook({...result,id:'run',title:'测算',createdAt:'2026-09-16',request:{workspaceVersion:'V1'},sources:{volume:source,template:source},dailyPriceDate:'2026-09-16',dailyPriceFetchedAt:'now'});
  const w=XLSX.read(bytes);assert.deepEqual(w.SheetNames,['型号汇总','完整价格明细','待补数据','数据来源']);
  const exported=XLSX.utils.sheet_to_json(w.Sheets['完整价格明细'],{header:1});
  assert.equal(exported[1][0],'新机系列');
  assert.equal(exported[2][exported[1].indexOf('投入测算单台调整额')],-10);
  assert.equal(exported[2][exported[1].indexOf('预估新增投入')],0);
  assert.equal(exported[2][exported[1].indexOf('tm裸机价')],'-');
  assert.ok(exported[1].includes('状态'));
  assert.ok(!exported[1].some(label=>/参考基准|修正|等级比|理由|说明/.test(label)));
});
test('routes enforce editor and channel permissions; upload/download/run/save remain separate',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'grade-http-'));const store=createGradeStore(path.join(dir,'db.sqlite'));
  const app=express();app.use(express.json({limit:'2mb'}));
  app.use((req,_res,next)=>{req.authUser={openId:'test',role:req.get('x-role')||'admin',enabled:true,scopes:(req.get('x-scopes')||'').split(',')};next();});
  const p=price();
  const batch={id:'batch',channelId:'tradeIn',products:[{id:p.id,skuId:p.skuId,ppv:p.ppv,oldModel:p.model,newSeries:p.newSeries,recommendJdPrice:p.price,recommendAdjustment:100}]};
  const batches=new Map([['batch',batch],['other',{...batch,id:'other'}],['wrong',{...batch,products:[{...batch.products[0],recommendJdPrice:1}]}],['self',{...batch,channelId:'selfOperated'}]]);
  const audits=[];
  registerGradeRoutes(app,{store,getBatch:id=>batches.get(id),writeAudit:entry=>audits.push(entry),lookupPrices:async ppvs=>({rows:ppvs.map(ppv=>({ppv,最终报价:100})),dataDate:'2026-09-16',fetchedAt:'now'})});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const url=`http://127.0.0.1:${server.address().port}/api/grade-expansion`;
  const post=(route,body,headers={})=>fetch(url+route,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
  try{
    assert.equal((await fetch(url+'/sources',{headers:{'x-role':'viewer','x-scopes':'tradeIn.workspace'}})).status,403);
    assert.equal((await fetch(url+'/sources',{headers:{'x-role':'editor','x-scopes':'selfOperated.workspace'}})).status,403);
    assert.equal((await post('/sources',{}, {'x-role':'editor','x-scopes':'tradeIn.workspace'})).status,403);
    const v=await(await post('/sources',{kind:'volume',fileName:'raw.xlsx',fileBase64:volumeFile().toString('base64'),periodStart:'2026-08-17',periodEnd:'2026-09-15'})).json();
    const t=await(await post('/sources',{kind:'template',fileName:'rules.xlsx',fileBase64:templateFile().toString('base64')})).json();
    const original=await(await fetch(url+`/sources/${v.source.id}/file`)).arrayBuffer();assert.equal(crypto.createHash('sha256').update(Buffer.from(original)).digest('hex'),v.source.hash);
    const generated=await(await post('/runs',{volumeId:v.source.id,templateId:t.source.id,prices:[price()],skuIds:['101'],workspaceVersion:'V1'})).json();
    assert.equal(generated.run.rows.length,6);assert.equal(generated.run.saved,false);
    const historyHeaders={'x-role':'viewer','x-scopes':'tradeIn.history'};
    const getAsHistory=route=>fetch(url+route,{headers:historyHeaders});
    assert.equal((await getAsHistory(`/runs/${generated.run.id}`)).status,403);
    assert.equal((await getAsHistory(`/runs/${generated.run.id}/export`)).status,403);
    assert.equal((await getAsHistory('/runs')).status,403);
    for(const id of ['', 'wrong', 'self','missing'])assert.equal((await post(`/runs/${generated.run.id}/save`,{trackingBatchId:id})).status,400);
    const saved=await(await post(`/runs/${generated.run.id}/save`,{trackingBatchId:'batch'})).json();assert.equal(saved.run.saved,true);
    assert.equal(saved.run.trackingBatchId,'batch');assert.ok(saved.run.savedAt);
    assert.deepEqual(saved.run.rows,generated.run.rows);
    const second=await(await post(`/runs/${generated.run.id}/save`,{})).json();assert.equal(second.run.savedAt,saved.run.savedAt);
    assert.equal((await post(`/runs/${generated.run.id}/save`,{trackingBatchId:'other'})).status,400);
    assert.equal((await post(`/runs/${generated.run.id}/save`,{},historyHeaders)).status,403);
    assert.equal((await getAsHistory(`/runs/${generated.run.id}`)).status,200);
    assert.equal((await fetch(url+`/runs/${generated.run.id}/export`)).status,200);
    assert.equal((await getAsHistory(`/runs/${generated.run.id}/export`)).status,200);
    const linked=await(await getAsHistory('/batches/batch')).json();
    assert.equal(linked.runs.length,1);
    assert.deepEqual(linked.events.map(e=>e.action),['exported','exported','investment_confirmed','saved','generated']);
    assert.ok(saved.run.investmentConfirmedAt);
    assert.equal((await(await getAsHistory('/batches/other')).json()).runs.length,0);
    assert.equal((await fetch(url+'/batches/batch',{headers:{'x-role':'viewer','x-scopes':'selfOperated.history'}})).status,403);
    assert.equal((await getAsHistory('/batches/self')).status,400);
    const refreshed=await(await post('/runs',{...generated.run.request,parentRunId:generated.run.id,title:'新版'})).json();
    assert.notEqual(refreshed.run.id,generated.run.id);assert.equal(refreshed.run.trackingBatchId,'batch');
    assert.equal(refreshed.run.saved,false);
    assert.equal((await(await getAsHistory('/batches/batch')).json()).runs.length,1);
    assert.equal((await getAsHistory(`/runs/${refreshed.run.id}`)).status,403);
    assert.equal((await post(`/runs/${refreshed.run.id}/save`,{})).status,200);
    const finals=await(await getAsHistory('/batches/batch')).json();
    assert.equal(finals.runs.length,1);assert.equal(finals.runs[0].id,refreshed.run.id);
    assert.ok(finals.runs[0].investmentConfirmedAt);
    assert.equal((await post(`/runs/${generated.run.id}/save`,{})).status,400);
    assert.equal(store.getRun(generated.run.id).savedAt,saved.run.savedAt);
    assert.equal(audits.filter(a=>a.action==='grade_run_saved').length,2);
    assert.ok(audits.filter(a=>a.action==='grade_run_saved').every(a=>a.resourceType==='tracking_batch'&&a.resourceId==='batch'));
    batches.delete('batch');
    assert.equal((await getAsHistory(`/runs/${generated.run.id}`)).status,403);
    assert.equal((await getAsHistory('/batches/batch')).status,400);
  }finally{await new Promise(resolve=>server.close(resolve));store.close();fs.rmSync(dir,{recursive:true});}
});
