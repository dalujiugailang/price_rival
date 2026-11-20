import React, {useMemo, useState} from 'react';
import {CalculatedProduct, TrackingBatch} from '../types';
import {aggregate, analysisIdentity, indexPpv, metrics, value} from '../utils/priceAnalysis';

const formatter = new Intl.NumberFormat('zh-CN', {maximumFractionDigits: 2});
const number = (n: number | null | undefined) => n == null || !Number.isFinite(n) ? '—' : formatter.format(n);
const button = 'border border-[#141414] bg-white px-3 py-1.5 text-xs font-bold hover:bg-[#E4E3E0] disabled:opacity-40 disabled:cursor-not-allowed';
const pairs = [
  ['recommendJdPrice', 'tmPrice', '物品价'],
  ['totalSubsidy', 'tmSubsidyManual', '补贴'],
  ['postJdHandPrice', 'tmHandPrice', '到手价']
] as const;
type Point = Record<string, string | number | null>;
const numeric = (point: Point | undefined, key: string) => typeof point?.[key] === 'number' ? point[key] as number : null;
const difference = (a: number | null, b: number | null) => a !== null && b !== null ? b - a : null;
export const changeColor = (delta: number | null | undefined) => delta == null || Math.abs(delta) < .005 ? 'text-[#777]' : delta > 0 ? 'text-green-700' : 'text-red-700';
const sign = (n: number) => n > 0 ? '+' : '';

export function ChangeNumber({delta, suffix = '元'}: {delta: number | null; suffix?: string}) {
  return <span className={`font-mono font-bold ${changeColor(delta)}`}>
    {delta === null ? '—' : Math.abs(delta) < .005 ? `0 ${suffix}` : `${delta > 0 ? '↑' : '↓'} ${sign(delta)}${number(delta)} ${suffix}`}
  </span>;
}

function ChangeBar({label, first, last, scale, compact = false}: {label: string; first: number | null; last: number | null; scale: number; compact?: boolean}) {
  const delta = difference(first, last);
  const width = delta === null ? 0 : Math.min(100, Math.abs(delta) / scale * 100);
  const rate = delta !== null && first !== null && first !== 0 ? delta / first * 100 : null;
  return <div className={compact ? "py-1 leading-normal" : "py-0.5"} title={`${label}：${number(first)} → ${number(last)} 元`}>
    <div className="flex items-center justify-between gap-2 text-[11px]">
      <span className="font-bold">{label}</span><ChangeNumber delta={delta}/>
      <span className={`w-16 text-right font-mono ${changeColor(delta)}`}>{rate === null ? '—' : `${sign(rate)}${number(rate)}%`}</span>
    </div>
    <div className={`${compact ? "mt-1 h-1" : "mt-1 h-1.5"} flex w-full bg-[#E4E3E0]`} aria-hidden="true">
      <div className="flex w-1/2 justify-end border-r border-[#aaa]">{delta !== null && delta < -.005 && <span className="bg-red-600" style={{width: `${width}%`}}/>}</div>
      <div className="w-1/2">{delta !== null && delta > .005 && <span className="block h-full bg-green-600" style={{width: `${width}%`}}/>}</div>
    </div>
  </div>;
}

function PriceChangeCells({agg, scales, compact = false}: {agg: ReturnType<typeof aggregate>; scales: number[]; compact?: boolean}) {
  return <>{pairs.map(([jd, tm], i) => <td className={`min-w-[190px] px-4 ${compact ? "py-2 leading-normal" : "py-1"} align-top`} key={jd}>
          <ChangeBar label="京东" first={numeric(agg.points[0], jd)} last={numeric(agg.points.at(-1), jd)} scale={scales[i]} compact={compact}/>
          <ChangeBar label="天猫" first={numeric(agg.points[0], tm)} last={numeric(agg.points.at(-1), tm)} scale={scales[i]} compact={compact}/>

        </td>)}</>;
}

