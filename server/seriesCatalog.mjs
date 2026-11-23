import {DatabaseSync} from 'node:sqlite';
import {INITIAL_SERIES_CATALOG,validateSeriesCatalog,seriesCatalogIndex,positionBatch} from '../shared/seriesCatalog.mjs';

export function createSeriesCatalog(databasePath) {
 const db=new DatabaseSync(databasePath,{timeout:5000});
 db.exec(`PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS series_catalog_state(id INTEGER PRIMARY KEY CHECK(id=1), entries_json TEXT NOT NULL, revision INTEGER NOT NULL, targets_json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS series_catalog_archive(id INTEGER PRIMARY KEY, entries_json TEXT NOT NULL, actor TEXT, created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS series_position_backups(batch_id TEXT PRIMARY KEY,payload_json TEXT NOT NULL,created_at TEXT NOT NULL);`);
 const state=()=>db.prepare('SELECT * FROM series_catalog_state WHERE id=1').get();
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}};
 const apply=(entries,targets)=>{
  const index=seriesCatalogIndex(entries);let updatedProductCount=0;
  for(const id of targets){
   const row=db.prepare('SELECT payload_json FROM tracking_batches WHERE id=? AND deleted_at IS NULL').get(id);
   if(!row)continue;
   const batch=JSON.parse(row.payload_json),next=positionBatch(batch,index);
   db.prepare('INSERT OR IGNORE INTO series_position_backups VALUES(?,?,?)').run(id,row.payload_json,new Date().toISOString());
   updatedProductCount+=next.products.filter((p,i)=>p.newSeriesPosition!==batch.products[i].newSeriesPosition).length;
   const changed=next.products.some((product,i)=>product.newSeriesPosition!==batch.products[i].newSeriesPosition)
    || (next.restorePayload?.productsMaster || []).some((product,i)=>product.newSeriesPosition!==batch.restorePayload?.productsMaster?.[i]?.newSeriesPosition);
   if(!changed)continue;
   // Keep pricing, timestamps, confirmation and competitiveness values unchanged.
   db.prepare('UPDATE tracking_batches SET payload_json=? WHERE id=?').run(JSON.stringify(next),id);
  }
  return {batchIds:targets,updatedProductCount};
 };
 transaction(()=>{
  if(state())return;
  const targets=db.prepare(`SELECT id FROM tracking_batches WHERE channel_id='tradeIn' AND deleted_at IS NULL AND is_summary_only=0
   AND json_array_length(payload_json,'$.products')>0 ORDER BY created_at DESC,id DESC LIMIT 8`).all().map(row=>row.id);
  apply(INITIAL_SERIES_CATALOG,targets);
  db.prepare('INSERT INTO series_catalog_state VALUES(1,?,1,?)').run(JSON.stringify(INITIAL_SERIES_CATALOG),JSON.stringify(targets));
 });
 return {
  get(){const row=state();return {entries:JSON.parse(row.entries_json),revision:row.revision,backfilledBatchIds:JSON.parse(row.targets_json)};},
  save(entries,revision,actor){
   const validated=validateSeriesCatalog(entries);
   return transaction(()=>{
    const row=state();
    if(revision!==row.revision)throw Object.assign(new Error('商品库已被更新，请重新加载后再保存'),{statusCode:409});
    const entriesJson=JSON.stringify(validated);
    if(entriesJson===row.entries_json)return this.get();
    db.prepare('INSERT INTO series_catalog_archive(entries_json,actor,created_at) VALUES(?,?,?)').run(row.entries_json,actor || '',new Date().toISOString());
    const beforeIndex=seriesCatalogIndex(JSON.parse(row.entries_json)),afterIndex=seriesCatalogIndex(validated);
    const positionChanged=[...new Set([...beforeIndex.keys(),...afterIndex.keys()])].some(key=>beforeIndex.get(key)!==afterIndex.get(key));
    if(positionChanged)apply(validated,JSON.parse(row.targets_json));
    db.prepare('UPDATE series_catalog_state SET entries_json=?,revision=revision+1 WHERE id=1').run(entriesJson);
    return this.get();
   });
  },
  stamp(batch){if(!Array.isArray(batch.products))return batch;return (batch.channelId || 'tradeIn')==='tradeIn'?positionBatch(batch,seriesCatalogIndex(this.get().entries)):batch;},
  close(){db.close();}
 };
}
export function registerSeriesCatalogRoutes(app,{catalog,auth,requirePage,canRead}) {
 app.get('/api/series-catalog',(req,res)=>{
  if(!canRead(req.authUser))return res.status(403).json({success:false,error:'无权查看新机商品库'});
  res.json({success:true,...catalog.get()});
 });
 app.put('/api/series-catalog',auth.requireEditor,requirePage('tradeIn','upload'),(req,res)=>{
  try{const start=performance.now();const result=catalog.save(req.body?.entries,req.body?.revision,req.authUser.openId);
   res.set('Server-Timing',`catalog;dur=${(performance.now()-start).toFixed(1)}`);
   res.json({success:true,...result});
  }catch(error){res.status(error.statusCode || 400).json({success:false,error:error.message});}
 });
}
