import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { canAccess } from '../shared/accessPolicy.mjs';
import { riskSeed } from './tradeInRiskSeed.mjs';
export function registerRiskRoutes(app, { databasePath }) {
 fs.mkdirSync(path.dirname(databasePath), { recursive: true });
 const db = new DatabaseSync(databasePath);
 db.exec(`CREATE TABLE IF NOT EXISTS tradein_risk_strategies(id TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at TEXT NOT NULL);`);
 db.exec('CREATE TABLE IF NOT EXISTS tradein_risk_audit(id INTEGER PRIMARY KEY, strategy_id TEXT NOT NULL, actor_id TEXT, created_at TEXT NOT NULL)');
 db.exec('CREATE TABLE IF NOT EXISTS tradein_risk_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
 const insert=db.prepare('INSERT OR IGNORE INTO tradein_risk_strategies VALUES(?,?,?)');
 db.exec('BEGIN');
 try { if(!db.prepare("SELECT key FROM tradein_risk_meta WHERE key='seed-v1'").get()){for(const item of riskSeed) insert.run(item.id,JSON.stringify(item),new Date().toISOString());db.prepare('INSERT INTO tradein_risk_meta VALUES(?,?)').run('seed-v1',new Date().toISOString());} db.exec('COMMIT'); } catch(e){db.exec('ROLLBACK');throw e;}
 const access=(req,res,next)=>canAccess(req.authUser,'tradeIn','riskLedger')?next():res.status(403).json({error:'未开通旧机压价台账权限'});
 app.get('/api/tradein-risk',access,(_req,res)=>res.json({strategies:db.prepare("SELECT payload FROM tradein_risk_strategies ORDER BY CASE WHEN id LIKE 'initial-%' THEN 1 ELSE 0 END, CASE WHEN id LIKE 'initial-%' THEN rowid END ASC, rowid DESC").all().map(x=>JSON.parse(x.payload))}));
 app.delete('/api/tradein-risk/:id',access,(req,res)=>{
  if(req.authUser.role!=='admin') return res.status(403).json({error:'仅管理员可以删除策略'});
  const result=db.prepare('DELETE FROM tradein_risk_strategies WHERE id=?').run(req.params.id);
  if(!result.changes)return res.status(404).json({error:'策略不存在'});
  db.prepare('INSERT INTO tradein_risk_audit(strategy_id,actor_id,created_at) VALUES(?,?,?)').run('DELETE:'+req.params.id,req.authUser.openId||null,new Date().toISOString());
  res.json({success:true});
 });
 app.post('/api/tradein-risk',access,(req,res)=>{
  if(req.authUser.role!=='admin') return res.status(403).json({error:'仅管理员可以保存策略'});
  const s=req.body;
  const validDate=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(x)&&Number.isFinite(Date.parse(x.replace(' ','T')+'+08:00'));
  if(!s.name?.trim()||!Array.isArray(s.models)||!s.models.length||s.models.some(x=>typeof x!=='string'||!x.trim())||!Number.isFinite(s.ratio)||s.ratio>0||s.ratio< -100||!validDate(s.start)||!validDate(s.end)||s.start>=s.end) return res.status(400).json({error:'请核对名称、型号、比例及起止时间'});
  if(s.link&&!/^https?:\/\//.test(s.link)) return res.status(400).json({error:'策略链接必须为HTTP或HTTPS地址'});
  if(s.screenshot&&!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(s.screenshot)) return res.status(400).json({error:'截图格式不支持'});
  if(s.screenshot?.length>14000000) return res.status(400).json({error:'截图请小于10MB'});
  const id=typeof s.id==='string'?s.id:crypto.randomUUID();
  const item={id,name:s.name.trim(),models:s.models,ratio:s.ratio,start:s.start,end:s.end,note:String(s.note||''),brand:String(s.brand||''),link:String(s.link||''),fields:s.fields&&typeof s.fields==='object'?s.fields:{},screenshot:s.screenshot||null,ocrText:String(s.ocrText||'')};
  db.prepare('INSERT INTO tradein_risk_strategies VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at').run(id,JSON.stringify(item),new Date().toISOString());
  db.prepare('INSERT INTO tradein_risk_audit(strategy_id,actor_id,created_at) VALUES(?,?,?)').run(id,req.authUser.openId||null,new Date().toISOString());
  res.json({strategy:item});
 });
}