type BrandGroup = {br: string; agg: ReturnType<typeof aggregate>};
export type DetailSort = 'original' | `${0 | 1 | 2}:${'both' | 'jd' | 'tm'}`;
type DetailGroup = {name: string; agg: ReturnType<typeof aggregate>};
export function detailChange(agg: ReturnType<typeof aggregate>, key: string) {
  const first = numeric(agg.points[0], key), last = numeric(agg.points.at(-1), key);
  const delta = first !== null && last !== null && Number.isFinite(first) && Number.isFinite(last) ? last - first : null;
  return {delta, rate: delta !== null && first !== null && first !== 0 ? delta / first * 100 : null};
}
export function sortDetailGroups(groups: DetailGroup[], sort: DetailSort): DetailGroup[] {
  if (sort === 'original') return groups;
  const [index, platform] = sort.split(':');
  const [jd, tm] = pairs[Number(index)];
  const score = ({agg}: DetailGroup) => {
    const keys = platform === 'jd' ? [jd] : platform === 'tm' ? [tm] : [jd, tm];
    const valid = keys.map(key => detailChange(agg, key).delta).filter((n): n is number => n !== null);
    return valid.length ? Math.max(...valid.map(Math.abs)) : -Infinity;
  };
  return groups.map((group, index) => ({group, index, score: score(group)}))
    .sort((a, b) => (a.score === b.score ? a.index - b.index : a.score > b.score ? -1 : 1)).map(({group}) => group);
}
export function detailScales(groups: DetailGroup[], mapping: 'amount' | 'rate') {
  return pairs.map(([jd, tm]) => Math.max(0, ...groups.flatMap(({agg}) => [jd, tm].map(key => {
    const change = detailChange(agg, key);
    return Math.abs((mapping === 'amount' ? change.delta : change.rate) ?? 0);
  }))));
}

