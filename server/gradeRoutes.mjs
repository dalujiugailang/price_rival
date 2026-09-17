import path from 'node:path';
import * as XLSX from 'xlsx';
import { canAccess, canEdit } from '../shared/accessPolicy.mjs';
import { gradeBatchMismatch, gradeSourceBatchId } from '../shared/gradeHistory.mjs';
import {withGradeInvestment} from '../shared/gradeInvestment.mjs';
import { buildGradePlan, applyGradeStrategyPrices, summarizeGradeRows } from '../shared/gradeExpansion.mjs';
import { addGradePresentation, gradeSourceDisplay, gradeRowDisplay, gradeResultStatus, gradeResultValue } from '../shared/gradePresentation.mjs';
import { pricingColumnKeys, pricingColumnLabels, pricingColumnCodes, pricingPercentKeys } from '../shared/pricingColumns.mjs';
import {applyGradeMarginFloor} from '../shared/gradeMargin.mjs';
import {stabilizeGradeOrder} from '../shared/gradeOrder.mjs';

export const createGradePriceClient = ({ url, token, fetchImpl = fetch }) => async ppvs => {
  if (!token) throw new Error('Daily Price 服务端凭据未配置');
  const rows = [], dates = new Set();
  for (let start = 0; start < ppvs.length; start += 200) {
    const response = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ ppv: ppvs.slice(start, start + 200) }), signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw new Error(`Daily Price 查询失败 (${response.status})，未生成测算`);
    const payload = await response.json();
    if (!Array.isArray(payload.rows)) throw new Error('Daily Price 返回格式无效，未生成测算');
    rows.push(...payload.rows);
    dates.add(String(payload.dataDate || '未提供数据日期'));
  }
  if (dates.size > 1) throw new Error('Daily Price 在查询期间更新了数据，请重新生成');
  return { rows, dataDate: [...dates][0] || '未查询', fetchedAt: new Date().toISOString() };
};

