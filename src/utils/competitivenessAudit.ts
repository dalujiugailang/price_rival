import { CalculatedProduct, CompetitivenessMetrics } from '../types';
import { calculateCompetitivenessMetrics } from './competitiveness';
import {
  resolveCompetitivenessBrand,
  resolveCompetitivenessSeries
} from './brandCompetitiveness';

export const TM_SUBSIDY_CARRY_GAP_LABEL = '天猫补贴承接缺口';
export const UNIDENTIFIED_BRAND = '未识别品牌';
export const UNGROUPED_SERIES = '未分组系列';

export interface TmSubsidyIssueProduct {
  key: string;
  ppv: string;
  quoteVolume: number;
  soldVolume: number | null;
  jdItemPrice: number | null;
  tmItemPrice: number | null;
  itemPriceGap: number | null;
  jdInvestment: number | null;
  tmManualSubsidy: number | null;
  subsidyGap: number | null;
  jdHandPrice: number | null;
  tmHandPrice: number | null;
  handPriceGap: number | null;
}

interface CompetitivenessAuditSummary {
  metrics: CompetitivenessMetrics;
  tmSubsidyCarryGap: number;
  productCount: number;
  tmItemEligibleQuoteVolume: number;
  tmHandEligibleQuoteVolume: number;
  hasTmCoverageMismatch: boolean;
  allBrandsCommonEligibleQuoteVolume: number;
  issueQuoteVolume: number;
  issueQuoteVolumeShare: number;
  issueProducts: TmSubsidyIssueProduct[];
}

export interface CompetitivenessAuditSeries extends CompetitivenessAuditSummary {
  key: string;
  brand: string;
  newSeries: string;
}

export interface CompetitivenessAuditBrand extends CompetitivenessAuditSummary {
  key: string;
  brand: string;
  series: CompetitivenessAuditSeries[];
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const round2 = (value: number) => Math.round(value * 100) / 100;

const nonNegativeVolume = (value: unknown) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
};