export function BrandSeriesChanges({batches, brand, series = ''}: {batches: TrackingBatch[]; brand: string; series?: string}) {
  const [highlight, setHighlight] = useState(true);
  const [threshold, setThreshold] = useState(100);
  const [sort, setSort] = useState<DetailSort>('1:both');
  const mapping = 'amount' as const;
  const groups = useMemo(() => {
    if (!batches.length) return [];
    const names = new Set([...indexPpv(batches[0]).rows.values()].map(analysisIdentity).filter(p => p.brand === brand && (!series || p.newSeries === series)).map(p => p.newSeries));
    return [...names].sort((a, b) => a.localeCompare(b, 'zh-CN')).map(name => {
      if (name) return {name, agg: aggregate(batches, brand, name)};
      const ppvs = new Set([...indexPpv(batches[0]).rows.values()].filter(product => {
        const identity = analysisIdentity(product);
        return identity.brand === brand && !identity.newSeries;
      }).map(product => product.ppv));
      return {name, agg: aggregate(batches.map(batch => ({...batch, products: batch.products.filter(product => ppvs.has(product.ppv))})), brand)};
    });
  }, [batches, brand, series]);
  const scales = detailScales(groups, mapping);
  const sorted = sortDetailGroups(groups, sort);
  return <>
    <tr className="brand-detail-toolbar"><td colSpan={4}>
      <div role="group" aria-label={`${brand}展开明细工具栏`} className="brand-detail-controls">
        <label><input type="checkbox" checked={highlight} onChange={event => setHighlight(event.target.checked)}/>突出重大异动</label>
        <label>阈值 <input aria-label={`${brand}异动高亮金额阈值`} type="range" min={50} max={500} step={10} value={threshold} onChange={event => setThreshold(Number(event.target.value))}/><output>{threshold} 元</output></label>
        <label>排序 <select aria-label={`${brand}明细排序`} value={sort} onChange={event => setSort(event.target.value as DetailSort)}>
          {[1, 0, 2].flatMap(index => (['both', 'jd', 'tm'] as const).map(platform => <option key={`${index}:${platform}`} value={`${index}:${platform}`}>{platform === 'both' ? '双平台' : platform === 'jd' ? '京东' : '天猫'}{pairs[index][2]}异动</option>))}
          <option value="original">原始机型顺序</option>
        </select></label>
        <span className="brand-detail-note">居中零轴 · 各指标独立尺度 · 同指标跨平台一致</span>
      </div>
    </td></tr>
    {sorted.map(({name, agg}, rowIndex) => <tr key={name} className={`brand-detail-row ${rowIndex % 2 ? 'brand-detail-stripe' : ''} ${rowIndex === sorted.length - 1 ? 'brand-detail-last' : ''}`} aria-label={`${brand}新机系列：${name || '未标注'}`}>
      <th scope="row" className="brand-detail-name">
        <strong><span className="brand-detail-indent-marker" aria-hidden="true">↳</span>{name || '未标注新机系列'}</strong>
        <p>{agg.count} PPV · 覆盖 {agg.coverage === null ? '—' : `${number(agg.coverage * 100)}%`}</p>
      </th>
      {pairs.map(([jd, tm, label], metricIndex) => <td className="brand-detail-metric" key={jd}>
        {[jd, tm].map((key, platformIndex) => {
          const {delta, rate} = detailChange(agg, key);
          const platform = platformIndex === 0 ? '京东' : '天猫';
          const mapped = delta;
          const width = mapped === null || scales[metricIndex] === 0 ? 0 : Math.min(50, Math.abs(mapped) / scales[metricIndex] * 50);
          const major = highlight && delta !== null && Math.abs(delta) >= threshold;
          const tooltip = `${name || '未标注新机系列'} · ${platform} · ${label}变化：${delta === null ? '缺失' : `${sign(delta)}${number(delta)} 元`}；涨跌幅：${rate === null ? '无法计算' : `${sign(rate)}${number(rate)}%`}`;
          return <div key={key} className={`brand-detail-value ${major ? delta! > 0 ? 'brand-detail-major-up' : 'brand-detail-major-down' : ''}`} title={tooltip} tabIndex={0} aria-label={tooltip}>
            <div className="brand-detail-numbers"><span>{platform}</span><ChangeNumber delta={delta}/><span className={`brand-detail-rate ${changeColor(delta)}`}>{rate === null ? '—' : `${sign(rate)}${number(rate)}%`}</span></div>
            <div className="brand-detail-plot" aria-hidden="true">
              {mapped !== null && mapped !== 0 && <span className={`brand-detail-bar ${mapped > 0 ? 'brand-detail-up' : 'brand-detail-down'}`} style={{left: `${mapped > 0 ? 50 : 50 - width}%`, width: `${width}%`}}/>}
              {mapped === 0 && <span className="brand-detail-zero"/>}
            </div>
          </div>;
        })}
      </td>)}
    </tr>)}
  </>;
}

export function BrandPriceChanges({groups, onBrand, batches = [], series = ''}: {groups: BrandGroup[]; onBrand: (brand: string) => void; batches?: TrackingBatch[]; series?: string}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggle = (brand: string) => setExpanded(previous => {const next = new Set(previous); if (next.has(brand)) next.delete(brand); else next.add(brand); return next;});
  const scales = useMemo(() => pairs.map(([jd, tm]) => Math.max(1, ...groups.flatMap(({agg}) => [jd, tm].map(key => Math.abs(difference(numeric(agg.points[0], key), numeric(agg.points.at(-1), key)) || 0))))), [groups]);
  return <section className="border border-[#141414] bg-white" aria-label="品牌价格变化">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#141414] bg-[#F0EFEC] px-4 py-3">
      <h3 className="text-sm font-bold">品牌价格变化</h3>
      <p className="text-xs text-[#555]"><span className="text-green-700">↑ 上涨</span> · <span className="text-red-700">↓ 下降</span> · 0 持平；点击品牌行展开新机系列</p>
    </div>
    <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-xs">
      <thead className="bg-[#F0EFEC] text-left"><tr><th className="px-4 py-2">品牌 / 样本</th>{pairs.map(([, , label]) => <th className="px-4 py-2" key={label}>{label}变化 <span className="font-normal text-[#777]">金额 / 涨跌幅</span></th>)}</tr></thead>
      <tbody>{groups.map(({br, agg}) => <React.Fragment key={br}><tr onClick={br && batches.length ? () => toggle(br) : undefined} className={`border-t border-[#141414]/15 ${br === '' ? 'bg-[#F8F7F5]' : 'cursor-pointer hover:bg-[#F8F7F5]'}`}>
        <td className="w-36 px-4 py-2 align-top"><button className="font-bold hover:underline" aria-expanded={br && batches.length ? expanded.has(br) : undefined} onClick={event => {event.stopPropagation(); br && batches.length ? toggle(br) : onBrand(br);}}>{br && batches.length ? (expanded.has(br) ? '▾ ' : '▸ ') : ''}{br || '整体'}</button><p className="mt-1 text-[11px] text-[#777]">{agg.count} PPV · 覆盖 {agg.coverage === null ? '—' : `${number(agg.coverage * 100)}%`}</p></td>
        <PriceChangeCells agg={agg} scales={scales}/>
      </tr>{br && expanded.has(br) && batches.length > 0 && <BrandSeriesChanges batches={batches} brand={br} series={series}/>}</React.Fragment>)}</tbody>
    </table></div>
  </section>;
}

