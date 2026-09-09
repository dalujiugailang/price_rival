/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useMemo } from 'react';
import { 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend,
  ReferenceLine,
  ReferenceDot
} from 'recharts';
import type { LegendPayload } from 'recharts';
import { TrendingUp, TrendingDown, Target, Info, AlertCircle, ShoppingBag, Radio, Download } from 'lucide-react';
import { CalculatedProduct, ChannelId, CompetitivenessMetrics, TrackingBatch } from '../types';
import { exportCompetitivenessTrends } from '../api';
import { formatPercent, formatRMB } from '../utils/formulas';
import { calculateCompetitivenessMetrics } from '../utils/competitiveness';
import { TrendRange } from '../utils/trendRange';
import {
  ALL_BRANDS,
  ALL_SERIES,
  listCompetitivenessBrands
} from '../utils/brandCompetitiveness';
import {
  ALL_BATCHES, LIVE_DRAFT, buildCompetitivenessView,
  getCompetitivenessViewRange, CompetitivenessViewPoint
} from '../utils/competitivenessView';
import { buildCompetitivenessTrendExportPayload } from '../utils/competitivenessTrendExport';
import CompetitivenessAuditTable from './CompetitivenessAuditTable';

interface Props {
  historyBatches: TrackingBatch[];
  currentCalculatedItems: CalculatedProduct[];
  activeSubsidyFileName: string;
  channelId?: ChannelId;
  channelName?: string;
}

interface CompetitivenessDataPoint extends CompetitivenessMetrics {
  date: string;
  batchName: string;
  isDraft?: boolean;
}

type TrendMetricKey =
  | 'tmItemScore'
  | 'ahsVsTmRecyclerScore'
  | 'tmDirectScore'
  | 'zzItemScore'
  | 'ahsVsZzDirectScore'
  | 'jdVsZzDirectScore';

const ZZ_TREND_METRIC_KEYS: TrendMetricKey[] = [
  'zzItemScore',
  'ahsVsZzDirectScore',
  'jdVsZzDirectScore'
];

const TREND_METRIC_KEYS = new Set<TrendMetricKey>([
  'tmItemScore',
  'ahsVsTmRecyclerScore',
  'tmDirectScore',
  ...ZZ_TREND_METRIC_KEYS
]);

const TREND_METRIC_KEY_BY_NAME: Record<string, TrendMetricKey> = {
  '天猫物品价竞争力': 'tmItemScore',
  'AHS补贴后 vs TM回收商补贴后': 'ahsVsTmRecyclerScore',
  '天猫到手价竞争力': 'tmDirectScore',
  '转转物品价竞争力': 'zzItemScore',
  '物品价+ahs补贴 vs 转转到手价': 'ahsVsZzDirectScore',
  '京东到手价 vs 转转到手价': 'jdVsZzDirectScore'
};

const isTrendMetricKey = (dataKey: LegendPayload['dataKey']): dataKey is TrendMetricKey => (
  typeof dataKey === 'string' && TREND_METRIC_KEYS.has(dataKey as TrendMetricKey)
);