const finiteNumber = (value: unknown, fallback = 0) => {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const nullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const nonNegativeNumberOrNull = (value: unknown) => {
  const numeric = nullableNumber(value);
  return numeric === null ? null : Math.max(0, numeric);
};

const roundedGap = (left: number | null, right: number | null) => (
  left === null || right === null ? null : round2(left - right)
);

const issueProductsOf = (products: CalculatedProduct[]): TmSubsidyIssueProduct[] => (
  products
    .filter(product => (
      finiteNumber(product.tmPrice) > 0
      && finiteNumber(product.tmHandPrice) > 0
      && product.postTmItemWin
      && !product.postTmHandWin
    ))
    .map((product, index) => {
      const jdItemPrice = nullableNumber(product.recommendJdPrice ?? product.recommendPrice);
      const tmItemPrice = nullableNumber(product.tmPrice);
      const jdInvestment = nullableNumber(product.totalSubsidy);
      const tmManualSubsidy = nullableNumber(product.tmSubsidyManual);
      const jdHandPrice = nullableNumber(product.postJdHandPrice);
      const tmHandPrice = nullableNumber(product.tmHandPrice);

      return {
        key: `${String(product.id || product.ppv || 'ppv')}-${index}`,
        ppv: String(product.ppv || '').trim(),
        quoteVolume: nonNegativeVolume(product.quoteVolume),
        soldVolume: nonNegativeNumberOrNull(product.soldVolume),
        jdItemPrice,
        tmItemPrice,
        itemPriceGap: roundedGap(jdItemPrice, tmItemPrice),
        jdInvestment,
        tmManualSubsidy,
        subsidyGap: roundedGap(jdInvestment, tmManualSubsidy),
        jdHandPrice,
        tmHandPrice,
        handPriceGap: roundedGap(jdHandPrice, tmHandPrice)
      };
    })
    .sort((left, right) => (
      right.quoteVolume - left.quoteVolume
      || (left.handPriceGap ?? Number.POSITIVE_INFINITY) - (right.handPriceGap ?? Number.POSITIVE_INFINITY)
      || left.ppv.localeCompare(right.ppv, 'zh-Hans-u-kn-true')
    ))
);

const summarizeProducts = (
  products: CalculatedProduct[],
  allBrandsCommonEligibleQuoteVolume: number
): CompetitivenessAuditSummary => {
  const metrics = calculateCompetitivenessMetrics(products, 'tradeIn');
  const issueProducts = issueProductsOf(products);
  const tmItemEligibleQuoteVolume = products
    .filter(product => finiteNumber(product.tmPrice) > 0)
    .reduce((sum, product) => sum + nonNegativeVolume(product.quoteVolume), 0);
  const tmHandEligibleQuoteVolume = products
    .filter(product => finiteNumber(product.tmHandPrice) > 0)
    .reduce((sum, product) => sum + nonNegativeVolume(product.quoteVolume), 0);
  const commonEligibleQuoteVolume = products
    .filter(product => finiteNumber(product.tmPrice) > 0 && finiteNumber(product.tmHandPrice) > 0)
    .reduce((sum, product) => sum + nonNegativeVolume(product.quoteVolume), 0);
  const issueQuoteVolume = issueProducts.reduce((sum, product) => sum + product.quoteVolume, 0);

  return {
    metrics,
    tmSubsidyCarryGap: round1(metrics.tmItemScore - metrics.tmDirectScore),
    productCount: products.length,
    tmItemEligibleQuoteVolume,
    tmHandEligibleQuoteVolume,
    hasTmCoverageMismatch: commonEligibleQuoteVolume !== tmItemEligibleQuoteVolume
      || commonEligibleQuoteVolume !== tmHandEligibleQuoteVolume,
    allBrandsCommonEligibleQuoteVolume,
    issueQuoteVolume,
    issueQuoteVolumeShare: allBrandsCommonEligibleQuoteVolume > 0
      ? round1(issueQuoteVolume / allBrandsCommonEligibleQuoteVolume * 100)
      : 0,
    issueProducts
  };
};

const compareAuditRows = <T extends CompetitivenessAuditSummary>(left: T, right: T) => (
  right.metrics.tmItemScore - left.metrics.tmItemScore
  || right.tmItemEligibleQuoteVolume - left.tmItemEligibleQuoteVolume
  || right.tmSubsidyCarryGap - left.tmSubsidyCarryGap
);

export const buildCompetitivenessAudit = (
  products: CalculatedProduct[]
): CompetitivenessAuditBrand[] => {
  const allBrandsCommonEligibleQuoteVolume = products
    .filter(product => finiteNumber(product.tmPrice) > 0 && finiteNumber(product.tmHandPrice) > 0)
    .reduce((sum, product) => sum + nonNegativeVolume(product.quoteVolume), 0);
  const productsByBrand = new Map<string, CalculatedProduct[]>();

  products.forEach(product => {
    const brand = resolveCompetitivenessBrand(product)
      || String(product.brand || '').trim()
      || UNIDENTIFIED_BRAND;
    const grouped = productsByBrand.get(brand) || [];
    grouped.push(product);
    productsByBrand.set(brand, grouped);
  });

  return Array.from(productsByBrand.entries())
    .map(([brand, brandProducts]) => {
      const productsBySeries = new Map<string, CalculatedProduct[]>();
      brandProducts.forEach(product => {
        const newSeries = resolveCompetitivenessSeries(product) || UNGROUPED_SERIES;
        const grouped = productsBySeries.get(newSeries) || [];
        grouped.push(product);
        productsBySeries.set(newSeries, grouped);
      });

      const series = Array.from(productsBySeries.entries())
        .map(([newSeries, seriesProducts]) => ({
          key: `${brand}\u0000${newSeries}`,
          brand,
          newSeries,
          ...summarizeProducts(seriesProducts, allBrandsCommonEligibleQuoteVolume)
        }))
        .sort((left, right) => (
          compareAuditRows(left, right)
          || left.newSeries.localeCompare(right.newSeries, 'zh-Hans-u-kn-true')
        ));

      return {
        key: brand,
        brand,
        ...summarizeProducts(brandProducts, allBrandsCommonEligibleQuoteVolume),
        series
      };
    })
    .sort((left, right) => (
      compareAuditRows(left, right)
      || left.brand.localeCompare(right.brand, 'zh-Hans-u-kn-true')
    ));
};
