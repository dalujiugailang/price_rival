import { batchTypeLabel } from './batchScope';
import { CalculatedProduct, ChannelId, CompetitivenessMetrics, TrackingBatch } from '../types';
import { calculateCompetitivenessMetrics } from './competitiveness';

export interface BrandCompetitivenessDataPoint extends CompetitivenessMetrics {
  date: string;
  batchName: string;
  isDraft?: boolean;
}

export const ALL_BRANDS = 'ALL';
export const ALL_SERIES = 'ALL_SERIES';

export const selectCompetitivenessTimeline = <T>(
  overallTimeline: T[],
  brandTimeline: T[],
  selectedBrand: string
) => selectedBrand === ALL_BRANDS ? overallTimeline : brandTimeline;

import { resolveCompetitivenessBrand, resolveCompetitivenessSeries, filterCompetitivenessProducts } from '../../shared/competitivenessScope.mjs';
export { resolveCompetitivenessBrand, resolveCompetitivenessSeries, filterCompetitivenessProducts };
const brandOf = resolveCompetitivenessBrand;
const seriesOf = resolveCompetitivenessSeries;

const compareBrands = (left: string, right: string) => {
  const leftAscii = /^[\x00-\x7F]/.test(left);
  const rightAscii = /^[\x00-\x7F]/.test(right);
  if (leftAscii !== rightAscii) return leftAscii ? -1 : 1;
  return left.localeCompare(right, 'zh-Hans-u-kn-true');
};

export const listCompetitivenessBrands = (
  historyBatches: TrackingBatch[],
  currentCalculatedItems: CalculatedProduct[]
) => Array.from(new Set(
  [
    ...historyBatches.filter(batch => !batch.isSummaryOnly).flatMap(batch => batch.products || []),
    ...currentCalculatedItems
  ].map(brandOf).filter(Boolean)
)).sort(compareBrands);

export const listCompetitivenessSeries = (
  historyBatches: TrackingBatch[],
  currentCalculatedItems: CalculatedProduct[],
  selectedBrand: string = ALL_BRANDS
) => Array.from(new Set(
  [
    ...historyBatches
      .filter(batch => !batch.isSummaryOnly)
      .flatMap(batch => batch.products || []),
    ...currentCalculatedItems
  ]
    .filter(product => selectedBrand === ALL_BRANDS || brandOf(product) === selectedBrand)
    .map(seriesOf)
    .filter(Boolean)
)).sort(compareBrands);

export const buildFilteredCompetitivenessTimeline = ({
  historyBatches,
  currentCalculatedItems,
  brand = ALL_BRANDS,
  newSeries = ALL_SERIES,
  channelId = 'tradeIn'
}: {
  historyBatches: TrackingBatch[];
  currentCalculatedItems: CalculatedProduct[];
  brand?: string;
  newSeries?: string;
  channelId?: ChannelId;
}): BrandCompetitivenessDataPoint[] => {
  if (brand === ALL_BRANDS && newSeries === ALL_SERIES) return [];

  const list: BrandCompetitivenessDataPoint[] = [];
  const savedPoints = [...historyBatches]
    .filter(batch => batch.isCompetitivenessConfirmed && !batch.isSummaryOnly && batch.products.length > 0)
    .sort((left, right) => (
      (left.competitivenessDate || left.date).localeCompare(right.competitivenessDate || right.date)
    ))
    .flatMap(batch => {
      const products = filterCompetitivenessProducts(batch.products, brand, newSeries);
      if (products.length === 0) return [];
      const sourceDate = batch.competitivenessDate || batch.date;
      return [{
        date: sourceDate.slice(5) || sourceDate,
        batchName: `${batchTypeLabel(batch)} · ${batch.id.slice(-8)} ${batch.remarks ? `(${batch.remarks.slice(0, 8)}...)` : ''}`,
        ...calculateCompetitivenessMetrics(products, channelId)
      }];
    });

  savedPoints.forEach(point => {
    const duplicateDate = list.some(item => item.date === point.date);
    list.push(duplicateDate ? { ...point, date: `${point.date} (新)` } : point);
  });

  const liveProducts = filterCompetitivenessProducts(currentCalculatedItems, brand, newSeries);
  if (liveProducts.length > 0) {
    const scopeLabel = [
      brand === ALL_BRANDS ? '' : brand,
      newSeries === ALL_SERIES ? '' : newSeries
    ].filter(Boolean).join(' / ');
    list.push({
      date: '今日(工作台)',
      batchName: `当前工作台(${scopeLabel}实时计算草稿)`,
      isDraft: true,
      ...calculateCompetitivenessMetrics(liveProducts, channelId)
    });
  }

  return list;
};

export const buildBrandCompetitivenessTimeline = ({
  historyBatches,
  currentCalculatedItems,
  brand,
  channelId = 'tradeIn'
}: {
  historyBatches: TrackingBatch[];
  currentCalculatedItems: CalculatedProduct[];
  brand: string;
  channelId?: ChannelId;
}): BrandCompetitivenessDataPoint[] => {
  if (!brand) return [];
  return buildFilteredCompetitivenessTimeline({
    historyBatches,
    currentCalculatedItems,
    brand,
    channelId
  });
};
