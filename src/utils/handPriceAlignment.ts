import type { CalculatedProduct, HandPriceAdjustment, SubsidyRule } from '../types';
import { applyManualRecommendedPrice, formatPercent, roundUploadPrice } from './formulas';

export type HandPriceAction = 'align' | 'rollback';
export type HandPriceAdjustments = Record<string, HandPriceAdjustment>;
const money = (value: number) => String(Number(value.toFixed(2)));
const EPS = 1e-9;

// A PPV can appear under several new-device series. Keep each source row independent.
export const handPriceRowKey = (p: CalculatedProduct) => JSON.stringify([
  p.id, p.sourceSheet, p.sourceRowNumber, p.newSeries, p.ppv
]);

const seriesRules = (p: CalculatedProduct, rules: SubsidyRule[]) => rules
  .filter(rule => rule.newSeries === p.newSeries)
  .sort((a, b) => a.threshold - b.threshold);

const signature = (p: CalculatedProduct, rules: SubsidyRule[]) => JSON.stringify([
  handPriceRowKey(p), p.jdPrice, p.recommendJdPrice, p.postJdHandPrice,
  p.basePrice, p.ahsInput, p.jdSubsidy, p.tmPrice, p.tmSubsidyManual,
  p.zzPrice, p.zzHandPrice, rules.length > 0,
  seriesRules(p, rules).map(r => [r.threshold, r.ahsInput, r.jdSubsidy])
]);

function invalidReason(p: CalculatedProduct, rules: SubsidyRule[]) {
  if (!(p.tmPrice > 0) || !(p.tmHandPrice > 0)
    || !Number.isFinite(p.tmHandPrice) || !Number.isFinite(p.tmSubsidyManual)) return '缺少有效天猫到手价';
  if (!(p.basePrice > 0) || !Number.isFinite(p.basePrice)) return '缺少有效基准价，无法核算边际';
  if (!(p.recommendJdPrice > 0) || !Number.isFinite(p.recommendJdPrice)
    || !Number.isFinite(p.postJdHandPrice)) return '缺少有效京东追后价格';
  const active = seriesRules(p, rules);
  if (rules.length && !active.length) return '新机系列未匹配到补贴规则';
  if (active.some(r => !Number.isFinite(r.threshold) || r.threshold < 0
    || !Number.isFinite(r.ahsInput) || r.ahsInput < 0
    || !Number.isFinite(r.jdSubsidy) || r.jdSubsidy < 0)) return '补贴规则不完整或无效';
  if (!active.length && (![p.ahsInput, p.jdSubsidy].every(v => Number.isFinite(v) && v >= 0))) return '缺少有效补贴数据';
  return '';
}

function intervals(p: CalculatedProduct, rules: SubsidyRule[]) {
  const active = seriesRules(p, rules);
  const boundaries = [...new Set([0, ...active.map(r => r.threshold)])].sort((a, b) => a - b);
  return boundaries.map((min, i) => {
    const matched = active.filter(r => r.threshold <= min).at(-1);
    return {
      min, max: boundaries[i + 1] ?? Infinity,
      ahs: matched?.ahsInput ?? (active.length ? 0 : p.ahsInput),
      jd: matched?.jdSubsidy ?? (active.length ? 0 : p.jdSubsidy)
    };
  });
}

// Enumerate the rounding preimages near each interval bound. In particular, 250 ->
// 245 and 251 -> 250 are not idempotent; retaining the input avoids a second rounding.
function candidatesNear(bound: number) {
  const candidates = new Map<number, number>();
  if (!Number.isFinite(bound)) return candidates;
  for (let raw = Math.max(1, Math.floor(bound) - 12); raw <= Math.ceil(bound) + 12; raw++) {
    candidates.set(roundUploadPrice(raw), raw);
  }
  return candidates;
}

