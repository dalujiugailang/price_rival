import { CalculatedProduct, ChannelId, CompetitivenessMetrics, TrackingBatch } from '../types';
import { calculateCompetitivenessMetrics } from './competitiveness';

export interface BrandCompetitivenessDataPoint extends CompetitivenessMetrics {
  date: string;
  batchName: string;
  isDraft?: boolean;
}

export const ALL_BRANDS = 'ALL';

export const selectCompetitivenessTimeline = <T>(
  overallTimeline: T[],
  brandTimeline: T[],
  selectedBrand: string
) => selectedBrand === ALL_BRANDS ? overallTimeline : brandTimeline;

const brandOf = (product: CalculatedProduct) => String(product.brand || '').trim();

export const filterCompetitivenessProducts = (
  products: CalculatedProduct[],
  selectedBrand: string
) => selectedBrand === ALL_BRANDS
  ? products
  : products.filter(product => brandOf(product) === selectedBrand);

const compareBrands = (left: string, right: string) => {
  const leftAscii = /^[\x00-\x7F]/.test(left);
  const rightAscii = /^[\x00-\x7F]/.test(right);
  if (leftAscii !== rightAscii) return leftAscii ? -1 : 1;
  return left.localeCompare(right, 'zh-Hans-u-kn-true');
};

export const listCompetitivenessBrands = (
  historyBatches: TrackingBatch[],
  currentCalculatedItems: CalculatedProduct[]
) => Array.from(new Set([
  ...historyBatches
    .filter(batch => batch.isCompetitivenessConfirmed && !batch.isSummaryOnly && batch.products.length > 0)
    .flatMap(batch => batch.products.map(brandOf)),
  ...currentCalculatedItems.map(brandOf)
].filter(Boolean))).sort(compareBrands);

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

  const list: BrandCompetitivenessDataPoint[] = [];
  const savedPoints = [...historyBatches]
    .filter(batch => batch.isCompetitivenessConfirmed && !batch.isSummaryOnly && batch.products.length > 0)
    .sort((left, right) => (
      (left.competitivenessDate || left.date).localeCompare(right.competitivenessDate || right.date)
    ))
    .flatMap(batch => {
      const products = batch.products.filter(product => brandOf(product) === brand);
      if (products.length === 0) return [];
      const sourceDate = batch.competitivenessDate || batch.date;
      return [{
        date: sourceDate.slice(5) || sourceDate,
        batchName: `${batch.id.slice(-8)} ${batch.remarks ? `(${batch.remarks.slice(0, 8)}...)` : ''}`,
        ...calculateCompetitivenessMetrics(products, channelId)
      }];
    });

  savedPoints.forEach(point => {
    const duplicateDate = list.some(item => item.date === point.date);
    list.push(duplicateDate ? { ...point, date: `${point.date} (新)` } : point);
  });

  const liveProducts = currentCalculatedItems.filter(product => brandOf(product) === brand);
  if (liveProducts.length > 0) {
    list.push({
      date: '今日(工作台)',
      batchName: `当前工作台(${brand}实时计算草稿)`,
      isDraft: true,
      ...calculateCompetitivenessMetrics(liveProducts, channelId)
    });
  }

  return list;
};
