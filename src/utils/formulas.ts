/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Product, CalculatedProduct, SubsidyRule, PricingMode } from '../types';
import { SOURCE_0518_PRODUCTS } from '../data/source0518';

export const INITIAL_PRODUCTS: Product[] = SOURCE_0518_PRODUCTS;

export const INITIAL_SUBSIDIES = [];

const round2 = (value: number) => Math.round(value * 100) / 100;

export const roundUploadPrice = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const integerPrice = Math.floor(value);
  const base = Math.floor(integerPrice / 100) * 100;
  const tail = integerPrice - base;

  if (tail === 0) return base;
  if (tail <= 39) return base;
  if (tail <= 49) return base + 40;
  if (tail <= 59) return base + 50;
  if (tail <= 69) return base + 60;
  return base + 100;
};

export const getRoundedCompetitivePrice = (competitorPrice: number) => {
  if (!Number.isFinite(competitorPrice) || competitorPrice <= 0) return 0;
  const start = competitorPrice + 2;
  for (let price = start; price <= start + 200; price += 1) {
    const rounded = roundUploadPrice(price);
    if (rounded > competitorPrice) return rounded;
  }
  return roundUploadPrice(start + 200);
};

const normalizeFieldName = (value: string) => value.replace(/^[A-Z]+_/, '').trim().replace(/\s+/g, '').toLowerCase();

