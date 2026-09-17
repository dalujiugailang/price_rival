import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalculatedProduct, SubsidyRule, TrackingBatch } from '../types';
import { gradeBatchMismatch, gradeSourceBatchId } from '../../shared/gradeHistory.mjs';
import { GradePriceInput, GradeRequest, GradeRun, GradeSource } from '../gradeTypes';
import { generateGradeRun, getGradeSource, gradeExportUrl, gradeSourceUrl,
  listGradeSources, saveGradeRun, uploadGradeSource } from '../gradeApi';
import { createGradeRequestCache, gradeRequestKey } from '../../shared/gradeLiveRequest.mjs';
import { gradePriceChoiceKey, resolveGradeInputLevel, gradePriceAdjustment } from '../../shared/gradeExpansion.mjs';
import { gradeSourceDisplay } from '../../shared/gradePresentation.mjs';
import GradePricingTable from './GradePricingTable';

const button='border border-[#141414] px-3 py-2 text-xs font-bold hover:bg-[#E4E3E0] disabled:opacity-40 disabled:cursor-not-allowed';
const input='w-full border border-[#141414] bg-white px-2 py-2 text-xs';
const rmb=(n:number|null)=>n===null ? '—' : n.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const calculateLive=createGradeRequestCache((request:GradeRequest)=>generateGradeRun({...request,title:'等级推算投入测算'}));

