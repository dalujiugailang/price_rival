import type { TrackingBatch } from '../types';

export interface EfficiencyPeriod {
  batch: TrackingBatch;
  savedDay: string;
  start: string;
  end: string | null;
  score: number | null;
  eligibleQuotes: number;
  winningQuotes: number;
  selectedCount: number | null;
  priceCoverage: number | null;
  warnings: string[];
}

const shanghaiDay = (timestamp: string) => {
  // Legacy timestamps without a timezone cannot establish a real save instant.
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(timestamp)) return null;
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
    : null;
};
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

export function buildEfficiencyPeriods(batches: TrackingBatch[]): { periods: EfficiencyPeriod[]; excluded: number; sameDayReplaced: number } {
  const candidates = batches.filter(b => (b.channelId || 'tradeIn') === 'tradeIn' && b.batchType === 'regular'
    && !b.isSummaryOnly && !/^(RECOVERED|COMP)-/.test(b.id) && b.serverCreatedAt && shanghaiDay(b.serverCreatedAt));
  const sorted = [...candidates].sort((a, b) => Date.parse(a.serverCreatedAt!) - Date.parse(b.serverCreatedAt!) || a.id.localeCompare(b.id));
  const days = new Map<string, TrackingBatch>();
  for (const batch of sorted) days.set(shanghaiDay(batch.serverCreatedAt!)!, batch);
  const chosen = [...days.entries()];
  const periods = chosen.map(([savedDay, batch], index): EfficiencyPeriod => {
    const selected = batch.restorePayload?.selectedCompetitionPpvs ?? batch.competitionCoveragePpvs;
    const selectedSet = selected ? new Set(selected) : null;
    const products = selectedSet ? batch.products.filter(p => selectedSet.has(p.ppv)) : [];
    const seen = new Set<string>();
    let eligibleQuotes = 0, winningQuotes = 0, totalQuotes = 0, duplicate = false;
    for (const p of products) {
      if (seen.has(p.ppv)) { duplicate = true; continue; }
      seen.add(p.ppv);
      const q = Number.isFinite(p.quoteVolume) ? Math.max(0, p.quoteVolume) : 0;
      totalQuotes += q;
      if (!(Number.isFinite(p.tmHandPrice) && p.tmHandPrice > 0 && Number.isFinite(p.postJdHandPrice))) continue;
      eligibleQuotes += q;
      if (p.postJdHandPrice >= p.tmHandPrice) winningQuotes += q;
    }
    const warnings: string[] = [];
    if (!selectedSet) warnings.push('缺少历史覆盖名单');
    if (selectedSet && [...selectedSet].some(ppv => !seen.has(ppv))) warnings.push('覆盖名单与价格明细未完全匹配');
    if (duplicate) warnings.push('PPV重复，竞争力暂不计算');
    const end = chosen[index + 1]?.[0] || null;
    if (!end) warnings.push('开放期');
    if (batch.pricingTimestamp && batch.pricingTimestamp.slice(0, 10) !== savedDay) warnings.push('追价日与保存日不同');
    const start = nextDay(savedDay);
    if (batches.some(b => b.batchType === 'launch' && (b.channelId || 'tradeIn') === 'tradeIn' && b.serverCreatedAt
      && (() => { const day = shanghaiDay(b.serverCreatedAt); return day && day >= savedDay && (!end || day <= end); })())) warnings.push('期内存在新品活动，需核验覆盖重叠');
    return { batch, savedDay, start, end, score: eligibleQuotes > 0 && !duplicate && !warnings.includes('覆盖名单与价格明细未完全匹配') ? 100 * winningQuotes / eligibleQuotes : null,
      eligibleQuotes, winningQuotes, selectedCount: selectedSet?.size ?? null,
      priceCoverage: totalQuotes > 0 ? eligibleQuotes / totalQuotes * 100 : null, warnings };
  });
  return { periods, excluded: batches.length - candidates.length, sameDayReplaced: candidates.length - chosen.length };
}
