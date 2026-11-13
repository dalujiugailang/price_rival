import React, { useMemo, useState } from 'react';
import { BarChart3, ChevronDown, Download } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TrackingBatch } from '../types';
import { buildEfficiencyPeriods } from '../utils/competitionEfficiency';
import EfficiencyInteractiveChart from './EfficiencyInteractiveChart';
import MarginalUtilityPanel, { type MarginalExploration } from './MarginalUtilityPanel';

interface Stratum {
  band: string; weight: number; competitionQuotes: number; competitionSubmissions: number;
  controlQuotes: number; controlSubmissions: number; difference: number;
}
export interface Period {
  batchId: string; start: string; end: string; days: number; score: number; difference: number;
  competitionQuotes: number; competitionSubmissions: number; controlQuotes: number; controlSubmissions: number;
  competitionRate: number; controlRate: number; comparisonCoverage: number; strata: Stratum[];
  involvedModels: number; analysisModels: number; excludedActivityModels: number; excludedActivityQuotes: number;
  excludedBandQuotes: number; modelMatchRate: number; priceCoverage: number; snapshotScore?: number;
}
export interface EfficiencyDataset {
  analysisWindow?: { start: string; end: string; mode: string; completePeriodsOnly: boolean };
  snapshotAudit?: { id: string; type: string; summaryOnly: boolean; included: boolean; createdAt: string; originalPricingTime?: string; reason: string }[];
  marginalExploration?: MarginalExploration;
  modelEvaluation?: {
    periodCount: number; candidatePeak: number | null; recommendedTarget: number | null;
    candidatePredictedY: number | null; leaveOneOutPeakRange: number[];
    models: { id: string; rSquared: number; looRmse: number | null; forwardRmse: number | null }[];
    equation: { intercept: number; linear: number; quadratic: number };
    curve: { score: number; difference: number; slope: number }[];
  };
  version: string; generatedAt: string; flowMinDate: string; flowMaxDate: string; latestSnapshotSavedAt: string;
  scope: string; grouping: string; commonStrataCount: number; launchModelCount: number; sourceRowCount: number;
  sourceQuotes: number; sourceSubmissions: number; launchExclusion: string; caveats: string[];
  periods: Period[]; excludedPeriods: { batchId: string; reason: string; start?: string; end?: string }[];
}
const pct = (n: number) => `${n.toFixed(1)}%`;
const pp = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)} pp`;
const number = (n: number) => n.toLocaleString('zh-CN');

export default function CompetitionEfficiencyResults({ data, historyBatches }: { data: EfficiencyDataset; historyBatches: TrackingBatch[] }) {
  const [range, setRange] = useState('all');
  const [selectedId, setSelectedId] = useState(data.periods.at(-1)?.batchId);
  const periods = range === 'recent' ? data.periods.slice(-8) : data.periods;
  const selected = periods.find(p => p.batchId === selectedId) || periods.at(-1);
  const model = data.modelEvaluation;
  const raw = useMemo(() => new Map(buildEfficiencyPeriods(historyBatches).periods.map(p => [p.batch.id, p])), [historyBatches]);
  const exportData = () => {
    const rows = [['快照ID', '开始日期', '结束日期', '分析样本天猫到手价竞争力%', '调整后报价提交率差值pp', '竞争组报价量', '竞争组提交量', '对照组报价量', '对照组提交量', '共同分层覆盖率%'],
      ...periods.map(p => [p.batchId, p.start, p.end, p.score, p.difference, p.competitionQuotes, p.competitionSubmissions, p.controlQuotes, p.controlSubmissions, p.comparisonCoverage])];
    const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = '竞争效率_型号观察差值.csv'; a.click(); URL.revokeObjectURL(url);
  };
  return <div className="border border-[#141414] bg-white p-6 space-y-6 text-[#141414]">
    <div className="-mx-6 -mt-6 flex flex-wrap items-center justify-between gap-4 border-b border-[#141414] bg-[#F0EFEC] p-5">
      <div><h1 className="flex items-center gap-2 text-base font-bold"><BarChart3 size={20} />京东换新竞争投入效率</h1>
        <p className="mt-1 text-xs leading-5 text-black/70">天猫到手价竞争力 × 调整后报价提交率差值 · 当期追价涉及型号的同期观察</p></div>
      <button type="button" onClick={exportData} className="flex min-h-11 items-center gap-2 border border-[#141414] bg-[#141414] px-3 text-xs font-bold text-white hover:bg-[#333] active:translate-y-px"><Download size={15} />导出分析结果</button>
    </div>
    <div className="flex flex-wrap items-end gap-4 border border-[#141414] bg-[#F9F9F8] p-4 text-xs">
      <div><div className="mb-2 font-bold">分析范围</div><div>{data.scope} · 普通追价</div></div>
      <label><span className="mb-1 block text-black/65">展示范围</span><select className="min-h-11 border border-[#141414] bg-white px-3" value={range} onChange={e => setRange(e.target.value)}><option value="all">近两个月 · {data.periods.length} 个完整期</option><option value="recent">最近 8 个完整期</option></select></label>
      <div className="leading-6 text-black/65">分析窗口 {data.analysisWindow?.start || data.flowMinDate} — {data.analysisWindow?.end || data.flowMaxDate}<br />云端快照截至 {new Date(data.latestSnapshotSavedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</div>
      <div className="leading-6 text-black/65">保存次日至下次保存当天<br />各期按当期实际竞争报价量加权，切换仅影响展示</div>
    </div>
    <div className="border border-amber-700/40 bg-amber-50 px-4 py-3 text-xs leading-6 text-amber-950">按已确认的“追价涉及型号”划竞争组，未覆盖型号作对照；不是精确 SKU 曝光效果。新品活动按保存次日起连续3天处理；只有与活动窗重叠的常规期，才从两组与 X 排除对应型号，其他期保留。X 为当期分析样本竞争力。价位段沿用提交A等级价位段。</div>
    <div className="grid gap-4 sm:grid-cols-3">{[
      ['近两个月完整覆盖期', `${data.periods.length} 期`, `${data.periods[0]?.start} 至 ${data.periods.at(-1)?.end}`],
      ['当期可比分层', `${selected?.strata.length ?? 0} 层`, '同渠道 × 回收类型 × 提交A等级价位段'],
      ['最新完整期调整后差值', selected ? pp(selected.difference) : '—', selected ? `所选期 ${selected.start} — ${selected.end}` : ''],
    ].map(([title, value, note], i) => <div className="border border-[#141414] bg-[#F9F9F8] p-4" key={title}><div className="text-xs font-bold">{i === 2 ? '所选期调整后差值' : title}</div><div className="my-3 font-mono text-2xl font-black">{value}</div><div className="text-xs leading-5 text-black/60">{note}</div></div>)}</div>
    <EfficiencyInteractiveChart periods={periods} selected={selected} onSelect={setSelectedId} model={data.marginalExploration ? { curve: data.marginalExploration.methods.find(m => m.id === (data.marginalExploration.businessRecommendation?.methodId || 'smoothing_spline_gcv'))?.curve || [] } : model} />
    {data.marginalExploration && <MarginalUtilityPanel result={data.marginalExploration} />}
    {model && !data.marginalExploration && <section className="border border-[#141414] bg-[#F9F9F8] p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-bold">日常目标建模与导数检验</h2><span className="border border-amber-700 bg-amber-50 px-2 py-1 text-xs font-bold text-amber-900">暂未形成可靠执行目标</span></div>
      <div className="grid gap-4 md:grid-cols-2"><div className="border border-[#141414] bg-white p-4"><div className="text-xs font-bold">二次模型的一阶导数零点 · 数学候选</div><div className="my-3 font-mono text-2xl font-black">{model.candidatePeak?.toFixed(1)}%</div><p className="text-xs leading-6 text-black/70">预测 Y 为 {model.candidatePredictedY?.toFixed(2)} pp；不能据此直接把日常竞争力锁定到该点。逐期删去一个观测后，候选峰值在 {model.leaveOneOutPeakRange[0].toFixed(1)}%—{model.leaveOneOutPeakRange[1].toFixed(1)}% 之间变化。</p></div><div className="border border-[#141414] bg-white p-4"><div className="text-xs font-bold">日常投入建议</div><p className="mt-3 text-sm font-bold">把约85%作为待验证候选，不作自动执行目标</p><p className="mt-2 text-xs leading-6 text-black/70">四个模型中，均值基线的留一期及按时间留后检验误差更低。可围绕候选值设置80%、85%、90%的对照测试，并同步记录实际竞争费用；不能从当前曲线确认收益峰值或成本最优点。</p></div></div>
      <div className="overflow-x-auto"><table className="tech-grid-table w-full min-w-[600px] text-left text-xs"><thead className="bg-[#F0EFEC]"><tr>{['候选模型','样本内 R²','留一期验证误差（pp）','顺序留后误差（pp）'].map(t => <th key={t} className="border-y border-[#141414] p-3">{t}</th>)}</tr></thead><tbody>{model.models.map(m => <tr key={m.id}><td className="p-3 font-bold">{{constant:'均值基线',linear:'线性',quadratic:'二次曲线',saturation:'饱和曲线'}[m.id]}</td><td className="p-3 font-mono">{m.rSquared.toFixed(3)}</td><td className="p-3 font-mono">{m.looRmse?.toFixed(2) ?? '拟合失败'}</td><td className="p-3 font-mono">{m.forwardRmse?.toFixed(2) ?? '拟合失败'}</td></tr>)}</tbody></table></div>
      <div className="text-xs leading-6"><p>探索模型：z = (X − 80) / 10；Ŷ = {model.equation.intercept.toFixed(4)} + {model.equation.linear.toFixed(4)}z − {Math.abs(model.equation.quadratic).toFixed(4)}z²。</p><p>一阶导数：dŶ/dX = ({model.equation.linear.toFixed(4)} − {Math.abs(2*model.equation.quadratic).toFixed(4)}z) / 10。单位为“每增加1个百分点竞争力，Y变化多少pp”。</p></div>
      <div className="h-[230px] w-full" role="img" aria-label="二次探索模型的一阶导数曲线，约84.7%穿过零线，该模型尚未通过预测检验"><ResponsiveContainer width="100%" height="100%"><LineChart data={model.curve} margin={{top:15,right:25,bottom:25,left:15}}><CartesianGrid strokeDasharray="3 3" stroke="#D8D7D2"/><XAxis type="number" dataKey="score" domain={['dataMin','dataMax']} tick={{fontSize:11}} tickFormatter={v=>`${Number(v).toFixed(0)}%`} label={{value:'天猫到手价竞争力（分析样本）',position:'bottom',offset:8,fontSize:11}}/><YAxis tick={{fontSize:11}} width={55}/><ReferenceLine y={0} stroke="#141414" strokeDasharray="4 4"/><Tooltip formatter={value=>[Number(value).toFixed(3),'Y的边际变化（pp / 竞争力百分点）']} labelFormatter={v=>`竞争力 ${Number(v).toFixed(1)}%`} contentStyle={{fontSize:11,border:'1px solid #141414',borderRadius:0}}/><Line type="linear" dataKey="slope" stroke="#a16207" dot={false} strokeWidth={2} isAnimationActive={false}/></LineChart></ResponsiveContainer></div>
      <p className="text-xs leading-6 text-black/65">一阶导数为0且二阶导数为负，表示Y的局部峰值；边际提升最大看一阶导数最大，通常对应二阶导数过零。真正的投入最优需要新增收益等于新增成本，当前X不是投入金额。两类检验均以本版各期实际报价权重后的Y为条件，不是独立未来验证。仅14期，不能视为因果结论。</p>
    </section>}
    <section className="min-w-0 border border-[#141414] bg-[#F9F9F8]"><div className="flex flex-wrap justify-between gap-2 p-4"><h2 className="text-sm font-bold">完整覆盖期明细</h2><span className="text-xs text-black/60">点击期别查看样本与分层贡献</span></div>
      <div className="overflow-x-auto"><table className="tech-grid-table w-full min-w-[1040px] text-left text-xs"><thead className="border-y border-[#141414] bg-[#F0EFEC]"><tr>{['覆盖期', '分析样本 X', '快照全覆盖 X', '调整后差值 Y', '竞争报价 / 提交', '对照报价 / 提交', '分层覆盖率', '分析型号'].map(t => <th className="px-3 py-3" key={t}>{t}</th>)}</tr></thead><tbody>{[...periods].reverse().map(p => <tr key={p.batchId} className={selected?.batchId === p.batchId ? 'bg-[#E4E3E0]' : 'hover:bg-[#F0EFEC]'}><td className="px-3"><button aria-pressed={selected?.batchId === p.batchId} onClick={() => setSelectedId(p.batchId)} type="button" className="min-h-11 whitespace-nowrap text-left font-bold underline underline-offset-4">{p.start} — {p.end}<span className="ml-2 font-normal">{p.days}天</span></button></td><td className="px-3 font-mono font-bold">{pct(p.score)}</td><td className="px-3 font-mono text-black/60">{p.snapshotScore != null ? pct(p.snapshotScore) : raw.get(p.batchId)?.score != null ? pct(raw.get(p.batchId)!.score!) : '—'}</td><td className="px-3 font-mono font-bold">{pp(p.difference)}</td><td className="px-3 font-mono">{number(p.competitionQuotes)} / {number(p.competitionSubmissions)}</td><td className="px-3 font-mono">{number(p.controlQuotes)} / {number(p.controlSubmissions)}</td><td className="px-3">{pct(p.comparisonCoverage)}</td><td className="px-3">{p.analysisModels} / {p.involvedModels}</td></tr>)}</tbody></table></div>
    </section>
    {selected && <section className="border border-[#141414] bg-[#F9F9F8] p-4"><h2 className="mb-3 break-all text-sm font-bold">所选期分层依据 · {selected.batchId}</h2><div className="mb-4 grid gap-3 text-xs leading-6 md:grid-cols-2"><p>竞争组原始提交率 {pct(selected.competitionRate)}；对照组 {pct(selected.controlRate)}。上述比率未经分层调整，不直接相减作为 Y。</p><p>型号匹配率 {pct(selected.modelMatchRate)}；剔除活动型号 {selected.excludedActivityModels} 个。两组共排除活动报价 {number(selected.excludedActivityQuotes)} 次、缺失档位报价 {number(selected.excludedBandQuotes)} 次。</p></div>
      <p className="mb-3 border border-black/20 bg-white p-3 text-xs leading-6">当期权重 = 该提交A等级价位段的竞争组报价量 ÷ 本期所有可比价位段的竞争组报价总量。每一期重新计算，不固定跨期权重；当期没有对照报价的档位不补零，并列入覆盖率说明。</p>
      <div className="overflow-x-auto"><table className="tech-grid-table w-full min-w-[650px] text-left text-xs"><thead className="bg-[#F0EFEC]"><tr>{['提交A等级价位段','当期报价权重','竞争报价 / 提交','对照报价 / 提交','层内差值','加权贡献'].map(t => <th className="border-y border-[#141414] p-2" key={t}>{t}</th>)}</tr></thead><tbody>{selected.strata.map(s => <tr key={s.band}><td className="p-2">{s.band}</td><td className="p-2">{pct(100*s.weight)}</td><td className="p-2">{number(s.competitionQuotes)} / {number(s.competitionSubmissions)}</td><td className="p-2">{number(s.controlQuotes)} / {number(s.controlSubmissions)}</td><td className="p-2">{pp(s.difference)}</td><td className="p-2">{pp(s.weight*s.difference)}</td></tr>)}</tbody></table></div>
    </section>}
    {data.snapshotAudit && <details className="border border-[#141414] p-4"><summary className="min-h-11 cursor-pointer text-sm font-bold">全部历史快照纳入清单 · {data.snapshotAudit.length}份已检查，{data.periods.length}个完整期</summary><p className="my-3 text-xs leading-6 text-black/65">早期恢复记录使用其原追价日期；没有单独覆盖名单的旧快照，以保存的追价明细型号还原，属于历史代理口径。历史重复PPV按原快照测算行保留计算，未按文本去重。仅汇总记录不能还原分组，不用于Y。</p><div className="overflow-x-auto"><table className="tech-grid-table w-full min-w-[760px] text-left text-xs"><thead className="bg-[#F0EFEC]"><tr>{['快照ID','保存日期（北京）','原追价日期','纳入情况'].map(t=><th key={t} className="border-y border-[#141414] p-2">{t}</th>)}</tr></thead><tbody>{data.snapshotAudit.map(s=><tr key={s.id}><td className="p-2 font-mono">{s.id}</td><td className="p-2">{new Date(s.createdAt).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'})}</td><td className="p-2">{s.originalPricingTime?.slice(0,10) || '—'}</td><td className="p-2">{s.reason}</td></tr>)}</tbody></table></div></details>}
    <details className="border border-[#141414] p-4"><summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm font-bold">口径、排除范围与数据来源<ChevronDown size={16} /></summary><div className="mt-3 space-y-2 text-xs leading-6 text-black/70"><p>来源：云端追价快照表（只读下载，合并本地）；操盘系统正式手机 DuckDB 的 runtime_flow_records。取数 {number(data.sourceRowCount)} 行，报价 {number(data.sourceQuotes)} 次、提交 {number(data.sourceSubmissions)} 次；以上为排除前来源总量。</p><p>每期分别筛选两组都有报价的可比分层，并按当期竞争组实际报价量占比计算权重。Y = Σ 当期报价权重 ×（竞争组提交率 − 对照组提交率）×100；比率先汇总分子分母再相除。</p><p>{data.launchExclusion}。排除型号见本地映射审计；按常规覆盖期整期排除相交活动涉及型号，不跨期永久排除。</p>{data.caveats.map(c => <p key={c}>{c}。</p>)}<p>未纳入：{data.excludedPeriods.map(p => `${p.start || p.batchId}：${p.reason}`).join('；')}。</p><p className="break-all">分析版本：{data.version}；生成时间 {new Date(data.generatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}。刷新快照后须重新取数计算，当前结果不会自动扩大日期范围。</p></div></details>
  </div>;
}
