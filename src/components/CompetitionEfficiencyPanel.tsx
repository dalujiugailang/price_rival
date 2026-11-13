import React, { useEffect, useMemo, useState } from 'react';
import CompetitionEfficiencyResults, { type EfficiencyDataset } from './CompetitionEfficiencyResults';
import { ArrowRight, Check, ChevronDown, BarChart3, Download, SlidersHorizontal } from 'lucide-react';
import type { TrackingBatch } from '../types';
import { buildEfficiencyPeriods } from '../utils/competitionEfficiency';

const pct = (v: number | null) => v === null ? '—' : `${v.toFixed(1)}%`;
const count = (v: number) => v.toLocaleString('zh-CN');

export default function CompetitionEfficiencyPanel({ historyBatches }: { historyBatches: TrackingBatch[] }) {
  const [dataset, setDataset] = useState<EfficiencyDataset | null>(null);
  const [loadError, setLoadError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/competition-efficiency', { signal: controller.signal, cache: 'no-store' }).then(async response => {
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '分析数据未加载');
      setDataset(result.data);
    }).catch(error => { if (error.name !== 'AbortError') setLoadError(error.message); });
    return () => controller.abort();
  }, []);
  const { periods, excluded, sameDayReplaced } = useMemo(() => buildEfficiencyPeriods(historyBatches), [historyBatches]);
  const [range, setRange] = useState('all');
  const [selectedId, setSelectedId] = useState('');
  const shown = range === 'recent' ? periods.slice(-8) : periods;
  const selected = shown.find(p => p.batch.id === selectedId) || shown.at(-1);
  const complete = shown.filter(p => p.end);
  const available = shown.filter(p => p.score !== null);
  const exportRequest = () => {
    const rows = [['snapshot_id', 'start_date', 'end_date', 'channel', 'required_dimensions', 'required_measures'],
      ...complete.map(p => [p.batch.id, p.start, p.end!, 'tradeIn', '来源类型/来源渠道/回收类型/商品品牌/商品型号/提交A等级价位段（统一）', 'SUM(报价量)/SUM(提交量)'])];
    const blob = new Blob(['\uFEFF' + rows.map(row => row.map(v => `"${v.replaceAll('"', '""')}"`).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = '竞争效率_候选期取数清单.csv'; link.click(); URL.revokeObjectURL(url);
  };
  if (dataset) return <CompetitionEfficiencyResults data={dataset} historyBatches={historyBatches} />;
  return <div className="bg-white rounded-none border border-[#141414] p-6 space-y-6 text-[#141414]">
    {loadError && <div role="status" className="border border-amber-700 bg-amber-50 p-3 text-xs">经营分析数据：{loadError}。下方仍可查看快照侧候选信息。</div>}
    <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 border-b border-[#141414] bg-[#F0EFEC] -mx-6 -mt-6 p-5">
      <div><h1 className="flex items-center gap-2 text-base font-bold"><BarChart3 className="h-5 w-5" />京东换新竞争投入效率</h1>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-[#141414]/70">同渠道、回收类型和价位段内，比较天猫到手价竞争力与报价提交表现。</p></div>
      <button type="button" onClick={exportRequest} disabled={!complete.length} className="inline-flex min-h-11 shrink-0 items-center gap-2 border border-[#141414] bg-[#141414] text-white px-3 text-xs font-bold transition-colors hover:bg-[#333333] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"><Download size={16} />导出候选期取数清单</button>
    </div>

    <div className="flex flex-wrap items-end gap-4 border border-[#141414] bg-[#F9F9F8] p-4">
      <div className="flex min-h-11 items-center gap-2 text-sm font-bold"><SlidersHorizontal size={16} />分析范围</div>
      <div className="text-sm"><div className="mb-1 text-xs text-black/55">经营盘 / 策略</div><div className="min-h-11 border border-[#141414] bg-white px-3 py-3">手机 · 京东换新 · 普通追价（待确认）</div></div>
      <label className="text-sm"><span className="mb-1 block text-xs text-black/55">快照范围</span><select value={range} onChange={e => setRange(e.target.value)} className="min-h-11 border border-[#141414] bg-white px-3"><option value="all">全部可识别快照</option><option value="recent">最近 8 个覆盖期</option></select></label>
      <div className="pb-3 text-xs leading-5 text-black/55">保存次日至下次保存当天<br />北京时间 · 同日保留最后版本</div>
    </div>

    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {[['候选完整覆盖期', `${complete.length}`, '尚待核验活动重叠与型号覆盖'], ['可计算竞争力的期数', `${available.length}`, '按覆盖 PPV 的近30天报价量加权'], ['调整后报价提交率差值', '待接入', '经营流量与型号映射尚未完成']].map(([title, value, note]) => <div key={title} className="flex flex-col justify-between border border-[#141414] bg-[#F9F9F8] p-4"><div className="text-xs font-bold text-[#141414]">{title}</div><div className="my-3 font-mono text-2xl font-black tracking-tight tabular-nums">{value}</div><div className="text-xs leading-5 text-black/55">{note}</div></div>)}
    </div>

    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_270px]">
      <section className="min-w-0 border border-[#141414] bg-[#F9F9F8]">
        <div className="flex flex-wrap justify-between gap-2 border-b border-[#141414]/30 p-5"><h2 className="text-sm font-bold">竞争力与提交表现</h2><span className="text-xs text-black/55">每个点代表一个完整覆盖期</span></div>
        <div className="flex min-h-[300px] flex-col items-center justify-center gap-4 p-6 text-center" role="status">
          <BarChart3 className="text-[#141414]/40" size={32} strokeWidth={1.5} />
          <h3 className="text-sm font-bold">接入报价与提交量后生成关系图</h3>
          <p className="max-w-md text-xs leading-6 text-black/60">快照侧提供竞争力；经营侧提供同期两组的报价量和提交量。完成型号覆盖与共同分层核验后，展示真实期别点。</p>
          <div className="flex flex-wrap items-center justify-center gap-3 text-xs"><span className="border border-[#141414] bg-[#141414] px-3 py-2 text-white">X · 天猫到手价竞争力（%）</span><ArrowRight size={16} /><span className="border border-[#141414]/30 px-3 py-2">Y · 调整后报价提交率差值（pp）</span></div>
        </div>
        <div className="border-t border-[#141414]/30 px-5 py-3 text-xs leading-5 text-black/55">展示原始期别点；暂不拟合最优点。结果反映同期相对表现，不作为因果增量。</div>
      </section>
      <section className="border border-[#141414] bg-[#F9F9F8] p-5"><h2 className="mb-5 font-bold">数据接入进度</h2><ol className="space-y-5">{[
        ['快照与竞争力', periods.length ? `已读取 ${periods.length} 个候选覆盖期` : '等待共享快照加载', periods.length > 0],
        ['型号与覆盖映射', '核验全型号、部分 SKU 覆盖', false],
        ['经营流量', '按日接入报价量、提交量', false],
        ['共同分层与权重', '锁定可比期后统一计算', false],
      ].map(([title, note, ready], i) => <li key={String(title)} className="flex gap-3"><span className={`flex h-6 w-6 shrink-0 items-center justify-center border text-xs ${ready ? 'border-[#141414] bg-[#141414] text-white' : 'border-[#141414] text-black/50'}`}>{ready ? <Check size={14} /> : i + 1}</span><div><div className="text-sm font-bold">{title}</div><p className="mt-1 text-xs leading-5 text-black/60">{note}</p></div></li>)}</ol></section>
    </div>

    <section className="min-w-0 border border-[#141414] bg-[#F9F9F8]"><div className="flex flex-wrap items-center justify-between gap-3 p-5"><h2 className="text-sm font-bold">覆盖期明细</h2><span className="text-xs text-black/55">点击期别查看计算依据</span></div>
      <div className="overflow-x-auto"><table className="tech-grid-table w-full min-w-[760px] text-left text-xs"><thead className="border-y border-[#141414]/30 bg-[#F0EFEC] text-xs"><tr>{['覆盖期', '天猫到手价竞争力', '覆盖 PPV', '有效价报价占比', '调整后提交率差', '状态'].map(h => <th key={h} className="px-4 py-3 font-bold">{h}</th>)}</tr></thead><tbody>{[...shown].reverse().map(p => <tr key={p.batch.id} className={`border-b border-[#141414]/20 ${selected?.batch.id === p.batch.id ? 'bg-[#E4E3E0]' : 'hover:bg-[#F0EFEC]'}`}><td className="px-4 py-3"><button type="button" onClick={() => setSelectedId(p.batch.id)} aria-pressed={selected?.batch.id === p.batch.id} className="min-h-11 text-left font-bold underline decoration-black/25 underline-offset-4">{p.start} — {p.end || '进行中'}</button></td><td className="px-4 py-3 font-mono font-bold tabular-nums">{pct(p.score)}</td><td className="px-4 py-3 tabular-nums">{p.selectedCount ?? '缺名单'}</td><td className="px-4 py-3 tabular-nums">{pct(p.priceCoverage)}</td><td className="px-4 py-3 text-black/45">待接入</td><td className="max-w-[240px] px-4 py-3 text-xs leading-5 text-amber-900">{p.warnings.join('；') || '待核验型号覆盖'}</td></tr>)}</tbody></table>{!shown.length && <div className="p-8 text-center text-sm text-black/60">暂无具备可验证保存时间的普通追价快照。历史补录与汇总快照不自动划期。</div>}</div>
      {selected && <div className="grid gap-3 bg-[#F0EFEC] p-5 text-xs leading-6 md:grid-cols-2"><div><div className="text-sm font-bold">所选快照 · {selected.batch.id}</div><div>赢价报价量 / 有效报价量：{count(selected.winningQuotes)} / {count(selected.eligibleQuotes)}</div><div>权重：快照内 PPV 近30天报价量；平价计赢。</div></div><div><div className="text-sm font-bold">生效近似与数据范围</div><div>保存时间：{selected.batch.serverCreatedAt ? new Date(selected.batch.serverCreatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '缺失'}（北京时间）</div><div>部分 SKU 覆盖不放大为全型号；开放期暂不进入正式比较。</div></div></div>}
    </section>

    <details className="border border-[#141414] bg-white p-5"><summary className="flex cursor-pointer list-none items-center justify-between text-sm font-bold">计算口径与排除规则<ChevronDown size={16} /></summary><div className="mt-4 grid gap-5 text-sm leading-7 text-black/70 md:grid-cols-2"><div><h3 className="font-bold text-black">调整后报价提交率差值</h3><p>各层提交率 = 提交量 ÷ 报价量；同渠道 × 回收类型 × 提交A等级价位段内比较两组，再按分析窗口固定的竞争组报价结构加权。</p><p>只保留全部可比期内两组都有报价的共同分层。提交价位段尚不能证明是追价前基准价位段。</p></div><div><h3 className="font-bold text-black">当前候选数据限制</h3><p>已排除 {excluded} 个补录、汇总、其他策略或缺少可靠保存时间的快照；同日较早版本 {sameDayReplaced} 个。新品活动重叠需进一步核验。</p><p>范围与时间来自当前账号可见共享历史；跨日提交归属、型号映射与数据完整性仍待确认。</p></div></div></details>
  </div>;
}
