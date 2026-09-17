import type { Product, TrackingBatch } from '../types';

// Reuse saved input prices, not saved recommendations or manual overrides.
export function snapshotPricingProducts(batch: TrackingBatch): Product[] {
  return batch.products.map(p => ({
    id:p.id,sourceSheet:p.sourceSheet,sourceRowNumber:p.sourceRowNumber,sourceFieldCount:p.sourceFieldCount,
    rawFields:{...p.rawFields},newSeries:p.newSeries,oldModel:p.oldModel,ppv:p.ppv,brand:p.brand,
    level:p.level,skuId:p.skuId,levelId:p.levelId,quoteVolume:p.quoteVolume,soldVolume:p.soldVolume,
    description:p.description,jdPrice:p.jdPrice,ahsInput:p.ahsInput,jdSubsidy:p.jdSubsidy,
    tmPrice:p.tmPrice,tmSubsidyManual:p.tmSubsidyManual,tmSubsidySheet:p.tmSubsidySheet,
    zzPrice:p.zzPrice,basePrice:p.basePrice
  }));
}
