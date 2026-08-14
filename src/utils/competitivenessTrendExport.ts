import { CalculatedProduct, ChannelId, CompetitivenessMetrics, TrackingBatch } from '../types';
import { buildBrandCompetitivenessTimeline } from './brandCompetitiveness';
import { getTrendRangeData, TrendRange } from './trendRange';

export interface CompetitivenessTrendExportPoint extends CompetitivenessMetrics {
  date: string;
  batchName: string;
  nodeType: '历史正式' | '实时草稿';
}

export interface CompetitivenessTrendExportSheet {
  sheetName: string;
  chartTitle: string;
  points: CompetitivenessTrendExportPoint[];
}

export interface CompetitivenessTrendExportPayload {
  rangeLabel: '近15次追价' | '全部';
  sheets: CompetitivenessTrendExportSheet[];
}

interface TimelinePoint extends CompetitivenessMetrics {
  date: string;
  batchName: string;
  isDraft?: boolean;
}

const mapPoints = (points: TimelinePoint[]): CompetitivenessTrendExportPoint[] => points.map(point => ({
  date: point.date,
  batchName: point.batchName,
  nodeType: point.isDraft ? '实时草稿' : '历史正式',
  tmDirectScore: point.tmDirectScore,
  tmItemScore: point.tmItemScore,
  ahsVsZzDirectScore: point.ahsVsZzDirectScore,
  zzItemScore: point.zzItemScore
}));

export const buildCompetitivenessTrendExportPayload = ({
  overallTimeline,
  historyBatches,
  currentCalculatedItems,
  brandOptions,
  trendRange,
  channelId
}: {
  overallTimeline: TimelinePoint[];
  historyBatches: TrackingBatch[];
  currentCalculatedItems: CalculatedProduct[];
  brandOptions: string[];
  trendRange: TrendRange;
  channelId: ChannelId;
}): CompetitivenessTrendExportPayload => {
  const sheets: CompetitivenessTrendExportSheet[] = [{
    sheetName: '总盘走势',
    chartTitle: '总盘竞争力波动走势',
    points: mapPoints(getTrendRangeData(overallTimeline, trendRange))
  }];

  brandOptions.forEach(brand => {
    const points = getTrendRangeData(buildBrandCompetitivenessTimeline({
      historyBatches,
      currentCalculatedItems,
      brand,
      channelId
    }), trendRange);
    if (points.length === 0) return;
    sheets.push({
      sheetName: brand,
      chartTitle: `${brand} 竞争力波动走势`,
      points: mapPoints(points)
    });
  });

  return {
    rangeLabel: trendRange === 'all' ? '全部' : '近15次追价',
    sheets
  };
};
