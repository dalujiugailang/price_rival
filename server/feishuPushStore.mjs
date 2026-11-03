import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
export const createPushStore = path => {
  const db = new DatabaseSync(path, {timeout:5000});
  db.exec(`CREATE TABLE IF NOT EXISTS feishu_push_previews (id TEXT PRIMARY KEY, actor TEXT NOT NULL, report TEXT NOT NULL, png BLOB NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS feishu_push_deliveries (dedupe TEXT PRIMARY KEY, preview_id TEXT NOT NULL, actor TEXT NOT NULL, target TEXT NOT NULL, status TEXT NOT NULL, message_id TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
  return {
    close:()=>db.close(),
    preview(actor, report, png) {
      const id=crypto.randomUUID();const url=new URL(report.url);url.searchParams.set('reportId',id);report={...report,url:url.toString()};db.prepare('INSERT INTO feishu_push_previews VALUES (?,?,?,?,?)').run(id,actor,JSON.stringify(report),png,Date.now());return id;
    },
    getPreview(id) { const row=db.prepare('SELECT * FROM feishu_push_previews WHERE id=?').get(id);return row ? {...row,report:JSON.parse(row.report),png:Buffer.from(row.png)} : null; },
    claim(preview, actor, target) {
      const dedupe=crypto.createHash('sha256').update(`${preview.report.digest}:${target.type}:${target.id}`).digest('hex');
      const now=new Date().toISOString();
      const inserted=db.prepare('INSERT OR IGNORE INTO feishu_push_deliveries VALUES (?,?,?,?,?,NULL,NULL,?,?)').run(dedupe,preview.id,actor,JSON.stringify(target),'sending',now,now);
      return {...db.prepare('SELECT * FROM feishu_push_deliveries WHERE dedupe=?').get(dedupe), claimed:inserted.changes === 1};
    },
    finish(dedupe,status,messageId,error) {db.prepare('UPDATE feishu_push_deliveries SET status=?,message_id=?,error=?,updated_at=? WHERE dedupe=?').run(status,messageId||null,error||null,new Date().toISOString(),dedupe);},
    hasSent(id) {return !!db.prepare("SELECT 1 FROM feishu_push_deliveries WHERE preview_id=? AND status='sent' LIMIT 1").get(id);},
    history(channelId) {return db.prepare(`SELECT d.*, p.report FROM feishu_push_deliveries d JOIN feishu_push_previews p ON p.id=d.preview_id WHERE json_extract(p.report,'$.channelId')=? ORDER BY d.created_at DESC LIMIT 50`).all(channelId).map(row=>({...row,target:JSON.parse(row.target),report:JSON.parse(row.report)}));}
  };
};
