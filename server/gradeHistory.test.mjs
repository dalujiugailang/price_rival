import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createGradeStore } from './gradeStore.mjs';
import { gradeBatchMismatch, gradeSourceBatchId } from '../shared/gradeHistory.mjs';

test('batch matching uses SKU, PPV, series, model and frozen pricing; does not guess from dates',()=>{
  const p={id:'id',skuId:'100',ppv:'A+ phone',model:'phone',newSeries:'new',price:200,display:{recommendAdjustment:20}};
  const product={id:p.id,skuId:100,ppv:p.ppv,oldModel:p.model,newSeries:p.newSeries,recommendJdPrice:200,recommendAdjustment:20};
  const request={prices:[p]},batch={id:'batch',channelId:'tradeIn',products:[product]};
  assert.equal(gradeBatchMismatch(request,batch),'');
  for(const field of ['id','skuId','ppv','oldModel','newSeries','recommendJdPrice','recommendAdjustment']) {
    assert.ok(gradeBatchMismatch(request,{...batch,products:[{...product,[field]:'different'}]}));
  }
  assert.ok(gradeBatchMismatch({prices:[p,p]},batch));
  assert.ok(gradeBatchMismatch(request,{...batch,channelId:'selfOperated'}));
  assert.equal(gradeSourceBatchId({workspaceVersion:'竞争版本 V1'}),'');
  assert.equal(gradeSourceBatchId({workspaceVersion:'共享快照 TRACK-20260101-120000-ABC123'}),'TRACK-20260101-120000-ABC123');
});

test('old database migrates without overwriting runs; archive and logs survive reopening and cannot be rebound',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'grade-history-')),file=path.join(dir,'db.sqlite');
  let store;
  try {
    const db=new DatabaseSync(file);
    db.exec('CREATE TABLE grade_runs(id TEXT PRIMARY KEY,title TEXT,created_at TEXT,saved INTEGER,payload_json TEXT,created_by TEXT)');
    const payload={id:'old',title:'旧版',createdAt:'2026-09-16',saved:true,request:{prices:[{price:100}]},rows:[{price:100}]};
    db.prepare('INSERT INTO grade_runs VALUES(?,?,?,?,?,?)').run('old','旧版','2026-09-16',1,JSON.stringify(payload),'old-user');db.close();
    store=createGradeStore(file);
    const normalizedRows=[{price:100,quoteVolume:0,soldVolume:0,investment:0,status:[]}];
    assert.deepEqual(store.getRun('old').rows,normalizedRows);
    const saved=store.saveRun('old','batch',{openId:'user',name:'测试操作人'});
    store.saveRun('old','batch',{openId:'user',name:'测试操作人'});
    assert.throws(()=>store.saveRun('old','another','user'),/不能移动/);
    assert.equal(store.listBatchEvents('batch').length,1);
    assert.equal(store.listBatchEvents('batch')[0].actorName,'测试操作人');
    const draft=store.createRun({title:'新版',request:{trackingBatchId:'batch'},rows:[{price:90}],parentRunId:'old'},'user');
    assert.equal(store.listBatchRuns('batch').length,1);
    store.saveRun(draft.id,'batch','user');
    store.close();store=createGradeStore(file);
    assert.equal(store.listBatchRuns('batch').length,1);
    assert.equal(store.listBatchRuns('batch')[0].id,draft.id);
    assert.equal(store.getRun('old').isFinal,false);
    assert.throws(()=>store.saveRun('old','batch','user'),/替换/);
    assert.equal(store.getRun('old').savedAt,saved.savedAt);
    assert.deepEqual(store.getRun('old').rows,normalizedRows);
    const rawDb=new DatabaseSync(file,{readOnly:true});
    assert.deepEqual(JSON.parse(rawDb.prepare('SELECT payload_json FROM grade_runs WHERE id=?').get('old').payload_json),payload);
    rawDb.close();
    assert.deepEqual(store.listBatchEvents('batch').map(e=>e.action),['superseded','saved','refreshed','saved']);
  } finally {store?.close();fs.rmSync(dir,{recursive:true,force:true});}
});
