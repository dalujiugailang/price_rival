import React, {useMemo, useState} from 'react';
import type {CalculatedProduct} from '../../types';
import {buildRiskRankings, type RiskRanking} from './riskRankingModel';
import type {MatrixRow, MatrixRule} from './types';
import {input, money, percent} from './ui';

function RankingList({items, limit, kind}: {items: RiskRanking[]; limit: number; kind: 'new' | 'old'}) {
  if (!items.length) return <p className="p-3 text-xs text-[#555]">当前范围没有已识别的边际亏损组合。</p>;
  return <ol className="space-y-2">
    {items.slice(0, limit).map((item, index) => {
      const tiers = [...item.tiers.values()].sort((a, b) => b.losses - a.losses).slice(0, 2);
      const example = item.worst!;
      const comparison = example.result.comparison!;
      const original = example.product.postMarginalProfit * example.product.basePrice;
      return <li key={item.name} className="border border-[#141414]/25 bg-white p-3 text-xs leading-relaxed">
        <div className="flex flex-wrap justify-between gap-2">
          <strong>{index + 1}. {item.name}</strong>
          <span className="font-bold text-red-800">亏损 {item.losses} / {item.checked} 组 · {percent(item.losses / item.checked)}</span>
        </div>
        <p className="mt-1 text-[#555]">{kind === 'new' ? `比较 ${item.quotes.size} 条旧机报价` : `${item.quotes.size} 条旧机报价 · 涉及 ${item.targets.size} 个亏损新机系列`} · 待核验 {item.unknown} 组</p>
        <p className="mt-1 text-[#555]">亏损组合平均承担比例 {item.averageRatio === null ? '待核验' : percent(item.averageRatio)} · 有效比例 {item.ratioCount} 组</p>
        <details className="mt-2">
          <summary className="cursor-pointer font-bold underline">具体原因</summary>
          <ul className="mt-2 list-disc space-y-2 pl-4">
            <li>{item.losses - item.alreadyNegative} 个组合由原方案非亏损转为亏损，另有 {item.alreadyNegative} 个组合原方案已亏损。</li>
            {tiers.map(tier => <li key={JSON.stringify(tier)}>
              {kind === 'old' && <strong>{tier.series} · </strong>}
              原始门槛 {money(tier.threshold)} 元，爱回收承担 {money(tier.ahs)} 元，总补贴 {money(tier.total)} 元，
              承担比例 {tier.ratio !== null ? percent(tier.ratio) : '待核验'}，该档产生 {tier.losses} 个亏损组合。
            </li>)}
            <li>最深亏损组合为 {example.product.oldModel} 换 {example.result.row.series}。
              追后价 {money(example.product.recommendJdPrice)} 元，原配 {example.product.newSeries}，
              原利润 {money(original)} 元。承担额从 {money(example.product.ahsSubsidyAfter)} 元变为 {money(example.result.hit.ahs)} 元，
              补贴{comparison.delta >= 0 ? '增加' : '减少'} {money(Math.abs(comparison.delta))} 元，换新后利润为 <strong className="text-red-800">{money(comparison.profit)} 元</strong>。
              <span className="mt-1 block break-words text-[#555]">{example.product.ppv}</span>
            </li>
          </ul>
        </details>
      </li>;
    })}
  </ol>;
}
export default function RiskRankings({products, rows, rules, invalidSeries, floor}: {
  products: CalculatedProduct[]; rows: MatrixRow[]; rules: MatrixRule[]; invalidSeries: Set<string>; floor: number;
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
    <p className="text-xs leading-relaxed text-[#555]">跟随上方品牌、新机系列、目标系列及关键词筛选，使用本版全部旧机报价比较。按亏损组合次数降序排列，同次数按亏损占比排序。排除原换新组合；亏损指边际利润低于 0，待核验不计入占比分母。补贴承担比例＝爱回收承担金额 ÷ 对应原始门槛；门槛为 0 时比例待核验。平均承担比例按各亏损组合的原始门槛比例取算术平均，待核验比例不参与平均。</p>
    <p className="text-xs">可测算 {ranking.checked} 组 · 亏损 <strong className="text-red-800">{ranking.losses} 组</strong> · 待核验 {ranking.unknown} 组</p>
    <div className="grid min-w-0 gap-4 xl:grid-cols-2">
      <div className="min-w-0 space-y-2"><h4 className="text-xs font-bold">新机系列 Top {limit} · 哪些新机换购容易亏</h4><RankingList items={ranking.newSeries} limit={limit} kind="new"/></div>
      <div className="min-w-0 space-y-2"><h4 className="text-xs font-bold">旧机型号 Top {limit} · 哪些旧机换其他系列容易亏</h4><RankingList items={ranking.oldModels} limit={limit} kind="old"/></div>
    </div>
    <p className="text-xs text-[#555]">预计边际利润＝原方案边际利润 − 补贴承担增量 × 1.0466。每条旧机报价分别测算，型号排行合并其不同 PPV 的组合次数。</p>
  </section>;
}