function findPrice(p: CalculatedProduct, rules: SubsidyRule[], action: HandPriceAction, floor: number) {
  const target = p.tmHandPrice * 1.03;
  let best: { product: CalculatedProduct; rawPrice: number } | undefined;
  for (const interval of intervals(p, rules)) {
    const bound = action === 'align'
      ? Math.max(p.recommendJdPrice, interval.min, target - interval.jd)
      : Math.min(p.recommendJdPrice, interval.max,
        (p.basePrice * (1 - floor - 0.0218) - 81) / 1.0466 - interval.ahs);
    for (const [price, rawPrice] of candidatesNear(bound)) {
      if (price <= 0 || price < interval.min || price >= interval.max) continue;
      if (action === 'align' && (price < p.recommendJdPrice || price + interval.jd + EPS < target)) continue;
      if (action === 'rollback' && price > p.recommendJdPrice) continue;
      const simulated = applyManualRecommendedPrice(p, rawPrice, floor, rules);
      if (action === 'align' && simulated.postJdHandPrice + EPS < target) continue;
      if (action === 'rollback' && simulated.postMarginalProfit + 1e-12 < floor) continue;
      if (!best || (action === 'align' ? price < best.product.recommendJdPrice : price > best.product.recommendJdPrice)) {
        best = { product: simulated, rawPrice };
      }
    }
  }
  return best;
}

const targetGapText = (gap: number) => gap > EPS ? `距TM 103%还差${money(gap)}元` : '已达TM 103%';

// Keep existing local drafts readable without rerunning either pricing action.
const compactReason = (reason: string | undefined) => {
  if (!reason) return reason;
  const align = reason.match(/^到手价追至TM 103%：物品价.*，上调([\d.]+)元；.*边际(-?[\d.]+%)。$/);
  if (align) return `到手价追至TM 103%：物品价+${money(Number(align[1]))}元；边际${align[2]}。`;
  const rollback = reason.match(/^边际底线回调：当前边际.*设定底线(-?[\d.]+%)；.*下调([\d.]+)元；.*距TM 103%目标差额(-?[\d.]+)元.*边际(-?[\d.]+%)。$/);
  if (rollback) return `边际底线回调：底线${rollback[1]}，物品价-${money(Number(rollback[2]))}元；边际${rollback[4]}；${targetGapText(-Number(rollback[3]))}。`;
  const unchanged = reason.match(/^已达TM到手价103%，保持物品价.*边际(-?[\d.]+%)。$/);
  if (unchanged) return `已达TM 103%，不加价；边际${unchanged[1]}。`;
  const satisfied = reason.match(/^无需回调：当前边际(-?[\d.]+%)满足(-?[\d.]+%)底线，.*$/);
  if (satisfied) return `无需回调：边际${satisfied[1]}，满足${satisfied[2]}底线。`;
  return reason.replace('请先执行到手价追至TM 103%，保持原价', '请先完成到手追至TM 103%')
    .replace('缺少有效基准价，无法核算边际', '缺少基准价')
    .replace('缺少有效天猫到手价', '缺少TM到手价')
    .replace('缺少有效京东追后价格', '缺少京东追后价')
    .replace('新机系列未匹配到补贴规则', '系列未匹配补贴')
    .replace('缺少有效补贴数据', '缺少补贴数据')
    .replace('，保持原价。', '。');
};

