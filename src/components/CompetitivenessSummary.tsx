/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend 
} from 'recharts';
import { TrendingUp, TrendingDown, Target, Info, AlertCircle, ShoppingBag, Radio } from 'lucide-react';
import { CalculatedProduct, TrackingBatch } from '../types';
import { formatPercent, formatRMB } from '../utils/formulas';
import { calculateCompetitivenessMetrics, emptyCompetitivenessMetrics } from '../utils/competitiveness';

interface Props {
  historyBatches: TrackingBatch[];
  currentCalculatedItems: CalculatedProduct[];
  activeSubsidyFileName: string;
}

interface CompetitivenessDataPoint {
  date: string;
  batchName: string;
  isDraft?: boolean;
  
  // The 4 requested metrics in %
  tmItemScore: number;       // 天猫物品价竞争力
  tmDirectScore: number;     // 天猫到手价竞争力
  zzItemScore: number;       // 转转物品价竞争力
  ahsVsZzDirectScore: number;// 物品价+ahs补贴 vs 转转到手价竞争力
}

export default function CompetitivenessSummary({ 
  historyBatches, 
  currentCalculatedItems,
  activeSubsidyFileName
}: Props) {
  // We can choose which batch to inspect individual model details for
  const [selectedBatchId, setSelectedBatchId] = useState<string>('LIVE_DRAFT');

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
      const computed = batch.competitivenessMetrics || calculateCompetitivenessMetrics(batch.products);
      
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
      const liveCalculated = calculateCompetitivenessMetrics(currentCalculatedItems);
      list.push({
        date: '今日(工作台)',
        batchName: '当前工作台(实时计算草稿)',
        isDraft: true,
        ...liveCalculated
      });
    }

    return list;
  }, [historyBatches, currentCalculatedItems]);

  // Find the selected details row
  const selectedBatchDetails = useMemo(() => {
    if (selectedBatchId === 'LIVE_DRAFT') {
      return {
        name: '当前价格测算工作台 (实时草稿状态)',
        date: new Date().toISOString().slice(0, 10),
        remarks: '基于左侧实时填写的竞品售价与最上方生效的补贴表配置：' + activeSubsidyFileName,
        products: currentCalculatedItems,
        metrics: calculateCompetitivenessMetrics(currentCalculatedItems),
        isSummaryOnly: false,
        isConfirmed: false
      };
    }

    const batch = historyBatches.find(b => b.id === selectedBatchId);
    if (batch) {
      return {
        name: `快照备份: ${batch.id}`,
        date: batch.competitivenessDate || batch.date,
        remarks: batch.isCompetitivenessConfirmed ? `已确认竞争力落数。${batch.remarks || ''}` : batch.remarks || '未备注说明。',
        products: batch.products,
        metrics: batch.competitivenessMetrics || calculateCompetitivenessMetrics(batch.products),
        isSummaryOnly: !!batch.isSummaryOnly,
        isConfirmed: !!batch.isCompetitivenessConfirmed
      };
    }

    return null;
  }, [selectedBatchId, historyBatches, currentCalculatedItems, activeSubsidyFileName]);

  const confirmedBatches = historyBatches.filter(batch => batch.isCompetitivenessConfirmed);

  // Header cards follow the selected data source. Default is the live workbench draft.
  const latestMetric = useMemo(() => {
    if (selectedBatchDetails) {
      return selectedBatchDetails.metrics;
    }
    if (timelineData.length > 0) {
      return timelineData[timelineData.length - 1];
    }
    return emptyCompetitivenessMetrics();
  }, [selectedBatchDetails, timelineData]);

  const getScoreRating = (val: number) => {
    if (val >= 80) return { label: '高强竞争力', color: 'text-green-700 bg-green-50 border-green-300' };
    if (val >= 50) return { label: '一般竞争力', color: 'text-amber-700 bg-amber-50 border-amber-300' };
    return { label: '弱势竞争力', color: 'text-rose-700 bg-rose-50 border-rose-300' };
  };

  return (
    <div className="bg-white rounded-none border border-[#141414] p-6 space-y-8" id="competitiveness-summary-panel">
      {/* Visual Industrial Header */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 border-b border-[#141414] pb-4 bg-[#F0EFEC] -mx-6 -mt-6 p-5">
        <div>
          <h3 className="font-bold text-[#141414] text-base flex items-center gap-2">
            <Radio className="w-5 h-5 text-red-600 animate-pulse" />
            全网核心竞品渠道“竞争力总结”追踪器
          </h3>
          <p className="text-xs text-[#141414]/70 mt-1">
            横向度量本司回收报价能否压制竞对。百分比按 ppv近30天报价量 加权，越高代表高流量 PPV 的报价竞争力越强。
          </p>
        </div>
        <div className="text-[11px] font-bold border border-[#141414] bg-white text-black px-3 py-1">
          正式落数：{confirmedBatches.length} 期 / 实时草稿联动中
        </div>
      </div>

      {/* 4 Cards Scorecard representing Today's metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1 */}
        <div className="border border-[#141414] p-4 bg-[#F9F9F8] flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center mb-1">
              <span className="text-[11px] font-bold text-slate-500">Benchmark 1</span>
              <span className={`text-[9px] border px-1.5 font-bold ${getScoreRating(latestMetric.tmDirectScore).color}`}>
                {getScoreRating(latestMetric.tmDirectScore).label}
              </span>
            </div>
            <h4 className="font-bold text-[#141414] text-xs">天猫到手价竞争力</h4>
	            <p className="text-[10px] text-slate-500 mt-0.5">追后京东到手价 &gt; 天猫总到手价</p>
          </div>
          <div className="mt-4 flex items-baseline justify-between">
            <span className="text-2xl font-black font-mono tracking-tight text-[#141414]">
              {latestMetric.tmDirectScore.toFixed(1)}%
            </span>
            <span className="text-[10px] font-mono opacity-70">报价量加权</span>
          </div>
        </div>

        {/* Metric 2 */}
        <div className="border border-[#141414] p-4 bg-[#F9F9F8] flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center mb-1">
              <span className="text-[11px] font-bold text-slate-500">Benchmark 2</span>
              <span className={`text-[9px] border px-1.5 font-bold ${getScoreRating(latestMetric.tmItemScore).color}`}>
                {getScoreRating(latestMetric.tmItemScore).label}
              </span>
            </div>
            <h4 className="font-bold text-[#141414] text-xs">天猫物品价竞争力</h4>
	            <p className="text-[10px] text-slate-500 mt-0.5">追后京东物品价 &gt; 天猫裸机价</p>
          </div>
          <div className="mt-4 flex items-baseline justify-between">
            <span className="text-2xl font-black font-mono tracking-tight text-[#141414]">
              {latestMetric.tmItemScore.toFixed(1)}%
            </span>
            <span className="text-[10px] font-mono opacity-70">报价量加权</span>
          </div>
        </div>

        {/* Metric 3 */}
        <div className="border border-[#141414] p-4 bg-[#F9F9F8] flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center mb-1">
              <span className="text-[11px] font-bold text-slate-500">Benchmark 3</span>
              <span className={`text-[9px] border px-1.5 font-bold ${getScoreRating(latestMetric.ahsVsZzDirectScore).color}`}>
                {getScoreRating(latestMetric.ahsVsZzDirectScore).label}
              </span>
            </div>
            <h4 className="font-bold text-[#141414] text-xs">物品价+ahs补贴 vs 转转到手价</h4>
	            <p className="text-[10px] text-slate-500 mt-0.5">追后物品价+AHS补贴 &gt; 转转券后价</p>
          </div>
          <div className="mt-4 flex items-baseline justify-between">
            <span className="text-2xl font-black font-mono tracking-tight text-[#141414]">
              {latestMetric.ahsVsZzDirectScore.toFixed(1)}%
            </span>
            <span className="text-[10px] font-mono opacity-70">报价量加权</span>
          </div>
        </div>

        {/* Metric 4 */}
        <div className="border border-[#141414] p-4 bg-[#F9F9F8] flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center mb-1">
              <span className="text-[11px] font-bold text-slate-500">Benchmark 4</span>
              <span className={`text-[9px] border px-1.5 font-bold ${getScoreRating(latestMetric.zzItemScore).color}`}>
                {getScoreRating(latestMetric.zzItemScore).label}
              </span>
            </div>
            <h4 className="font-bold text-[#141414] text-xs">转转物品价竞争力</h4>
	            <p className="text-[10px] text-slate-500 mt-0.5">追后京东物品价 &gt; 转转裸机价</p>
          </div>
          <div className="mt-4 flex items-baseline justify-between">
            <span className="text-2xl font-black font-mono tracking-tight text-[#141414]">
              {latestMetric.zzItemScore.toFixed(1)}%
            </span>
            <span className="text-[10px] font-mono opacity-70">报价量加权</span>
          </div>
        </div>
      </div>

      {/* Main Graph Content Panel */}
      <div className="border border-[#141414] p-5 bg-[#F9F9F8] rounded-none">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 mb-6">
          <div>
            <h4 className="font-bold text-stone-900 text-sm flex items-center gap-1.5">
              <Target className="w-4 h-4 text-[#141414]" />
              历史追平周期竞争力波动走势 (趋势折线图)
            </h4>
            <p className="text-xs text-stone-500 mt-0.5">
              横坐标为每次批次更新节点，纵坐标为“有竞争力PPV的近30天报价量 / 有效竞品PPV的近30天报价量”。
            </p>
          </div>
          <div className="text-[11px] text-stone-600 bg-stone-100 p-2 border border-stone-200">
            📊 走势分析：当折线上行时表示我司本期补贴方案对竞品的价格压制力变强。
          </div>
        </div>

        {/* Interactive Line Chart */}
        <div className="w-full h-80 min-h-[300px]" id="competitiveness-recharts-container">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={timelineData}
              margin={{ top: 10, right: 30, left: -10, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e0deda" />
              <XAxis 
                dataKey="date" 
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
                    const data = payload[0].payload as CompetitivenessDataPoint;
                    return (
                      <div className="bg-white border-2 border-black p-3 text-xs shadow-none rounded-none space-y-1 w-64">
                        <p className="font-bold text-stone-950 border-b border-stone-200 pb-1 flex justify-between">
                          <span>📅 {data.batchName}</span>
                          {data.isDraft && <span className="bg-red-600 text-white px-1 text-[9px]">实时</span>}
                        </p>
                        {payload.map((item, index) => (
                          <div key={index} className="flex justify-between items-center py-0.5">
                            <span className="text-stone-600 text-[11px]" style={{ color: item.color }}>● {item.name}:</span>
                            <span className="font-bold font-mono text-stone-900">{Number(item.value).toFixed(1)}%</span>
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
                wrapperStyle={{ fontSize: 11, fontWeight: 'bold', paddingTop: 10 }}
              />
              <Line 
                type="monotone" 
                dataKey="tmDirectScore" 
                name="天猫到手价竞争力" 
                stroke="#C2873E" 
                strokeWidth={2} 
                strokeDasharray="4 4"
              />
              <Line 
                type="monotone" 
                dataKey="tmItemScore" 
                name="天猫物品价竞争力" 
                stroke="#B43E2B" 
                strokeWidth={3} 
                activeDot={{ r: 8 }} 
              />
              <Line 
                type="monotone" 
                dataKey="ahsVsZzDirectScore" 
                name="物品价+ahs补贴 vs 转转到手价" 
                stroke="#1E824C" 
                strokeWidth={3} 
                activeDot={{ r: 8 }}
              />
              <Line 
                type="monotone" 
                dataKey="zzItemScore" 
                name="转转物品价竞争力" 
                stroke="#1B6D87" 
                strokeWidth={2} 
              />
            </LineChart>
          </ResponsiveContainer>
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
              您可以选择本系统任意一期存储的历史快照，由系统纵向诊断特定型号是由于因受制于底牌成本还是亏损保底导致无法击穿对方底价。
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-stone-700">数据源期次选择:</span>
              <select
              value={selectedBatchId}
              onChange={(e) => setSelectedBatchId(e.target.value)}
              className="text-xs font-bold border border-[#141414] bg-white p-1.5 focus:outline-none"
              >
                <option value="LIVE_DRAFT">🔥 今日工作台 (实时草稿)</option>
                {historyBatches.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.isCompetitivenessConfirmed ? '✅' : '📅'} {b.id.slice(0, 14)} ({b.remarks ? b.remarks.slice(0, 12) : '无备注'}...)
                  </option>
                ))}
              </select>
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
	              <p className="text-stone-500 text-[11px] italic">
	                备注说明: "{selectedBatchDetails.remarks}"
	              </p>
                {selectedBatchDetails.isConfirmed && (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 pt-2">
                    <div className="bg-white border border-[#141414]/20 p-2">
                      <div className="text-[10px] text-stone-500">天猫物品价</div>
                      <div className="font-mono font-bold">{selectedBatchDetails.metrics.tmItemScore.toFixed(2)}%</div>
                    </div>
                    <div className="bg-white border border-[#141414]/20 p-2">
                      <div className="text-[10px] text-stone-500">天猫到手价</div>
                      <div className="font-mono font-bold">{selectedBatchDetails.metrics.tmDirectScore.toFixed(2)}%</div>
                    </div>
                    <div className="bg-white border border-[#141414]/20 p-2">
                      <div className="text-[10px] text-stone-500">转转物品价</div>
                      <div className="font-mono font-bold">{selectedBatchDetails.metrics.zzItemScore.toFixed(2)}%</div>
                    </div>
                    <div className="bg-white border border-[#141414]/20 p-2">
                      <div className="text-[10px] text-stone-500">AHS vs 转转到手</div>
                      <div className="font-mono font-bold">{selectedBatchDetails.metrics.ahsVsZzDirectScore.toFixed(2)}%</div>
                    </div>
                  </div>
                )}
	            </div>

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
	                    <th className="p-3 bg-red-50/50">京东物品价-追价后 vs 天猫</th>
	                    <th className="p-3">tm总到手价</th>
	                    <th className="p-3 bg-amber-50/50">京东到手价-追价后 vs 天猫</th>
	                    <th className="p-3">zz裸机价</th>
	                    <th className="p-3">zz券后价</th>
	                    <th className="p-3 bg-cyan-50/50">京东物品价-追价后 vs 转转</th>
	                    <th className="p-3 bg-emerald-50 text-emerald-900">京东物品价+ahs补贴-追价后 vs 转转</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
	                  {selectedBatchDetails.products.length === 0 ? (
	                    <tr>
	                      <td colSpan={14} className="p-6 text-center text-stone-400">
                          {selectedBatchDetails.isSummaryOnly ? '该记录为历史竞争力纯落数，只保存汇总分数，无PPV明细。' : '本批次中尚未关联到任何有效商品。'}
                        </td>
	                    </tr>
                  ) : (
                    selectedBatchDetails.products.map((p) => {
                      const isTmItemBetter = p.postTmItemWin;
                      const tmHandPrice = p.tmHandPrice;
                      const isTmDirectBetter = p.postTmHandWin;
                      const isZzItemBetter = p.postZzItemWin;
                      const ourAhsSubsidized = p.postAhsPrice;
                      const isOurAhsSubsidizedBetterThanZz = p.postAhsZzHandWin;

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
                          
                          {/* Target 1 */}
                          <td className={`p-3 font-bold text-center ${isTmItemBetter ? 'bg-green-50 text-green-700' : 'bg-rose-50 text-rose-700'}`}>
                            {isTmItemBetter ? '✔ 胜出' : '❌ 报价低'}
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
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Diagnostic helper message at bottom of table */}
            <div className="p-3.5 bg-[#F9F9F8] border-t border-[#141414]/30 text-[11px] text-[#141414]/80 flex gap-2">
              <Info className="w-4 h-4 text-stone-700 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="font-bold text-stone-900">审计诊断建议：</span>
                <p>
                  - 当发现大部分产品的天猫裸机价无法追过时，说明我司可能受边际底线约束，或需要调整 AHS 补贴门槛。
                </p>
                <p>
                  - 如果 <strong>“物品价+AHS补贴 vs 转转到手价”</strong> 仍然处于❌状态，表示追后物品价叠加 AHS 补贴后仍低于转转券后价，主要原因通常是补贴阶梯或边际底线限制。
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
