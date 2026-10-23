import React, {useEffect,useRef} from 'react';
type Point=Record<string,string|number|null>;
const formatter=new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2});
const money=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)?formatter.format(n):'—';
const gap=(point:Point,jd:string,tm:string)=>typeof point[jd]==='number'&&typeof point[tm]==='number'?Number(point[jd])-Number(point[tm]):null;
export function TimelineDetailButton({expanded,onClick}:{expanded:boolean;onClick:()=>void}) {
  return <button className="font-bold underline" aria-expanded={expanded} onClick={event=>{event.stopPropagation();onClick();}}>{expanded?'收起':'详情'}</button>;
}
export default function TimelineHistoryDetails({ppv,points,focusBatch,focusRequest,onOpenSnapshot}:{ppv:string;points:Point[];focusBatch?:string;focusRequest?:number;onOpenSnapshot?:(batchId:string,ppv:string)=>void}) {
  const focusedRow=useRef<HTMLTableRowElement>(null);
  useEffect(()=>{if(focusBatch)focusedRow.current?.scrollIntoView({block:'center',inline:'nearest'});},[focusBatch,focusRequest]);
  const records=points.filter(point=>point.present===1);
  return <div aria-label="PPV时序详情"><h4 className="mb-1 break-all text-xs font-bold">{ppv}</h4>
    <p className="mb-3 text-[11px] text-[#777]">按追价日期从早到晚 · {records.length} 份快照含该 PPV · 价差＝京东－天猫，正数京东更高，负数天猫更高。</p>
    <div className="max-h-[360px] overflow-auto"><table className="w-full min-w-[900px] border-separate border-spacing-0 border-l border-t border-[#888] bg-white text-[11px] [&_th]:border-0 [&_th]:bg-[#F0EFEC] [&_th]:shadow-[inset_-1px_0_0_#888,inset_0_-1px_0_#888] [&_td]:border-0 [&_td]:border-b [&_td]:border-r [&_td]:border-[#aaa]" aria-label="PPV按时间价格明细">
      <thead className="sticky top-0 z-20 bg-[#F0EFEC] after:pointer-events-none after:absolute after:inset-x-0 after:top-0 after:z-30 after:h-px after:bg-[#888] after:content-['']"><tr><th rowSpan={2} className="px-3 py-2 text-left">追价日期 / 批次</th><th rowSpan={2} className="px-3 py-2">基准价</th><th colSpan={3} className="px-3 py-2">京东</th><th colSpan={3} className="px-3 py-2">天猫</th><th rowSpan={2} className="px-3 py-2">物品价差</th><th rowSpan={2} className="px-3 py-2">到手价差</th></tr><tr>{['物品价－追后','新品总投入－追后','到手价－追后','裸机价','人工总补贴','到手价'].map(title=><th key={title} className="px-2 py-2 font-normal">{title}</th>)}</tr></thead>
      <tbody>{records.map(point=><tr ref={point.batch===focusBatch?focusedRow:undefined} aria-label={point.batch===focusBatch?`已定位批次：${point.batch}`:undefined} key={String(point.batch)} className={`border-t border-[#141414]/15 ${point.batch===focusBatch?'bg-sky-100 [&>td]:bg-sky-100 outline outline-2 outline-inset outline-sky-300':''}`}><td className="whitespace-nowrap px-3 py-2">{onOpenSnapshot?<button type="button" className="text-left hover:text-blue-700 hover:underline" title="打开历史快照并定位此 PPV" onClick={()=>onOpenSnapshot(String(point.batch),ppv)}>{String(point.name||'').slice(0,10)}<span className="mt-1 block text-[10px] text-[#777]">{point.batch}</span></button>:<>{String(point.name||'').slice(0,10)}<p className="mt-1 text-[10px] text-[#777]">{point.batch}</p></>}</td>{['basePrice','recommendJdPrice','totalSubsidy','postJdHandPrice','tmPrice','tmSubsidyManual','tmHandPrice'].map(key=><td className="px-3 py-2 text-right font-mono" key={key}>{money(point[key])}</td>)}{[['recommendJdPrice','tmPrice'],['postJdHandPrice','tmHandPrice']].map(([jd,tm])=>{
        const difference=gap(point,jd,tm);return <td key={jd} className={`px-3 py-2 text-right font-mono ${difference===null||difference===0?'text-[#777]':difference>0?'text-green-700':'text-red-700'}`}>{difference!==null&&difference>0?'+':''}{money(difference)}</td>;
      })}</tr>)}</tbody>
    </table></div>
  </div>;
}