export default function GradeExpansionPanel({ products, workspaceVersion, canUpload, subsidyRules, trackingBatchId, historyBatches, onViewHistory, onSaved }: {
  products:CalculatedProduct[]; workspaceVersion:string; canUpload:boolean; subsidyRules:SubsidyRule[];
  trackingBatchId?:string; historyBatches:TrackingBatch[]; onViewHistory?:(batchId:string)=>void;
  onSaved?:()=>void|Promise<unknown>;
}) {
  const [sources,setSources]=useState<GradeSource[]>([]);
  const [volumeId,setVolumeId]=useState(''); const [templateId,setTemplateId]=useState('');
  const [volume,setVolume]=useState<GradeSource|null>(null); const [template,setTemplate]=useState<GradeSource|null>(null);
  const [priceChoices,setPriceChoices]=useState<Record<string,string>>({});
  const [calculation,setCalculation]=useState<{key:string;revision:number;run:GradeRun}|null>(null);
  const [revision,setRevision]=useState(0);
  const refreshedRevision=useRef(0);
  const [calculationError,setCalculationError]=useState<{key:string;revision:number;message:string}|null>(null);
  const [busy,setBusy]=useState(''); const [error,setError]=useState(''); const [message,setMessage]=useState('');
  const [saveBatchChoice,setSaveBatchChoice]=useState('');
  const [volumeFile,setVolumeFile]=useState<File|null>(null);
  const [periodStart,setPeriodStart]=useState('');const [periodEnd,setPeriodEnd]=useState('');

  const volumeByPpv=useMemo(()=>new Map((volume?.data?.rows||[]).map(r=>[r.ppv,r])),[volume]);
  const prices=useMemo<GradePriceInput[]>(()=>products.map(p=>({id:p.id,ppv:p.ppv,skuId:String(p.skuId),model:p.oldModel,
    level:volumeByPpv.get(p.ppv)?.level||resolveGradeInputLevel({ppv:p.ppv,model:p.oldModel,level:p.level},template?.data?.rules||[]),price:p.recommendJdPrice,newSeries:p.newSeries,display:gradeSourceDisplay(p)})),[products,volumeByPpv,template]);
  const skuIds=useMemo(()=>[...new Set(prices.map(p=>p.skuId))],[prices]);
  const currentRequest=useMemo<GradeRequest>(()=>({volumeId,templateId,prices,skuIds,priceChoices,workspaceVersion,trackingBatchId,subsidyRules:subsidyRules.map(({newSeries,threshold,ahsInput,jdSubsidy})=>({newSeries,threshold,ahsInput,jdSubsidy}))}),[volumeId,templateId,prices,skuIds,priceChoices,workspaceVersion,trackingBatchId,subsidyRules]);
  const requestKey=gradeRequestKey(currentRequest);
  const ready=Boolean(volume?.id===volumeId&&template?.id===templateId&&skuIds.length);
  const run=ready&&calculation?.key===requestKey&&calculation.revision===revision ? calculation.run : null;
  const liveError=calculationError?.key===requestKey&&calculationError.revision===revision ? calculationError.message : '';
  const calculating=ready&&!run&&!liveError;
  const knownBatchId=run ? run.trackingBatchId || gradeSourceBatchId(run.request) : '';
  const matchingBatches=useMemo(()=>run ? historyBatches.filter(b=>(!knownBatchId || b.id===knownBatchId)&&!gradeBatchMismatch(run.request,b)) : [],[run,historyBatches,knownBatchId]);
  const saveBatchId=matchingBatches.find(b=>b.id===saveBatchChoice)?.id || (matchingBatches.length===1 ? matchingBatches[0].id : '');
  const conflicts=useMemo(()=>{
    const groups=new Map<string,GradePriceInput[]>();
    const noRaiseSkus=new Set(currentRequest.skuIds.filter(skuId=>{const rows=currentRequest.prices.filter(p=>p.skuId===skuId);return rows.length&&rows.every(p=>{const a=gradePriceAdjustment(p);return a!==null&&a<=0;});}));
    for (const p of currentRequest.prices) {if(!p.level||noRaiseSkus.has(p.skuId))continue;const key=gradePriceChoiceKey(p.skuId,p.level);groups.set(key,[...(groups.get(key)||[]),p]);}
    return [...groups].filter(([,rows])=>new Set(rows.map(r=>r.price)).size>1);
  },[currentRequest.prices]);

  useEffect(()=>{
    let live=true;
    listGradeSources().then(a=>{
      if (!live) return;
      setSources(a.sources);
      setVolumeId(a.sources.find(s=>s.kind==='volume')?.id||'');setTemplateId(a.sources.find(s=>s.kind==='template')?.id||'');
    }).catch(e=>{if(live)setError(e.message);});
    return()=>{live=false;};
  },[]);
  useEffect(()=>{
    let live=true;setVolume(null);setTemplate(null);
    Promise.all([volumeId?getGradeSource(volumeId):null,templateId?getGradeSource(templateId):null]).then(([v,t])=>{
      if(live){setVolume(v?.source||null);setTemplate(t?.source||null);}
    }).catch(e=>{if(live)setError(e.message);});
    return()=>{live=false;};
  },[volumeId,templateId]);
  useEffect(()=>{
    if(!ready)return;
    let live=true;
    const timer=setTimeout(()=>{
      const refresh=revision!==refreshedRevision.current;
      refreshedRevision.current=revision;
      calculateLive(currentRequest,refresh).then((result:{run:GradeRun})=>{
        if(live)setCalculation({key:requestKey,revision,run:result.run});
      }).catch((e:Error)=>{if(live)setCalculationError({key:requestKey,revision,message:e.message});});
    },500);
    // Use the captured payload; ignore any response after the workspace changes.
    return()=>{live=false;clearTimeout(timer);};
  },[requestKey,ready,revision]);
  const execute=async(label:string,fn:()=>Promise<void>)=>{
    setBusy(label);setError('');setMessage('');
    try{await fn();}catch(e){setError(e instanceof Error?e.message:'操作失败');}finally{setBusy('');}
  };
  const importTemplate=(file?:File)=>{
    if(!file)return;
    void execute('保存模板',async()=>{
      const result=await uploadGradeSource(file,'template');
      setSources((await listGradeSources()).sources);setTemplateId(result.source.id);
      setMessage(`${result.reused?'已复用相同模板':'模板原件已保存'}：${result.source.rowCount} 条等级配置`);
    });
  };
  const importVolume=()=>void execute('导入底表',async()=>{
    if(!volumeFile)return;
    const result=await uploadGradeSource(volumeFile,'volume',periodStart,periodEnd);
    setSources((await listGradeSources()).sources);setVolumeId(result.source.id);setVolumeFile(null);
    setMessage(`完整 PPV 底表已保存：${result.source.rowCount} 行，已用于实时推算。`);
  });
  const modelSummaries=useMemo(()=>{
    const grouped=new Map<string,{core:number;expansion:number;missing:number}>();
    for(const r of run?.rows||[]){const g=grouped.get(r.model)||{core:0,expansion:0,missing:0};g[r.origin==='重点追价'?'core':'expansion']+=r.investment??0;g.missing+=Number(r.investment===null);grouped.set(r.model,g);}
    return [...grouped];
  },[run]);

  return <section className="space-y-4 p-4" aria-label="等级推算与投入测算">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-black">等级推算投入测算</h2>
      <span role="status" className="text-xs text-[#555]">{calculating?'正在根据重点追价更新…':run?`已同步重点追价 · 全部 ${skuIds.length} 个 SKU`:!skuIds.length?'等待重点追价数据':'等待测算数据'}</span>
    </div>
    <div className="grid gap-3 md:grid-cols-3">{[['重点追价投入',run?.summary.coreInvestment],['等级推算新增投入',run?.summary.expansionInvestment],['合计投入',run?.summary.totalInvestment]].map(([label,value])=><div key={label} className={`border border-[#141414] p-3 ${label==='合计投入'?'bg-[#F0EFEC]':''}`}><div className="text-xs">{label}</div><div className="mt-1 font-mono text-2xl font-bold">{typeof value==='number'?`¥${rmb(value)}`:'-'}</div></div>)}</div>
    {liveError&&<div role="alert" className="border border-red-700 bg-red-50 p-3 text-sm text-red-800">{liveError}<button className="ml-3 underline" onClick={()=>setRevision(r=>r+1)}>重试</button></div>}
    <details className="border border-[#141414] p-3">
      <summary className="cursor-pointer text-xs font-bold">数据来源</summary>
      <div className="mt-3 space-y-3">
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="text-xs"><label className="font-bold">完整 PPV 底表
        <select aria-label="完整PPV底表版本" className={`${input} mt-2`} value={volumeId} disabled={!!busy} onChange={e=>setVolumeId(e.target.value)}>
          <option value="">请选择已保存的底表</option>{sources.filter(s=>s.kind==='volume').map(s=><option key={s.id} value={s.id}>{s.fileName} · {s.periodStart}～{s.periodEnd} · {s.rowCount} PPV</option>)}</select></label>
        {volume&&<div className="mt-2"><a className="underline" href={gradeSourceUrl(volume.id)}>下载原文件</a></div>}
        {canUpload&&<div className="mt-2 space-y-2"><label className="block">导入完整 PPV 底表 <input aria-label="导入完整PPV底表" type="file" accept=".xlsx,.xls,.csv" disabled={!!busy} onChange={e=>{setVolumeFile(e.target.files?.[0]||null);e.currentTarget.value='';}}/></label>
          {volumeFile&&<><p>{volumeFile.name}</p><div className="flex flex-wrap items-end gap-2"><label>成交量起始日期<input aria-label="底表成交量起始日期" type="date" className={input} value={periodStart} onChange={e=>setPeriodStart(e.target.value)}/></label><label>成交量截止日期<input aria-label="底表成交量截止日期" type="date" className={input} value={periodEnd} onChange={e=>setPeriodEnd(e.target.value)}/></label><button className={button} disabled={!!busy||!periodStart||!periodEnd} onClick={importVolume}>导入并使用</button></div><p className="text-[#555]">按文件实际统计范围填写，需为完整 30 天。</p></>}
        </div>}
      </div>
      <div className="text-xs"><label className="font-bold">等级模板版本
        <select aria-label="等级模板版本" className={`${input} mt-2`} value={templateId} disabled={!!busy} onChange={e=>setTemplateId(e.target.value)}>
          <option value="">请选择等级模板</option>{sources.filter(s=>s.kind==='template').map(s=><option key={s.id} value={s.id}>{s.fileName} · {s.createdAt.slice(0,10)}</option>)}</select></label>
        {canUpload&&<label className="mt-2 block">导入等级模板 <input aria-label="导入等级模板" type="file" accept=".xlsx,.xls" disabled={!!busy} onChange={e=>{importTemplate(e.target.files?.[0]);e.currentTarget.value='';}}/></label>}
        {template&&<div className="mt-2">{Object.keys(template.data?.models||{}).length} 个型号 · {template.rowCount} 条等级配置 · <a className="underline" href={gradeSourceUrl(template.id)}>下载原文件</a></div>}
      </div>
    </div>
    {!skuIds.length&&<p className="text-xs">先在重点追价完成本次 PPV 定价。</p>}
    {!!conflicts.length&&<div className="space-y-2 border border-amber-700 bg-amber-50 p-3 text-xs"><div className="font-bold">同一 PPV 存在不同最终价格，请选择保留的记录</div>
      {conflicts.map(([key,rows])=><label key={key} className="block">{rows[0].ppv}<select className={`${input} mt-1`} aria-label={`价格选择 ${rows[0].ppv}`} disabled={!!busy} value={priceChoices[key]||''} onChange={e=>setPriceChoices(p=>({...p,[key]:e.target.value}))}><option value="">请选择</option>{rows.map(r=><option key={r.id} value={r.id}>{r.newSeries||'未分系列'} · ¥{rmb(r.price)}</option>)}</select></label>)}</div>}
      </div>
    </details>
    <div className="flex flex-wrap items-end gap-2">
      <button className={button} disabled={!!busy||calculating||!ready} onClick={()=>{setMessage('');setRevision(r=>r+1);}}>刷新 Daily Price</button>
      <button className={button} disabled={!!busy||!run||!saveBatchId||Boolean(run.isFinal&&run.investmentConfirmedAt)} onClick={()=>void execute('保存测算',async()=>{const result=await saveGradeRun(run!.id,saveBatchId);calculateLive.update(currentRequest,result);setCalculation(previous=>previous?.run.id===result.run.id?{...previous,run:result.run}:previous);await onSaved?.();setMessage('已保存为本期最终版，等级新增投入已计入费率。');})}>{run?.isFinal&&run.investmentConfirmedAt?'最终版已保存':'保存到本期历史'}</button>
      {run&&<a className={button} href={gradeExportUrl(run.id)}>导出 Excel</a>}
    </div>
    <p className="text-xs text-[#555]">保存即确认额外投入并计入费率；再次保存替换本期最终版。</p>
    {run&&!(run.saved&&run.trackingBatchId)&&<div className="text-xs text-[#555]">
      {matchingBatches.length>1 ? <label>归属快照 <select aria-label="等级测算归属快照" className="ml-2 max-w-full border border-[#141414] bg-white p-2" value={saveBatchId} disabled={!!busy} onChange={e=>setSaveBatchChoice(e.target.value)}><option value="">请选择对应的已保存快照</option>{matchingBatches.map(b=><option key={b.id} value={b.id}>{b.date} · {b.remarks || b.id}</option>)}</select></label>
        : !matchingBatches.length&&<span>保存历史前，请先在重点追价保存对应快照。</span>}
    </div>}
    {run?.saved&&run.trackingBatchId&&onViewHistory&&<button className="text-xs underline" onClick={()=>onViewHistory(run.trackingBatchId!)}>查看本期历史</button>}
    {error&&<div role="alert" className="border border-red-700 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
    {message&&<div role="status" className="text-xs text-green-800">{message}</div>}
    {run&&<>
      <details className="text-xs text-[#555]"><summary className="cursor-pointer">Daily Price {run.dailyPriceDate} · 成交量周期 {run.sources.volume.periodStart} 至 {run.sources.volume.periodEnd}</summary>
        <div className="mt-2 space-y-1"><p>生成时间：{new Date(run.createdAt).toLocaleString('zh-CN')}</p><p>价格拉取时间：{run.dailyPriceFetchedAt?new Date(run.dailyPriceFetchedAt).toLocaleString('zh-CN'):'-'}</p><p>底表：{run.sources.volume.fileName}</p><p>模板：{run.sources.template.fileName}</p></div>
      </details>
      <div className="flex flex-wrap items-start gap-x-5 gap-y-2 text-xs">
        <span className={run.summary.pendingRows||run.issues.length?'text-amber-800':'text-[#555]'}>{run.summary.pendingRows||run.issues.length?'部分预估':'完整预估'} · 待补费用 {run.summary.pendingRows} 行</span>
        {!!run.issues.length&&<details className="min-w-48 flex-1 text-amber-800"><summary className="cursor-pointer">无法推算 {run.issues.length} 项</summary><div className="mt-2 max-h-48 overflow-auto border border-amber-700 bg-amber-50 p-3">{run.issues.map((i,index)=><p key={index}>{i.model} · SKU {i.skuId}：{i.message}</p>)}</div></details>}
        {!!run.skippedSkus?.length&&<details className="min-w-48 flex-1 text-[#555]"><summary className="cursor-pointer">未加价，跳过 {run.skippedSkus.length} 个 SKU</summary><div className="mt-2 max-h-48 overflow-auto">{run.skippedSkus.map(s=><p key={s.skuId}>{s.model} · SKU {s.skuId}：{s.reason}</p>)}</div></details>}
      </div>
      {!!run.orderIssues?.length&&<div role="alert" className="border border-red-700 bg-red-50 p-3 text-xs">{run.orderIssues.map((i,index)=><p key={index}>{i.model} · SKU {i.skuId}：{i.message}</p>)}</div>}
      <details className="border border-[#141414] p-3"><summary className="cursor-pointer text-sm font-bold">型号投入汇总（{modelSummaries.length}）</summary>
        <table className="mt-2 w-full text-xs"><thead><tr><th className="text-left">型号</th><th>重点追价</th><th>等级推算</th><th>合计</th><th>待补行数</th></tr></thead><tbody>{modelSummaries.map(([model,s])=><tr key={model} className="border-t"><td>{model}</td><td className="text-right">{rmb(s.core)}</td><td className="text-right">{rmb(s.expansion)}</td><td className="text-right">{rmb(s.core+s.expansion)}</td><td className="text-right">{s.missing}</td></tr>)}</tbody></table></details>
      <GradePricingTable key={run.id} run={run}/>
    </>}
  </section>;
}