export default function CompetitivenessSummary({ 
  historyBatches, 
  currentCalculatedItems,
  activeSubsidyFileName,
  channelId = 'tradeIn',
  channelName = '京东换新'
}: Props) {
  const isSelfOperated = channelId === 'selfOperated';
  const quoteWeightFieldLabel = isSelfOperated ? 'ppv近30天报价访客数' : 'ppv近30天报价量';
  const quoteWeightShortLabel = isSelfOperated ? '报价访客数加权' : '报价量加权';
  const quoteWeightFormulaLabel = isSelfOperated
    ? '有竞争力PPV的近30天报价访客数 / 有效竞品PPV的近30天报价访客数'
    : '有竞争力PPV的近30天报价量 / 有效竞品PPV的近30天报价量';
  const [selectedBatchId, setSelectedBatchId] = useState<string>(ALL_BATCHES);
  const [trendRange, setTrendRange] = useState<TrendRange>('recent15');
  const [hiddenTrendMetrics, setHiddenTrendMetrics] = useState<Set<TrendMetricKey>>(
    () => new Set(isSelfOperated ? [] : ZZ_TREND_METRIC_KEYS)
  );
  const [selectedBrand, setSelectedBrand] = useState(ALL_BRANDS);
  const [selectedSeries, setSelectedSeries] = useState(ALL_SERIES);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  useEffect(() => {
    setHiddenTrendMetrics(new Set(isSelfOperated ? [] : ZZ_TREND_METRIC_KEYS));
  }, [isSelfOperated]);

  const handleTrendLegendClick = (entry: LegendPayload) => {
    const metricKey = isTrendMetricKey(entry.dataKey)
      ? entry.dataKey
      : TREND_METRIC_KEY_BY_NAME[String(entry.value || '')];
    if (!metricKey) return;
    setHiddenTrendMetrics(current => {
      const next = new Set(current);
      if (next.has(metricKey)) {
        next.delete(metricKey);
      } else {
        next.add(metricKey);
      }
      return next;
    });
  };

  // Generate complete trend timeline data, merging historical database with the live draft state
  const timelineData = useMemo(() => {
    const list: CompetitivenessDataPoint[] = [];

    // Read real saved history batches
    const savedPoints = [...historyBatches]
      .filter(batch => batch.isCompetitivenessConfirmed)
      .sort((left, right) => {
        const leftDate = left.competitivenessDate || left.date;
        const rightDate = right.competitivenessDate || right.date;
        return leftDate.localeCompare(rightDate);
      })
      .map(batch => {
      const computed = batch.competitivenessMetrics || calculateCompetitivenessMetrics(batch.products, channelId);
      
      // format date nicely for chart labels
      const sourceDate = batch.competitivenessDate || batch.date;
      const dateLabel = sourceDate.slice(5) || sourceDate; // e.g. 05-25
      return {
        date: dateLabel,
        batchName: `${batch.id.slice(-8)} ${batch.remarks ? `(${batch.remarks.slice(0, 8)}...)` : ''}`,
        ...computed
      };
    });

    // Push actual historical items
    savedPoints.forEach(p => {
      // Avoid duplicate labels on same date by appending suffix if needed
      const exists = list.some(item => item.date === p.date);
      if (exists) {
        list.push({ ...p, date: `${p.date} (新)` });
      } else {
        list.push(p);
      }
    });

    // Finally append the dynamic "Current Workbench State" as a "Live Draft" item
    if (currentCalculatedItems && currentCalculatedItems.length > 0) {
      const liveCalculated = calculateCompetitivenessMetrics(currentCalculatedItems, channelId);
      list.push({
        date: '今日(工作台)',
        batchName: '当前工作台(实时计算草稿)',
        isDraft: true,
        ...liveCalculated
      });
    }

    return list;
  }, [historyBatches, currentCalculatedItems, channelId]);

  const view = useMemo(() => buildCompetitivenessView({
    historyBatches, currentCalculatedItems, sourceId: selectedBatchId,
    brand: selectedBrand, newSeries: selectedSeries, channelId, activeSubsidyFileName
  }), [historyBatches, currentCalculatedItems, selectedBatchId, selectedBrand, selectedSeries, channelId, activeSubsidyFileName]);

  useEffect(() => {
    setSelectedBatchId(view.sourceId);
    setSelectedBrand(view.brand);
    setSelectedSeries(view.newSeries);
  }, [view.sourceId, view.brand, view.newSeries]);

  const { brandOptions, seriesOptions, details: selectedBatchDetails, metrics: latestMetric } = view;
  const displayedRange = useMemo(() => getCompetitivenessViewRange(
    view.timeline, trendRange, selectedBatchDetails?.batchId
  ), [view.timeline, trendRange, selectedBatchDetails?.batchId]);
  const displayedTimelineData = displayedRange.points;
  const selectedPoint = displayedTimelineData.find(point => point.batchId === selectedBatchDetails?.batchId);
  const scopeLabel = [view.brand === ALL_BRANDS ? '全部品牌' : view.brand,
    isSelfOperated ? '' : view.newSeries === ALL_SERIES ? '全部新机系列' : view.newSeries].filter(Boolean).join(' / ');
  const sourceLabel = selectedBatchDetails
    ? `${selectedBatchDetails.name} · ${selectedBatchDetails.date} · ${selectedBatchDetails.isDraft ? '实时草稿' : selectedBatchDetails.isConfirmed ? '正式落数' : '未确认快照'}`
    : '暂无有效批次';
  const hasChartMetrics = displayedTimelineData.some(point => [...TREND_METRIC_KEYS].some(key => point[key] !== null))
    || !!selectedPoint && Object.values(latestMetric).some(value => value !== null);

  const handleExport = async () => {
    setIsExporting(true);
    setExportError('');
    try {
      const payload = buildCompetitivenessTrendExportPayload({
        overallTimeline: timelineData,
        historyBatches,
        currentCalculatedItems,
        brandOptions: listCompetitivenessBrands(historyBatches, currentCalculatedItems),
        trendRange: displayedRange.range,
        channelId
      });
      const { blob, fileName } = await exportCompetitivenessTrends(payload);
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : '导出失败');
    } finally {
      setIsExporting(false);
    }
  };

  const confirmedBatches = historyBatches.filter(batch => batch.isCompetitivenessConfirmed);

  const getScoreRating = (val: number | null | undefined) => {
    if (val === null || val === undefined || !Number.isFinite(val)) {
      return { label: '无有效数据', color: 'text-stone-500 bg-stone-100 border-stone-300' };
    }
    if (val >= 80) return { label: '高强竞争力', color: 'text-green-700 bg-green-50 border-green-300' };
    if (val >= 50) return { label: '一般竞争力', color: 'text-amber-700 bg-amber-50 border-amber-300' };
    return { label: '弱势竞争力', color: 'text-rose-700 bg-rose-50 border-rose-300' };
  };
  const formatScore = (value: number | null | undefined, digits = 1) => (
    value === null || value === undefined || !Number.isFinite(value) ? '—' : `${value.toFixed(digits)}%`
  );

  return (
    <div className="bg-white rounded-none border border-[#141414] p-6 space-y-8" id="competitiveness-summary-panel">
      {/* Visual Industrial Header */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 border-b border-[#141414] pb-4 bg-[#F0EFEC] -mx-6 -mt-6 p-5">
        <div>
          <h3 className="font-bold text-[#141414] text-base flex items-center gap-2">
            <Radio className="w-5 h-5 text-red-600 animate-pulse" />
            {channelName}“竞争力总结”追踪器
          </h3>
          <p className="text-xs text-[#141414]/70 mt-1">
            横向度量本司回收报价能否压制竞对。百分比按 {quoteWeightFieldLabel} 加权，越高代表高流量 PPV 的报价竞争力越强。
          </p>
        </div>
        <div className="text-[11px] font-bold border border-[#141414] bg-white text-black px-3 py-1">
          正式落数：{confirmedBatches.length} 期
        </div>
      </div>

      {/* Benchmark groups follow the business comparison order: TM first, ZZ second. */}
      <div className="space-y-5">
        <div className="border border-[#141414]/30 bg-[#F9F9F8] px-3 py-2 text-xs" aria-label="当前指标数据来源" aria-live="polite">
          <span className="font-bold">{view.sourceId === ALL_BATCHES ? '最新有效批次' : '选定批次'}：{sourceLabel}</span>
          <span className="mt-1 block text-stone-600">{scopeLabel}{selectedBatchDetails ? ` · ${selectedBatchDetails.products.length} 条明细` : ''}</span>
        </div>
        {!isSelfOperated && (
          <section aria-labelledby="tm-benchmark-group" className="space-y-2">
            <div className="flex items-center gap-2 border-b border-[#141414]/30 pb-2">
              <span className="border border-[#141414] bg-[#141414] px-2 py-0.5 text-[10px] font-black text-white">01–03</span>
              <h4 id="tm-benchmark-group" className="text-sm font-black text-[#141414]">天猫</h4>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="flex flex-col justify-between border border-[#141414] bg-[#F9F9F8] p-4">
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-500">Benchmark 1</span>
                    <span className={`border px-1.5 text-[9px] font-bold ${getScoreRating(latestMetric.tmItemScore).color}`}>
                      {getScoreRating(latestMetric.tmItemScore).label}
                    </span>
                  </div>
                  <h5 className="text-xs font-bold text-[#141414]">天猫物品价竞争力</h5>
                  <p className="mt-0.5 text-[10px] text-slate-500">追后京东物品价 ≥ 天猫裸机价</p>
                </div>
                <div className="mt-4 flex items-baseline justify-between">
                  <span className="font-mono text-2xl font-black tracking-tight text-[#141414]">{formatScore(latestMetric.tmItemScore)}</span>
                  <span className="font-mono text-[10px] opacity-70">{quoteWeightShortLabel}</span>
                </div>
              </div>

              <div className="flex flex-col justify-between border border-[#141414] bg-[#F9F9F8] p-4">
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-500">Benchmark 2</span>
                    <span className={`border px-1.5 text-[9px] font-bold ${getScoreRating(latestMetric.ahsVsTmRecyclerScore).color}`}>
                      {getScoreRating(latestMetric.ahsVsTmRecyclerScore).label}
                    </span>
                  </div>
                  <h5 className="text-xs font-bold text-[#141414]">AHS补贴后 vs TM回收商补贴后</h5>
                  <p className="mt-0.5 text-[10px] text-slate-500">追后含AHS补贴报价 ≥ TM裸机价+回收商投入</p>
                </div>
                <div className="mt-4 flex items-baseline justify-between">
                  <span className="font-mono text-2xl font-black tracking-tight text-[#141414]">{formatScore(latestMetric.ahsVsTmRecyclerScore)}</span>
                  <span className="font-mono text-[10px] opacity-70">{quoteWeightShortLabel}</span>
                </div>
              </div>

              <div className="flex flex-col justify-between border border-[#141414] bg-[#F9F9F8] p-4">
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-500">Benchmark 3</span>
                    <span className={`border px-1.5 text-[9px] font-bold ${getScoreRating(latestMetric.tmDirectScore).color}`}>
                      {getScoreRating(latestMetric.tmDirectScore).label}
                    </span>
                  </div>
                  <h5 className="text-xs font-bold text-[#141414]">天猫到手价竞争力</h5>
                  <p className="mt-0.5 text-[10px] text-slate-500">追后京东到手价 ≥ 天猫总到手价</p>
                </div>
                <div className="mt-4 flex items-baseline justify-between">
                  <span className="font-mono text-2xl font-black tracking-tight text-[#141414]">{formatScore(latestMetric.tmDirectScore)}</span>
                  <span className="font-mono text-[10px] opacity-70">{quoteWeightShortLabel}</span>
                </div>
              </div>
            </div>
          </section>
        )}

        <section aria-labelledby="zz-benchmark-group" className="space-y-2">
          <div className="flex items-center gap-2 border-b border-[#141414]/30 pb-2">
            <span className="border border-[#141414] bg-[#141414] px-2 py-0.5 text-[10px] font-black text-white">04–06</span>
            <h4 id="zz-benchmark-group" className="text-sm font-black text-[#141414]">转转</h4>
          </div>
          <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${isSelfOperated ? 'lg:grid-cols-2' : 'lg:grid-cols-3'}`}>
            <div className="flex flex-col justify-between border border-[#141414] bg-[#F9F9F8] p-4">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-500">Benchmark 4</span>
                  <span className={`border px-1.5 text-[9px] font-bold ${getScoreRating(latestMetric.zzItemScore).color}`}>
                    {getScoreRating(latestMetric.zzItemScore).label}
                  </span>
                </div>
                <h5 className="text-xs font-bold text-[#141414]">转转物品价竞争力</h5>
                <p className="mt-0.5 text-[10px] text-slate-500">追后京东物品价 ≥ 转转裸机价</p>
              </div>
              <div className="mt-4 flex items-baseline justify-between">
                <span className="font-mono text-2xl font-black tracking-tight text-[#141414]">{formatScore(latestMetric.zzItemScore)}</span>
                <span className="font-mono text-[10px] opacity-70">{quoteWeightShortLabel}</span>
              </div>
            </div>

            <div className="flex flex-col justify-between border border-[#141414] bg-[#F9F9F8] p-4">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-500">Benchmark 5</span>
                  <span className={`border px-1.5 text-[9px] font-bold ${getScoreRating(latestMetric.ahsVsZzDirectScore).color}`}>
                    {getScoreRating(latestMetric.ahsVsZzDirectScore).label}
                  </span>
                </div>
                <h5 className="text-xs font-bold text-[#141414]">物品价+ahs补贴 vs 转转到手价</h5>
                <p className="mt-0.5 text-[10px] text-slate-500">追后物品价+AHS补贴 ≥ 转转券后价</p>
              </div>
              <div className="mt-4 flex items-baseline justify-between">
                <span className="font-mono text-2xl font-black tracking-tight text-[#141414]">{formatScore(latestMetric.ahsVsZzDirectScore)}</span>
                <span className="font-mono text-[10px] opacity-70">{quoteWeightShortLabel}</span>
              </div>
            </div>

            {!isSelfOperated && (
              <div className="flex flex-col justify-between border border-[#141414] bg-[#F9F9F8] p-4">
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-500">Benchmark 6</span>
                    <span className={`border px-1.5 text-[9px] font-bold ${getScoreRating(latestMetric.jdVsZzDirectScore).color}`}>
                      {getScoreRating(latestMetric.jdVsZzDirectScore).label}
                    </span>
                  </div>
                  <h5 className="text-xs font-bold text-[#141414]">京东到手价 vs 转转到手价</h5>
                  <p className="mt-0.5 text-[10px] text-slate-500">追后京东总到手价 ≥ 转转券后价</p>
                </div>
                <div className="mt-4 flex items-baseline justify-between">
                  <span className="font-mono text-2xl font-black tracking-tight text-[#141414]">{formatScore(latestMetric.jdVsZzDirectScore)}</span>
                  <span className="font-mono text-[10px] opacity-70">{quoteWeightShortLabel}</span>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Main Graph Content Panel */}
      <div data-tour="competitiveness-trend-chart" className="border border-[#141414] p-5 bg-[#F9F9F8] rounded-none">
        <div className="space-y-4 mb-6">
          <div>
            <h4 className="font-bold text-stone-900 text-sm flex items-center gap-1.5">
              <Target className="w-4 h-4 text-[#141414]" />
              历史追平周期竞争力波动走势 (趋势折线图)
            </h4>
            <p className="text-xs text-stone-500 mt-0.5">
              横坐标为每次批次更新节点，纵坐标为“{quoteWeightFormulaLabel}”。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex max-w-full items-center gap-2 text-xs font-bold text-stone-700">
              <span className="shrink-0">数据范围</span>
              <select
                aria-label="竞争力数据范围"
                value={view.sourceId}
                onChange={event => setSelectedBatchId(event.target.value)}
                className="min-w-0 w-80 max-w-full border border-[#141414] bg-white px-3 py-1.5 text-xs font-bold focus:outline-none"
              >
                <option value={ALL_BATCHES}>{currentCalculatedItems.length ? '全量查看（历史＋实时）' : '全量历史'}</option>
                {currentCalculatedItems.length > 0 && <option value={LIVE_DRAFT}>实时工作台</option>}
                <optgroup label="历史 TRACK 批次">
                  {view.batches.map(batch => (
                    <option key={batch.id} value={batch.id}>
                      {batch.competitivenessDate || batch.date} · {batch.remarks || '无备注'} · {batch.id} · {batch.isCompetitivenessConfirmed ? '正式落数' : '未确认快照'}{batch.isSummaryOnly ? '（仅汇总）' : ''}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs font-bold text-stone-700">
              品牌
              <select
                aria-label="品牌筛选"
                value={view.brand}
                disabled={view.sourceId !== ALL_BATCHES && !!selectedBatchDetails?.isSummaryOnly}
                onChange={event => setSelectedBrand(event.target.value)}
                className="min-w-36 border border-[#141414] bg-white px-3 py-1.5 text-xs font-bold focus:outline-none disabled:bg-stone-100 disabled:text-stone-400"
              >
                <option value={ALL_BRANDS}>全部品牌</option>
                {brandOptions.map(brand => (
                  <option key={brand} value={brand}>{brand}</option>
                ))}
              </select>
            </label>
            {!isSelfOperated && (
              <label className="flex items-center gap-2 text-xs font-bold text-stone-700">
                新机系列
                <select
                  aria-label="新机系列筛选"
                  value={view.newSeries}
                  disabled={view.sourceId !== ALL_BATCHES && !!selectedBatchDetails?.isSummaryOnly}
                  onChange={event => setSelectedSeries(event.target.value)}
                  className="min-w-40 border border-[#141414] bg-white px-3 py-1.5 text-xs font-bold focus:outline-none disabled:bg-stone-100 disabled:text-stone-400"
                >
                  <option value={ALL_SERIES}>全部新机系列</option>
                  {seriesOptions.map(series => (
                    <option key={series} value={series}>{series}</option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="button"
              onClick={handleExport}
              disabled={isExporting || timelineData.length === 0}
              className="inline-flex items-center gap-1.5 border border-[#141414] bg-white px-3 py-1.5 text-xs font-bold text-[#141414] hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              {isExporting ? '导出中...' : '导出全量走势Excel'}
            </button>
            {exportError && <span className="text-[11px] font-bold text-red-700">{exportError}</span>}
          </div>
        </div>

        {selectedBatchDetails?.isSummaryOnly && (
          <p className="mb-3 border border-stone-300 bg-white px-3 py-2 text-xs text-stone-600" role="status">
            该历史记录只有汇总分数，没有 PPV 明细，无法按品牌／新机系列拆分。
          </p>
        )}
        <p className="mb-3 text-[11px] text-stone-600" aria-label="趋势选定批次">
          高亮批次：{sourceLabel}{selectedBatchDetails && !selectedBatchDetails.isDraft && !selectedBatchDetails.isConfirmed ? '；未确认快照单独展示，不计入正式走势。' : ''}
          {displayedRange.range !== trendRange ? '；已展开全部期次以定位该批次。' : ''}
        </p>

        {/* Interactive Line Chart */}
        <div className="relative w-full h-80 min-h-[300px]" id="competitiveness-recharts-container">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={displayedTimelineData}
              margin={{ top: 10, right: 30, left: -10, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e0deda" />
              <XAxis 
                dataKey="batchId"
                tickFormatter={batchId => displayedTimelineData.find(point => point.batchId === batchId)?.date || batchId}
                tick={{ fill: '#141414', fontSize: 11, fontWeight: 'bold' }} 
              />
              <YAxis 
                domain={[0, 100]} 
                tickFormatter={(val) => `${val}%`}
                tick={{ fill: '#141414', fontSize: 11 }}
              />
              <Tooltip 
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload as CompetitivenessViewPoint;
                    return (
                      <div className="bg-white border-2 border-black p-3 text-xs shadow-none rounded-none space-y-1 w-80 break-words">
                        <p className="font-bold text-stone-950 border-b border-stone-200 pb-1 flex justify-between">
                          <span>📅 {data.batchName}</span>
                          {data.isDraft && <span className="bg-red-600 text-white px-1 text-[9px]">实时</span>}
                        </p>
                        <p className="text-stone-500">{data.sourceDate}{data.batchId === selectedBatchDetails?.batchId ? ' · 当前选定批次' : ''}</p>
                        {payload.map((item, index) => (
                          <div key={index} className="flex justify-between items-center py-0.5">
                            <span className="text-stone-600 text-[11px]" style={{ color: item.color }}>● {item.name}:</span>
                            <span className="font-bold font-mono text-stone-900">{formatScore(item.value == null ? null : Number(item.value))}</span>
                          </div>
                        ))}
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Legend 
                verticalAlign="bottom" 
                height={36} 
                iconType="rect"
                itemSorter={() => 0}
                onClick={handleTrendLegendClick}
                formatter={(value, entry) => (
                  <span
                    className={entry.inactive ? 'text-stone-400 line-through' : 'text-[#141414]'}
                    title={`点击${entry.inactive ? '显示' : '隐藏'}${value}`}
                  >
                    {value}
                  </span>
                )}
                wrapperStyle={{ fontSize: 11, fontWeight: 'bold', paddingTop: 10, cursor: 'pointer', userSelect: 'none' }}
              />
              {!isSelfOperated && <Line
                type="monotone"
                dataKey="tmItemScore"
                name="天猫物品价竞争力"
                hide={hiddenTrendMetrics.has('tmItemScore')}
                stroke="#C2410C"
                strokeWidth={3}
                activeDot={{ r: 8 }}
              />}
              {!isSelfOperated && <Line
                type="monotone"
                dataKey="ahsVsTmRecyclerScore"
                name="AHS补贴后 vs TM回收商补贴后"
                hide={hiddenTrendMetrics.has('ahsVsTmRecyclerScore')}
                stroke="#DC2626"
                strokeWidth={3}
                activeDot={{ r: 8 }}
              />}
              {!isSelfOperated && <Line
                type="monotone"
                dataKey="tmDirectScore"
                name="天猫到手价竞争力"
                hide={hiddenTrendMetrics.has('tmDirectScore')}
                stroke="#D97706"
                strokeWidth={2}
                strokeDasharray="4 4"
              />}
              <Line
                type="monotone"
                dataKey="zzItemScore"
                name="转转物品价竞争力"
                hide={hiddenTrendMetrics.has('zzItemScore')}
                stroke="#134E4A"
                strokeWidth={2}
              />
              <Line 
                type="monotone" 
                dataKey="ahsVsZzDirectScore" 
                name="物品价+ahs补贴 vs 转转到手价"
                hide={hiddenTrendMetrics.has('ahsVsZzDirectScore')}
                stroke="#059669"
                strokeWidth={3} 
                activeDot={{ r: 8 }}
              />
              {!isSelfOperated && <Line
                type="monotone"
                dataKey="jdVsZzDirectScore"
                name="京东到手价 vs 转转到手价"
                hide={hiddenTrendMetrics.has('jdVsZzDirectScore')}
                stroke="#84CC16"
                strokeWidth={2}
                strokeDasharray="2 3"
              />}
              {selectedPoint && <ReferenceLine
                x={selectedPoint.batchId}
                stroke="#141414"
                strokeWidth={2}
                strokeDasharray="4 3"
                label={{ value: selectedPoint.isSnapshot ? '选定快照' : '选定批次', position: 'insideTopRight', fill: '#141414', fontSize: 10 }}
              />}
              {selectedPoint && ([
                ['tmItemScore', '#C2410C'], ['ahsVsTmRecyclerScore', '#DC2626'],
                ['tmDirectScore', '#D97706'], ['zzItemScore', '#134E4A'],
                ['ahsVsZzDirectScore', '#059669'], ['jdVsZzDirectScore', '#84CC16']
              ] as const).filter(([key]) => !hiddenTrendMetrics.has(key)
                && (!isSelfOperated || key === 'zzItemScore' || key === 'ahsVsZzDirectScore')
                && latestMetric[key] !== null).map(([key, color]) => (
                <ReferenceDot key={key} x={selectedPoint.batchId} y={latestMetric[key]!}
                  r={6} fill={color} stroke="#141414" strokeWidth={2} />
              ))}
            </LineChart>
          </ResponsiveContainer>
          {!hasChartMetrics && <div className="pointer-events-none absolute inset-0 flex items-center justify-center pb-10 text-xs text-stone-500">
            <span className="border border-stone-300 bg-white px-4 py-2">当前筛选暂无有效竞争力数据</span>
          </div>}
          <div
            className="absolute bottom-[13px] left-0 z-10 inline-flex border border-[#141414] bg-white"
            role="group"
            aria-label="趋势展示范围"
          >
            {([
              ['recent15', '近15次追价'],
              ['all', '全部']
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={displayedRange.range === value}
                onClick={() => setTrendRange(value)}
                className={`px-2.5 py-1 text-[10px] font-bold leading-none first:border-r first:border-[#141414] ${
                  displayedRange.range === value
                    ? 'bg-[#141414] text-white'
                    : 'bg-white text-[#141414] hover:bg-stone-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Model Breakdown Inspection List */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
          <div>
            <h4 className="font-bold text-[#141414] text-xs uppercase tracking-wider">
              🔍 详细大底表横向竞争力审计诊断
            </h4>
            <p className="text-xs text-stone-500">
              {isSelfOperated
                ? '选择当前工作台或历史快照，逐PPV查看追价后竞争结果。'
                : '选择当前工作台或历史快照，按品牌 → 新机系列查看两项主要指标、补贴归因和三项参考指标，并下钻补贴问题明细。'}
            </p>
          </div>

        </div>

        {selectedBatchDetails ? (
          <div className="border border-[#141414] rounded-none overflow-hidden text-xs">
            {/* Version Header details */}
            <div className="bg-[#F0EFEC] p-3 border-b border-[#141414] space-y-1">
              <div className="flex justify-between font-bold text-stone-900">
                <span>选定数据：{selectedBatchDetails.name}</span>
                <span className="text-stone-600">日期：{selectedBatchDetails.date}</span>
              </div>
              <p className="text-stone-600">{scopeLabel} · {selectedBatchDetails.products.length} 条明细</p>
	              <p className="text-stone-500 text-[11px] italic">
	                备注说明: "{selectedBatchDetails.remarks}"
	              </p>
                {selectedBatchDetails.isConfirmed && (
                  <div className={`grid grid-cols-2 ${isSelfOperated ? 'lg:grid-cols-4' : 'lg:grid-cols-6'} gap-2 pt-2`}>
                    <div className="bg-white border border-[#141414]/20 p-2">
                      <div className="text-[10px] text-stone-500">Benchmark 1 · 天猫物品价</div>
                      <div className="font-mono font-bold">{formatScore(selectedBatchDetails.metrics.tmItemScore, 2)}</div>
                    </div>
                    {!isSelfOperated && <div className="bg-white border border-[#141414]/20 p-2">
                      <div className="text-[10px] text-stone-500">Benchmark 2 · AHS vs TM回收商补贴后</div>
                      <div className="font-mono font-bold">{formatScore(selectedBatchDetails.metrics.ahsVsTmRecyclerScore, 2)}</div>
                    </div>}
                    <div className="bg-white border border-[#141414]/20 p-2">
                      <div className="text-[10px] text-stone-500">Benchmark 3 · 天猫到手价</div>
                      <div className="font-mono font-bold">{formatScore(selectedBatchDetails.metrics.tmDirectScore, 2)}</div>
                    </div>
                    <div className="bg-white border border-[#141414]/20 p-2">
                      <div className="text-[10px] text-stone-500">Benchmark 4 · 转转物品价</div>
                      <div className="font-mono font-bold">{formatScore(selectedBatchDetails.metrics.zzItemScore, 2)}</div>
                    </div>
                    <div className="bg-white border border-[#141414]/20 p-2">
                      <div className="text-[10px] text-stone-500">Benchmark 5 · AHS vs 转转到手</div>
                      <div className="font-mono font-bold">{formatScore(selectedBatchDetails.metrics.ahsVsZzDirectScore, 2)}</div>
                    </div>
                    {!isSelfOperated && <div className="bg-white border border-[#141414]/20 p-2">
                      <div className="text-[10px] text-stone-500">Benchmark 6 · 京东到手 vs 转转到手</div>
                      <div className="font-mono font-bold">{formatScore(selectedBatchDetails.metrics.jdVsZzDirectScore, 2)}</div>
                    </div>}
                  </div>
                )}
	            </div>
            {!isSelfOperated ? (
              <div key={`${selectedBatchDetails.batchId}:${view.brand}:${view.newSeries}`}>
              <CompetitivenessAuditTable
                products={selectedBatchDetails.products}
                isSummaryOnly={selectedBatchDetails.isSummaryOnly}
              />
              </div>
            ) : null}

            <details className="border-t border-[#141414]" open={isSelfOperated || undefined}>
              <summary className={isSelfOperated
                ? 'hidden'
                : 'cursor-pointer bg-[#E4E3E0] px-3 py-2 text-[11px] font-bold text-[#141414] hover:bg-[#D8D7D2]'}>
                查看当前筛选 PPV 明细（{selectedBatchDetails.products.length} 条）
              </summary>

              {/* Model list item metrics */}
              <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-stone-50 border-b border-[#141414]/30 text-[11px] text-stone-700 font-bold">
                    <th className="p-3">旧机型号</th>
	                    <th className="p-3">ppv</th>
	                    <th className="p-3">京东物品价-追价后</th>
	                    <th className="p-3">含AHS补贴后报价-追价后</th>
	                    <th className="p-3">京东总补贴</th>
	                    <th className="p-3">jd总到手价-追价后</th>
	                    <th className="p-3">tm裸机价</th>
	                    <th className="p-3">TM回收商投入</th>
	                    <th className="p-3">含TM回收商补贴后报价</th>
	                    <th className="p-3 bg-red-50/50">京东物品价-追价后 vs 天猫</th>
	                    <th className="p-3 bg-violet-50/50">京东物品价+ahs补贴-追价后 vs天猫</th>
	                    <th className="p-3">tm总到手价</th>
	                    <th className="p-3 bg-amber-50/50">京东到手价-追价后 vs 天猫</th>
	                    <th className="p-3">zz裸机价</th>
	                    <th className="p-3">zz券后价</th>
	                    <th className="p-3 bg-cyan-50/50">京东物品价-追价后 vs 转转</th>
	                    <th className="p-3 bg-emerald-50 text-emerald-900">京东物品价+ahs补贴-追价后 vs 转转</th>
	                    <th className="p-3 bg-blue-50 text-blue-900">京东到手价-追价后vs转转</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
	                  {selectedBatchDetails.products.length === 0 ? (
	                    <tr>
	                      <td colSpan={18} className="p-6 text-center text-stone-400">
                          {selectedBatchDetails.isSummaryOnly ? '该记录为历史竞争力纯落数，只保存汇总分数，无PPV明细。' : '本批次中尚未关联到任何有效商品。'}
                        </td>
	                    </tr>
                  ) : (
                    selectedBatchDetails.products.map((p) => {
                      const isTmItemBetter = p.postTmItemWin;
                      const isAhsBetterThanTmRecycler = p.postAhsTmRecyclerWin;
                      const tmHandPrice = p.tmHandPrice;
                      const isTmDirectBetter = p.postTmHandWin;
                      const isZzItemBetter = p.postZzItemWin;
                      const ourAhsSubsidized = p.postAhsPrice;
                      const isOurAhsSubsidizedBetterThanZz = p.postAhsZzHandWin;
                      const isJdHandBetterThanZz = p.postJdZzHandWin;

                      return (
                        <tr key={p.ppv} className="hover:bg-stone-50">
                          <td className="p-3">
                            <span className="font-bold block text-stone-900">{p.model}</span>
                          </td>
                          <td className="p-3">
                            <span className="font-mono text-[10px] text-slate-500 block">{p.ppv}</span>
	                          </td>
	                          <td className="p-3 font-bold font-mono">{formatRMB(p.recommendPrice)}</td>
	                          <td className="p-3 font-bold font-mono">{formatRMB(p.postAhsPrice)}</td>
	                          <td className="p-3 font-mono text-stone-600">
	                            {formatRMB(p.totalSubsidy)}
	                          </td>
	                          <td className="p-3 font-mono text-stone-600">{formatRMB(p.postJdHandPrice)}</td>
	                          <td className="p-3 font-mono text-stone-500">{p.tmPrice > 0 ? formatRMB(p.tmPrice) : 'N/A'}</td>
	                          <td className="p-3 font-mono text-stone-500">{p.tmPrice > 0 ? formatRMB(p.tmRecyclerSubsidy) : 'N/A'}</td>
	                          <td className="p-3 font-mono text-stone-500">{p.tmRecyclerQuotedPrice > 0 ? formatRMB(p.tmRecyclerQuotedPrice) : 'N/A'}</td>
                          
                          {/* Target 1 */}
                          <td className={`p-3 font-bold text-center ${isTmItemBetter ? 'bg-green-50 text-green-700' : 'bg-rose-50 text-rose-700'}`}>
                            {isTmItemBetter ? '✔ 胜出' : '❌ 报价低'}
                          </td>

                          <td className={`p-3 font-bold text-center ${p.tmRecyclerQuotedPrice > 0 ? (isAhsBetterThanTmRecycler ? 'bg-green-50 text-green-700' : 'bg-rose-50 text-rose-700') : 'text-slate-400 font-mono'}`}>
                            {p.tmRecyclerQuotedPrice > 0 ? (isAhsBetterThanTmRecycler ? '✔ 胜出' : '❌ 报价低') : '无数据'}
                          </td>

                          <td className="p-3 font-mono text-stone-500">{p.tmHandPrice > 0 ? formatRMB(tmHandPrice) : 'N/A'}</td>

                          {/* Target 2 */}
                          <td className={`p-3 font-bold text-center ${isTmDirectBetter ? 'bg-green-50 text-green-700' : 'bg-rose-50 text-rose-700'}`}>
                            {isTmDirectBetter ? '✔ 胜出' : '❌ 到手低'}
                          </td>

	                          <td className="p-3 font-mono text-stone-500">{p.zzPrice > 0 ? formatRMB(p.zzPrice) : 'N/A'}</td>
	                          <td className="p-3 font-mono text-stone-500">{p.zzHandPrice > 0 ? formatRMB(p.zzHandPrice) : 'N/A'}</td>

                          {/* Target 3 */}
                          <td className={`p-3 font-bold text-center ${p.zzPrice > 0 ? (isZzItemBetter ? 'bg-green-50 text-green-700' : 'bg-rose-50 text-rose-700') : 'text-slate-400 font-mono'}`}>
                            {p.zzPrice > 0 ? (isZzItemBetter ? '✔ 胜出' : '❌ 报价低') : '无数据'}
                          </td>

                          {/* Target 4: ahs_vs_zz */}
                          <td className={`p-3 font-bold ${p.zzHandPrice > 0 ? (isOurAhsSubsidizedBetterThanZz ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700') : 'text-slate-400 font-mono'}`}>
                            {p.zzPrice > 0 ? (
                              <div className="space-y-0.5">
                                <span className="block">{isOurAhsSubsidizedBetterThanZz ? '✔ AHS补贴后胜出' : '❌ 仍低'}</span>
                                <span className="text-[10px] font-mono text-stone-500 block">
                                  AHS后我司: {formatRMB(ourAhsSubsidized)}
                                </span>
                              </div>
                            ) : (
                              '无对比'
                            )}
                          </td>

                          <td className={`p-3 font-bold text-center ${p.zzHandPrice > 0 ? (isJdHandBetterThanZz ? 'bg-blue-50 text-blue-800' : 'bg-red-50 text-red-700') : 'text-slate-400 font-mono'}`}>
                            {p.zzHandPrice > 0 ? (isJdHandBetterThanZz ? '✔ 到手价胜出' : '❌ 到手价低') : '无数据'}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
              </div>

              {/* Diagnostic helper message at bottom of raw table */}
              <div className="p-3.5 bg-[#F9F9F8] border-t border-[#141414]/30 text-[11px] text-[#141414]/80 flex gap-2">
                <Info className="w-4 h-4 text-stone-700 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <span className="font-bold text-stone-900">原始明细说明：</span>
                  <p>
                    - 本表展示选定期次、品牌和新机系列的PPV价格与六项竞争结果，用于核对上方汇总值。
                  </p>
                  <p>
                    - 如果 <strong>“物品价+AHS补贴 vs 转转到手价”</strong> 仍为❌，表示追后物品价叠加AHS补贴后仍低于转转券后价。
                  </p>
                </div>
              </div>
            </details>
          </div>
        ) : <div className="border border-stone-300 p-6 text-center text-xs text-stone-500">当前筛选暂无有效批次明细。</div>}
      </div>
    </div>
  );
}
