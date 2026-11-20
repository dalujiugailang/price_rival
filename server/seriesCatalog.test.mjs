import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createDatabase} from './database.mjs';
import {createSeriesCatalog,registerSeriesCatalogRoutes} from './seriesCatalog.mjs';
import {INITIAL_SERIES_CATALOG,seriesCatalogIndex,positionProducts,missingSeries,validateSeriesCatalog} from '../shared/seriesCatalog.mjs';

test('explicit positions, normalized brand+series matching and missing combinations',()=>{
 assert.equal(INITIAL_SERIES_CATALOG.length,33);
 const index=seriesCatalogIndex(INITIAL_SERIES_CATALOG);
 const products=[{brand:'华为',newSeries:'Mate 80',jdPrice:100},{brand:'小米',newSeries:' REDMI K100 ',jdPrice:200},{brand:'荣耀',newSeries:'X80 Pro Max'},{brand:'华为',newSeries:'Find X10'},{brand:'',newSeries:'Mate 80'}];
 assert.deepEqual(positionProducts(products,index).map(p=>p.newSeriesPosition),['次旗舰','旗舰','中端','','']);
 assert.equal(products[0].newSeriesPosition,undefined);
 assert.equal(positionProducts(products,index)[0].jdPrice,100);
 assert.equal(missingSeries([...products,products[3]],index).length,2);
 assert.throws(()=>validateSeriesCatalog([{brand:'REDMI',newSeries:'REDMI K100',newSeriesPosition:'旗舰'},{brand:'小米',newSeries:'REDMI K100',newSeriesPosition:'次旗舰'}]),/重复/);
 assert.throws(()=>validateSeriesCatalog([{brand:'华为',newSeries:'Mate 90',newSeriesPosition:''}]),/定位/);
});

test('migration freezes exactly latest eight saved detail snapshots; restart and edits never touch older history',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'series-position-')),file=path.join(dir,'test.sqlite');
 const db=createDatabase(file),raw=new DatabaseSync(file);
 const ctx={actor:{openId:'tester',name:'测试'}};
 for(let i=0;i<12;i++){
  const product={brand:'华为',newSeries:'Mate 80',ppv:`P${i}`,jdPrice:610,postTmItemWin:true};
  db.createBatch({id:`B${i}`,date:'2026-11-20',operator:'测试',channelId:'tradeIn',products:[product],restorePayload:{productsMaster:[product]},competitivenessMetrics:{tmItemScore:80}},ctx);
  raw.prepare('UPDATE tracking_batches SET created_at=? WHERE id=?').run(`2026-11-${String(i+1).padStart(2,'0')}T00:00:00Z`,`B${i}`);
 }
 db.createBatch({id:'summary',date:'2026-11-20',operator:'测试',isSummaryOnly:true,products:[{brand:'华为',newSeries:'Mate 80'}]},ctx);
 db.createBatch({id:'self',date:'2026-11-20',operator:'测试',channelId:'selfOperated',products:[{brand:'华为',newSeries:'Mate 80'}]},ctx);
 const oldPayload=raw.prepare('SELECT payload_json FROM tracking_batches WHERE id=?').get('B3').payload_json;
 const times=raw.prepare('SELECT created_at,updated_at FROM tracking_batches WHERE id=?').get('B11');
 let catalog=createSeriesCatalog(file);
 assert.equal(catalog.get().backfilledBatchIds.length,8);
 assert.equal(db.getBatch('B4').products[0].newSeriesPosition,'次旗舰');
 assert.equal(db.getBatch('B11').restorePayload.productsMaster[0].newSeriesPosition,'次旗舰');
 assert.equal(raw.prepare('SELECT payload_json FROM tracking_batches WHERE id=?').get('B3').payload_json,oldPayload);
 assert.deepEqual(raw.prepare('SELECT created_at,updated_at FROM tracking_batches WHERE id=?').get('B11'),times);
 assert.equal(db.getBatch('summary').products[0].newSeriesPosition,undefined);
 assert.equal(db.getBatch('self').products[0].newSeriesPosition,undefined);
 assert.equal(db.getBatch('B11').competitivenessMetrics.tmItemScore,80);
 assert.equal(raw.prepare('SELECT count(*) AS n FROM series_position_backups').get().n,8);
 const next=catalog.get().entries.map(row=>row.brand==='华为'&&row.newSeries==='Mate 80'?{...row,newSeriesPosition:'旗舰'}:row);
 catalog.save(next,1,'tester');
 assert.equal(db.getBatch('B11').products[0].newSeriesPosition,'旗舰');
 assert.equal(raw.prepare('SELECT payload_json FROM tracking_batches WHERE id=?').get('B3').payload_json,oldPayload);
 assert.throws(()=>catalog.save(next,1,'tester'),/已被更新/);
 assert.equal(catalog.get().revision,2);
 const future=catalog.stamp({channelId:'tradeIn',products:[{brand:'华为',newSeries:'Mate 80',newSeriesPosition:'中端'}]});
 assert.equal(future.products[0].newSeriesPosition,'旗舰');
 catalog.close();catalog=createSeriesCatalog(file);
 assert.equal(catalog.get().revision,2);
 assert.equal(raw.prepare('SELECT count(*) AS n FROM series_position_backups').get().n,8);
 catalog.close();raw.close();db.close();
});

test('catalog routes require both identity and data-source permission for edits',()=>{
 const routes={};const editor=()=>{},page=()=>{};
 registerSeriesCatalogRoutes({get:(url,...handlers)=>routes.get=handlers,put:(url,...handlers)=>routes.put=handlers},{catalog:{get:()=>({entries:[]})},auth:{requireEditor:editor},requirePage:(channel,name)=>{assert.equal(channel,'tradeIn');assert.equal(name,'upload');return page;},canRead:user=>user.allowed});
 assert.equal(routes.put[0],editor);assert.equal(routes.put[1],page);
 let status;routes.get[0]({authUser:{allowed:false}},{status:value=>{status=value;return {json:()=>{}};}});assert.equal(status,403);
});
