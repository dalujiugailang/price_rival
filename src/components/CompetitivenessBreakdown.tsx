import React, { useEffect, useId, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ALL_BRANDS, ALL_SERIES } from '../utils/brandCompetitiveness';
import type { CompetitivenessViewSnapshot } from '../utils/competitivenessView';
import { buildCompetitivenessBreakdown } from '../utils/competitivenessBreakdown';

type Row = ReturnType<typeof buildCompetitivenessBreakdown>[number];
const score = (value: number | null) => value == null ? '—' : `${value.toFixed(1)}%`;

export default function CompetitivenessBreakdown({ snapshot, brand, newSeries, onBrandChange, onSeriesChange }: {
  snapshot: CompetitivenessViewSnapshot | null;
  brand: string;
  newSeries: string;
  onBrandChange: (brand: string) => void;
  onSeriesChange: (series: string) => void;
}) {
  const dotPatternId = `tm-hand-dots-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setAnimate(!preference.matches);
    update();
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);
  const [drilledBrand, setDrilledBrand] = useState<string | null>(null);
  const bySeries = newSeries !== ALL_SERIES || (brand !== ALL_BRANDS && drilledBrand === brand);
  const rows = useMemo(() => buildCompetitivenessBreakdown(snapshot?.products || [], bySeries), [snapshot?.products, bySeries]);
  const select = (row: Row) => {
    // Missing brand/series values have no matching option in the shared filters.
    if (!row.brand || (bySeries && !row.series)) return;
    onBrandChange(row.brand);
    if (bySeries) onSeriesChange(row.series);
    else { setDrilledBrand(row.brand); onSeriesChange(ALL_SERIES); }
  };
  const reset = () => { setDrilledBrand(null); onBrandChange(ALL_BRANDS); onSeriesChange(ALL_SERIES); };
  return <section className="border border-[#141414] bg-[#F9F9F8] p-5" aria-label="批次内竞争力对比">
    <div className="mb-4 flex items-center justify-between gap-3">
      <div>
        <h4 className="text-sm font-bold">批次内竞争力对比 · {bySeries ? '新机系列' : '品牌'}</h4>
        <p className="mt-1 break-all text-[11px] text-stone-500">{snapshot ? `${snapshot.date} · ${snapshot.name} · ${snapshot.isDraft ? '实时' : snapshot.isConfirmed ? '正式落数' : '未确认快照'}` : '暂无选定数据'}</p>
        <p className="mt-1 text-xs text-stone-600">{brand === ALL_BRANDS ? '全部品牌' : brand} / {newSeries === ALL_SERIES ? '全部新机系列' : newSeries} · 按近30天报价量加权；{bySeries ? '点击系列同步筛选明细' : '点击品牌查看新机系列'}</p>
      </div>
    </div>
    {(bySeries || brand !== ALL_BRANDS) && <button type="button" className="mb-3 border border-[#141414] bg-white px-3 py-1 text-xs font-bold" onClick={reset}>← 返回全部品牌对比</button>}
    {snapshot?.isSummaryOnly ? <p className="py-10 text-center text-xs text-stone-500">该批次仅保存汇总分数，无明细，无法拆分品牌与新机系列。</p>
      : !rows.length ? <p className="py-10 text-center text-xs text-stone-500">当前批次与筛选范围暂无明细。</p>
      : <>
        <div className="overflow-x-auto">
          <div style={{ minWidth: Math.max(440, rows.length * 108), height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 12, right: 18, bottom: 12, left: 0 }} accessibilityLayer>
                <defs>
                  <pattern id={dotPatternId} width={5} height={5} patternUnits="userSpaceOnUse">
                    <rect width={5} height={5} fill="#F9F9F8" />
                    <circle cx={2.5} cy={2.5} r={0.8} fill="#D97706" />
                  </pattern>
                </defs>
                <CartesianGrid stroke="#e0deda" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" interval={0} tick={{ fontSize: 11, fill: '#141414' }} />
                <YAxis domain={[0, 100]} tickFormatter={value => `${value}%`} tick={{ fontSize: 11 }} />
                <Tooltip content={({ active, payload }) => {
                  const row = payload?.[0]?.payload as Row | undefined;
                  return active && row ? <div className="border border-[#141414] bg-white p-3 text-xs leading-6">
                    <p className="font-bold">{row.label} · {row.count} PPV 明细</p>
                    <p>天猫物品价：{score(row.tmItemScore)} · 有效报价量 {row.itemWeight.toLocaleString()}</p>
                    <p>天猫到手价：{score(row.tmDirectScore)} · 有效报价量 {row.handWeight.toLocaleString()}</p>
                  </div> : null;
                }} />
                <Legend content={() => <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 pt-2 text-[11px]">
                  <span className="inline-flex items-center gap-1"><span aria-hidden="true" className="inline-block h-3 w-4 bg-[#C2410C]" />天猫物品价竞争力</span>
                  <span className="inline-flex items-center gap-1"><span aria-hidden="true" className="inline-block h-3 w-4 border-2 border-dashed border-[#D97706]" style={{ backgroundColor: '#F9F9F8', backgroundImage: 'radial-gradient(circle, #D97706 0.8px, transparent 0.9px)', backgroundSize: '5px 5px' }} />天猫到手价竞争力</span>
                </div>} />
                <Bar dataKey="tmItemScore" name="天猫物品价竞争力" fill="#C2410C" maxBarSize={30} cursor="pointer" isAnimationActive={animate} animationDuration={350} onClick={data => select((data as unknown as { payload: Row }).payload)} />
                <Bar dataKey="tmDirectScore" name="天猫到手价竞争力" fill={`url(#${dotPatternId})`} stroke="#D97706" strokeWidth={2} strokeDasharray="4 3" maxBarSize={30} cursor="pointer" isAnimationActive={animate} animationDuration={350} onClick={data => select((data as unknown as { payload: Row }).payload)} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2" aria-label="竞争力分组下钻">
          {rows.map(row => <button key={row.key} type="button" disabled={!row.brand || (bySeries && !row.series)} onClick={() => select(row)} className="border border-stone-300 bg-white px-2 py-1 text-[11px] hover:border-[#141414] focus:outline-2 disabled:text-stone-400">
            {row.label} <span className="font-mono">{score(row.tmItemScore)} / {score(row.tmDirectScore)}</span>
          </button>)}
        </div>
        <p className="mt-2 text-[10px] text-stone-500">缺少有效竞品价格或报价量时显示 —，不计作 0%。</p>
      </>}
  </section>;
}
