import { CalculatedProduct, ChannelId, CompetitivenessMetrics, TrackingBatch } from '../types';
import { calculateCompetitivenessMetrics } from './competitiveness';
import {
  ALL_BRANDS, ALL_SERIES, filterCompetitivenessProducts,
  listCompetitivenessBrands, listCompetitivenessSeries
} from './brandCompetitiveness';
import { getTrendRangeData, TrendRange } from './trendRange';

export const ALL_BATCHES = 'ALL_BATCHES';
export const LIVE_DRAFT = 'LIVE_DRAFT';

export type CompetitivenessViewMetrics = {
  [K in keyof CompetitivenessMetrics]-?: number | null;
};

export interface CompetitivenessViewSnapshot {
  batchId: string;
  name: string;
  date: string;
  remarks: string;
  isDraft: boolean;
  isConfirmed: boolean;
  isSummaryOnly: boolean;
  products: CalculatedProduct[];
  metrics: CompetitivenessViewMetrics;
}

export interface CompetitivenessViewPoint extends CompetitivenessViewMetrics {
  batchId: string;
  date: string;
  sourceDate: string;
  batchName: string;
  isDraft: boolean;
  isSnapshot: boolean;
  isSummaryOnly: boolean;
}

export const unavailableViewMetrics = (): CompetitivenessViewMetrics => ({
  tmItemScore: null, tmDirectScore: null, ahsVsTmRecyclerScore: null,
  zzItemScore: null, ahsVsZzDirectScore: null, jdVsZzDirectScore: null
});

const ELIGIBLE_PRICE: Record<keyof CompetitivenessMetrics, keyof CalculatedProduct> = {
  tmItemScore: 'tmPrice',
  tmDirectScore: 'tmHandPrice',
  ahsVsTmRecyclerScore: 'tmRecyclerQuotedPrice',
  zzItemScore: 'zzPrice',
  ahsVsZzDirectScore: 'zzHandPrice',
  jdVsZzDirectScore: 'zzHandPrice'
};

// Keep saved scores and the existing weighting formula. A missing denominator is
// unavailable in this view, rather than a measured zero-percent win rate.
const viewMetrics = (
  products: CalculatedProduct[], channelId: ChannelId, saved?: CompetitivenessMetrics
): CompetitivenessViewMetrics => {
  const metrics = saved || calculateCompetitivenessMetrics(products, channelId);
  const result = unavailableViewMetrics();
  for (const key of Object.keys(ELIGIBLE_PRICE) as (keyof CompetitivenessMetrics)[]) {
    const value = metrics[key];
    const hasWeight = products.some(product => (
      Number(product[ELIGIBLE_PRICE[key]]) > 0 && product.quoteVolume > 0
    ));
    result[key] = hasWeight && typeof value === 'number' && Number.isFinite(value) ? value : null;
  }
  return result;
};

const savedSummaryMetrics = (saved?: CompetitivenessMetrics): CompetitivenessViewMetrics => {
  const result = unavailableViewMetrics();
  for (const key of Object.keys(result) as (keyof CompetitivenessMetrics)[]) {
    const value = saved?.[key];
    result[key] = typeof value === 'number' && Number.isFinite(value) ? value : null;
  }
  return result;
};

