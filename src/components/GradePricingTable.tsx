import React, { useMemo, useState } from 'react';
import { GradeOutputRow, GradeRun } from '../gradeTypes';
import { gradeRowDisplay, gradeResultStatus, gradeResultValue } from '../../shared/gradePresentation.mjs';
import { formatRMB, formatPercent } from '../utils/formulas';
import { pricingColumnCodes, pricingColumnKeys, pricingColumnLabels, pricingColumnWidths, pricingPercentKeys, pricingBooleanKeys } from '../../shared/pricingColumns.mjs';
import { ColumnFilters, EMPTY_COLUMN_FILTER_VALUE, getColumnFilterOptions, matchesColumnFilters, matchesTableSearch, setColumnFilter } from '../utils/tableColumnFilters';
import ColumnFilterButton from './ColumnFilterButton';

const labels=pricingColumnLabels();
const columns=pricingColumnKeys.map((key,index)=>({key,label:labels[index],code:pricingColumnCodes[index],width:pricingColumnWidths[index]}))
  .filter((_,index)=>index!==28&&index!==37);
const extras=[['level','等级',90],['origin','价格来源',110],['strategyPrice','投入测算原价（Daily Price）',150],['adjustment','投入测算单台调整额',150],['investment','预估新增投入',140],['status','状态',240]] as const;
const allColumns=[...columns,...extras.map(([key,label,width])=>({key,label,width,code:''}))];
const textKeys=new Set(['newSeries','oldModel','ppv','skuId','levelId','brand','smallGapOpportunityRemark','level','origin','status']);
const moneyKeys=new Set(['ahsQuotedPrice','jdHandPrice','tmRecyclerSubsidy','tmRecyclerQuotedPrice','tmHandPrice','zzHandPrice','basePrice','preItemGap','preHandGap','recommendJdPrice','recommendAdjustment','ahsSubsidyAfter','postAhsPrice','postJdHandPrice','postItemGap','postHandGap','strategyPrice','adjustment','investment']);
const gapKeys=new Set(['preItemGap','preHandGap','postItemGap','postHandGap']);
const format=(key:string,value:unknown)=>{
  if(value==null||value==='')return '-';
  if(pricingBooleanKeys.has(key))return String(value);
  if(pricingPercentKeys.has(key))return formatPercent(Number(value));
  if(moneyKeys.has(key))return formatRMB(Number(value));
  if(textKeys.has(key))return String(value);
  return String(value);
};
const cellStyle=(key:string,value:unknown)=>{
  const alignment=pricingBooleanKeys.has(key)?'text-center font-mono':textKeys.has(key)&&key!=='skuId'&&key!=='levelId'?'text-left':'text-right font-mono';
  const emphasis=['newSeries','oldModel','ppv','brand'].includes(key)?'font-bold':'';
  const numeric=typeof value==='number';
  const color=pricingPercentKeys.has(key)&&numeric?`font-bold ${value<0.03?'text-red-700':'text-green-700'}`
    :gapKeys.has(key)&&numeric?`font-bold ${value>0?'text-green-700':value<0?'text-red-700':''}`
    :(key==='recommendAdjustment'||key==='adjustment')&&numeric?`font-bold ${value>0?'text-green-700':value<0?'text-red-700':'text-slate-500'}`:'';
  return `${alignment} ${emphasis} ${color} ${key==='recommendJdPrice'||key==='recommendAdjustment'?'bg-[#D8D7D2] font-bold':''}`;
};
type ViewRow={row:GradeOutputRow;values:Record<string,unknown>};
const getValue=(view:ViewRow,key:string)=>view.values[key];
const button='border border-[#141414] bg-white px-3 py-2 text-xs font-bold disabled:opacity-40';

