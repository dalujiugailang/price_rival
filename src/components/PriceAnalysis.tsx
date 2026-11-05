import React, {forwardRef,useMemo,useState} from 'react';
import {AnimatePresence,LayoutGroup,motion,useIsPresent,useReducedMotion} from 'motion/react';
import PriceTimeline from './PriceTimeline';
import DailyAdvicePanel from './DailyAdvicePanel';
import {TrackingBatch} from '../types';
import {BrandPriceChanges, ChangeNumber, PpvPriceChanges} from './PriceComparisonPanels';
import {advice,aggregate,analysisTimeLabel,analysisHierarchy,matchesAnalysisScope,comparisonScope,chronological,indexPpv} from '../utils/priceAnalysis';
import {hasSnapshotDetails} from '../utils/snapshotHistory';
const pct=(n:unknown)=>typeof n==='number'?`${(n*100).toFixed(1)}%`:'—';
const control='inline-flex items-center justify-center gap-1.5 border border-[#141414] bg-white px-3 py-1.5 text-xs font-bold hover:bg-[#E4E3E0] disabled:cursor-not-allowed disabled:opacity-40';
const filterSpring={type:'spring',stiffness:360,damping:36,mass:1} as const;
// Exiting controls leave the layout immediately, but remain visible for their slide-out.
// Keeping the values in PriceAnalysis lets a returning control restore its selection.
const FilterSlot=forwardRef<HTMLDivElement,{children:React.ReactNode;className?:string}>(function FilterSlot({children,className},ref){
 const present=useIsPresent(),reduceMotion=useReducedMotion();
 return <motion.div ref={ref} layout={!reduceMotion} inert={!present} aria-hidden={!present||undefined} className={'min-w-0 '+(className||'')}
   initial={{opacity:0,y:reduceMotion?0:12}} animate={{opacity:1,y:0}} exit={{opacity:0,y:reduceMotion?0:-12}}
   transition={{layout:reduceMotion?{duration:0}:filterSpring,opacity:{duration:reduceMotion?0:.18},y:{duration:reduceMotion?0:.28,ease:[.22,1,.36,1]}}}>
   <motion.div layout={reduceMotion?false:'position'}>{children}</motion.div>
 </motion.div>;
});
function BatchFilterRow({children}:{children:React.ReactNode;key?:string}){
 const present=useIsPresent(),reduceMotion=useReducedMotion();
 return <motion.div inert={!present} aria-hidden={!present||undefined} initial={{height:0,opacity:0,y:reduceMotion?0:12,marginBottom:0}} animate={{height:'auto',opacity:1,y:0,marginBottom:12}} exit={{height:0,opacity:0,y:reduceMotion?0:-12,marginBottom:0}} transition={{duration:reduceMotion?0:.32,ease:[.22,1,.36,1]}} className="relative overflow-hidden">{children}</motion.div>;
}
export default function PriceAnalysis({batches:all,onOpenSnapshot}:{batches:TrackingBatch[];onOpenSnapshot?:(batchId:string,ppv:string)=>void}){
 const batches=useMemo(()=>chronological(all.filter(b=>(b.channelId||'tradeIn')==='tradeIn'&&hasSnapshotDetails(b))),[all]);
 const [view,setView]=useState('compare'),[aId,setA]=useState(''),[bId,setB]=useState(''),[brand,setBrand]=useState(''),[series,setSeries]=useState('');
 const b=batches.find(b=>b.id===bId)||batches.at(-1);
 const defaultA=useMemo(()=>{
   if(!b)return undefined;
   const keys=indexPpv(b).rows;
   let best=b, bestScore=-1;
   for(let i=batches.length-1;i>=0;i--){const candidate=batches[i];if(candidate===b)continue;
     let score=0;for(const ppv of indexPpv(candidate).rows.keys())if(keys.has(ppv))score++;
     if(score>bestScore){best=candidate;bestScore=score;}
   }
   return best;
 },[b,batches]);
 const a=batches.find(b=>b.id===aId)||defaultA;
 const [limit,setLimit]=useState(50),[presence,setPresence]=useState('common'),[timelineBatchId,setTimelineBatchId]=useState(''),[timelineSearch,setTimelineSearch]=useState('');
 const comparison=useMemo(()=>view==='compare'&&a&&b?comparisonScope(a,b):null,[view,a,b]);
 const compare=comparison?.rows||[];
 const groupBatches=useMemo(()=>view==='advice'?(b?[b]:[]):view==='compare'?(comparison?.batches||[]):batches,[view,b,comparison,batches]);
 const hierarchy=useMemo(()=>analysisHierarchy(groupBatches),[groupBatches]);
 const brands=useMemo(()=>[...hierarchy.keys()],[hierarchy]);
 const selectedBrand=hierarchy.has(brand)?brand:'';
 const seriesOptions=hierarchy.get(selectedBrand)||[];
 const selectedSeries=seriesOptions.includes(series)?series:'';
 const changeBrand=(next:string)=>{setBrand(next);setSeries('');setLimit(50);};
 const matches=(p:Parameters<typeof matchesAnalysisScope>[0])=>matchesAnalysisScope(p,selectedBrand,selectedSeries);
 const filtered=compare.filter(r=>matches((r.a||r.b)!));
 const summary=useMemo(()=>aggregate(view==='compare'?groupBatches:[],selectedBrand,selectedSeries),[view,groupBatches,selectedBrand,selectedSeries]);
 const brandGroups=useMemo(()=>view!=='compare'?[]:(selectedBrand?[selectedBrand]:['',...brands]).map(br=>({br,agg:br===selectedBrand?summary:aggregate(groupBatches,br,selectedSeries)})),[view,selectedBrand,selectedSeries,brands,groupBatches,summary]);
 const selector=(id:string,onChange:(id:string)=>void,label:string,disabled=false)=><label className="flex min-w-0 items-center gap-2 text-xs"><span className="shrink-0 font-bold">{label}</span><select aria-label={label} className={control+' min-w-0 w-full flex-1'} value={id} disabled={disabled} title={disabled?'当前视图不使用此筛选':undefined} onChange={e=>onChange(e.target.value)}>{batches.map(batch=><option key={batch.id} value={batch.id}>{analysisTimeLabel(batch)} · {batch.batchType==='launch'?'发新期':'常规/未分类'} · {batch.remarks||batch.id}</option>)}</select></label>;
 const adviceRows=useMemo(()=>view==='advice'&&b?advice(b):[],[view,b]);
 if(!batches.length||!a||!b)return <div className="p-8">暂无包含 PPV 明细的京东换新快照，无法分析。</div>;
 const warnings=groupBatches.map(b=>({b,i:indexPpv(b)})).filter(({i})=>i.conflicts.size||i.missing);
 return <section className="min-w-0 space-y-4" aria-label="价格分析">
 <div className="flex flex-wrap gap-2 border border-[#141414] bg-[#F0EFEC] px-4 py-3">{[['compare','两期对比'],['trend','价格时序'],['advice','日报建议']].map(([id,label])=><button key={id} aria-pressed={view===id} className={`${control} ${view===id?'!bg-[#141414] text-white':''}`} onClick={()=>setView(id)}>{label}</button>)}</div>
 <LayoutGroup>
 <div className="border border-[#141414] bg-white px-4 py-3" aria-label="价格分析统一筛选">
   <AnimatePresence initial={false}>
     {view!=='trend'&&<BatchFilterRow key="batch-row">
       <div className="relative flex flex-wrap items-center gap-3" aria-label="分析批次选择">
         <AnimatePresence initial={false} mode="popLayout">
           {view==='compare'&&<FilterSlot key="comparison-batch" className="basis-[280px] grow">{selector(a.id,setA,'对比期',view!=='compare')}</FilterSlot>}
           <FilterSlot key="baseline-batch" className="basis-[280px] grow">{selector(b.id,setB,view==='advice'?'建议批次':'基准期',view==='trend')}</FilterSlot>
           {view==='compare'&&<FilterSlot key="swap"><button className={control} disabled={view!=='compare'} onClick={()=>{setA(b.id);setB(a.id);}}>互换</button></FilterSlot>}
         </AnimatePresence>
       </div>
     </BatchFilterRow>}
   </AnimatePresence>
   <div className="relative flex min-h-8 flex-wrap items-center gap-3" aria-label="分析范围筛选">
     <AnimatePresence initial={false} mode="popLayout">
     <FilterSlot key="brand" className="w-[180px] max-w-full"><label className="flex min-w-0 items-center gap-2 text-xs"><span className="shrink-0 font-bold">品牌</span><select aria-label="价格分析品牌" className={control+' min-w-0 w-full flex-1'} value={selectedBrand} onChange={e=>changeBrand(e.target.value)}><option value="">全部品牌</option>{brands.map(name=><option key={name} value={name}>{name}</option>)}</select></label></FilterSlot>
     <FilterSlot key="series" className="w-[240px] max-w-full"><label className="flex min-w-0 items-center gap-2 text-xs"><span className="shrink-0 font-bold">新机系列</span><select aria-label="价格分析新机系列" className={control+' min-w-0 w-full flex-1'} disabled={!selectedBrand} value={selectedSeries} onChange={e=>{setSeries(e.target.value);setLimit(50);}}><option value="">{selectedBrand?'全部新机系列':'请先选择品牌'}</option>{seriesOptions.map(name=><option key={name} value={name}>{name}</option>)}</select></label></FilterSlot>
     {view==='compare'&&<FilterSlot key="presence" className="w-[200px] max-w-full"><label className="flex min-w-0 items-center gap-2 text-xs"><span className="shrink-0 font-bold">匹配范围</span><select aria-label="PPV匹配范围" className={control+' min-w-0 w-full flex-1'} disabled={view!=='compare'} title={view!=='compare'?'仅两期对比使用匹配范围':undefined} value={presence} onChange={e=>{setPresence(e.target.value);setLimit(50);}}><option value="common">两期共有</option><option value="all">全部 PPV</option><option value="added">对比期新增</option><option value="removed">对比期未包含</option></select></label></FilterSlot>}
     {view==='trend'&&<FilterSlot key="timeline-batch" className="w-[320px] max-w-full"><label className="flex min-w-0 items-center gap-2 text-xs"><span className="shrink-0 font-bold">时序批次</span><select aria-label="时序PPV所属批次" className={control+' min-w-0 w-full flex-1'} disabled={view!=='trend'} title={view!=='trend'?'仅价格时序按所属批次筛选 PPV':undefined} value={timelineBatchId} onChange={e=>setTimelineBatchId(e.target.value)}><option value="">全部历史 PPV</option>{batches.map(batch=><option key={batch.id} value={batch.id}>{analysisTimeLabel(batch)} · {batch.remarks||batch.id}</option>)}</select></label></FilterSlot>}
     {view==='trend'&&<FilterSlot key="search" className="w-[240px] max-w-full"><label className="flex min-w-0 items-center gap-2 text-xs"><span className="shrink-0 font-bold">搜索</span><input type="search" aria-label="搜索时序PPV" className={control+' min-w-0 w-full flex-1 font-normal'} disabled={view!=='trend'} title={view!=='trend'?'仅价格时序使用 PPV 搜索':undefined} placeholder="PPV / 旧机型号" value={timelineSearch} onChange={e=>setTimelineSearch(e.target.value)}/></label></FilterSlot>}
     </AnimatePresence>
   </div>
   <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-[#777]"><p>仅显示当前视图适用的筛选项；切换后保留已选条件。</p>{view==='compare'&&<details className="relative shrink-0"><summary aria-label="两期对比统计口径说明" title="统计口径说明" className="flex h-5 w-5 cursor-pointer list-none items-center justify-center rounded-full border border-[#777] text-xs font-bold text-[#555] [&::-webkit-details-marker]:hidden">?</summary><div className="absolute right-0 top-full z-30 mt-2 w-[min(520px,75vw)] border border-[#141414] bg-white p-3 text-xs font-normal leading-relaxed shadow-md">固定样本 {summary.count} 个 PPV · 基准期报价量覆盖率 {pct(summary.coverage)}。七项指标及全部所选批次共同有效、基准报价量大于 0 才进入品牌指数；品牌按基准期归属。品牌、新机系列均按基准期归属，筛选同步作用于汇总和明细。
 <p className="mt-2">共有 {filtered.filter(r=>r.a&&r.b).length} · 对比期新增 {filtered.filter(r=>!r.a).length} · 对比期未包含 {filtered.filter(r=>!r.b).length}。差额＝对比期－基准期；报价量取基准期。</p></div></details>}</div>
 </div>
 </LayoutGroup>
 <p className="text-xs text-[#555]">全部已保存快照 · 历史只读 · 完整 PPV 匹配 · 报价越高竞争力越强 · 上涨绿色 / 下降红色（时序蓝色京东 / 橙色天猫）。无明细快照 {all.filter(b=>!hasSnapshotDetails(b)).length} 份不参与分析。</p>
 {warnings.length>0&&<details className="border border-[#141414] bg-white px-4 py-3 text-xs"><summary className="cursor-pointer text-amber-800">数据检查：{warnings.length} 份快照存在重复或空 PPV，已排除冲突行（展开查看）</summary><div className="mt-2 space-y-2">{warnings.map(({b,i})=><p key={b.id} className="text-[#555]">{b.id}：重复 PPV {i.conflicts.size} 个（已排除），空 PPV {i.missing} 行。</p>)}</div></details>}
 {view==='compare'&&<>

 <div className="grid gap-3 lg:grid-cols-2">{[['itemWin','物品价竞争力'],['handWin','到手价竞争力']].map(([key,label])=>{const first=summary.points[0]?.[key],last=summary.points.at(-1)?.[key];return <div className="border border-[#141414] bg-white p-3" key={key}><strong>{label}</strong><p><span className="text-xs text-[#777]">{pct(first)} → {pct(last)}</span><span className="ml-3 text-sm"><ChangeNumber delta={typeof first==='number'&&typeof last==='number'?(last-first)*100:null} suffix="个百分点"/></span></p></div>})}</div>
 {summary.count===0&&<p className="text-amber-800 text-xs">所选批次没有共同有效样本，指数不可计算；可调整对比批次，PPV 明细仍可查看。</p>}
 <BrandPriceChanges groups={brandGroups} onBrand={changeBrand}/>

 </>}
 {view==='compare'&&<PpvPriceChanges rows={filtered} presence={presence} limit={limit} onMore={()=>setLimit(n=>n+50)}/>}
 {view==='trend'&&<div key={JSON.stringify([selectedBrand,selectedSeries,timelineBatchId,timelineSearch])}><PriceTimeline batches={batches} brand={selectedBrand} newSeries={selectedSeries} batchId={timelineBatchId} search={timelineSearch} onOpenSnapshot={onOpenSnapshot}/></div>}
 {view==='advice'&&<div key={JSON.stringify([b.id,selectedBrand,selectedSeries])}><DailyAdvicePanel rows={adviceRows.filter(r=>matches(r))} batch={b} onOpenSnapshot={onOpenSnapshot}/></div>}
 </section>;
}