const sourceNumber = (product: Product, aliases: string[]) => {
  const entries = Object.entries(product.rawFields || {});
  const found = entries.find(([key]) => aliases.some(alias => normalizeFieldName(key) === normalizeFieldName(alias)));
  if (!found) return null;
  if (typeof found[1] === 'number' && Number.isFinite(found[1])) return found[1];
  const parsed = Number(String(found[1] ?? '').replace(/[¥,%\s,]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeRules = (rules: SubsidyRule[]) => {
  return [...rules]
    .filter(rule => Number.isFinite(rule.threshold) && Number.isFinite(rule.ahsInput))
    .sort((a, b) => a.threshold - b.threshold);
};

const subsidyAtPrice = (price: number, rules: SubsidyRule[], fallback: number) => {
  if (rules.length === 0) return fallback;
  const matched = rules.filter(rule => price >= rule.threshold).at(-1);
  return matched ? matched.ahsInput : 0;
};

const jdSubsidyAtPrice = (price: number, rules: SubsidyRule[], fallback: number) => {
  if (rules.length === 0) return fallback;
  const matched = rules.filter(rule => price >= rule.threshold).at(-1);
  if (!matched) return 0;
  return Number.isFinite(matched.jdSubsidy) ? matched.jdSubsidy : fallback;
};

const calcLinearCost = (itemPrice: number, subsidy: number, basePrice: number) => {
  return (itemPrice + subsidy) * 0.0466 + basePrice * 0.0218 + 81;
};

const calcMarginalProfit = (itemPrice: number, subsidy: number, basePrice: number) => {
  if (basePrice <= 0) return 0;
  const linearCost = calcLinearCost(itemPrice, subsidy, basePrice);
  return 1 - (itemPrice + subsidy + linearCost) / basePrice;
};

const findBestPriceByMargin = (
  product: Product,
  rules: SubsidyRule[],
  targetMargin: number
) => {
  const usableRules = normalizeRules(rules);
  const intervals = usableRules.length > 0
    ? usableRules.map((rule, index) => ({
      min: rule.threshold,
      max: usableRules[index + 1] ? usableRules[index + 1].threshold - 0.01 : Number.POSITIVE_INFINITY,
      subsidy: rule.ahsInput
    }))
    : [{ min: 0, max: Number.POSITIVE_INFINITY, subsidy: product.ahsInput }];

  const rawUpperBounds = intervals
    .map(interval => {
      const theoreticalAhsUpper = (product.basePrice * (1 - targetMargin - 0.0218) - 81) / 1.0466;
      return Math.min(theoreticalAhsUpper - interval.subsidy, interval.max);
    })
    .filter(value => Number.isFinite(value) && value > 0);
  const upperBound = Math.floor(Math.max(...rawUpperBounds, product.jdPrice));
  const checkedPrices = new Set<number>();
  let bestPrice = 0;
  let bestSubsidy = 0;

  for (let rawPrice = upperBound; rawPrice >= 0; rawPrice -= 1) {
    const candidate = roundUploadPrice(rawPrice);
    if (checkedPrices.has(candidate)) continue;
    checkedPrices.add(candidate);

    const subsidy = subsidyAtPrice(candidate, usableRules, product.ahsInput);
    const margin = calcMarginalProfit(candidate, subsidy, product.basePrice);
    if (margin > targetMargin) {
      bestPrice = candidate;
      bestSubsidy = subsidy;
      break;
    }
  }

  return { price: round2(bestPrice), subsidy: bestSubsidy };
};

export function calculateProductPrice(product: Product, targetMargin: number, subsidyRules: SubsidyRule[] = [], pricingMode: PricingMode = 'margin'): CalculatedProduct {
  const seriesRules = normalizeRules(subsidyRules.filter(rule => rule.newSeries === product.newSeries));
  const currentSubsidy = subsidyAtPrice(product.jdPrice, seriesRules, product.ahsInput);
  const currentJdSubsidy = jdSubsidyAtPrice(product.jdPrice, seriesRules, product.jdSubsidy);
  const ahsQuotedPrice = product.jdPrice + currentSubsidy;
  const jdHandPrice = product.jdPrice + currentJdSubsidy;
  const tmHandPrice = product.tmPrice + product.tmSubsidyManual;
  const zzCoupon = sourceNumber(product, ['zz券', '转转券']) ?? round2(product.zzPrice * 0.18);
  const zzHandPrice = sourceNumber(product, ['zz券后价', '转转券后价']) ?? round2(product.zzPrice + zzCoupon);

  const jdVsTmItemGap = product.jdPrice - product.tmPrice;
  const jdVsTmHandGap = jdHandPrice - tmHandPrice;
  const jdVsZzItemGap = product.jdPrice - product.zzPrice;
  const ahsVsZzHandGap = ahsQuotedPrice - zzHandPrice;
  const jdVsZzHandGap = jdHandPrice - zzHandPrice;

  const preGrossMargin = product.basePrice > 0 ? 1 - ahsQuotedPrice / product.basePrice : 0;
  const preLinearCost = calcLinearCost(product.jdPrice, currentSubsidy, product.basePrice);
  const preMarginalProfit = calcMarginalProfit(product.jdPrice, currentSubsidy, product.basePrice);
  const preGapRate = product.basePrice > 0 ? jdVsTmItemGap / product.basePrice : 0;

  const targetCompetitorPrice = product.tmPrice;
  let recommendJdPrice = product.jdPrice;
  let ahsSubsidyAfter = currentSubsidy;
  let maxPriceByMargin = product.jdPrice;
  let pricingRemark = '';

  if (pricingMode === 'fullCompetition') {
    if (product.tmPrice <= 0) {
      pricingRemark = 'tm裸机价缺失，不调整';
    } else if (product.jdPrice >= product.tmPrice) {
      pricingRemark = 'jd裸机价>=tm裸机价，不调整';
    } else {
      const targetPrice = getRoundedCompetitivePrice(product.tmPrice);
      recommendJdPrice = targetPrice;
      ahsSubsidyAfter = subsidyAtPrice(targetPrice, seriesRules, currentSubsidy);
      maxPriceByMargin = targetPrice;
      pricingRemark = '100%竞争力：追过tm裸机价';
    }
  } else if (preMarginalProfit <= 0) {
    pricingRemark = '追前边际利润率<=0%，不调整';
  } else if (product.jdPrice >= product.tmPrice) {
    pricingRemark = 'jd裸机价>=tm裸机价，不调整';
  } else {
    const targetPrice = getRoundedCompetitivePrice(product.tmPrice);
    const targetSubsidy = subsidyAtPrice(targetPrice, seriesRules, currentSubsidy);
    const targetPostMargin = calcMarginalProfit(targetPrice, targetSubsidy, product.basePrice);

    if (targetPostMargin >= targetMargin) {
      recommendJdPrice = targetPrice;
      ahsSubsidyAfter = targetSubsidy;
      maxPriceByMargin = targetPrice;
      pricingRemark = '追过tm裸机价后边际达标';
    } else {
      const best = findBestPriceByMargin(product, seriesRules, targetMargin);
      maxPriceByMargin = best.price;
      if (best.price > 0 && best.price >= product.jdPrice) {
        recommendJdPrice = best.price;
        ahsSubsidyAfter = best.subsidy;
        pricingRemark = '按补贴区间反推最高达标追价';
      } else {
        recommendJdPrice = product.jdPrice;
        ahsSubsidyAfter = currentSubsidy;
        pricingRemark = best.price > 0 && best.price < product.jdPrice
          ? '修正后价格低于jd裸机价'
          : '未找到满足边际底线的追价';
      }
    }
  }

  const recommendAdjustment = round2(recommendJdPrice - product.jdPrice);
  const postAhsPrice = recommendJdPrice + ahsSubsidyAfter;
  const postLinearCost = calcLinearCost(recommendJdPrice, ahsSubsidyAfter, product.basePrice);
  const postGrossMargin = product.basePrice > 0 ? 1 - postAhsPrice / product.basePrice : 0;
  const postMarginalProfit = calcMarginalProfit(recommendJdPrice, ahsSubsidyAfter, product.basePrice);
  const postJdSubsidy = jdSubsidyAtPrice(recommendJdPrice, seriesRules, currentJdSubsidy);
  const postJdHandPrice = recommendJdPrice + postJdSubsidy;

  const tmItemWin = product.tmPrice > 0 && jdVsTmItemGap > 0;
  const tmHandWin = tmHandPrice > 0 && jdVsTmHandGap > 0;
  const zzItemWin = product.zzPrice > 0 && jdVsZzItemGap > 0;
  const ahsZzHandWin = zzHandPrice > 0 && ahsVsZzHandGap > 0;
  const jdZzHandWin = zzHandPrice > 0 && jdVsZzHandGap > 0;

  const postTmItemWin = product.tmPrice > 0 && recommendJdPrice > product.tmPrice;
  const postTmHandWin = tmHandPrice > 0 && postJdHandPrice > tmHandPrice;
  const postZzItemWin = product.zzPrice > 0 && recommendJdPrice > product.zzPrice;
  const postAhsZzHandWin = zzHandPrice > 0 && postAhsPrice > zzHandPrice;
  const hasSpace = recommendAdjustment > 0;

  let riskWarning: 'SAFE' | 'WARNING' | 'CRITICAL' = 'SAFE';
  if (postMarginalProfit < targetMargin) {
    riskWarning = 'CRITICAL';
  } else if (postMarginalProfit < targetMargin + 0.02) {
    riskWarning = 'WARNING';
  }

  return {
    ...product,
    ahsInput: currentSubsidy,
    jdSubsidy: currentJdSubsidy,
    ahsQuotedPrice,
    jdHandPrice,
    tmHandPrice,
    zzCoupon,
    zzHandPrice,
    jdVsTmItemGap,
    jdVsTmHandGap,
    jdVsZzItemGap,
    ahsVsZzHandGap,
    jdVsZzHandGap,
    tmItemWin,
    tmHandWin,
    zzItemWin,
    ahsZzHandWin,
    jdZzHandWin,
    preGrossMargin,
    preLinearCost,
    preMarginalProfit,
    preGapRate,
    recommendJdPrice,
    recommendAdjustment,
    ahsSubsidyAfter,
    postAhsPrice,
    postLinearCost,
    postGrossMargin,
    postMarginalProfit,
    postJdHandPrice,
    postTmItemWin,
    postTmHandWin,
    postZzItemWin,
    postAhsZzHandWin,
    targetCompetitorPrice,
    maxPriceByMargin: round2(maxPriceByMargin),
    riskWarning,
    hasSpace,
    pricingRemark,
    model: product.oldModel,
    category: product.newSeries,
    baseCost: product.basePrice,
    currentPrice: product.jdPrice,
    totalSubsidy: postJdSubsidy,
    competitorLowestPrice: targetCompetitorPrice,
    competitorLowestSource: product.tmPrice >= product.zzPrice ? 'TM天猫' : 'ZZ转转',
    minAllowedPrice: round2(maxPriceByMargin),
    isBelowBottomLine: riskWarning === 'CRITICAL',
    maxTrackSpace: Math.max(0, round2(maxPriceByMargin - product.jdPrice)),
    recommendPrice: recommendJdPrice,
    estMarginRate: postMarginalProfit,
    generalSubsidy: currentSubsidy,
    tradeInSubsidy: postJdSubsidy,
    incentiveSubsidy: product.tmSubsidyManual,
    tmSubsidy: product.tmSubsidyManual
  };
}

export function runBatchCalculations(products: Product[], targetMargin: number, subsidyRules: SubsidyRule[] = [], pricingMode: PricingMode = 'margin'): CalculatedProduct[] {
  return products.map(p => calculateProductPrice(p, targetMargin, subsidyRules, pricingMode));
}

export function applyManualRecommendedPrice(product: CalculatedProduct, manualPrice: number, targetMargin: number, subsidyRules: SubsidyRule[] = []): CalculatedProduct {
  const seriesRules = normalizeRules(subsidyRules.filter(rule => rule.newSeries === product.newSeries));
  const recommendJdPrice = roundUploadPrice(manualPrice);
  const ahsSubsidyAfter = subsidyAtPrice(recommendJdPrice, seriesRules, product.ahsInput);
  const postAhsPrice = recommendJdPrice + ahsSubsidyAfter;
  const postLinearCost = calcLinearCost(recommendJdPrice, ahsSubsidyAfter, product.basePrice);
  const postGrossMargin = product.basePrice > 0 ? 1 - postAhsPrice / product.basePrice : 0;
  const postMarginalProfit = calcMarginalProfit(recommendJdPrice, ahsSubsidyAfter, product.basePrice);
  const postJdSubsidy = jdSubsidyAtPrice(recommendJdPrice, seriesRules, product.jdSubsidy);
  const postJdHandPrice = recommendJdPrice + postJdSubsidy;
  const recommendAdjustment = round2(recommendJdPrice - product.jdPrice);

  let riskWarning: 'SAFE' | 'WARNING' | 'CRITICAL' = 'SAFE';
  if (postMarginalProfit < targetMargin) {
    riskWarning = 'CRITICAL';
  } else if (postMarginalProfit < targetMargin + 0.02) {
    riskWarning = 'WARNING';
  }

  const originalRemark = product.pricingRemark.replace(/^手动改价：[^；]+；?/, '');
  const pricingRemark = `手动改价：${round2(product.recommendJdPrice)}→${recommendJdPrice}${originalRemark ? `；${originalRemark}` : ''}`;

  return {
    ...product,
    recommendJdPrice,
    recommendAdjustment,
    ahsSubsidyAfter,
    postAhsPrice,
    postLinearCost,
    postGrossMargin,
    postMarginalProfit,
    postJdHandPrice,
    postTmItemWin: product.tmPrice > 0 && recommendJdPrice > product.tmPrice,
    postTmHandWin: product.tmHandPrice > 0 && postJdHandPrice > product.tmHandPrice,
    postZzItemWin: product.zzPrice > 0 && recommendJdPrice > product.zzPrice,
    postAhsZzHandWin: product.zzHandPrice > 0 && postAhsPrice > product.zzHandPrice,
    riskWarning,
    hasSpace: recommendAdjustment > 0,
    pricingRemark,
    manualRecommendJdPrice: recommendJdPrice,
    totalSubsidy: postJdSubsidy,
    minAllowedPrice: recommendJdPrice,
    isBelowBottomLine: riskWarning === 'CRITICAL',
    maxTrackSpace: Math.max(0, recommendAdjustment),
    recommendPrice: recommendJdPrice,
    estMarginRate: postMarginalProfit,
    tradeInSubsidy: postJdSubsidy
  };
}

export function simulateIncrementalPriceUpdate(products: Product[]): Product[] {
  return products.map((p, index) => {
    const delta = index % 3 === 0 ? 20 : index % 3 === 1 ? -10 : 0;
    return {
      ...p,
      jdPrice: Math.max(0, p.jdPrice + delta),
      tmPrice: Math.max(0, p.tmPrice + (index % 2 === 0 ? 15 : -8)),
      zzPrice: Math.max(0, p.zzPrice + (index % 2 === 0 ? -12 : 18))
    };
  });
}

export function parsePastedPricesText(text: string): { ppv: string; tmPrice: number; tmSubsidy: number; zzPrice: number }[] {
  const result: { ppv: string; tmPrice: number; tmSubsidy: number; zzPrice: number }[] = [];
  text.split('\n').forEach(line => {
    if (!line.trim()) return;
    const parts = line.includes('\t') ? line.split('\t') : line.split(',');
    if (parts.length >= 2) {
      result.push({
        ppv: parts[0].trim(),
        tmPrice: parseFloat(parts[1]) || 0,
        tmSubsidy: parts[2] ? parseFloat(parts[2]) || 0 : 0,
        zzPrice: parts[3] ? parseFloat(parts[3]) || 0 : 0
      });
    }
  });
  return result.filter(row => row.ppv);
}

export function formatRMB(val: number | undefined): string {
  if (val === undefined || isNaN(val)) return '¥0.00';
  return `¥${val.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatPercent(val: number | undefined): string {
  if (val === undefined || isNaN(val)) return '0.00%';
  return `${(val * 100).toFixed(2)}%`;
}
