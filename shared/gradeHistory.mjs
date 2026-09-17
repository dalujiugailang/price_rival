// A run belongs to an exact saved batch, never just to a date or the latest batch.
export function gradeBatchMismatch(request, batch) {
  if (!batch || (batch.channelId || 'tradeIn') !== 'tradeIn' || !batch.products?.length || batch.isSummaryOnly) return '请选择有明细的京东换新已保存快照';
  if (!request.prices?.length) return '测算缺少原始追价记录';
  const remaining = [...batch.products];
  for (const price of request.prices) {
    const index = remaining.findIndex(p => String(p.id) === price.id && String(p.skuId) === price.skuId
      && p.ppv === price.ppv && (p.newSeries || '') === price.newSeries && p.oldModel === price.model
      && p.recommendJdPrice === price.price
      && (price.display?.recommendAdjustment == null || p.recommendAdjustment === price.display.recommendAdjustment));
    if (index < 0) return '测算的原始追价记录与该快照不一致，请先保存对应的重点追价快照';
    remaining.splice(index, 1);
  }
  return '';
}

export const gradeSourceBatchId = request => request.trackingBatchId
  || /^共享快照\s+(TRACK-\S+)$/.exec(request.workspaceVersion || '')?.[1] || '';
