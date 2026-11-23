import type { CalculatedProduct } from '../types';
import { resolveCompetitivenessBrand, resolveCompetitivenessSeries } from './brandCompetitiveness';
import { viewMetrics } from './competitivenessView';

export const buildCompetitivenessBreakdown = (products: CalculatedProduct[], bySeries: boolean) => {
  const groups = new Map<string, { brand: string; series: string; products: CalculatedProduct[] }>();
  for (const product of products) {
    const brand = resolveCompetitivenessBrand(product);
    const series = resolveCompetitivenessSeries(product);
    const key = bySeries ? JSON.stringify([brand, series]) : brand;
    const group = groups.get(key) || { brand, series, products: [] };
    group.products.push(product);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, group]) => {
    const metrics = viewMetrics(group.products, 'tradeIn');
    const weight = (field: 'tmPrice' | 'tmHandPrice') => group.products.reduce((sum, product) => (
      Number(product[field]) > 0 && product.quoteVolume > 0 ? sum + product.quoteVolume : sum
    ), 0);
    return {
      key, brand: group.brand, series: group.series,
      label: bySeries ? group.series || '未分组系列' : group.brand || '未识别品牌',
      count: group.products.length,
      tmItemScore: metrics.tmItemScore, tmDirectScore: metrics.tmDirectScore,
      itemWeight: weight('tmPrice'), handWeight: weight('tmHandPrice')
    };
  }).sort((a, b) => (b.tmItemScore ?? -1) - (a.tmItemScore ?? -1) || a.label.localeCompare(b.label, 'zh-CN'));
};
