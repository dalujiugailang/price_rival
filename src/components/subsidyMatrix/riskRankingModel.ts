import type {CalculatedProduct} from '../../types';
import {buildSeriesProfitResults} from './model';
import type {MatrixRow, MatrixRule, SeriesProfitResult} from './types';

interface Example {
  product: CalculatedProduct;
  result: SeriesProfitResult;
}
interface Tier {
  series: string;
  threshold: number;
  ahs: number;
  total: number;
  losses: number;
  ratio: number | null;
}
export interface RiskRanking {
  name: string;
  checked: number;
  unknown: number;
  losses: number;
  alreadyNegative: number;
  ratioSum: number;
  ratioCount: number;
  averageRatio: number | null;
  quotes: Set<CalculatedProduct>;
  targets: Set<string>;
  tiers: Map<string, Tier>;
  worst?: Example;
}
function entry(name: string): RiskRanking {
  return {name, checked: 0, unknown: 0, losses: 0, alreadyNegative: 0, ratioSum: 0, ratioCount: 0, averageRatio: null,
    quotes: new Set(), targets: new Set(), tiers: new Map()};
}
function add(group: RiskRanking, product: CalculatedProduct, result: SeriesProfitResult) {
  group.quotes.add(product);
  if (!result.comparison) {
    group.unknown++;
    return;
  }
  group.checked++;
  if (result.comparison.risk !== '亏损风险') return;
  group.losses++;
  group.targets.add(result.row.series);
  if (product.postMarginalProfit < 0) group.alreadyNegative++;
  const rule = result.hit.rules[0];
  if (rule) {
    const ratio = rule.threshold > 0 ? rule.ahs / rule.threshold : null;
    if (ratio !== null) {
      group.ratioSum += ratio;
      group.ratioCount++;
      group.averageRatio = group.ratioSum / group.ratioCount;
    }
    const key = JSON.stringify([rule.series, rule.threshold, rule.ahs, rule.jd]);
    const tier = group.tiers.get(key) || {series: rule.series, threshold: rule.threshold, ahs: rule.ahs, total: rule.jd, losses: 0, ratio};
    tier.losses++;
    group.tiers.set(key, tier);
  }
  if (!group.worst || result.comparison.profit < group.worst.result.comparison!.profit) {
    group.worst = {product, result};
  }
}
function sorted(groups: Map<string, RiskRanking>) {
  return [...groups.values()].filter(group => group.losses > 0).sort((a, b) =>
    b.losses - a.losses || b.losses / b.checked - a.losses / a.checked || a.name.localeCompare(b.name, 'zh-CN'));
}
export function buildRiskRankings({products, rows, rules, invalidSeries, floor}: {
  products: CalculatedProduct[];
  rows: MatrixRow[];
  rules: MatrixRule[];
  invalidSeries: Set<string>;
  floor: number;
}) {
  const newSeries = new Map<string, RiskRanking>();
  const oldModels = new Map<string, RiskRanking>();
  for (const product of products) {
    const results = buildSeriesProfitResults({rows, rules, product, floor, invalidSeries});
    for (const result of results) {
      if (result.current) continue;
      const oldName = product.oldModel?.trim() || product.ppv || '未填写旧机型号';
      if (!newSeries.has(result.row.series)) newSeries.set(result.row.series, entry(result.row.series));
      if (!oldModels.has(oldName)) oldModels.set(oldName, entry(oldName));
      add(newSeries.get(result.row.series)!, product, result);
      add(oldModels.get(oldName)!, product, result);
    }
  }
  const groups = [...newSeries.values()];
  return {newSeries: sorted(newSeries), oldModels: sorted(oldModels),
    checked: groups.reduce((sum, group) => sum + group.checked, 0),
    losses: groups.reduce((sum, group) => sum + group.losses, 0),
    unknown: groups.reduce((sum, group) => sum + group.unknown, 0)};
}