export default function GradePricingTable({run}:{run:GradeRun;key?:string}) {
  const [query,setQuery]=useState(''); const [onlyIssues,setOnlyIssues]=useState(false);
  const [filters,setFilters]=useState<ColumnFilters>({}); const [open,setOpen]=useState<string|null>(null);const [page,setPage]=useState(1);
  const views=useMemo(()=>run.rows.map(row=>({row,values:{...Object.fromEntries(Object.entries(gradeRowDisplay(row,run.request)).map(([key,value])=>[key,gradeResultValue(key,value)])),level:row.level,origin:row.origin,strategyPrice:row.strategyPrice,adjustment:row.adjustment,investment:row.investment,status:gradeResultStatus(row).join('；')}})),[run]);
  const searched=useMemo(()=>views.filter(v=>(!onlyIssues||Boolean(v.values.status))&&matchesTableSearch(v,query,v=>allColumns.map(c=>v.values[c.key]))),[views,query,onlyIssues]);
  const filtered=useMemo(()=>searched.filter(v=>matchesColumnFilters(v,filters,getValue)),[searched,filters]);
  const count=Math.max(1,Math.ceil(filtered.length/50));const current=Math.min(page,count);
  const width=allColumns.reduce((total,c)=>total+c.width,0);
  return <div className="space-y-3">
    {run.pricingVersion!==4&&<p className="text-xs font-bold text-amber-800">此测算使用旧版规则，可重新生成最新结果。</p>}
    {!run.presentationVersion&&<p className="text-xs text-amber-800">此历史版本未保存完整展示字段；缺失项显示「-」。重新生成可查询并冻结完整字段。</p>}
    {!!run.rows.some(r=>r.displayStatus?.length)&&<p className="text-xs text-amber-800">部分系列缺少补贴规则，相关补贴、到手价及利润显示「-」。可在数据源上传补贴表后重新生成。</p>}
    <div className="flex flex-wrap items-center gap-3">
      <input aria-label="筛选等级推算明细" className="min-w-72 border border-[#141414] bg-white px-2 py-2 text-xs" placeholder="搜索新机系列 / 型号 / PPV / SKU" value={query} onChange={e=>{setQuery(e.target.value);setPage(1);}}/>
      <label className="text-xs"><input type="checkbox" checked={onlyIssues} onChange={e=>{setOnlyIssues(e.target.checked);setPage(1);}}/> 仅看有提示的行</label>
      <button className={button} onClick={()=>{setFilters({});setQuery('');setOnlyIssues(false);setOpen(null);setPage(1);}}>清除筛选与搜索</button>
      <span className="text-xs">共 {filtered.length} 行</span>
    </div>
    <div className="tracking-table-scroll border border-[#141414]" aria-label="等级推算追价明细">
      <table className="table-fixed text-[11px] leading-tight" style={{width,minWidth:width}}>
        <colgroup>{allColumns.map(c=><col key={c.key} style={{width:c.width}}/>)}</colgroup>
        <thead className="tracking-table-head border-b border-[#141414] bg-[#F0EFEC]">
          <tr>{allColumns.map(c=><th key={c.key} className={`border-r border-[#141414] px-2 py-1 text-center ${c.key==='recommendJdPrice'?'repricing-header bg-[#D8D7D2]':''}`}>{c.code||'等级推算'}</th>)}</tr>
          <tr>{allColumns.map(c=><th key={c.key} className={`border-r border-[#141414] px-2 py-1 text-center ${c.key==='recommendJdPrice'?'repricing-header bg-[#D8D7D2]':''}`}>
            <div className="flex items-center justify-center gap-1"><span className="min-w-0 flex-1">{c.label}</span><ColumnFilterButton label={c.label} options={open===c.key?getColumnFilterOptions(searched,c.key,filters,getValue).map(o=>({...o,label:o.value===EMPTY_COLUMN_FILTER_VALUE?'-':format(c.key,o.value)})):[]} activeValues={filters[c.key]||[]} isOpen={open===c.key} onToggle={()=>setOpen(open===c.key?null:c.key)} onClose={()=>setOpen(null)} onApply={values=>{setFilters(current=>setColumnFilter(current,c.key,values));setPage(1);}}/></div>
          </th>)}</tr>
        </thead>
        <tbody>{filtered.slice((current-1)*50,current*50).map(v=><tr key={v.row.ppv} className="border-b border-[#141414]/20 hover:bg-[#F9F9F8]">
          {allColumns.map(c=><td key={c.key} className={`border-r border-[#141414]/20 px-2 py-1 ${cellStyle(c.key,v.values[c.key])}`}>{c.key==='ppv'?<div className="truncate" title={String(v.values.ppv||'')}>{format(c.key,v.values[c.key])}</div>:format(c.key,v.values[c.key])}</td>)}
        </tr>)}</tbody>
      </table>
      {!filtered.length&&<p className="p-4 text-xs">没有符合筛选条件的 PPV</p>}
    </div>
    <div className="flex items-center justify-end gap-3 text-xs"><span>{current}/{count} 页</span><button className={button} disabled={current===1} onClick={()=>setPage(current-1)}>上一页</button><button className={button} disabled={current===count} onClick={()=>setPage(current+1)}>下一页</button></div>
  </div>;
}
