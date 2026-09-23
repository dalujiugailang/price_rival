import type { Product, TrackingBatch } from '../types';

// Build editable inputs from a snapshot while retaining explicit manual prices.
export function snapshotPricingProducts(batch: TrackingBatch): Product[] {
  return batch.products.map(p => ({
    id:p.id,sourceSheet:p.sourceSheet,sourceRowNumber:p.sourceRowNumber,sourceFieldCount:p.sourceFieldCount,
    rawFields:{...p.rawFields},newSeries:p.newSeries,oldModel:p.oldModel,ppv:p.ppv,brand:p.brand,
    level:p.level,skuId:p.skuId,levelId:p.levelId,quoteVolume:p.quoteVolume,soldVolume:p.soldVolume,
    description:p.description,jdPrice:p.jdPrice,ahsInput:p.ahsInput,jdSubsidy:p.jdSubsidy,
    tmPrice:p.tmPrice,tmSubsidyManual:p.tmSubsidyManual,tmSubsidySheet:p.tmSubsidySheet,
    zzPrice:p.zzPrice,basePrice:p.basePrice,manualBasePrice:p.manualBasePrice
  }));
}

export function snapshotManualRecommendPrices(batch: TrackingBatch): Record<string, number> {
  return Object.fromEntries(batch.products
    .filter(product => Number.isFinite(product.manualRecommendJdPrice))
    .map(product => [product.ppv, product.manualRecommendJdPrice!]));
}

export function buildSnapshotRestore(batch: TrackingBatch) {
  if (batch.isSummaryOnly || !batch.products?.length) {
    return { canRestore: false, warnings: ['该快照没有可编辑的明细。'] as string[] };
  }
  const payload = batch.restorePayload;
  const productsMaster = payload?.productsMaster?.length ? payload.productsMaster : snapshotPricingProducts(batch);
  const manualRecommendPrices = payload?.manualRecommendPrices || snapshotManualRecommendPrices(batch);
  const warnings: string[] = [];
  if (!payload) warnings.push('该快照为旧格式，未保存完整的历史输入包。');
  if (!payload?.subsidyRules?.length) warnings.push('未保存当时的补贴规则，重新计算前请核对补贴表。');
  if (!batch.sourceUploadRecords?.some(record => record.type === 'base' || record.type === 'subsidy')) {
    warnings.push('未留存原始竞争表或补贴表文件。');
  }
  return {
    canRestore: true,
    warnings,
    productsMaster,
    dailyPriceRows: payload?.dailyPriceRows || [],
    subsidyRules: payload?.subsidyRules || [],
    selfSubsidyRules: payload?.selfSubsidyRules || [],
    manualRecommendPrices,
    selectedCompetitionPpvs: payload?.selectedCompetitionPpvs || batch.products.map(product => product.ppv),
    activeSubsidyFileName: payload?.activeSubsidyFileName || batch.subsidyFileName || '未上传补贴表，沿用基础表字段',
    dailyPriceSource: payload?.dailyPriceSource
  };
}
