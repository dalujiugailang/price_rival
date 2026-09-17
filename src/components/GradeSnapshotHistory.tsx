import React, { useEffect, useState } from 'react';
import { getBatchGradeHistory, getGradeRun, gradeExportUrl } from '../gradeApi';
import { GradeRun, GradeRunEvent, GradeRunSummary } from '../gradeTypes';
import { formatRMB } from '../utils/formulas';
import GradePricingTable from './GradePricingTable';

const actions:Record<string,string>={generated:'生成测算',refreshed:'更新 Daily Price',saved:'保存本期最终版',investment_confirmed:'确认额外投入',superseded:'被新最终版替换',exported:'导出 Excel'};
const button='border border-[#141414] px-3 py-2 text-xs font-bold';
const time=(value:string)=>new Date(value).toLocaleString('zh-CN');

export default function GradeSnapshotHistory({batchId,children}:{batchId:string;children:React.ReactNode}) {
  const [pane,setPane]=useState<'pricing'|'grades'>('pricing');
  const [runs,setRuns]=useState<GradeRunSummary[]>([]);
  const [events,setEvents]=useState<GradeRunEvent[]>([]);
  const [selected,setSelected]=useState('');
  const [run,setRun]=useState<GradeRun|null>(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [revision,setRevision]=useState(0);
  useEffect(()=>{
    let live=true;setLoading(true);setError('');
    getBatchGradeHistory(batchId).then(result=>{
      if(!live)return;
      setRuns(result.runs);setEvents(result.events);
      setSelected(previous=>result.runs.some(r=>r.id===previous)?previous:result.runs[0]?.id||'');
    }).catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  },[batchId,revision]);
  useEffect(()=>{
    let live=true;setRun(null);
    if(pane==='grades'&&selected)getGradeRun(selected).then(result=>{if(live)setRun(result.run);}).catch(e=>{if(live)setError(e.message);});
    return()=>{live=false;};
  },[selected,pane]);
  return <div className="min-w-0 space-y-3">
    <div className="flex gap-2 border border-[#141414] bg-[#F0EFEC] p-3">
      <button className={`${button} ${pane==='pricing'?'bg-[#141414] text-white':'bg-white'}`} aria-pressed={pane==='pricing'} onClick={()=>setPane('pricing')}>重点追价明细</button>
      <button className={`${button} ${pane==='grades'?'bg-[#141414] text-white':'bg-white'}`} aria-pressed={pane==='grades'} onClick={()=>setPane('grades')}>等级推算最终版</button>
    </div>
    {error&&<div role="alert" className="border border-red-700 bg-red-50 p-3 text-xs">{error}<button className="ml-3 underline" onClick={()=>setRevision(r=>r+1)}>重试</button></div>}
    {pane==='pricing'?children:<div className="space-y-3 border border-[#141414] bg-white p-4">
      {loading?<p className="text-xs">正在读取本期等级推算…</p>:!runs.length?<p className="text-xs text-[#555]">本期尚未保存等级推算。生成后点击“保存到本期历史”即可归档。</p>:<>
        <div className="flex flex-wrap items-end gap-2"><div className="min-w-64 flex-1 text-xs">本期最终版 · 保存于 {time(runs[0].savedAt||runs[0].createdAt)} · {runs[0].investmentConfirmedAt?'已确认额外投入，计入费率':'旧版仅归档，尚未确认额外投入'}</div>
          {run&&<a className={button} href={gradeExportUrl(run.id)}>导出本版 Excel</a>}
        </div>
        {run?<>
          <div className="text-xs text-[#555]">{run.rows.length} 个 PPV · Daily Price {run.dailyPriceDate} · 成交量周期 {run.sources.volume.periodStart} 至 {run.sources.volume.periodEnd}</div>
          <details className="text-xs text-[#555]"><summary className="cursor-pointer">本版数据来源</summary><div className="mt-2 space-y-1"><p>生成于 {time(run.createdAt)} · 保存于 {time(run.savedAt||run.createdAt)}</p><p>底表：{run.sources.volume.fileName}</p><p>模板：{run.sources.template.fileName}</p><p>Daily Price 拉取于 {time(run.dailyPriceFetchedAt)}</p></div></details>
          <div className="flex flex-wrap gap-5 text-xs"><span>等级推算新增投入 <strong>{formatRMB(run.summary.expansionInvestment)}</strong></span><span>待补费用 {run.summary.pendingRows} 行</span><span>无法推算 {run.issues.length} 项</span></div>
          <GradePricingTable key={run.id} run={run}/>
        </>:<p className="text-xs">正在读取已保存明细…</p>}
      </>}
    </div>}
    {!!runs.length&&<details className="border border-[#141414] bg-white p-3 text-xs"><summary className="cursor-pointer font-bold">等级推算操作记录（{events.length}）</summary>
      <button className="my-2 underline" onClick={()=>setRevision(r=>r+1)}>刷新记录</button>
      <div className="max-h-72 overflow-auto"><table className="w-full text-left"><thead><tr>{['时间','操作人','操作','记录'].map(t=><th key={t} className="border-b p-2">{t}</th>)}</tr></thead><tbody>{events.map(e=><tr key={e.id}><td className="p-2">{time(e.createdAt)}</td><td className="p-2">{e.actorName||'-'}</td><td className="p-2">{actions[e.action]||e.action}</td><td className="p-2">{e.title}{e.runId!==selected?'（已替换）':''}</td></tr>)}</tbody></table></div>
    </details>}
  </div>;
}
