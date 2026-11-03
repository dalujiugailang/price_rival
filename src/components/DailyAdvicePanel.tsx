import React, {useMemo,useState} from 'react';
import ProfitComparison from './ProfitComparison';
import {adviceTones,adviceFields} from './advicePalette';
import {TrackingBatch} from '../types';
import {advice,analysisTimeLabel,indexPpv,value} from '../utils/priceAnalysis';
const categories=[
  {type:'亏损风险',owner:'分货+销售',action:'协调分货与销售，改善物品价竞争力',...adviceTones.loss},
  {type:'利润底线限制',owner:'我方定价决策',action:'评估是否继续追平，明确利润取舍',...adviceTones.warning},
  {type:'补贴竞争力不足',owner:'京东换新渠道方',action:'与采销协商补贴，争取到手价高于天猫',...adviceTones.subsidy},
  {type:'利润空间待核验',owner:'我方定价决策',action:'补齐历史规则，核验利润后再决策',...adviceTones.unknown}
];
const format=new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2});
const money=(n:number|null)=>n===null?'—':format.format(n);
const button='border border-[#141414] bg-white px-3 py-1.5 text-xs font-bold hover:bg-[#E4E3E0]';
type AdviceRow=ReturnType<typeof advice>[number];
function AdviceEvidence({row,batch,action}:{row:AdviceRow;batch:TrackingBatch;action:string}) {
  const product=indexPpv(batch).rows.get(row.ppv);
  const current=product&&Number.isFinite(product.postMarginalProfit)?product.postMarginalProfit:null;
  const target=row.targetMargin??null,floor=Number.isFinite(batch.marginBottomLine)?batch.marginBottomLine:null;
  const ceiling=product&&Number.isFinite(product.maxPriceByMargin)&&product.maxPriceByMargin>0?product.maxPriceByMargin:null;
  const evidenceTone=categories.find(category=>category.type===row.type)||categories[3];
  const subsidy=row.type==='补贴竞争力不足';
  return <div className="space-y-2" aria-label="建议可视化依据"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-bold" style={{color:evidenceTone.color}}>建议：{action}</p><span className="border px-2 py-1 text-[11px]" style={{color:evidenceTone.color,background:evidenceTone.soft,borderColor:evidenceTone.border}}>处理对象：{row.owner}</span></div>
    {subsidy?<div className="grid gap-3 sm:grid-cols-3">{([['recommendJdPrice','tmPrice','物品价'],['totalSubsidy','tmSubsidyManual','补贴'],['postJdHandPrice','tmHandPrice','到手价']] as const).map(([jd,tm,label])=>{const j=value(product,jd),t=value(product,tm),max=Math.max(1,j??0,t??0);return <div key={jd} className="border border-[#aaa] bg-white p-3"><p className="mb-2 font-bold">{label}</p>{[['京东',j,adviceFields.current],['天猫',t,adviceFields.competitor]].map(([name,n,color])=><div key={String(name)} className="mt-2"><p className="flex justify-between text-[11px]"><span>{name}</span><strong style={{color:String(color)}}>{money(n as number|null)} 元</strong></p><div className="mt-1 h-1.5 bg-[#eee]"><div className="h-full" style={{width:`${(n as number|null)===null?0:Number(n)/max*100}%`,background:String(color)}}/></div></div>)}<p className="mt-2 text-[11px] text-[#777]">京东－天猫：{j===null||t===null?'—':`${money(j-t)} 元`}</p></div>;})}</div>:<ProfitComparison current={current} target={target} floor={floor} ceiling={ceiling}/>}
    <details className="text-[11px] text-[#555]"><summary className="cursor-pointer">完整计算说明与来源</summary><p className="mt-2 break-all leading-relaxed">{row.detail}</p><p className="mt-2 break-all text-[10px] text-[#777]">批次：{batch.id} · 完整 PPV：{row.ppv}</p></details>
  </div>;
}
export default function DailyAdvicePanel({rows,batch,onOpenSnapshot}:{rows:AdviceRow[];batch:TrackingBatch;onOpenSnapshot?:(id:string,ppv:string)=>void}) {
  const [type,setType]=useState(''),[brand,setBrand]=useState(''),[expanded,setExpanded]=useState('');
  const counts=categories.map(category=>({...category,count:rows.filter(row=>row.type===category.type).length}));
  const categoryRows=useMemo(()=>rows.filter(row=>!type||row.type===type),[rows,type]);
  const brands=useMemo(()=>{const map=new Map<string,number>();for(const row of categoryRows)map.set(row.brand,(map.get(row.brand)||0)+1);return [...map].sort((a,b)=>b[1]-a[1]);},[categoryRows]);
  const visible=categoryRows.filter(row=>!brand||row.brand===brand);
  const maxGap=Math.max(1,...visible.map(row=>row.gap));
  const products=indexPpv(batch).rows;
  const exportRows=()=>{
    const cell=(v:unknown)=>{const text=String(v??'');return '"'+(/^[=+@-]/.test(text)?"'":'')+text.replaceAll('"','""')+'"';};
    const data=[['批次','追价时间','品牌','新机系列','PPV','反馈对象','分类','价格缺口（元）','建议依据'],...visible.map(row=>[batch.id,analysisTimeLabel(batch),row.brand,row.newSeries,row.ppv,row.owner,row.type,row.gap,row.detail])];
    const url=URL.createObjectURL(new Blob(['\uFEFF'+data.map(row=>row.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download=`价格建议-${batch.id}.csv`;link.click();URL.revokeObjectURL(url);
  };
  return <section className="advice-palette space-y-4" aria-label="日报建议分类看板">
    <div className="border border-[#141414] bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-bold">本批次行动建议</h3><p className="mt-1 text-xs text-[#777]">{analysisTimeLabel(batch)} · {new Set(rows.map(row=>row.ppv)).size} 个 PPV · {rows.length} 条建议</p></div><button className={button} onClick={()=>{setType('');setBrand('');}}>查看全部分类</button></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{counts.map(category=><button type="button" key={category.type} aria-pressed={type===category.type} className="advice-category-card border p-3 text-left" style={{borderTop:`3px solid ${category.color}`,borderColor:type===category.type?category.color:category.border,background:type===category.type?category.soft:'white',boxShadow:type===category.type?`inset 0 0 0 1px ${category.border}`:undefined}} onClick={()=>{setType(previous=>previous===category.type?'':category.type);setBrand('');}}><div className="flex items-center justify-between gap-2"><strong className="flex items-center gap-1.5 text-xs" style={{color:category.color}}><span className="h-1.5 w-1.5 rounded-full" style={{background:category.color}}/>{category.type}</strong><span className="font-mono text-2xl font-bold" style={{color:category.color}}>{category.count}</span></div><p className="mt-2 text-xs font-bold">{category.owner}</p><p className="mt-1 text-[11px] leading-relaxed text-[#777]">{category.action}</p></button>)}</div>
      <div className="mt-3 flex h-2 overflow-hidden bg-[#F0EFEC]" aria-label="建议分类数量分布">{counts.map(category=><span key={category.type} title={`${category.type}：${category.count} 条`} style={{width:`${rows.length?category.count/rows.length*100:0}%`,background:category.color}}/>)}</div>
      <p className="mt-2 text-[11px] text-[#777]">点击分类卡片筛选 · 按单条价格缺口从大到小排列，金额单位：元；缺口不是总投入或销量影响。仍有追价空间不生成反馈。</p>
    </div>
    <div className="grid items-start gap-4 xl:grid-cols-[200px_minmax(0,1fr)]">
      <aside className="border border-[#141414] bg-white p-3" aria-label="品牌建议分布"><h4 className="text-xs font-bold">品牌分布 / 建议条数</h4><button className="mt-3 text-xs underline" onClick={()=>setBrand('')}>全部品牌 · {categoryRows.length}</button><div className="mt-2 space-y-2">{brands.map(([name,count])=><button key={name} className={`block w-full p-1 text-left text-xs ${brand===name?'advice-brand-selected':''}`} aria-pressed={brand===name} onClick={()=>setBrand(previous=>previous===name?'':name)}><span className="flex justify-between"><span>{name||'未识别品牌'}</span><strong>{count}</strong></span><span className="mt-1 block h-1 bg-[#F0EFEC]"><span className="block h-full" style={{background:brand===name?adviceFields.current:'var(--advice-muted)',width:`${count/Math.max(1,brands[0]?.[1]||0)*100}%`}}/></span></button>)}</div></aside>
      <div className="min-w-0 border border-[#141414] bg-white"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#141414] bg-[#F0EFEC] px-4 py-3"><h4 className="text-sm font-bold">{type||'全部建议'}{brand?` · ${brand}`:''} <span className="font-normal text-[#777]">{visible.length} 条</span></h4><button className={button} disabled={!visible.length} onClick={exportRows}>导出当前建议</button></div>
      <div className="max-h-[650px] overflow-auto"><table className="w-full min-w-[780px] text-xs"><thead className="sticky top-0 z-10 bg-[#F0EFEC] text-left"><tr>{['商品 / PPV','分类 / 处理对象','京东 / 天猫','缺口','行动'].map(title=><th key={title} className="border-b border-[#999] px-3 py-2">{title}</th>)}</tr></thead><tbody>{visible.map(row=>{
        const key=row.ppv+row.type,product=products.get(row.ppv),subsidy=row.type==='补贴竞争力不足';
        const jd=value(product,subsidy?'postJdHandPrice':'recommendJdPrice'),tm=value(product,subsidy?'tmHandPrice':'tmPrice');
        const category=categories.find(item=>item.type===row.type)!;
        return <React.Fragment key={key}><tr className="border-b border-[#141414]/20 hover:bg-[#F8F7F5]"><td className="max-w-[250px] px-3 py-3"><strong>{product?.oldModel||product?.model||row.brand}</strong><p className="mt-1 truncate text-[11px] text-[#777]" title={row.ppv}>{row.ppv}</p><p className="mt-1 text-[11px] text-[#777]">{row.newSeries}</p></td><td className="px-3 py-3"><strong className="inline-block rounded px-2 py-1 text-[11px]" style={{color:category.color,background:category.soft}}>{row.type}</strong><p className="mt-1 text-[11px]">{row.owner}</p></td><td className="whitespace-nowrap px-3 py-3"><p className="text-[10px] text-[#777]">{subsidy?'到手价':'物品价'}</p><p className="mt-1 font-mono"><span style={{color:adviceFields.current}}>{money(jd)}</span><span className="mx-1 text-[#b2b8c1]">/</span><span style={{color:adviceFields.competitor}}>{money(tm)}</span></p></td><td className="min-w-[110px] px-3 py-3"><strong className="font-mono" style={{color:category.color}}>{money(row.gap)} 元</strong><div className="mt-1 h-1 bg-[#F0EFEC]"><div className="h-full" style={{background:category.color,width:`${row.gap/maxGap*100}%`}}/></div>{subsidy&&row.gap===0&&<p className="mt-1 text-[10px] text-[#777]">到手价持平，仍需争取超过</p>}</td><td className="px-3 py-3"><button className="font-bold underline" aria-expanded={expanded===key} onClick={()=>setExpanded(previous=>previous===key?'':key)}> {expanded===key?'收起依据':'查看依据'}</button>{onOpenSnapshot&&<button className="mt-2 block underline text-[#555]" onClick={()=>onOpenSnapshot(batch.id,row.ppv)}>定位快照</button>}</td></tr>{expanded===key&&<tr><td colSpan={5} className="border-b border-[#999] bg-[#F8F7F5] p-3"><AdviceEvidence row={row} batch={batch} action={category.action}/></td></tr>}</React.Fragment>;
      })}</tbody></table>{!visible.length&&<p className="p-8 text-center text-xs text-[#777]">当前筛选下没有待处理建议。</p>}</div></div>
    </div>
  </section>;
}
