import React, {useEffect,useState} from 'react';
import {listPriceAnalysisBatches} from '../api';
import {TrackingBatch} from '../types';
import PriceAnalysis from './PriceAnalysis';
export default function AuthorizedPriceAnalysis({onOpenSnapshot}:{onOpenSnapshot?:(batchId:string,ppv:string)=>void}) {
  const [batches,setBatches]=useState<TrackingBatch[]|null>(null),[error,setError]=useState('');
  useEffect(()=>{let active=true;listPriceAnalysisBatches().then(result=>{if(active)setBatches(result.batches);}).catch(reason=>{if(active)setError(reason.message||'无法访问价格分析');});return()=>{active=false;};},[]);
  if(error)return <p role="alert" className="border border-[#141414] bg-white p-4 text-xs text-red-700">{error}</p>;
  if(!batches)return <p role="status" className="p-4 text-xs text-[#777]">正在加载价格分析…</p>;
  return <PriceAnalysis batches={batches} onOpenSnapshot={onOpenSnapshot}/>;
}