export function createHandPriceAdjustment(
  p: CalculatedProduct, rules: SubsidyRule[], action: HandPriceAction, floor: number
): HandPriceAdjustment {
  const previous = p.handPriceAdjustment;
  const record: HandPriceAdjustment = {
    signature: previous?.signature ?? signature(p, rules),
    rawPrice: previous?.rawPrice,
    aligned: previous?.aligned ?? false,
    alignReason: previous?.alignReason ?? ''
  };
  const invalid = invalidReason(p, rules);
  if (action === 'align') {
    if (invalid) return { ...record, aligned: false, alignReason: compactReason(`无法追至TM 103%：${invalid}。`)! };
    if (p.postJdHandPrice + EPS >= p.tmHandPrice * 1.03) {
      return { ...record, aligned: true, alignReason: `已达TM 103%，不加价；边际${formatPercent(p.postMarginalProfit)}。` };
    }
    const best = findPrice(p, rules, action, floor);
    if (!best) return { ...record, aligned: false, alignReason: '未调整：无可用价格能达到TM 103%。' };
    return {
      ...record, rawPrice: best.rawPrice, aligned: true,
      alignReason: `到手价追至TM 103%：物品价+${money(best.product.recommendJdPrice - p.recommendJdPrice)}元；边际${formatPercent(best.product.postMarginalProfit)}。`
    };
  }
  if (!previous?.aligned) return { ...record, rollbackReason: '未回调：请先完成到手追至TM 103%。' };
  if (invalid) return { ...record, rollbackReason: compactReason(`无法回调：${invalid}。`) };
  if (!Number.isFinite(floor) || floor < -1 || floor > 1) return { ...record, rollbackReason: '未回调：边际底线须为-100%至100%的有效数值。' };
  if (p.postMarginalProfit + 1e-12 >= floor) {
    return { ...record, rollbackReason: `无需回调：边际${formatPercent(p.postMarginalProfit)}，满足${formatPercent(floor)}底线。` };
  }
  const best = findPrice(p, rules, action, floor);
  if (!best) return { ...record, rollbackReason: `无法回调：无可用价格满足${formatPercent(floor)}底线；边际仍为${formatPercent(p.postMarginalProfit)}。` };
  return {
    ...record, rawPrice: best.rawPrice,
    rollbackReason: `边际底线回调：底线${formatPercent(floor)}，物品价-${money(p.recommendJdPrice - best.product.recommendJdPrice)}元；边际${formatPercent(best.product.postMarginalProfit)}；${targetGapText(best.product.tmHandPrice * 1.03 - best.product.postJdHandPrice)}。`
  };
}

export function applyHandPriceAdjustment(
  p: CalculatedProduct, record: HandPriceAdjustment | undefined, rules: SubsidyRule[], margin: number
): CalculatedProduct {
  // Old actions must not override a new upload, refreshed prices, subsidies or manual edit.
  if (!record || record.signature !== signature(p, rules)) return p;
  record = { ...record, alignReason: compactReason(record.alignReason)!, rollbackReason: compactReason(record.rollbackReason) };
  const result = record.rawPrice === undefined ? p : applyManualRecommendedPrice(p, record.rawPrice, margin, rules);
  return {
    ...result,
    pricingRemark: record.rawPrice === undefined ? p.pricingRemark : `常规追价：${p.pricingRemark}；后续到手价调整见小差额提醒`,
    handPriceAdjustment: record,
    smallGapOpportunity: record.rawPrice === undefined ? p.smallGapOpportunity : false,
    smallGapToleranceEligible: record.rawPrice === undefined ? p.smallGapToleranceEligible : false,
    smallGapTolerancePrice: record.rawPrice === undefined ? p.smallGapTolerancePrice : undefined,
    smallGapToleranceMargin: record.rawPrice === undefined ? p.smallGapToleranceMargin : undefined,
    smallGapOpportunityRemark: [record.alignReason, record.rollbackReason].filter(Boolean).join('\n')
  };
}

export function updateHandPriceAdjustments(
  products: CalculatedProduct[], selectedKeys: string[], records: HandPriceAdjustments,
  rules: SubsidyRule[], action: HandPriceAction, floor: number
): HandPriceAdjustments {
  const selected = new Set(selectedKeys);
  const next = { ...records };
  products.filter(p => selected.has(handPriceRowKey(p))).forEach(p => {
    next[handPriceRowKey(p)] = createHandPriceAdjustment(p, rules, action, floor);
  });
  return next;
}
