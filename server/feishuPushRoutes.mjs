import crypto from 'node:crypto';
import { ALL_SERIES, filterCompetitivenessProducts } from '../shared/competitivenessScope.mjs';
import { resolveBrandAssignments } from '../shared/feishuBrandAssignments.mjs';
import { canAccess, canPushFeishu } from '../shared/accessPolicy.mjs';
import { prepareTracker, reportCard, brandAssignmentCard } from './feishuReport.mjs';
import { createFeishuClient } from './feishuClient.mjs';
import { createPushStore } from './feishuPushStore.mjs';

export const registerFeishuPushRoutes = (app, {db, auth, databasePath, appUrl, env=process.env, client=createFeishuClient({env}), store=createPushStore(databasePath)}) => {
  const fail=(res,error)=>res.status(error.statusCode || 400).json({success:false,error:error.message});
  const allowed=canPushFeishu;
  const guard=(req,res,next)=>allowed(req.authUser,String(req.query.channelId || req.body?.channelId || 'tradeIn')) ? next() : res.status(403).json({success:false,error:'未开通独立的飞书推送权限，或缺少该渠道的数据权限'});
  const previewFor = req => {
    const p=store.getPreview(String(req.params.id || req.body?.previewId || ''));
    if (!p || p.actor!==req.authUser.openId || !allowed(req.authUser,p.report.channelId)) throw Object.assign(new Error('无权查看或发送该预览'),{statusCode:403});
    return p;
  };
  app.get('/api/feishu-push/config',guard,(_req,res)=>{
    const matches=(db.listMembers?.() || []).filter(member=>member.name==='陈誉钧' && member.enabled);
    const profile=matches.length===1 ? matches[0] : null;
    res.json({success:true,configured:client.configured,trialName:'陈誉钧',brandAssignments:resolveBrandAssignments(db.listMembers?.() || []),defaultRecipient:profile ? {id:profile.openId,name:profile.name,department:profile.department || '',type:'user'} : null});
  });
  app.get('/api/feishu-push/targets',guard,async(req,res)=>{
    try {
      if(req.query.type==='chat') return res.json({success:true,targets:await client.groups()});
      const query=String(req.query.q || '').trim();if(!query || query.length>50) throw new Error('请输入1～50个字的姓名或飞书账号 ID');
      const result=await auth.searchDirectory(req.authUser,query);
      res.json({success:true,targets:result.users.map(u=>({id:u.openId,name:u.name,department:u.department || '',type:'user'})),requiresLogin:result.requiresLogin});
    } catch(error){fail(res,error);}
  });
  const prepare = req => {
    const batch=db.getBatch(String(req.body?.batchId || ''));
    if(!batch || (batch.channelId || 'tradeIn')!==req.body.channelId) throw new Error('批次不存在或渠道不匹配');
    return prepareTracker(db,batch,req.body.scope,appUrl);
  };
  app.post('/api/feishu-push/prepare',guard,(req,res)=>{
    try {res.json({success:true,...prepare(req)});}catch(error){fail(res,error);}
  });
  app.post('/api/feishu-push/preview',guard,async(req,res)=>{
    try {
      const {report}=prepare(req);
      if(req.body.digest!==report.digest) throw new Error('追踪器数据已变化，请重新生成截图');
      const encoded=req.body.imageBase64;
      if(typeof encoded!=='string' || encoded.length>12*1024*1024 || !/^[A-Za-z0-9+/]+=*$/.test(encoded)) throw new Error('追踪器截图无效或超过9MB');
      const buffer=Buffer.from(encoded,'base64');
      const {default:sharp}=await import('sharp');const image=sharp(buffer,{limitInputPixels:20_000_000});const meta=await image.metadata();
      if(meta.format!=='png'||meta.width<800||meta.width>4000||meta.height<300||meta.height>6000) throw new Error('请使用竞争力总结追踪器生成的 PNG 截图');
      const png=await image.png().toBuffer();
      const id=store.preview(req.authUser.openId,report,png);report.url=store.getPreview(id).report.url;
      res.json({success:true,previewId:id,report,imageUrl:`/api/feishu-push/previews/${id}/image`});
    } catch(error){fail(res,error);}
  });
  const readableReport = req => {
    const p=store.getPreview(String(req.params.id));
    if(!p || !canAccess(req.authUser,p.report.channelId,'competitiveness')) throw Object.assign(new Error('当前账号未开通该竞争力报告，请联系管理员'),{statusCode:403});
    const delivered=store.hasSent(p.id) || store.hasSentBrandPreview(p.id,req.authUser.openId);
    if(p.actor!==req.authUser.openId && !delivered) throw Object.assign(new Error('报告尚未推送'),{statusCode:403});
    return p;
  };
  app.get('/api/feishu-push/reports/:id',(req,res)=>{try{res.json({success:true,report:readableReport(req).report});}catch(error){fail(res,error);}});
  app.get('/api/feishu-push/reports/:id/image',(req,res)=>{try{res.type('png').send(readableReport(req).png);}catch(error){fail(res,error);}});
  app.get('/api/feishu-push/previews/:id/image',async(req,res)=>{
    try { const p=previewFor(req);res.type('png').send(p.png); }catch(error){fail(res,error);}
  });
  app.get('/api/feishu-push/history',guard,(req,res)=>{
    const channel=String(req.query.channelId || 'tradeIn');
    res.json({success:true,deliveries:store.history(channel).map(d=>({id:d.dedupe,batchId:d.report.batchId,scopeLabel:d.report.scopeLabel,target:d.target,status:d.status,messageId:d.message_id,error:d.error,createdAt:d.created_at}))});
  });
  app.post('/api/feishu-push/send-by-brand',guard,async(req,res)=>{
    try {
      if(!client.configured) throw new Error('飞书应用尚未配置');
      if(req.body.channelId!=='tradeIn' || !allowed(req.authUser,'tradeIn')) throw new Error('仅支持京东换新');
      const batch=db.getBatch(String(req.body.batchId || ''));
      if(!batch || (batch.channelId || 'tradeIn')!=='tradeIn' || !batch.isCompetitivenessConfirmed || batch.isSummaryOnly || !batch.products?.length) throw new Error('请选择已确认竞争力的京东换新明细批次');
      const ids=req.body.previews;
      if(!Array.isArray(ids) || ids.length>11 || new Set(ids).size!==ids.length) throw new Error('品牌截图清单无效');
      const previews=new Map();
      for(const id of ids) {
        const p=previewFor({...req,body:{previewId:id}});
        const {brand,newSeries}=p.report.scope;
        if(previews.has(brand) || p.report.batchId!==batch.id || p.report.channelId!=='tradeIn' || newSeries!==ALL_SERIES ||
          Date.now()-p.created_at>20*60*1000 || prepareTracker(db,batch,p.report.scope,appUrl).report.digest!==p.report.digest) throw new Error('品牌截图已过期或范围不匹配，请重新生成');
        previews.set(brand,p);
      }
      const plans=resolveBrandAssignments(db.listMembers()).map(assignment=>{
        const brands=assignment.brands.map(label=>({label,brand:label==='realme'?'真我':label}));
        const present=brands.filter(({brand})=>filterCompetitivenessProducts(batch.products,brand).length);
        const entries=present.map(({label,brand})=>({label,preview:previews.get(brand)}));
        if(entries.some(entry=>!entry.preview)) throw new Error('缺少固定品牌截图，请重新生成');
        return {...assignment,entries,missing:brands.filter(item=>!present.includes(item)).map(item=>item.label)};
      });
      const results=[];
      for(const plan of plans) {
        const fallback=plan.recipient || {type:'user',id:plan.name,name:plan.name};
        if(!plan.recipient || !plan.entries.length) {
          results.push({target:fallback,status:'skipped',error:!plan.recipient?'成员未唯一匹配':'该批次无负责品牌明细'});
          continue;
        }
        const first=plan.entries[0].preview;
        let target=fallback, delivery, status='failed',messageId,error;
        try {
          const user=await auth.lookupMessageRecipient(plan.recipient.id);
          if(user.openId!==plan.recipient.id || user.name!==plan.name) throw new Error('飞书身份与负责人配置不匹配');
          target={...fallback,nameVerified:user.nameVerified,nameSource:user.nameSource};
          const images=[];
          for(const entry of plan.entries) images.push({label:entry.label,url:entry.preview.report.url,imageKey:await client.uploadImage(entry.preview.png)});
          const report={...first.report,scopeLabel:plan.brands.join(' / '),brandPreviewIds:plan.entries.map(entry=>entry.preview.id),
            digest:crypto.createHash('sha256').update(JSON.stringify(plan.entries.map(entry=>[entry.label,entry.preview.report.digest]))).digest('hex')};
          const groupId=store.preview(req.authUser.openId,report,first.png);
          delivery=store.claim({id:groupId,report},req.authUser.openId,target);
          if(!delivery.claimed) {
            results.push({target,status:delivery.status==='sending'?'unknown':delivery.status,messageId:delivery.message_id,error:delivery.error,reused:true});
            continue;
          }
          const sentAt=new Date().toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
          try {messageId=await client.send(target,brandAssignmentCard(report,images,plan.missing,req.authUser.name,sentAt),delivery.dedupe.slice(0,32));status='sent';}
          catch(err) {status=err.feishuCode?'failed':'unknown';error=err.message;}
          store.finish(delivery.dedupe,status,messageId,error);
          db.writeAudit({...auth.requestContext(req),action:'BATCH_FEISHU_PUSH',outcome:status==='sent'?'SUCCESS':status.toUpperCase(),resourceType:'tracking_batch',resourceId:batch.id,
            details:{channelId:'tradeIn',brands:plan.brands,target,status,messageId,error,previewId:groupId}});
        } catch(err) {if(status!=='sent') error=err.message;}
        results.push({target,status,messageId,error});
      }
      res.json({success:true,results});
    } catch(error) {fail(res,error);}
  });
  app.post('/api/feishu-push/send',guard,async(req,res)=>{
    try {
      if(!client.configured) throw new Error('飞书应用尚未配置');
      const preview=previewFor(req);
      if(Date.now()-preview.created_at>20*60*1000) throw new Error('预览已超过20分钟，请重新预览');
      const batch=db.getBatch(preview.report.batchId);
      if(!batch || prepareTracker(db,batch,preview.report.scope,appUrl).report.digest!==preview.report.digest) throw new Error('批次已变化，请重新预览');
      const targets=req.body.targets;
      if(!Array.isArray(targets)||!targets.length||targets.length>20) throw new Error('请选择1～20个接收对象');
      const unique=[...new Map(targets.map(t=>[`${t?.type}:${t?.id}`,t])).values()];
      const groups=unique.some(t=>t?.type==='chat') ? await client.groups() : [];
      const verified=[];
      for(const t of unique) {
        if(t?.type==='user') {const u=await auth.lookupMessageRecipient(String(t.id));verified.push({type:'user',id:u.openId,name:u.name,nameVerified:u.nameVerified,nameSource:u.nameSource});}
        else if(t?.type==='chat') {const g=groups.find(g=>g.id===t.id);if(!g) throw new Error('机器人未加入所选群，请刷新群列表');verified.push(g);}
        else throw new Error('接收对象类型无效');
      }
      // Upload before claiming deliveries: image failures cannot create an ambiguous message state.
      const imageKey=await client.uploadImage(preview.png);
      const sentAt=new Date().toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
      const card=reportCard(preview.report,imageKey,req.authUser.name,sentAt), results=[];
      for(const target of verified) {
        const delivery=store.claim(preview,req.authUser.openId,target);
        if(!delivery.claimed) { results.push({target,status:delivery.status==='sending'?'unknown':delivery.status,messageId:delivery.message_id,error:delivery.error,reused:true});continue; }
        let status='sent',messageId,error;
        try {messageId=await client.send(target,card,delivery.dedupe.slice(0,32));}
        catch(err) {status=err.feishuCode?'failed':'unknown';error=err.message;}
        store.finish(delivery.dedupe,status,messageId,error);
        db.writeAudit({...auth.requestContext(req),action:'BATCH_FEISHU_PUSH',outcome:status==='sent'?'SUCCESS':status.toUpperCase(),resourceType:'tracking_batch',resourceId:preview.report.batchId,details:{channelId:preview.report.channelId,scope:preview.report.scope,target,status,messageId,error,previewId:preview.id}});
        results.push({target,status,messageId,error});
      }
      res.json({success:true,results});
    }catch(error){fail(res,error);}
  });
  return store;
};
