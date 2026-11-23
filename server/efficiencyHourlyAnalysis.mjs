import { ceilSnapshotHour, beijingTime, normalizeModel } from './efficiencyWarehouse.mjs';
import { createHash } from 'node:crypto';

const HOUR = 3600000, DAY = 24 * HOUR;
const selectedProducts = b => {
  const list = b.restorePayload?.selectedCompetitionPpvs ?? b.competitionCoveragePpvs;
  return list ? (b.products || []).filter(p => new Set(list).has(p.ppv)) : b.products || [];
};
const modelsOf = b => new Set(selectedProducts(b).map(p => normalizeModel(p.oldModel)).filter(Boolean));
const overlaps = (a, b, c, d) => a < d && c < b;

export function analyzeHourlyEfficiency(rows, batches, importedDays) {
  if (!rows.length) return null;
  const available = new Set(importedDays);
  const dates = [...available].sort();
  const maxDay = dates.at(-1), windowDate = new Date(`${maxDay}T00:00:00Z`);
  const originalDay = windowDate.getUTCDate();
  windowDate.setUTCDate(1); windowDate.setUTCMonth(windowDate.getUTCMonth() - 2);
  const monthEnd = new Date(Date.UTC(windowDate.getUTCFullYear(), windowDate.getUTCMonth() + 1, 0)).getUTCDate();
  windowDate.setUTCDate(Math.min(originalDay, monthEnd) + 1);
  const windowStart = windowDate.toISOString().slice(0, 10);
  const startLimit = Date.parse(`${windowStart}T00:00:00+08:00`), endLimit = Date.parse(`${maxDay}T00:00:00+08:00`) + DAY;
  const flow = rows.filter(r => r.day >= windowStart && r.day <= maxDay).map(r => ({ ...r, instant: Date.parse(`${r.day}T${String(r.hour).padStart(2, '0')}:00:00+08:00`), normalized: normalizeModel(r.model) }));
  const regular = batches.filter(b => (b.channelId || 'tradeIn') === 'tradeIn' && b.batchType === 'regular' && !/^(RECOVERED|COMP)-/.test(b.id) && ceilSnapshotHour(b.serverCreatedAt) !== null)
    .sort((a, b) => Date.parse(a.serverCreatedAt) - Date.parse(b.serverCreatedAt) || a.id.localeCompare(b.id));
  const byHour = new Map();
  for (const b of regular) byHour.set(ceilSnapshotHour(b.serverCreatedAt), b);
  const ordered = [...byHour.entries()].sort((a, b) => a[0] - b[0]);
  // Preserve the previously approved three full calendar-day launch exclusion.
  const launches = batches.filter(b => b.batchType === 'launch' && (b.channelId || 'tradeIn') === 'tradeIn' && ceilSnapshotHour(b.serverCreatedAt) !== null).map(b => {
    const midnight = Date.parse(`${beijingTime(Date.parse(b.serverCreatedAt)).slice(0, 10)}T00:00:00+08:00`);
    return { id: b.id, start: midnight + DAY, end: midnight + 4 * DAY, models: modelsOf(b) };
  });
  const periods = [], excluded = [], supported = new Set();
  for (let i = 0; i < ordered.length; i++) {
    const [start, b] = ordered[i], end = ordered[i + 1]?.[0];
    const skip = reason => excluded.push({ batchId: b.id, start: beijingTime(start), end: end ? beijingTime(end) : undefined, reason });
    if (start < startLimit) { skip('不在近两个月完整窗口内'); continue; }
    if (!end || end > endLimit) { skip('开放期或经营数据未覆盖完整期'); continue; }
    if (b.isSummaryOnly || !b.products?.length) { skip('快照仅有汇总或缺少价格明细'); continue; }
    const required = new Set();
    for (let hour = start; hour < end; hour += HOUR) required.add(beijingTime(hour).slice(0, 10));
    const missing = [...required].filter(d => !available.has(d));
    if (missing.length) { skip(`缺少全天数据：${missing.join('、')}`); continue; }
    const activity = launches.filter(l => overlaps(start, end, l.start, l.end));
    const banned = new Set(activity.flatMap(l => [...l.models]));
    const involved = modelsOf(b), effective = new Set([...involved].filter(m => !banned.has(m)));
    const products = selectedProducts(b), analysisProducts = products.filter(p => !banned.has(normalizeModel(p.oldModel)));
    const totals = ps => ps.reduce((a, p) => {
      const q = Math.max(0, Number(p.quoteVolume) || 0); a.all += q;
      if (Number(p.tmHandPrice) > 0 && Number.isFinite(Number(p.postJdHandPrice))) { a.valid += q; if (Number(p.postJdHandPrice) >= Number(p.tmHandPrice)) a.win += q; }
      return a;
    }, { all: 0, valid: 0, win: 0 });
    const score = totals(analysisProducts), raw = totals(products);
    if (!effective.size || !score.valid) { skip('无有效竞争覆盖或到手价样本'); continue; }
    const cells = new Map(), matched = new Set();
    const periodRows = flow.filter(row => row.instant >= start && row.instant < end);
    const competitionBands = new Set(periodRows.filter(row => !banned.has(row.normalized) && effective.has(row.normalized) && row.quotes > 0).map(row => row.band));
    let excludedNonCompetitionBandQuotes = 0;
    let excludedActivityQuotes = 0;
    for (const row of periodRows) {
      if (banned.has(row.normalized)) { excludedActivityQuotes += row.quotes; continue; }
      if (!competitionBands.has(row.band)) { excludedNonCompetitionBandQuotes += row.quotes; continue; }
      if (effective.has(row.normalized)) matched.add(row.normalized);
      if (!cells.has(row.band)) cells.set(row.band, { competition: [0, 0], control: [0, 0] });
      const cell = cells.get(row.band)[effective.has(row.normalized) ? 'competition' : 'control'];
      cell[0] += row.quotes; cell[1] += row.submissions;
    }
    const sums = group => [...cells.values()].reduce((a, c) => [a[0] + c[group][0], a[1] + c[group][1]], [0, 0]);
    const [cq, cs] = sums('competition'), [nq, ns] = sums('control');
    const common = [...cells].filter(([, c]) => c.competition[0] > 0 && c.control[0] > 0);
    const denominator = common.reduce((s, [, c]) => s + c.competition[0], 0);
    if (!denominator) { skip('当期没有两组都有报价的可比价位段'); continue; }
    const strata = common.map(([band, c]) => {
      supported.add(band);
      return { band, weight: c.competition[0] / denominator, competitionQuotes: c.competition[0], competitionSubmissions: c.competition[1], controlQuotes: c.control[0], controlSubmissions: c.control[1], difference: 100 * (c.competition[1] / c.competition[0] - c.control[1] / c.control[0]) };
    });
    periods.push({ batchId: b.id, start: beijingTime(start), end: beijingTime(end), days: (end - start) / DAY, hours: (end - start) / HOUR,
      savedAt: b.serverCreatedAt, score: 100 * score.win / score.valid, snapshotScore: raw.valid ? 100 * raw.win / raw.valid : null,
      difference: strata.reduce((s, c) => s + c.weight * c.difference, 0), competitionQuotes: cq, competitionSubmissions: cs, controlQuotes: nq, controlSubmissions: ns,
      competitionRate: 100 * cs / cq, controlRate: 100 * ns / nq, comparisonCoverage: 100 * denominator / cq, strata,
      involvedModels: involved.size, analysisModels: effective.size, excludedActivityModels: involved.size - effective.size, excludedActivityQuotes,
      competitionBands: [...competitionBands].sort(), excludedNonCompetitionBandQuotes,
      excludedBandQuotes: 0, modelMatchRate: 100 * matched.size / effective.size, priceCoverage: score.all ? 100 * score.valid / score.all : 0 });
  }
  const included = new Set(periods.map(p => p.batchId));
  const inputFingerprint = createHash('sha256').update(JSON.stringify({ rules: 'hourly-warehouse-v2-competition-bands', windowStart, maxDay, periods })).digest('hex');
  return { version: 'hourly-warehouse-v2-competition-bands', inputFingerprint, generatedAt: new Date().toISOString(), timeBasis: 'ceil_snapshot_save_hour',
    analysisWindow: { start: windowStart, end: maxDay, mode: 'rolling_two_calendar_months', completePeriodsOnly: true },
    flowMinDate: dates[0], flowMaxDate: maxDay, latestSnapshotSavedAt: regular.at(-1)?.serverCreatedAt || new Date().toISOString(),
    scope: '手机 / 京东换新 / 上传小时数据', grouping: '当期追价涉及型号；对照仅取竞争型号所在提交A等级价位段内的其他型号', bandField: '提交A等级价位段（统一）',
    weightBasis: '各期竞争组实际报价量占比', commonStrataCount: supported.size, launchModelCount: new Set(launches.flatMap(l => [...l.models])).size,
    sourceRowCount: flow.length, sourceQuotes: flow.reduce((s, r) => s + r.quotes, 0), sourceSubmissions: flow.reduce((s, r) => s + r.submissions, 0),
    launchExclusion: '新品保存次日起连续3个自然日；只在重叠常规期排除对应型号', periods, excludedPeriods: excluded,
    snapshotAudit: batches.map(b => ({ id: b.id, type: b.batchType, summaryOnly: !!b.isSummaryOnly, included: included.has(b.id), createdAt: b.serverCreatedAt,
      reason: included.has(b.id) ? '已纳入小时覆盖期' : excluded.find(e => e.batchId === b.id)?.reason || (regular.includes(b) ? '同一生效整点由较晚快照替代' : '非普通快照或缺少可靠保存时刻') })),
    caveats: ['覆盖期为快照保存时间向上取整到整点，含开始、不含结束；北京时间',
      '上传A等级价位段等同提交A等级价位段（统一），仅京东换新',
      '缺失日期不补零；已确认完整日内未出现的组合视为无记录',
      '型号层面同期观察差值；提交量沿用上传表口径，未确认报价后续提交归属',
      '模型仅使用与当前小时样本匹配的版本；数据或快照变化后需重新建模'] };
}
