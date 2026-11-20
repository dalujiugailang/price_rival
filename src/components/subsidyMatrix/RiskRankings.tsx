import React, {useMemo, useState} from 'react';
import type {CalculatedProduct} from '../../types';
import {buildRiskRankings, type RiskRanking, type Tier} from './riskRankingModel';
import type {MatrixRow, MatrixRule} from './types';
import {input, money, percent} from './ui';

function TierVisual({tiers, label}: {tiers: Tier[]; label: string}) {
  const ordered = [...tiers].sort((a, b) => a.threshold - b.threshold || b.losses - a.losses || a.series.localeCompare(b.series, 'zh-CN'));
  const max = Math.max(1, ...ordered.map(tier => tier.ratio || 0));
  return <div className="mt-3 space-y-2" aria-label={label}>
    <h5 className="font-bold">{label} · {ordered.length} 档</h5>
    {ordered.map(tier => <div key={JSON.stringify([tier.series, tier.threshold, tier.ahs, tier.total])} className="rounded border border-slate-200 p-2">
      <div className="flex flex-wrap justify-between gap-1"><strong>{tier.series} · 门槛 ¥{money(tier.threshold)}</strong><span>{tier.losses} 个亏损组合</span></div>
      <div className="mt-1 flex flex-wrap justify-between gap-1"><span>爱回收承担 ¥{money(tier.ahs)} / {tier.ratio === null ? '零门槛不计算比例' : percent(tier.ratio)}</span><strong className="text-blue-700">{tier.rank === null ? '同门槛排名不可比' : `同门槛第 ${tier.rank} / ${tier.rankTotal} 名`}</strong></div>
      <div className="mt-1 h-2 overflow-hidden rounded bg-slate-100" role="img" aria-label={`承担比例 ${tier.ratio === null ? '不可计算' : percent(tier.ratio)}`}>
        <div className="h-full bg-blue-600" style={{width: `${(tier.ratio || 0) / max * 100}%`}}/>
      </div>
    </div>)}
    {!ordered.length && <p>原方案未命中可核对的有效门槛。</p>}
  </div>;
}
function RankingList({items, limit, kind, onSelect}: {items: RiskRanking[]; limit: number; kind: 'new' | 'old'; onSelect: (kind: 'new' | 'old', item: RiskRanking) => void}) {
  if (!items.length) return <p className="p-3 text-xs text-[#555]">当前范围没有已识别的边际亏损组合。</p>;
  return <ol className="space-y-2">
    {items.slice(0, limit).map((item, index) => {
      const example = item.worst!;
      const comparison = example.result.comparison!;
      const original = example.product.postMarginalProfit * example.product.basePrice;
      const noTargetTier = item.losses - [...item.tiers.values()].reduce((sum, tier) => sum + tier.losses, 0);
      const noOriginalTier = item.losses - [...item.originalTiers.values()].reduce((sum, tier) => sum + tier.losses, 0);
      return <li key={item.name} className="border border-[#141414]/25 bg-white p-3 text-xs leading-relaxed">
        <div className="flex flex-wrap justify-between gap-2">
          <button type="button" className="text-left font-bold underline decoration-blue-400 underline-offset-4 hover:text-blue-700" onClick={() => onSelect(kind, item)} title="查看利润风险分析明细">{index + 1}. {item.name} ↗</button>
          <span className="font-bold text-red-800">亏损 {item.losses} / {item.checked} 组 · {percent(item.losses / item.checked)}</span>
        </div>
        <p className="mt-2">{item.losses - item.alreadyNegative} 个组合由原方案非亏损转为亏损，{item.alreadyNegative} 个原方案已亏损。</p>
        {kind === 'old' && <TierVisual tiers={[...item.originalTiers.values()]} label="亏损组合的原配新机与门槛"/>}
        <TierVisual tiers={[...item.tiers.values()]} label="全部亏损换购门槛"/>
        {noTargetTier > 0 && <p className="mt-2">另有 {noTargetTier} 个亏损组合未达到换购最低门槛，爱回收承担 0 元；其原方案已亏损。</p>}
        {kind === 'old' && noOriginalTier > 0 && <p className="mt-2 text-amber-800">{noOriginalTier} 个亏损组合的原配方案未命中可核对的有效门槛，原门槛排名暂不可比较。</p>}
        <details className="mt-2"><summary className="cursor-pointer font-bold underline">最深亏损原因</summary>
          <p className="mt-2">{example.product.oldModel} 换 {example.result.row.series}：追后价 ¥{money(example.product.recommendJdPrice)}，原配 {example.product.newSeries}，原利润 ¥{money(original)}。爱回收承担从 ¥{money(example.product.ahsSubsidyAfter)} 变为 ¥{money(example.result.hit.ahs)}，利润减少额按补贴增量 × 1.0466 计算，换新后利润 <strong className="text-red-800">¥{money(comparison.profit)}</strong>。</p>
        </details>
      </li>;
    })}
  </ol>;
}
export default function RiskRankings({products, rows, rules, invalidSeries, floor, onSelect}: {
  products: CalculatedProduct[]; rows: MatrixRow[]; rules: MatrixRule[]; invalidSeries: Set<string>; floor: number;
  onSelect: (kind: 'new' | 'old', item: RiskRanking) => void;
}) {
  const [limit, setLimit] = useState(5);
  const ranking = useMemo(() => buildRiskRankings({products, rows, rules, invalidSeries, floor}), [products, rows, rules, invalidSeries, floor]);
  return <section className="space-y-3 border border-[#141414] bg-[#F7F7F5] p-3" aria-label="换新亏损风险排行">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-sm font-black">换新亏损风险排行</h3>
      <label className="flex items-center gap-2 text-xs">排行范围
        <select className={input} aria-label="风险排行范围" value={limit} onChange={event => setLimit(Number(event.target.value))}>
          <option value={3}>Top 3</option><option value={5}>Top 5</option>
        </select>
      </label>
    </div>
    <p className="text-xs leading-relaxed text-[#555]">跟随上方品牌、新机系列、目标系列及关键词筛选，使用本版全部旧机报价比较。按亏损组合次数降序排列，同次数按亏损占比排序。排除原换新组合；亏损指边际利润低于 0，待核验不计入占比分母。补贴承担比例＝爱回收承担金额 ÷ 对应原始门槛；门槛为 0 时比例待核验。同门槛排名按爱回收承担比例从高到低，比较本版补贴表全部新机系列（不受上方筛选影响）；相同比例并列，系列去重，冲突或无效规则不参与排名。蓝条长度表示承担比例，同一图内使用相同刻度。</p>
    <p className="text-xs">可测算 {ranking.checked} 组 · 亏损 <strong className="text-red-800">{ranking.losses} 组</strong> · 待核验 {ranking.unknown} 组</p>
    <div className="grid min-w-0 gap-4 xl:grid-cols-2">
      <div className="min-w-0 space-y-2"><h4 className="text-xs font-bold">新机系列 Top {limit} · 哪些新机换购容易亏</h4><RankingList items={ranking.newSeries} limit={limit} kind="new" onSelect={onSelect}/></div>
      <div className="min-w-0 space-y-2"><h4 className="text-xs font-bold">旧机型号 Top {limit} · 哪些旧机换其他系列容易亏</h4><RankingList items={ranking.oldModels} limit={limit} kind="old" onSelect={onSelect}/></div>
    </div>
    <p className="text-xs text-[#555]">预计边际利润＝原方案边际利润 − 补贴承担增量 × 1.0466。每条旧机报价分别测算，型号排行合并其不同 PPV 的组合次数。</p>
  </section>;
}
