import React, {useState} from 'react';
import {ResponsiveContainer,BarChart,Bar,XAxis,YAxis,Tooltip,CartesianGrid,Cell,ReferenceLine,ReferenceArea,LabelList} from 'recharts';
import {adviceTones,adviceFields} from './advicePalette';
import {CircleHelp, ShieldAlert, ShieldCheck} from 'lucide-react';

// Display-only percentages: -1.35 means -1.35%. Business calculations remain upstream.
interface Props {currentRate:number|null;afterRate:number|null;floorRate:number|null;ceiling:number|null}
type Risk='loss'|'warning'|'good'|'unknown';
const fmt=(n:number|null)=>n===null?'待核验':`${n>0?'+':''}${n.toFixed(2)}%`;
const pp=(n:number|null)=>n===null?'待核验':`${Math.abs(n).toFixed(2)} pp`;
function InfoCard({name,text,description,tone='neutral'}:{name:string;text:string;description:string;tone?:string}) {
  return <div className="pr-card"><div className="pr-card-label">{name}</div><div className={`pr-card-number pr-${tone}`}>{text}</div><div className="pr-card-caption">{description}</div></div>;
}
export default function ProfitRateComparison({currentRate,afterRate,floorRate,ceiling}:Props) {
  const [showZones,setShowZones]=useState(true),[showDetails,setShowDetails]=useState(false);
  const [hidden,setHidden]=useState<Record<string,boolean>>({});
  const [hovered,setHovered]=useState<string|null>(null);
  const delta=currentRate!==null&&afterRate!==null?afterRate-currentRate:null;
  const gap=floorRate!==null&&afterRate!==null?floorRate-afterRate:null;
  const short=currentRate!==null&&floorRate!==null?Math.max(0,floorRate-currentRate):null;
  const risk:Risk=afterRate===null?'unknown':afterRate<0?'loss':floorRate===null?'unknown':afterRate<floorRate?'warning':'good';
  const labels={loss:'追平后亏损',warning:'低于利润底线',good:'利润率达标',unknown:'利润待核验'};
  const conclusion={loss:'不建议追价，协调分货+销售。',warning:'是否继续追平，由我方评估利润取舍。',good:'追平后未触及利润底线。',unknown:'规则不足，核验后再决策。'};
  const StatusIcon=risk==='unknown'?CircleHelp:risk==='good'?ShieldCheck:ShieldAlert;
  const all=[0,currentRate??0,afterRate??0,floorRate??0];
  const min=Math.min(-5,Math.floor(Math.min(...all)/5)*5),max=Math.max(5,Math.ceil(Math.max(...all)/5)*5);
  const ticks=Array.from({length:7},(_,i)=>min+(max-min)*i/6);
  const scale=max-min;
  const series=[{key:'current',label:'当前',value:currentRate,y:103,color:adviceFields.current},{key:'after',label:'追平后',value:afterRate,y:171,color:risk==='loss'?adviceTones.loss.color:risk==='warning'?adviceTones.warning.color:risk==='good'?adviceFields.positive:adviceTones.unknown.color}];
  return <section className="pr-panel" aria-label="追价利润率对比">
    <header className="pr-heading"><div><div className="pr-eyebrow">利润评估 / 保存快照</div><h2>追价利润率对比</h2></div><span className={`pr-status pr-status-${risk}`}><StatusIcon size={13}/>{labels[risk]}</span></header>
    <div className="pr-metrics"><InfoCard name="零利润线" text="0.00%" description="盈亏平衡点"/><InfoCard name="利润底线" text={fmt(floorRate)} description="快照保存的利润要求" tone="success"/><InfoCard name="当前利润率" text={fmt(currentRate)} description="已保存报价的边际利润率" tone="current"/><InfoCard name="追平后利润率" text={fmt(afterRate)} description={delta===null?'历史规则不足，待核验':`${delta<0?'↓':delta>0?'↑':'—'} ${pp(delta)} vs 当前`} tone={risk==='loss'?'danger':risk==='warning'?'warning':risk==='unknown'?'unknown':'success'}/></div>
    <div className="pr-toolbar"><div className="pr-hover-readout" aria-live="polite">{hovered||'悬停或聚焦横条查看数值 · 点击图例显隐'}</div><label className="pr-checkbox"><input type="checkbox" checked={showZones} onChange={event=>setShowZones(event.target.checked)}/>显示风险区间</label></div>
    <div className="pr-chart-frame"><div className="pr-chart-scroll" role="img" aria-label={`当前利润率 ${fmt(currentRate)}，追平后 ${fmt(afterRate)}，零利润线 0.00%，利润底线 ${fmt(floorRate)}。`}><div style={{height:180,minWidth:470}}><ResponsiveContainer width="100%" height="100%"><BarChart layout="vertical" data={series.map(item=>({...item,rate:hidden[item.key]?null:item.value}))} margin={{top:23,right:48,left:4,bottom:0}} onMouseMove={state=>{const index=state.activeTooltipIndex;const item=index==null?null:series[Number(index)];setHovered(item&&!hidden[item.key]?`${item.label}：${fmt(item.value)}`:null);}} onMouseLeave={()=>setHovered(null)}>
      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#dfe4e9"/>
      <XAxis type="number" domain={[min,max]} ticks={ticks} tickFormatter={n=>`${Number(Number(n).toFixed(1))}%`} tick={{fontSize:10,fill:'#7b8490'}} stroke="#aab1bb"/>
      <YAxis type="category" dataKey="label" width={54} tick={{fontSize:11,fill:'#2b3441'}} axisLine={false} tickLine={false}/>
      {showZones&&<><ReferenceArea x1={min} x2={0} className="pr-zone-loss" ifOverflow="hidden"/>{floorRate!==null&&floorRate>0&&<ReferenceArea x1={0} x2={floorRate} className="pr-zone-warning"/>} {floorRate!==null&&<ReferenceArea x1={Math.max(0,floorRate)} x2={max} className="pr-zone-good"/>}</>}
      <ReferenceLine x={0} stroke="#95a0ae" strokeWidth={1.5} label={{value:'零利润',position:'insideBottomRight',fontSize:10,fill:'#7b8490'}}/>
      {floorRate!==null&&<ReferenceLine x={floorRate} stroke={adviceFields.floor} strokeWidth={2} strokeDasharray="6 5" label={{value:`底线 ${fmt(floorRate)}`,position:'top',fontSize:10,fill:adviceFields.floor}}/>}
      <Tooltip cursor={{fill:'rgba(20,20,20,0.025)'}} contentStyle={{fontSize:'11px',borderRadius:'0px',border:'1px solid #141414',backgroundColor:'#ffffff'}} labelStyle={{fontWeight:700,color:'#141414'}} formatter={(n)=>[fmt(typeof n==='number'?n:null),'利润率']}/>
      <Bar dataKey="rate" name="利润率" barSize={22} radius={[4,4,4,4]} isAnimationActive={false}>{series.map(item=><Cell key={item.key} fill={item.color}/>)}<LabelList dataKey="rate" position="right" formatter={n=>fmt(typeof n==='number'?n:null)} style={{fontSize:10,fontWeight:600,fill:'#657080'}}/></Bar>
    </BarChart></ResponsiveContainer></div></div><div className="pr-legend">{series.map(item=><button type="button" key={item.key} aria-pressed={!hidden[item.key]} onClick={()=>{setHidden(previous=>({...previous,[item.key]:!previous[item.key]}));setHovered(null);}}><i className="pr-dot" style={{background:item.color}}/>{item.label}利润率</button>)}<span><i className="pr-line"/>利润底线</span></div></div>
    <div className="pr-analysis-cards"><div className="pr-analysis-card"><div className="pr-card-label">追价利润率变化</div><div className={`pr-analysis-big ${delta!==null&&delta<0?'pr-danger':'pr-neutral'}`}>{delta===null?'待核验':`${delta<0?'↓':delta>0?'↑':'—'} ${pp(delta)}`}<span>相对当前</span></div><div className="pr-progress"><div className={delta!==null&&delta<0?'pr-progress-danger':'pr-progress-success'} style={{width:`${delta===null?0:Math.min(100,Math.abs(delta)/scale*100)}%`}}/></div></div><div className="pr-analysis-card"><div className="pr-card-label">{gap===null?'距离利润底线':gap>0?'距离利润底线尚差':'高于或等于利润底线'}</div><div className={`pr-analysis-big ${gap===null?'pr-neutral':gap>0?(risk==='warning'?'pr-warning':'pr-danger'):'pr-success'}`}>{pp(gap)}<span>{gap===null?'待核验':gap>0?'未达标':'已达标'}</span></div><div className="pr-progress"><div className={gap===null?'pr-progress-muted':gap>0?(risk==='warning'?'pr-progress-warning':'pr-progress-danger'):'pr-progress-success'} style={{width:`${gap===null?0:Math.min(100,Math.abs(gap)/scale*100)}%`}}/></div></div></div>
    <div className="pr-recommendation"><div className={`pr-recommendation-icon pr-${risk}`}><StatusIcon size={16}/></div><div className="pr-recommendation-body"><strong>{conclusion[risk]}</strong><p>{short===null?'当前利润或底线待核验':short>0?`当前低于底线 ${short.toFixed(2)}pp`:'当前未低于利润底线'}{delta===null?'':`，追平后${delta<0?'进一步下降':delta>0?'上升':'持平'}${delta===0?'':` ${Math.abs(delta).toFixed(2)}pp`}`}。</p></div></div>
    <div className="pr-footer"><button type="button" className="pr-details-button" aria-expanded={showDetails} onClick={()=>setShowDetails(previous=>!previous)}>{showDetails?'收起':'展开'}计算详情 {showDetails?'▴':'▾'}</button><span className="pr-source-caption">算法最高可报价：{ceiling===null?'待核验':`${ceiling.toLocaleString('zh-CN',{maximumFractionDigits:2})} 元`}</span></div>
    {showDetails&&<div className="pr-details"><div><span>当前 / 追平后</span><strong>{fmt(currentRate)} / {fmt(afterRate)}</strong></div><div><span>利润率变化</span><strong>{delta===null?'待核验':`${delta.toFixed(2)} pp`}</strong></div><div><span>底线缺口（正数未达标）</span><strong>{gap===null?'待核验':`${gap.toFixed(2)} pp`}</strong></div><div><span>判断标准</span><strong>追平后＜0：亏损；否则与快照利润底线比较</strong></div><div><span>数据口径</span><strong>当前边际来自保存快照；追平后沿用原算法测算结果</strong></div></div>}
  </section>;
}
