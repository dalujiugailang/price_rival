import type {CalculatedProduct} from '../../types';
import {hitWorkspaceSeriesRules} from '../../../shared/subsidyMatrix.mjs';
import {buildSeriesProfitResults} from './model';
import type {MatrixRow, MatrixRule, SeriesProfitResult} from './types';

interface Example {
  product: CalculatedProduct;
  result: SeriesProfitResult;
}
export interface Tier {
  series: string;
  threshold: number;
  ahs: number;
  total: number;
  losses: number;
  ratio: number | null;
  rank: number | null;
  rankTotal: number;
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
  originalTiers: Map<string, Tier>;
  worst?: Example;
}
function entry(name: string): RiskRanking {
  return {name, checked: 0, unknown: 0, losses: 0, alreadyNegative: 0, ratioSum: 0, ratioCount: 0, averageRatio: null,
    quotes: new Set(), targets: new Set(), tiers: new Map(), originalTiers: new Map()};
}
// One peer per series at the exact original threshold. Conflicting or invalid rules cannot be ranked.
export function makeTier(rule: MatrixRule, rules: MatrixRule[], invalidSeries: Set<string>): Tier {
  const peers = new Map<string, number[]>();
  for (const candidate of rules) {
    if (candidate.threshold !== rule.threshold || invalidSeries.has(candidate.series)) continue;
    peers.set(candidate.series, [...(peers.get(candidate.series) || []), candidate.ahs]);
  }
  const conflicts = new Set(rules.filter(candidate => candidate.threshold === rule.threshold).filter(candidate => rules.some(other => other.series === candidate.series && other.threshold === candidate.threshold && (other.ahs !== candidate.ahs || other.jd !== candidate.jd))).map(candidate => candidate.series));
  for (const series of conflicts) peers.delete(series);
  const values = [...peers.values()].filter(values => new Set(values).size === 1).map(values => values[0]);
  const comparable = peers.get(rule.series);
  const ranked = rule.threshold > 0 && comparable && new Set(comparable).size === 1 && comparable[0] === rule.ahs;
  return {series: rule.series, threshold: rule.threshold, ahs: rule.ahs, total: rule.jd, losses: 0,
    ratio: rule.threshold > 0 ? rule.ahs / rule.threshold : null,
    rank: ranked ? 1 + values.filter(value => value > rule.ahs).length : null, rankTotal: values.length};
}
function addTier(tiers: Map<string, Tier>, tier: Tier) {
  const key = JSON.stringify([tier.series, tier.threshold, tier.ahs, tier.total]);
  const current = tiers.get(key) || tier;
  current.losses++;
  tiers.set(key, current);
}
function add(group: RiskRanking, product: CalculatedProduct, result: SeriesProfitResult, tierFor: (rule: MatrixRule) => Tier, original: SeriesProfitResult['hit'], invalidSeries: Set<string>) {
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
    const tier = tierFor(rule);
    if (tier.ratio !== null) {
      group.ratioSum += tier.ratio;
      group.ratioCount++;
      group.averageRatio = group.ratioSum / group.ratioCount;
    }
    addTier(group.tiers, tier);
  }
  if (original.status === 'hit' && !invalidSeries.has(product.newSeries) && original.rules[0]) {
    const rule = {...original.rules[0], ahs: product.ahsSubsidyAfter};
    addTier(group.originalTiers, tierFor(rule));
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
  const cache = new Map<string, Tier>();
  const tierFor = (rule: MatrixRule) => {
    const key = JSON.stringify([rule.series, rule.threshold, rule.ahs, rule.jd]);
    if (!cache.has(key)) cache.set(key, makeTier(rule, rules, invalidSeries));
    return {...cache.get(key)!};
  };
  const newSeries = new Map<string, RiskRanking>();
  const oldModels = new Map<string, RiskRanking>();
  for (const product of products) {
    const original = hitWorkspaceSeriesRules(rules, product.newSeries, product.recommendJdPrice) as SeriesProfitResult['hit'];
    const results = buildSeriesProfitResults({rows, rules, product, floor, invalidSeries});
    for (const result of results) {
      if (result.current) continue;
      const oldName = product.oldModel?.trim() || product.ppv || '未填写旧机型号';
      if (!newSeries.has(result.row.series)) newSeries.set(result.row.series, entry(result.row.series));
      if (!oldModels.has(oldName)) oldModels.set(oldName, entry(oldName));
      add(newSeries.get(result.row.series)!, product, result, tierFor, original, invalidSeries);
      add(oldModels.get(oldName)!, product, result, tierFor, original, invalidSeries);
    }
  }
  const groups = [...newSeries.values()];
  return {newSeries: sorted(newSeries), oldModels: sorted(oldModels),
    checked: groups.reduce((sum, group) => sum + group.checked, 0),
    losses: groups.reduce((sum, group) => sum + group.losses, 0),
    unknown: groups.reduce((sum, group) => sum + group.unknown, 0)};
}
