import React, {useMemo, useState} from 'react';
import {CalculatedProduct} from '../types';
import {aggregate, metrics, value} from '../utils/priceAnalysis';

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

function ChangeBar({label, first, last, scale}: {label: string; first: number | null; last: number | null; scale: number}) {
  const delta = difference(first, last);
  const width = delta === null ? 0 : Math.min(100, Math.abs(delta) / scale * 100);
  const rate = delta !== null && first !== null && first !== 0 ? delta / first * 100 : null;
  return <div className="py-1.5" title={`${label}：${number(first)} → ${number(last)} 元`}>
    <div className="flex items-center justify-between gap-2 text-[11px]">
      <span className="font-bold">{label}</span><ChangeNumber delta={delta}/>
      <span className={`w-16 text-right font-mono ${changeColor(delta)}`}>{rate === null ? '—' : `${sign(rate)}${number(rate)}%`}</span>
    </div>
    <div className="mt-1 flex h-1.5 w-full bg-[#F0EFEC]" aria-hidden="true">
      <div className="flex w-1/2 justify-end border-r border-[#aaa]">{delta !== null && delta < -.005 && <span className="bg-red-600" style={{width: `${width}%`}}/>}</div>
      <div className="w-1/2">{delta !== null && delta > .005 && <span className="block h-full bg-green-600" style={{width: `${width}%`}}/>}</div>
    </div>
  </div>;
}

type BrandGroup = {br: string; agg: ReturnType<typeof aggregate>};
export function BrandPriceChanges({groups, onBrand}: {groups: BrandGroup[]; onBrand: (brand: string) => void}) {
  const scales = useMemo(() => pairs.map(([jd, tm]) => Math.max(1, ...groups.flatMap(({agg}) => [jd, tm].map(key => Math.abs(difference(numeric(agg.points[0], key), numeric(agg.points.at(-1), key)) || 0))))), [groups]);
  return <section className="border border-[#141414] bg-white" aria-label="品牌价格变化">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#141414] bg-[#F0EFEC] px-4 py-3">
      <h3 className="text-sm font-bold">品牌价格变化</h3>
      <p className="text-xs text-[#555]"><span className="text-green-700">↑ 上涨</span> · <span className="text-red-700">↓ 下降</span> · 0 持平；条形长度按同列金额比较</p>
    </div>
    <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-xs">
      <thead className="bg-[#F0EFEC] text-left"><tr><th className="px-4 py-2">品牌 / 样本</th>{pairs.map(([, , label]) => <th className="px-4 py-2" key={label}>{label}变化 <span className="font-normal text-[#777]">金额 / 涨跌幅</span></th>)}</tr></thead>
      <tbody>{groups.map(({br, agg}) => <tr key={br} className={`border-t border-[#141414]/15 ${br === '' ? 'bg-[#F8F7F5]' : 'hover:bg-[#F8F7F5]'}`}>
        <td className="w-36 px-4 py-3 align-top"><button className="font-bold hover:underline" onClick={() => onBrand(br)}>{br || '整体'}</button><p className="mt-1 text-[11px] text-[#777]">{agg.count} PPV · 覆盖 {agg.coverage === null ? '—' : `${number(agg.coverage * 100)}%`}</p></td>
        {pairs.map(([jd, tm], i) => <td className="min-w-[190px] px-4 py-2 align-top" key={jd}>
          <ChangeBar label="京东" first={numeric(agg.points[0], jd)} last={numeric(agg.points.at(-1), jd)} scale={scales[i]}/>
          <ChangeBar label="天猫" first={numeric(agg.points[0], tm)} last={numeric(agg.points.at(-1), tm)} scale={scales[i]}/>
          <details className="mt-1 text-[10px] text-[#777]"><summary className="cursor-pointer">指数 / 波动幅度</summary>{[jd, tm].map((key, j) => {
            const first = numeric(agg.points[0], key), last = numeric(agg.points.at(-1), key);
            return <p key={key}>{j ? '天猫' : '京东'}：指数 {first !== null && first > 0 && last !== null ? number(last / first * 100) : '—'}；绝对变动均值 {number(numeric(agg.points.at(-1), key + 'Abs'))} 元</p>;
          })}</details>
        </td>)}
      </tr>)}</tbody>
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
export function PpvPriceChanges({rows, limit, onMore}: {rows: ComparisonRow[]; limit: number; onMore: () => void}) {
  const [pairIndex, setPairIndex] = useState(2);
  const [expanded, setExpanded] = useState('');
  const [presence, setPresence] = useState('common');
  const [jd, tm, label] = pairs[pairIndex];
  const visible = useMemo(() => rows.filter(row => presence === 'all' || (presence === 'common' ? row.a && row.b : presence === 'added' ? !row.a : !row.b)), [rows, presence]);
  return <section className="border border-[#141414] bg-white" aria-label="PPV价格变化">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#141414] bg-[#F0EFEC] px-4 py-3">
      <div className="flex flex-wrap items-center gap-3"><h3 className="text-sm font-bold">PPV 价格对比</h3><span className="text-xs text-[#777]">{visible.length} 条 · 基准期 → 对比期</span></div>
      <div className="flex flex-wrap gap-2">{pairs.map(([, , title], i) => <button key={title} className={`${button} ${pairIndex === i ? '!bg-[#141414] text-white' : ''}`} aria-pressed={pairIndex === i} onClick={() => setPairIndex(i)}>{title}</button>)}
        <select aria-label="PPV匹配范围" className="border border-[#141414] bg-white px-2 py-1 text-xs" value={presence} onChange={e => setPresence(e.target.value)}><option value="common">两期共有</option><option value="all">全部 PPV</option><option value="added">对比期新增</option><option value="removed">对比期未包含</option></select>
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