export function createGradeWorkbook(run,batch=null) {
  const wb = XLSX.utils.book_new();
  const append = (name, rows, widths) => {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet['!cols'] = widths.map(wch => ({ wch }));
    sheet['!autofilter'] = { ref: sheet['!ref'] };
    XLSX.utils.book_append_sheet(wb, sheet, name);
  };
  const models = [...new Set([...run.rows.map(r => r.model), ...run.issues.map(i => i.model)])];
  append('型号汇总', [['型号', '重点追价投入', '等级推算新增投入', '合计投入', '待补行数', '未能推算SKU数', '统计状态'], ...models.map(model => {
    const summary = summarizeGradeRows(run.rows.filter(r => r.model === model));
    const missing = run.issues.filter(i => i.model === model).length;
    return [model, summary.coreInvestment, summary.expansionInvestment, summary.totalInvestment, summary.pendingRows, missing,
      summary.pendingRows || missing ? '已匹配部分预估投入' : '完整预估投入'];
  })], [32, 20, 22, 20, 14, 18, 28]);
  const resultColumns=pricingColumnKeys.map((key,index)=>({key,label:pricingColumnLabels()[index],code:pricingColumnCodes[index]}))
    .filter(c=>c.key!=='pricingRemark'&&c.key!=='marginRemark');
  append('完整价格明细', [
    [...resultColumns.map(c=>c.code),...Array(6).fill('等级推算')],
    [...resultColumns.map(c=>c.label),'等级','价格来源','投入测算原价（Daily Price）','投入测算单台调整额','预估新增投入','状态'],
    ...run.rows.map(r => {
      const display=gradeRowDisplay(r,run.request);
      return [...resultColumns.map(c=>gradeResultValue(c.key,display[c.key]) ?? '-'),r.level,r.origin,r.strategyPrice??'-',r.adjustment??'-',r.investment??'-',gradeResultStatus(r).join('；')||'正常'];
    })], [...resultColumns.map(c=>c.key==='ppv'?55:20),12,14,24,22,20,50]);
  const detail=wb.Sheets['完整价格明细'];
  detail['!autofilter']={ref:`A2:${XLSX.utils.encode_col(resultColumns.length+5)}${run.rows.length+2}`};
  for (let row=3; row<=run.rows.length+2; row++) for (const index of resultColumns.flatMap((c,index)=>pricingPercentKeys.has(c.key)?[index]:[])) {
    const cell=detail[XLSX.utils.encode_cell({r:row-1,c:index})];
    if (cell?.t==='n') cell.z='0.00%';
  }
  append('待补数据', [['型号','SKU ID','PPV','问题'], ...run.issues.map(i => [i.model,i.skuId,'',i.message]),
    ...run.rows.filter(r => r.price === null || r.strategyPrice === null || r.soldVolume === null).map(r => [r.model,r.skuId,r.ppv,r.status.join('；')]),
    ...(run.orderIssues||[]).map(i=>[i.model,i.skuId,i.lowerPpv,i.message])], [32,18,42,65]);
  append('数据来源', [['项目','内容'],['测算名称',run.title],['测算ID',run.id],['生成时间',run.createdAt],
    ['关联追价快照',run.trackingBatchId || run.request.trackingBatchId || '-'],['保存时间',run.savedAt || '-'],
    ['工作台版本',run.request.workspaceVersion],['完整底表',run.sources.volume.fileName],['底表版本',run.sources.volume.id],
    ['数据周期',`${run.sources.volume.periodStart} 至 ${run.sources.volume.periodEnd}`],['模板文件',run.sources.template.fileName],['模板版本',run.sources.template.id],
    ['Daily Price数据日期',run.dailyPriceDate],['Daily Price查询时间',run.dailyPriceFetchedAt]], [34,105]);
  if(run.pricingVersion>=3)append('未扩展SKU',[['型号','SKU ID','跳过原因'],...(run.skippedSkus||[]).map(s=>[s.model,s.skuId,s.reason])],[32,18,55]);
  if(batch&&run.isFinal&&run.investmentConfirmedAt) {
    const saved=withGradeInvestment(batch,run), contribution=saved.gradeInvestment;
    if(contribution) {
      const inputs=saved.totalInvestmentRateInputs;
      const rates=saved.totalInvestmentRateMetrics;
      append('投入费率落数',[['项目','已确认结果'],['关联快照',batch.id],['确认时间',run.investmentConfirmedAt],
        ['重点追价投入',batch.investmentRateMetrics?.estimatedInvestmentAmount??'-'],['等级新增投入',contribution.amount],
        ['合计投入',rates?.estimatedInvestmentAmount??'-'],['安卓大盘分母',inputs?.androidSalesAmount30d??'-'],
        ['京东换新分母',inputs?.androidJdTradeInSalesAmount30d??'-'],['安卓大盘费率',rates?.androidOverallRate??'-'],
        ['京东换新费率',rates?.androidJdTradeInRate??'-'],['分母数据日期',saved.gradeInvestmentRevenueDate||batch.investmentRateSource?.dataDate||'-'],
        ['等级待补费用行数',contribution.pendingRows]], [30,70]);
    }
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

export function registerGradeRoutes(app, { store, lookupPrices, getBatch = () => null, lookupRevenue = async()=>null, writeAudit = () => {} }) {
  const root='/api/grade-expansion';
  const permit = mode => (req,res,next) => {
    const workspace = canEdit(req.authUser,'tradeIn','workspace'), upload = canEdit(req.authUser,'tradeIn','upload');
    if (mode==='history' ? canAccess(req.authUser,'tradeIn','history') : mode==='upload' ? upload : mode==='workspace' ? workspace : workspace || upload) return next();
    res.status(403).json({ error: '当前账号没有京东换新等级推算操作权限' });
  };
  const handle = fn => async (req,res) => {
    try { await fn(req,res); }
    catch (error) { res.status(error.statusCode || 400).json({ error: error.message || '等级推算操作失败' }); }
  };
  const requireSource = (id,kind) => {
    const source=store.getSource(String(id || ''));
    if (!source || source.kind!==kind) throw new Error('请选择有效的底表和等级模板版本');
    return source;
  };
  const requireBatch = (id, request) => {
    const batch = getBatch(id);
    const error = request ? gradeBatchMismatch(request,batch) : (!batch || (batch.channelId || 'tradeIn') !== 'tradeIn' ? '京东换新快照不存在' : '');
    if (error) throw new Error(error);
    return batch;
  };
  const permitRun = (req,res,next) => {
    const run = store.getRun(req.params.id);
    if (!run) return res.status(404).json({error:'测算不存在'});
    if (canEdit(req.authUser,'tradeIn','workspace')) return next();
    const batch = run.trackingBatchId && getBatch(run.trackingBatchId);
    if (run.saved && batch && (batch.channelId || 'tradeIn') === 'tradeIn' && canAccess(req.authUser,'tradeIn','history')) return next();
    res.status(403).json({error:'当前账号没有该测算的查看权限'});
  };
  const auditRun = (action,run,user) => writeAudit({action,actor:user,
    resourceType:run.trackingBatchId ? 'tracking_batch' : 'grade_run',resourceId:run.trackingBatchId || run.id,
    details:{channelId:'tradeIn',gradeRunId:run.id,title:run.title,rows:run.rows.length,parentRunId:run.parentRunId || null}});
  app.get(`${root}/sources`,permit('read'),(_req,res)=>res.json({sources:store.listSources()}));
  app.get(`${root}/sources/:id/file`,permit('read'),(req,res)=>{
    const file=store.getFile(req.params.id);
    if (!file) return res.status(404).json({error:'文件不存在'});
    res.set('content-disposition',`attachment; filename*=UTF-8''${encodeURIComponent(file.file_name)}`)
      .type('application/octet-stream').send(Buffer.from(file.original));
  });
  app.get(`${root}/sources/:id`,permit('read'),(req,res)=>{
    const source=store.getSource(req.params.id);
    if (!source) return res.status(404).json({error:'数据版本不存在'});
    res.json({source});
  });
  app.post(`${root}/sources`,permit('upload'),handle((req,res)=>{
    const body=req.body || {};
    if (typeof body.fileBase64!=='string' || body.fileBase64.length>25*1024*1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.fileBase64)) throw new Error('文件编码无效或超过18MB');
    const fileName=path.basename(String(body.fileName || ''));
    if (!/\.(xlsx|xls|csv)$/i.test(fileName)) throw new Error('仅支持 xlsx、xls 或 csv');
    const result=store.saveSource({kind:body.kind,fileName,buffer:Buffer.from(body.fileBase64,'base64'),periodStart:body.periodStart,periodEnd:body.periodEnd,actor:req.authUser.openId});
    writeAudit({ action:'grade_source_saved',actor:req.authUser,resourceType:'grade_source',resourceId:result.source.id,details:{fileName,reused:result.reused} });
    res.status(result.reused ? 200 : 201).json(result);
  }));
  app.get(`${root}/runs`,permit('workspace'),(_req,res)=>res.json({runs:store.listRuns()}));
  app.get(`${root}/batches/:id`,permit('history'),handle((req,res)=>{
    requireBatch(req.params.id);
    res.json({runs:store.listBatchRuns(req.params.id),events:store.listBatchEvents(req.params.id)});
  }));
  app.post(`${root}/runs`,permit('workspace'),handle(async(req,res)=>{
    const input=req.body || {};
    const volume=requireSource(input.volumeId,'volume'), template=requireSource(input.templateId,'template');
    if (!Array.isArray(input.prices) || !input.prices.length || input.prices.length>10000 || !Array.isArray(input.skuIds) || !input.skuIds.length || input.skuIds.length>1000) throw new Error('请选择已定价 SKU（最多1000个）');
    const prices=input.prices.map(p=>({id:String(p.id || ''),ppv:String(p.ppv || ''),skuId:String(p.skuId || ''),model:String(p.model || ''),level:String(p.level || ''),price:p.price,newSeries:String(p.newSeries || ''),...(p.display ? {display:gradeSourceDisplay(p.display)} : {})}));
    if (prices.some(p=>!p.id || !p.ppv || !p.skuId || !p.model || !Number.isFinite(p.price) || p.price<=0)) throw new Error('已定价记录不完整');
    if (input.subsidyRules != null && (!Array.isArray(input.subsidyRules) || input.subsidyRules.length>10000 || input.subsidyRules.some(r=>!r || typeof r.newSeries!=='string' || ![r.threshold,r.ahsInput,r.jdSubsidy].every(n=>Number.isFinite(n)&&n>=0)))) throw new Error('补贴规则格式无效');
    const subsidyRules=(input.subsidyRules || []).map(({newSeries,threshold,ahsInput,jdSubsidy})=>({newSeries,threshold,ahsInput,jdSubsidy}));
    const request={volumeId:volume.id,templateId:template.id,prices,subsidyRules,skuIds:[...new Set(input.skuIds.map(String))],priceChoices:input.priceChoices || {},workspaceVersion:String(input.workspaceVersion || '')};
    const parent = input.parentRunId ? store.getRun(String(input.parentRunId)) : null;
    if (input.parentRunId && !parent) throw new Error('原测算不存在，无法更新');
    if (parent && ['volumeId','templateId','prices','skuIds','priceChoices','subsidyRules'].some(key => JSON.stringify(parent.request[key] || (key==='subsidyRules'?[]:null)) !== JSON.stringify(request[key]))) throw new Error('更新价格必须沿用原测算输入');
    const trackingBatchId = parent?.trackingBatchId || gradeSourceBatchId(input);
    if (trackingBatchId) { requireBatch(trackingBatchId,request); request.trackingBatchId=trackingBatchId; }
    const plan=buildGradePlan({volume:volume.data,template:template.data,...request});
    const daily=plan.rows.length ? await lookupPrices(plan.rows.map(r=>r.ppv)) : {rows:[],dataDate:'未查询',fetchedAt:new Date().toISOString()};
    const guarded=applyGradeMarginFloor(plan,subsidyRules,daily.rows);
    const stable=stabilizeGradeOrder(guarded,subsidyRules,daily.rows);
    const result=addGradePresentation(applyGradeStrategyPrices(stable,daily.rows),request,daily.rows);
    const run=store.createRun({...result,title:String(input.title || `等级推算 ${volume.periodEnd}`).slice(0,100),request,
      trackingBatchId:trackingBatchId || undefined,parentRunId:parent?.id,
      sources:{volume:{...volume,data:undefined},template},dailyPriceDate:daily.dataDate,dailyPriceFetchedAt:daily.fetchedAt},req.authUser);
    auditRun(parent?'grade_run_refreshed':'grade_run_generated',run,req.authUser);
    res.status(201).json({run});
  }));
  app.get(`${root}/runs/:id`,permitRun,(req,res)=>{
    const run=store.getRun(req.params.id);
    if (!run) return res.status(404).json({error:'测算不存在'});
    res.json({run});
  });
  app.post(`${root}/runs/:id/save`,permit('workspace'),handle(async(req,res)=>{
    const existing=store.getRun(req.params.id);
    if (!existing) return res.status(404).json({error:'测算不存在'});
    const knownBatchId=existing.trackingBatchId || gradeSourceBatchId(existing.request);
    const trackingBatchId=String(req.body?.trackingBatchId || knownBatchId || '');
    if (knownBatchId && knownBatchId!==trackingBatchId) throw new Error('测算应保存到生成时对应的追价快照');
    const batch=requireBatch(trackingBatchId,existing.request);
    let revenue=null;
    if(!existing.investmentConfirmedAt) {
      try { revenue=await lookupRevenue(); } catch { /* Fall back to the saved batch's denominators; absent brand rates remain unknown. */ }
    }
    const run=store.saveRun(req.params.id,trackingBatchId,req.authUser,{confirmInvestment:true,revenue});
    if (!existing.saved || !existing.trackingBatchId) auditRun('grade_run_saved',run,req.authUser);
    if (!existing.investmentConfirmedAt) auditRun('grade_investment_confirmed',run,req.authUser);
    res.json({run});
  }));
  app.get(`${root}/runs/:id/export`,permitRun,handle((req,res)=>{
    const run=store.getRun(req.params.id);
    if (!run) return res.status(404).json({error:'测算不存在'});
    const fileName=`等级推算与投入测算_${run.createdAt.slice(0,10)}.xlsx`;
    const workbook=createGradeWorkbook(run,run.trackingBatchId?getBatch(run.trackingBatchId):null);
    store.addEvent(run.id,'exported',req.authUser);
    auditRun('grade_run_exported',run,req.authUser);
    res.set('content-disposition',`attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`)
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(workbook);
  }));
}
