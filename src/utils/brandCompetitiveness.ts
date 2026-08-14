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

const BRAND_ALIASES = new Map([
  ['iqoo', 'iQOO'],
  ['oppo', 'OPPO'],
  ['redmi', '小米'],
  ['vivo', 'vivo'],
  ['华为', '华为'],
  ['huawei', '华为'],
  ['摩托罗拉', '摩托罗拉'],
  ['motorola', '摩托罗拉'],
  ['moto', '摩托罗拉'],
  ['努比亚', '努比亚'],
  ['nubia', '努比亚'],
  ['荣耀', '荣耀'],
  ['honor', '荣耀'],
  ['三星', '三星'],
  ['samsung', '三星'],
  ['小米', '小米'],
  ['xiaomi', '小米'],
  ['一加', '一加'],
  ['oneplus', '一加'],
  ['真我', '真我'],
  ['realme', '真我']
]);

const normalizeBrandAlias = (value: unknown) => {
  const brand = String(value || '').trim();
  return BRAND_ALIASES.get(brand.toLocaleLowerCase()) || '';
};

const rawBrandOf = (product: CalculatedProduct) => {
  const entry = Object.entries(product.rawFields || {}).find(([key]) => {
    const fieldName = key.replace(/^[A-Z]+_/, '').trim().replace(/\s+/g, '').toLocaleLowerCase();
    return ['品牌名称', '品牌', 'brandname', 'brand'].includes(fieldName);
  });
  const explicitBrand = String(entry?.[1] || '').trim();
  return explicitBrand ? normalizeBrandAlias(explicitBrand) || explicitBrand : '';
};

const brandOf = (product: CalculatedProduct) => (
  rawBrandOf(product) || normalizeBrandAlias(product.brand)
);

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
  _historyBatches: TrackingBatch[],
  currentCalculatedItems: CalculatedProduct[]
) => Array.from(new Set(
  currentCalculatedItems.map(brandOf).filter(Boolean)
)).sort(compareBrands);

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