export const buildCompetitivenessView = ({
  historyBatches, currentCalculatedItems, sourceId = ALL_BATCHES,
  brand = ALL_BRANDS, newSeries = ALL_SERIES, channelId = 'tradeIn',
  liveDate = new Date().toLocaleDateString('sv-SE'), activeSubsidyFileName = ''
}: {
  historyBatches: TrackingBatch[];
  currentCalculatedItems: CalculatedProduct[];
  sourceId?: string;
  brand?: string;
  newSeries?: string;
  channelId?: ChannelId;
  liveDate?: string;
  activeSubsidyFileName?: string;
}) => {
  const batches = historyBatches.filter(batch => (batch.channelId || 'tradeIn') === channelId)
    .slice().sort((a, b) => (a.competitivenessDate || a.date).localeCompare(b.competitivenessDate || b.date)
      || (a.serverCreatedAt || a.id).localeCompare(b.serverCreatedAt || b.id));
  const selectedBatch = batches.find(batch => batch.id === sourceId);
  const effectiveSourceId = sourceId === LIVE_DRAFT || selectedBatch ? sourceId : ALL_BATCHES;
  const scopeBatches = effectiveSourceId === ALL_BATCHES ? batches : selectedBatch ? [selectedBatch] : [];
  const scopeLive = effectiveSourceId === ALL_BATCHES || effectiveSourceId === LIVE_DRAFT ? currentCalculatedItems : [];
  const brandOptions = listCompetitivenessBrands(scopeBatches, scopeLive);
  const effectiveBrand = brandOptions.includes(brand) ? brand : ALL_BRANDS;
  const seriesOptions = channelId === 'selfOperated' ? [] : listCompetitivenessSeries(scopeBatches, scopeLive, effectiveBrand);
  const effectiveSeries = seriesOptions.includes(newSeries) ? newSeries : ALL_SERIES;
  const hasDimensionFilter = effectiveBrand !== ALL_BRANDS || effectiveSeries !== ALL_SERIES;
  const filter = (products: CalculatedProduct[]) => filterCompetitivenessProducts(products, effectiveBrand, effectiveSeries);

  const snapshots: CompetitivenessViewSnapshot[] = batches.map(batch => {
    const products = batch.isSummaryOnly ? [] : filter(batch.products || []);
    return {
      batchId: batch.id,
      name: batch.id,
      date: batch.competitivenessDate || batch.date,
      remarks: batch.remarks || '无备注',
      isDraft: false,
      isConfirmed: !!batch.isCompetitivenessConfirmed,
      isSummaryOnly: !!batch.isSummaryOnly,
      products,
      metrics: batch.isSummaryOnly
        ? hasDimensionFilter ? unavailableViewMetrics() : savedSummaryMetrics(batch.competitivenessMetrics)
        : viewMetrics(products, channelId, hasDimensionFilter ? undefined : batch.competitivenessMetrics)
    };
  });
  const liveProducts = filter(currentCalculatedItems);
  const live: CompetitivenessViewSnapshot = {
    batchId: LIVE_DRAFT, name: '实时工作台', date: liveDate,
    remarks: activeSubsidyFileName ? `当前生效补贴表：${activeSubsidyFileName}` : '当前实时测算',
    isDraft: true, isConfirmed: false, isSummaryOnly: false,
    products: liveProducts, metrics: viewMetrics(liveProducts, channelId)
  };
  const candidates = [...snapshots, live];
  const details = effectiveSourceId === ALL_BATCHES
    ? candidates.filter(snapshot => snapshot.products.length > 0
      || Object.values(snapshot.metrics).some(value => value !== null)).at(-1) || null
    : candidates.find(snapshot => snapshot.batchId === effectiveSourceId) || null;

  const toPoint = (snapshot: CompetitivenessViewSnapshot, isSnapshot = false): CompetitivenessViewPoint => ({
    // Unconfirmed snapshots get separate highlighted dots, never a formal line segment.
    ...(isSnapshot ? unavailableViewMetrics() : snapshot.metrics),
    batchId: snapshot.batchId,
    date: snapshot.isDraft ? '今日(工作台)' : isSnapshot ? '选定快照' : snapshot.date.slice(5, 10),
    sourceDate: snapshot.date,
    batchName: `${snapshot.name}${snapshot.remarks !== '无备注' ? ` · ${snapshot.remarks}` : ''}`,
    isDraft: snapshot.isDraft, isSnapshot, isSummaryOnly: snapshot.isSummaryOnly
  });
  const timeline = snapshots.filter(snapshot => snapshot.isConfirmed).map(snapshot => toPoint(snapshot));
  if (currentCalculatedItems.length > 0 || effectiveSourceId === LIVE_DRAFT) timeline.push(toPoint(live));
  if (details && !details.isDraft && !details.isConfirmed) timeline.push(toPoint(details, true));

  return {
    sourceId: effectiveSourceId, brand: effectiveBrand, newSeries: effectiveSeries,
    brandOptions, seriesOptions, batches: [...batches].reverse(), details, timeline,
    hasDimensionFilter,
    metrics: details?.metrics || unavailableViewMetrics()
  };
};

// Keep an older selected batch visible even when it falls outside the latest 15 nodes.
export const getCompetitivenessViewRange = (
  timeline: CompetitivenessViewPoint[], range: TrendRange, selectedId?: string
) => {
  const recent = getTrendRangeData(timeline, range);
  const needsAll = selectedId && timeline.some(point => point.batchId === selectedId)
    && !recent.some(point => point.batchId === selectedId);
  return { points: needsAll ? timeline : recent, range: needsAll ? 'all' as const : range };
};
