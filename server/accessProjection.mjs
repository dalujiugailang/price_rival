import { canAccess } from '../shared/accessPolicy.mjs';
const COMMON = ['id', 'ppv', 'brand', 'newSeries', 'oldModel', 'model'];
const TREND = ['quoteVolume', 'soldVolume', 'recommendJdPrice', 'recommendPrice', 'postAhsPrice', 'postJdHandPrice',
  'tmPrice', 'tmHandPrice', 'tmRecyclerQuotedPrice', 'tmRecyclerSubsidy', 'tmSubsidyManual', 'totalSubsidy', 'zzPrice', 'zzHandPrice',
  'postTmItemWin', 'postTmHandWin', 'postAhsTmRecyclerWin', 'postZzItemWin', 'postAhsZzHandWin', 'postJdZzHandWin'];
const GAP = ['postAhsPrice', 'postJdHandPrice', 'tmHandPrice', 'zzHandPrice', 'postTmHandWin', 'postAhsZzHandWin'];
const META = ['id', 'channelId', 'channelName', 'date', 'dataDate', 'operator', 'remarks', 'isSummaryOnly',
  'isCompetitivenessConfirmed', 'competitivenessDate', 'pricingTimestamp', 'confirmedAt', 'serverCreatedAt', 'serverCreatedBy'];
const pick = (object, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(object, key)).map(key => [key, object[key]]));
export const projectBatch = (batch, user, isLatest = true) => {
  const channel = batch.channelId || 'tradeIn';
  if (canAccess(user, channel, 'history') || (isLatest && canAccess(user, channel, 'workspace'))) return batch;
  const trend = canAccess(user, channel, 'competitiveness');
  const gap = canAccess(user, channel, 'tmHandGap');
  const upload = canAccess(user, channel, 'upload');
  if (!trend && !gap && !upload) return null;
  const allowed = [...COMMON, ...(trend ? TREND : []), ...(gap ? GAP : []), ...(upload ? ['sourceSheet', 'sourceRowNumber', 'sourceFieldCount'] : [])];
  return {
    ...pick(batch, META),
    ...(trend ? { competitivenessMetrics: batch.competitivenessMetrics } : {}),
    ...(upload ? { sourceUploadRecords: batch.sourceUploadRecords || [] } : {}),
    products: (batch.products || []).map(product => ({
      ...pick(product, allowed),
      ...(trend ? { rawFields: Object.fromEntries(Object.entries(product.rawFields || {}).filter(([key]) =>
        ['品牌名称', '品牌', 'brandname', 'brand'].includes(key.replace(/^[A-Z]+_/, '').replace(/\s+/g, '').toLowerCase()))) } : {})
    }))
  };
};
export const listAuthorizedBatches = (db, user, channelId = null) => {
  const source = db.listBatches(channelId);
  const latest = new Set();
  return source.flatMap(batch => {
    const channel = batch.channelId || 'tradeIn';
    const allHistory = canAccess(user, channel, 'history') || canAccess(user, channel, 'competitiveness');
    if (!allHistory && (latest.has(channel) || batch.isSummaryOnly || !batch.products?.length)) return [];
    const isLatest = !latest.has(channel) && !batch.isSummaryOnly && batch.products?.length > 0;
    const projected = projectBatch(batch, user, isLatest);
    if (!projected) return [];
    if (isLatest) latest.add(channel);
    return [projected];
  });
};
