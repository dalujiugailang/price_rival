import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts';
import type { EfficiencyDataset, Period } from './CompetitionEfficiencyResults';

const pct = (n: number) => `${n.toFixed(1)}%`;
const pp = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)} pp`;
const control = 'min-h-11 border border-[#141414] px-3 text-xs font-bold transition-colors hover:bg-[#E4E3E0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-35';

export default function EfficiencyInteractiveChart({ periods, selected, onSelect, model }: {
  periods: Period[]; selected?: Period; onSelect: (id: string) => void; model?: Pick<NonNullable<EfficiencyDataset['modelEvaluation']>, 'curve'>;
}) {
  const [fullRange, setFullRange] = useState(false);
  const [showCurve, setShowCurve] = useState(true);
  const [showDates, setShowDates] = useState(false);
  const index = periods.findIndex(p => p.batchId === selected?.batchId);
  const previous = periods[index - 1];
  const min = Math.min(...periods.map(p => p.score));
  const max = Math.max(...periods.map(p => p.score));
  const xDomain: [number, number] = fullRange ? [0, 100] : [Math.max(0, Math.floor(min - 2)), Math.min(100, Math.ceil(max + 2))];
  const minY = Math.min(0, ...periods.map(p => p.difference));
  const maxY = Math.max(0, ...periods.map(p => p.difference));
  const yPad = Math.max(1, (maxY - minY) * .12);
  return <section className="min-w-0 border border-[#141414] bg-[#F9F9F8] p-4 md:p-5" aria-labelledby="efficiency-interactive-title">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 id="efficiency-interactive-title" className="text-sm font-bold">竞争力与报价提交表现</h2><p className="mt-1 text-xs text-black/60">点击数据点选中期别，与下方明细联动；红色为当前选中期。</p></div>
      <div className="flex flex-wrap gap-2"><button type="button" aria-pressed={!fullRange} onClick={() => setFullRange(false)} className={`${control} ${!fullRange ? 'bg-[#141414] text-white hover:bg-[#333]' : 'bg-white'}`}>聚焦数据</button><button type="button" aria-pressed={fullRange} onClick={() => setFullRange(true)} className={`${control} ${fullRange ? 'bg-[#141414] text-white hover:bg-[#333]' : 'bg-white'}`}>0–100% 全范围</button></div>
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-y border-black/20 py-2 text-xs"><label className="flex min-h-11 cursor-pointer items-center gap-2"><input type="checkbox" checked={showCurve} disabled={!model} onChange={e => setShowCurve(e.target.checked)} className="h-4 w-4 accent-black" />显示探索曲线（未验证）</label><label className="flex min-h-11 cursor-pointer items-center gap-2"><input type="checkbox" checked={showDates} onChange={e => setShowDates(e.target.checked)} className="h-4 w-4 accent-black" />显示各期日期</label><span className="ml-auto text-black/60">X 轴 {xDomain[0]}%–{xDomain[1]}% · 仅调整视图，不重算数据</span></div>
    <div className="mt-4 grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_245px]">
      <div className="min-w-0"><div className="h-[350px] w-full md:h-[390px]" aria-label="可交互期别散点图，数据点可点击或通过键盘选择">
        <ResponsiveContainer width="100%" height="100%"><ScatterChart margin={{ top: 26, right: 25, bottom: 30, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#D8D7D2" />
          <XAxis type="number" dataKey="score" domain={xDomain} allowDataOverflow tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} label={{ value: '天猫到手价竞争力（分析样本，%）', position: 'bottom', offset: 12, fontSize: 11 }} />
          <YAxis type="number" dataKey="difference" domain={[Math.floor(minY-yPad), Math.ceil(maxY+yPad)]} tick={{ fontSize: 11 }} tickFormatter={v => `${v} pp`} width={58} />
          <ReferenceLine y={0} stroke="#141414" strokeDasharray="4 4" />
          {selected && <ReferenceLine x={selected.score} stroke="#b91c1c" strokeOpacity={.35} strokeDasharray="3 3" />}
          <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ active, payload }) => {
            const p = payload?.[0]?.payload as Period;
            return active && p ? <div className="max-w-[260px] border border-[#141414] bg-white p-3 text-xs leading-6"><b>{p.batchId ? `${p.start} — ${p.end}` : '探索曲线（未验证）'}</b><div>竞争力：{pct(p.score)}</div><div>{p.batchId ? '实际差值' : '预测差值'}：{pp(p.difference)}</div>{p.batchId && <div className="text-black/60">点击选中，查看样本与分层</div>}</div> : null;
          }} />
          {showCurve && model && <Scatter name="探索曲线（未验证）" data={model.curve} line={{ stroke: '#a16207', strokeDasharray: '5 5' }} shape={() => null} isAnimationActive={false} />}
          <Scatter name="完整覆盖期" data={periods} isAnimationActive={false} shape={(props: any) => {
            const p = props.payload as Period;
            const active = selected?.batchId === p.batchId;
            const right = p.score > (xDomain[0]+xDomain[1])/2;
            return <g role="button" tabIndex={0} aria-pressed={active} aria-label={`选择 ${p.start} 至 ${p.end}，竞争力 ${pct(p.score)}，差值 ${pp(p.difference)}`} onClick={() => onSelect(p.batchId)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(p.batchId); } }} className="cursor-pointer outline-none focus-visible:stroke-black focus-visible:stroke-2">
              <circle cx={props.cx} cy={props.cy} r={14} fill="transparent" />
              {active && <circle cx={props.cx} cy={props.cy} r={10} fill="none" stroke="#b91c1c" strokeOpacity={.35} />}
              <circle cx={props.cx} cy={props.cy} r={active ? 6 : 4.5} fill={active ? '#b91c1c' : '#141414'} stroke="#F9F9F8" strokeWidth={1} />
              {(active || showDates) && <text x={props.cx + (right ? -12 : 12)} y={props.cy - 12} textAnchor={right ? 'end' : 'start'} fontSize={10} fontWeight={active ? 700 : 400} fill={active ? '#991b1b' : '#555'}>{p.start.slice(5)}–{p.end.slice(5)}</text>}
            </g>;
          }} />
        </ScatterChart></ResponsiveContainer>
      </div><p className="text-xs leading-5 text-black/60">Y：调整后报价提交率差值（pp）。保留全部期别；棕色虚线是未通过预测校验的探索模型。</p></div>
      <aside className="min-w-0 border border-[#141414] bg-white p-4" aria-live="polite"><div className="mb-3 flex items-center justify-between"><h3 className="text-xs font-bold">所选覆盖期</h3><span className="font-mono text-xs text-black/60">{index + 1} / {periods.length}</span></div>
        <label className="block text-xs"><span className="sr-only">选择图表覆盖期</span><select aria-label="选择图表覆盖期" value={selected?.batchId || ''} onChange={e => onSelect(e.target.value)} className="min-h-11 w-full min-w-0 border border-[#141414] bg-white px-2 text-xs">{periods.map(p => <option key={p.batchId} value={p.batchId}>{p.start} — {p.end}</option>)}</select></label>
        <div className="mt-2 grid grid-cols-2 gap-2"><button type="button" className={`${control} flex items-center justify-center gap-1 bg-white`} disabled={index <= 0} onClick={() => onSelect(periods[index-1].batchId)}><ChevronLeft size={14} />上一期</button><button type="button" className={`${control} flex items-center justify-center gap-1 bg-white`} disabled={index < 0 || index >= periods.length-1} onClick={() => onSelect(periods[index+1].batchId)}>下一期<ChevronRight size={14} /></button></div>
        {selected && <><dl className="mt-4 space-y-3 border-t border-black/20 pt-4 text-xs"><div><dt className="text-black/60">天猫到手价竞争力 X</dt><dd className="mt-1 font-mono text-2xl font-black">{pct(selected.score)}</dd></div><div><dt className="text-black/60">调整后报价提交率差 Y</dt><dd className="mt-1 font-mono text-2xl font-black">{pp(selected.difference)}</dd></div><div className="flex justify-between"><dt>竞争组报价量</dt><dd className="font-mono">{selected.competitionQuotes.toLocaleString('zh-CN')}</dd></div><div className="flex justify-between"><dt>共同分层覆盖率</dt><dd className="font-mono">{pct(selected.comparisonCoverage)}</dd></div></dl>
        <div className="mt-4 border-t border-black/20 pt-3 text-xs leading-6 text-black/65">{previous ? <>比上一期：X {selected.score-previous.score>=0?'+':''}{(selected.score-previous.score).toFixed(1)} 个百分点；Y {pp(selected.difference-previous.difference)}。<br />为期别观察变化，不代表因果增量。</> : '当前为展示范围内第一期，暂无上一期比较。'}</div></>}
      </aside>
    </div>
  </section>;
}
