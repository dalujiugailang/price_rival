import React, { useMemo, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

interface AlternativeMethod {
  id: string; source: string; looRmse: number; forwardRmse: number; looMae?: number;
  peakX?: number | null; parameters?: { m?: number; k?: number; a?: number; amplitude?: number };
  curve?: { x?: number; y?: number; score?: number; difference?: number; slope: number }[];
  leaveOnePeakRange?: number[] | null;
}
export interface AlternativeComparison {
  generatedAt: string; sourceFingerprint: string; periods: number; configurationCount: number; models: AlternativeMethod[];
}
const names: Record<string, string> = {
  constant:'均值基线',median:'中位数基线',linear_increasing:'单调线性',logistic:'原 Logistic',gompertz:'Gompertz',
  smoothing_spline_gcv:'GCV平滑样条',local_adaptive:'局部平滑（内层选带宽）',
  isotonic:'Isotonic 单调回归',increasing_step:'单调阶跃',saturating_hinge:'单调饱和折线',increasing_hinge:'单调双段折线',
  ridge1:'岭线性',ridge2:'岭二次',ridge3:'岭三次',huber_ridge2:'Huber 岭二次',
  huber_logistic:'Huber 稳健曲线',student_t_logistic:'Student-t 稳健曲线',
  precision_mean:'精度加权均值',precision_linear:'精度加权线性',precision_logistic:'精度加权 Logistic',
  random_mean:'随机效应加权均值',random_linear:'随机效应加权线性',random_logistic:'随机效应加权 Logistic',
  gaussian_process_nested:'高斯过程（内层调参）',ridge_time_control:'加入时间项的岭回归',
};
const number = (n?: number) => n == null ? '—' : n.toFixed(2);
const label = (m: AlternativeMethod) => names[m.id] || m.id;

export default function AlternativeModelsPanel({ report }: { report: AlternativeComparison }) {
  const [metric, setMetric] = useState<'looRmse'|'looMae'|'forwardRmse'>('looRmse');
  const [view, setView] = useState<'difference'|'slope'>('difference');
  const student = report.models.find(m => m.id === 'student_t_logistic');
  const original = report.models.find(m => m.id === 'logistic' && m.source === 'original');
  const median = report.models.find(m => m.id === 'median');
  const highlights = ['median','constant','student_t_logistic','random_logistic','logistic'].map(id => report.models.find(m => m.id === id)).filter((m): m is AlternativeMethod => !!m);
  const ranked = useMemo(() => [...report.models].sort((a,b) => (a[metric] ?? Infinity)-(b[metric] ?? Infinity)), [report.models, metric]);
  const curves = useMemo(() => (student?.curve || []).map(p => {
    const x = p.x ?? p.score ?? 0;
    const oldPoint = original?.curve?.reduce((best,q) => Math.abs((q.score ?? q.x ?? 0)-x)<Math.abs((best.score ?? best.x ?? 0)-x) ? q : best, original.curve[0]);
    return { score:x, student: view === 'slope' ? p.slope : p.y ?? p.difference,
      original: oldPoint ? view === 'slope' ? oldPoint.slope : oldPoint.difference ?? oldPoint.y : undefined };
  }), [student, original, view]);
  const table = (models: AlternativeMethod[]) => <div className="overflow-x-auto"><table className="tech-grid-table w-full min-w-[680px] text-left text-xs"><thead className="bg-[#F0EFEC]"><tr>{['模型','整体预测误差 RMSE','时间预测误差 RMSE','日常绝对误差 MAE'].map(h=><th key={h} className="border-y border-black/30 p-3">{h}{h === '模型' ? '' : '（pp）'}</th>)}</tr></thead><tbody>{models.map(m=><tr key={`${m.source}:${m.id}`} className="border-b border-black/15"><td className="p-3 font-bold">{label(m)}</td><td className="p-3 font-mono">{number(m.looRmse)}</td><td className="p-3 font-mono">{number(m.forwardRmse)}</td><td className="p-3 font-mono">{number(m.looMae)}</td></tr>)}</tbody></table></div>;
  return <section className="min-w-0 space-y-4 border border-[#141414] bg-[#F9F9F8] p-5 text-[#141414]">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-bold">替代模型探索 · 70% 与 82% 两档对照</h2><span className="border border-black bg-white px-2 py-1 text-xs">{report.configurationCount} 套设定 · {report.periods} 个完整期</span></div>
    <p className="text-sm font-bold leading-6">先把约70%与82%作为两档验证候选，比较更低竞争力能否获得接近的Y；暂不自动切换全量日常目标。</p>
    <div className="grid gap-4 md:grid-cols-2">
      <div className="min-w-0 border border-black bg-white p-4"><div className="text-xs font-bold">新增候选 · 更贴近日常典型期</div><div className="my-3 font-mono text-3xl font-black">约70%</div><p className="text-xs leading-6">Student-t 稳健曲线的最陡位置约 {number(student?.parameters?.m ?? student?.peakX ?? undefined)}%。两期特别高的Y影响减小，但没有被删除。删一期后约 {student?.leaveOnePeakRange?.[0].toFixed(1)}%—{student?.leaveOnePeakRange?.[1].toFixed(1)}%，位置比原模型更稳定。</p></div>
      <div className="min-w-0 border border-black bg-white p-4"><div className="text-xs font-bold">原候选 · 仍保留作对照</div><div className="my-3 font-mono text-3xl font-black">82%</div><p className="text-xs leading-6">原 Logistic 最陡位置约 {number(original?.parameters?.m ?? original?.peakX ?? undefined)}%；随机效应精度加权模型也给出约82%。不同方法得出不同位置，因此82%不再作为唯一算法答案。</p></div>
    </div>
    <div className="border border-black/25 bg-white p-3 text-xs leading-6"><b>怎么判断：</b>整体留一期预测最好的已变为中位数基线，误差 {number(median?.looRmse)} pp；它不提供竞争力目标。稳健曲线的日常绝对误差更小，但时间预测仍弱于均值基线。69%不是已验证最优点，70%与82%也不是置信区间。</div>
    {table(highlights)}
    <p className="text-xs leading-6 text-black/65">RMSE更重罚大错误；MAE看平均差多少。两者都越小越好。时间预测指用前面的期预测后面的期；不能只挑对自己有利的一项指标宣布胜出。</p>
    <div className="border border-black/25 bg-white p-3"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-xs font-bold">两条曲线为什么给出不同位置</h3><div className="flex gap-2">{(['difference','slope'] as const).map(v=><button type="button" aria-pressed={view===v} key={v} onClick={()=>setView(v)} className={`min-h-11 border border-black px-3 text-xs ${view===v?'bg-black text-white':'bg-white hover:bg-[#F0EFEC]'}`}>{v==='difference'?'看预测Y':'看边际提升'}</button>)}</div></div>
      <div className="mt-3 h-[270px] min-w-0" role="img" aria-label={view==='difference'?'稳健模型与原模型的预测Y对比':'稳健模型与原模型的一阶导数对比'}><ResponsiveContainer width="100%" height="100%"><LineChart data={curves} margin={{top:10,right:15,bottom:10,left:0}}><CartesianGrid stroke="#D8D7D2" strokeDasharray="3 3"/><XAxis type="number" dataKey="score" domain={['dataMin','dataMax']} tick={{fontSize:10}} tickFormatter={v=>`${Number(v).toFixed(0)}%`}/><YAxis width={45} tick={{fontSize:10}}/><Tooltip labelFormatter={v=>`竞争力 ${Number(v).toFixed(1)}%`} formatter={(v,n)=>[Number(v).toFixed(3),n]} contentStyle={{fontSize:11,border:'1px solid black',borderRadius:0}}/><Legend wrapperStyle={{fontSize:11}}/><Line dataKey="student" name="Student-t 稳健曲线" stroke="#141414" dot={false} isAnimationActive={false}/><Line dataKey="original" name="原 Logistic" stroke="#a16207" strokeDasharray="5 4" dot={false} isAnimationActive={false}/></LineChart></ResponsiveContainer></div>
      <p className="text-xs leading-6 text-black/65">X为天猫到手价竞争力；{view==='difference'?'Y为拟合的调整后提交率差值（pp）。':'边际提升表示竞争力每增加1个百分点，拟合Y增加多少pp。'}两种曲线的陡峭度都受到参数约束，不能把尖峰高度理解为已确认收益。</p>
    </div>
    <details className="border-t border-black/25 pt-2"><summary className="min-h-11 cursor-pointer py-3 text-xs font-bold">展开全部25套模型与验证误差</summary><label className="my-3 flex flex-wrap items-center gap-3 text-xs">排序依据<select aria-label="替代模型排序依据" value={metric} onChange={e=>setMetric(e.target.value as typeof metric)} className="min-h-11 max-w-full border border-black bg-white px-3"><option value="looRmse">整体预测误差 RMSE</option><option value="looMae">日常绝对误差 MAE</option><option value="forwardRmse">时间预测误差 RMSE</option></select></label>{table(ranked)}</details>
    <p className="text-xs leading-6 text-black/65">同一批{report.periods}期反复比较模型仍属探索，模型数量增加不等于证据变强。稳健模型降低高残差影响，估计更接近典型期中心；没有改变原始Y，也不是因果检验。生成于 {new Date(report.generatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}。</p>
  </section>;
}