function PriceMove({first, last, showRate = true, showTrend = true}: {first: number | null; last: number | null; showRate?: boolean; showTrend?: boolean}) {
  const delta = difference(first, last);
  const rate = delta !== null && first !== null && first !== 0 ? delta / first * 100 : null;
  const color = delta === null || Math.abs(delta) < .005 ? '#999' : delta > 0 ? '#15803d' : '#b91c1c';
  return <div className="space-y-1">
    <div className="flex items-center gap-2"><span className="text-[#777] font-mono">{number(first)}</span><span className="text-[#aaa]">→</span><span className="font-mono font-bold">{number(last)}</span>
      {showTrend && delta !== null && <svg width="44" height="18" viewBox="0 0 44 18" role="img" aria-label={Math.abs(delta) < .005 ? '价格持平' : delta > 0 ? '价格上涨' : '价格下降'}><path d={Math.abs(delta) < .005 ? 'M2 9 L42 9' : delta > 0 ? 'M2 15 L42 3' : 'M2 3 L42 15'} stroke={color} strokeWidth="1.6" fill="none"/></svg>}
    </div>
    <div className="flex items-center gap-2 text-[11px]"><ChangeNumber delta={delta}/><span className={changeColor(delta)}>{!showRate || rate === null ? '' : `${sign(rate)}${number(rate)}%`}</span></div>
  </div>;
}

