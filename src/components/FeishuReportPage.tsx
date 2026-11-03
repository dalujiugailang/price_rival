import React, { useEffect, useState } from 'react';
import { FeishuReport, getFeishuReport } from '../api';
export default function FeishuReportPage({id}:{id:string}) {
  const [report,setReport]=useState<FeishuReport|null>(null),[error,setError]=useState('');
  useEffect(()=>{let live=true;setReport(null);setError('');getFeishuReport(id).then(r=>live&&setReport(r.report)).catch(e=>live&&setError(e.message));return()=>{live=false;};},[id]);
  if(error)return <div role="alert" className="rounded border border-amber-600 bg-amber-50 p-5">{error}</div>;
  if(!report)return <p>正在加载本批次竞争力简报…</p>;
  const detail=new URL(report.url);detail.searchParams.delete('reportId');
  return <section className="mx-auto max-w-4xl rounded border bg-white p-6"><h2 className="text-xl font-bold">{report.title}</h2><p className="my-3 text-sm">批次：{report.batchId} · {report.scopeLabel}</p><p className="mb-4 text-xs text-slate-600">这是推送时保存的竞争力简报，保留当时的结果。</p><img alt="本批次竞争力简报" src={`/api/feishu-push/reports/${encodeURIComponent(id)}/image`} className="mx-auto w-full max-w-2xl"/><a className="my-4 inline-block rounded bg-blue-700 px-4 py-2 text-white" href={detail.toString()}>查看该批次明细与走势</a></section>;
}
