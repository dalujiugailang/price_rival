export type TrendRange = 'recent15' | 'all';

const RECENT_TREND_COUNT = 15;

export const getTrendRangeData = <T>(
  data: T[],
  range: TrendRange = 'recent15'
): T[] => range === 'all' ? data : data.slice(-RECENT_TREND_COUNT);