type ComparisonRow = {ppv: string; a?: CalculatedProduct; b?: CalculatedProduct};
export function PpvPriceChanges({rows, limit, onMore, presence='common'}: {rows: ComparisonRow[]; limit: number; onMore: () => void; presence?: string}) {
  const [pairIndex, setPairIndex] = useState(2);
  const [expanded, setExpanded] = useState('');
  const [jd, tm, label] = pairs[pairIndex];
  const visible = useMemo(() => rows.filter(row => presence === 'all' || (presence === 'common' ? row.a && row.b : presence === 'added' ? !row.a : !row.b)), [rows, presence]);
  return <section className="border border-[#141414] bg-white" aria-label="PPV价格变化">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#141414] bg-[#F0EFEC] px-4 py-3">
      <div className="flex flex-wrap items-center gap-3"><h3 className="text-sm font-bold">PPV 价格对比</h3><span className="text-xs text-[#777]">{visible.length} 条 · 基准期 → 对比期</span></div>
      <div className="flex flex-wrap gap-2">{pairs.map(([, , title], i) => <button key={title} className={`${button} ${pairIndex === i ? '!bg-[#141414] text-white' : ''}`} aria-pressed={pairIndex === i} onClick={() => setPairIndex(i)}>{title}</button>)}
      </div>
    </div>
    <div className="max-h-[650px] overflow-auto"><table className="w-full min-w-[960px] text-xs">
      <thead className="sticky top-0 z-10 bg-[#F0EFEC] text-left"><tr>{['型号 / PPV', '基准价', `京东${label}`, `天猫${label}`, '双方价差（京东－天猫）', '明细'].map(title => <th key={title} className="border-b border-[#141414]/30 px-4 py-2">{title}</th>)}</tr></thead>
      <tbody>{visible.slice(0, limit).map(row => {
        const product = (row.b || row.a)!;
        const oldGap = value(row.a, jd) !== null && value(row.a, tm) !== null ? value(row.a, jd)! - value(row.a, tm)! : null;
        const newGap = value(row.b, jd) !== null && value(row.b, tm) !== null ? value(row.b, jd)! - value(row.b, tm)! : null;
        return <React.Fragment key={row.ppv}>
          <tr className="border-t border-[#141414]/15 hover:bg-[#F8F7F5]">
            <td className="w-[25%] px-4 py-3"><strong>{product.oldModel || product.model || row.ppv}</strong><p className="mt-1 max-w-[300px] truncate text-[11px] text-[#777]" title={row.ppv}>{row.ppv}</p>{(!row.a || !row.b) && <p className="mt-1 text-[10px] text-[#777]">{row.a ? '对比期未包含' : '对比期新增'}</p>}</td>
            <td className="px-4 py-3"><PriceMove first={value(row.a, 'basePrice')} last={value(row.b, 'basePrice')}/></td>
            <td className="px-4 py-3"><PriceMove first={value(row.a, jd)} last={value(row.b, jd)}/></td>
            <td className="px-4 py-3"><PriceMove first={value(row.a, tm)} last={value(row.b, tm)}/></td>
            <td className="px-4 py-3"><PriceMove first={oldGap} last={newGap} showRate={false}/><p className="mt-1 text-[10px] text-[#777]">{newGap === null ? '缺少报价' : newGap > 0 ? '对比期京东更高' : newGap < 0 ? '对比期天猫更高' : '对比期双方持平'}</p></td>
            <td className="px-4 py-3"><button className="font-bold underline" aria-expanded={expanded === row.ppv} onClick={() => setExpanded(expanded === row.ppv ? '' : row.ppv)}>{expanded === row.ppv ? '收起' : '展开'}</button></td>
          </tr>
          {expanded === row.ppv && <tr><td colSpan={6} className="border-t border-[#141414]/15 bg-[#F8F7F5] p-4"><p className="mb-3 break-all font-bold">{row.ppv}</p><table className="w-full table-fixed border border-[#141414]/15 bg-white text-xs" aria-label="PPV分类价格详情">
            <thead className="bg-[#F0EFEC] text-center">
              <tr><th rowSpan={2} className="border-r border-[#141414]/15 px-2 py-2">基准价</th><th colSpan={3} className="border-r border-[#141414]/15 px-2 py-2">京东</th><th colSpan={3} className="px-2 py-2">天猫</th></tr>
              <tr>{['物品价－追后','新品总投入－追后','总到手价－追后','裸机价','人工总补贴','总到手价'].map((label,i)=><th key={label} title={metrics[i+1][1]} className="border-t border-r border-[#141414]/15 px-2 py-2 text-[11px] font-normal">{label}</th>)}</tr>
            </thead>
            <tbody><tr>{metrics.map(([key,title])=><td key={key} title={title} className="border-t border-r border-[#141414]/15 px-2 py-3 align-top"><PriceMove first={value(row.a,key)} last={value(row.b,key)} showTrend={false}/></td>)}</tr></tbody>
          </table><p className="mt-3 text-[11px] text-[#777]">数值：基准期 → 对比期；绿色上涨、红色下降。</p></td></tr>}
        </React.Fragment>;
      })}</tbody>
    </table>{!visible.length && <p className="p-6 text-center text-[#777]">该范围没有 PPV，可切换匹配范围或选择其他批次。</p>}</div>
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#141414]/15 px-4 py-2"><p className="text-[11px] text-[#777]">已展示 {Math.min(limit, visible.length)} / {visible.length} 条 · 展开查看基准价及全部七项指标。</p><button className={button} disabled={limit>=visible.length} onClick={onMore}>{limit>=visible.length?'已显示全部':'再显示 50 条'}</button></div>
  </section>;
}
