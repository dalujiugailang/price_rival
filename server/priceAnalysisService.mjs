import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {projectPriceAnalysisBatch} from '../shared/priceAnalysisProjection.mjs';
import {canAccess} from '../shared/accessPolicy.mjs';
const SCHEMA='analysis-projection-v1';
export function createPriceAnalysisService(databasePath) {
 const db=new DatabaseSync(databasePath,{timeout:5000});
 db.exec(`PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS price_analysis_revision (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
 INSERT OR IGNORE INTO price_analysis_revision VALUES(1,0);
 CREATE TABLE IF NOT EXISTS price_analysis_cache (id INTEGER PRIMARY KEY CHECK(id=1), version TEXT NOT NULL, etag TEXT NOT NULL, payload_json TEXT NOT NULL);
 CREATE TRIGGER IF NOT EXISTS price_analysis_insert AFTER INSERT ON tracking_batches WHEN NEW.channel_id='tradeIn' BEGIN UPDATE price_analysis_revision SET revision=revision+1 WHERE id=1; END;
 CREATE TRIGGER IF NOT EXISTS price_analysis_update AFTER UPDATE ON tracking_batches WHEN NEW.channel_id='tradeIn' OR OLD.channel_id='tradeIn' BEGIN UPDATE price_analysis_revision SET revision=revision+1 WHERE id=1; END;
 CREATE TRIGGER IF NOT EXISTS price_analysis_delete AFTER DELETE ON tracking_batches WHEN OLD.channel_id='tradeIn' BEGIN UPDATE price_analysis_revision SET revision=revision+1 WHERE id=1; END;`);
 const revision=db.prepare('SELECT revision FROM price_analysis_revision WHERE id=1');
 const stored=db.prepare('SELECT version,etag,payload_json FROM price_analysis_cache WHERE id=1');
 const save=db.prepare('INSERT INTO price_analysis_cache(id,version,etag,payload_json) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,etag=excluded.etag,payload_json=excluded.payload_json');
 const source=db.prepare("SELECT id,channel_id,batch_date,operator,pricing_timestamp,is_summary_only,created_at,payload_json FROM tracking_batches WHERE channel_id='tradeIn' AND deleted_at IS NULL ORDER BY COALESCE(competitiveness_date,batch_date) DESC,created_at DESC");
 let memory=null;
 return {
  response(user,ifNoneMatch) {
   // Authorization precedes both caches and conditional-response checks.
   if(!canAccess(user,'tradeIn','priceAnalysis'))throw Object.assign(new Error('未开通京东换新价格分析权限'),{statusCode:403});
   const version=`${SCHEMA}:${revision.get().revision}`;
   if(memory?.version!==version){
    db.exec('BEGIN');
    try {
     const currentVersion=`${SCHEMA}:${revision.get().revision}`;
     const cached=stored.get();
     if(cached?.version===currentVersion)memory={version:currentVersion,etag:cached.etag,body:cached.payload_json,gzip:null};
     else {
      const batches=source.all().map(row=>{const batch=JSON.parse(row.payload_json);return projectPriceAnalysisBatch({...batch,id:row.id,channelId:row.channel_id,date:row.batch_date,operator:row.operator,pricingTimestamp:row.pricing_timestamp||undefined,isSummaryOnly:Boolean(row.is_summary_only),serverCreatedAt:row.created_at});});
      const body=JSON.stringify({success:true,batches});const etag=`"${createHash('sha256').update(body).digest('hex')}"`;
      save.run(currentVersion,etag,body);memory={version:currentVersion,etag,body,gzip:null};
     }
     db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');memory=null;throw error;}
   }
   const notModified=String(ifNoneMatch||'').split(',').map(value=>value.trim().replace(/^W\//,'')).some(value=>value===memory.etag||value==='*');
   if(notModified)return {status:304,etag:memory.etag};
   if(!memory.gzip)memory.gzip=gzipSync(memory.body);
   return {status:200,etag:memory.etag,body:memory.body,gzip:memory.gzip};
  },
  close(){db.close();memory=null;}
 };
}
