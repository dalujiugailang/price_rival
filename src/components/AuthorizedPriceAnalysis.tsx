import React, {useEffect,useState} from 'react';
import {listPriceAnalysisBatches} from '../api';
import {TrackingBatch} from '../types';
import PriceAnalysis from './PriceAnalysis';
import {useAuth} from './AuthGate';
export default function AuthorizedPriceAnalysis({onOpenSnapshot}:{onOpenSnapshot?:(batchId:string,ppv:string)=>void}) {
  const {user}=useAuth();
  const identity=`${user.openId}:${user.role}:${user.accessVersion}`;
  const [batches,setBatches]=useState<TrackingBatch[]|null>(null),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[pending,setPending]=useState(false);
  useEffect(()=>{let active=true;setPending(true);setError('');listPriceAnalysisBatches(identity).then(result=>{if(active)setBatches(result.batches);}).catch(reason=>{if(active){setBatches(null);setError(reason.message||'无法访问价格分析');}}).finally(()=>{if(active)setPending(false);});return()=>{active=false;};},[identity,refresh]);
  useEffect(()=>{const reload=()=>{if(document.visibilityState==='visible')setRefresh(previous=>previous+1);};window.addEventListener('focus',reload);document.addEventListener('visibilitychange',reload);return()=>{window.removeEventListener('focus',reload);document.removeEventListener('visibilitychange',reload);};},[]);
  return <section data-price-analysis-active className="min-w-0 space-y-3"><div className="flex justify-end"><button disabled={pending} onClick={()=>setRefresh(previous=>previous+1)} className="border border-[#141414] bg-white px-3 py-1 text-xs disabled:opacity-40">{pending?'正在校验更新…':'刷新分析数据'}</button></div>{error?<p role="alert" className="border border-[#141414] bg-white p-4 text-xs text-red-700">{error}</p>:!batches?<p role="status" className="p-4 text-xs text-[#777]">正在加载价格分析…</p>:<PriceAnalysis batches={batches} onOpenSnapshot={onOpenSnapshot}/>}</section>;
}
