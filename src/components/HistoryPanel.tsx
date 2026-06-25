/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { TrackingBatch, CalculatedProduct } from '../types';
import { 
  History, 
  Eye, 
  ArrowLeftRight, 
  Download, 
  Search, 
  Trash2, 
  Calendar, 
  CheckCircle, 
  Activity, 
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  Equal
} from 'lucide-react';
import { formatRMB, formatPercent } from '../utils/formulas';
import * as XLSX from 'xlsx';

interface Props {
  historyBatches: TrackingBatch[];
  onDeleteBatch?: (id: string) => void;
  channelName?: string;
}

type SnapshotExportRow = Record<string, string | number | boolean | null>;

const displaySnapshotValue = (value: string | number | boolean | null | undefined) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? '是' : '否';
  return String(value);
};

const statusText = (p: CalculatedProduct) => (
  p.riskWarning === 'CRITICAL' ? '利润击穿' : p.riskWarning === 'WARNING' ? '逼近底线' : '可执行'
);

const pricingModeText = (batch: TrackingBatch) => (
  batch.pricingMode === 'fullCompetition' ? '100%竞争力' : `边际底线${formatPercent(batch.marginBottomLine)}`
);

const estimatedAdjustmentInvestment = (p: CalculatedProduct) => (
  p.recommendAdjustment > 0 ? p.recommendAdjustment * (p.soldVolume || 0) : 0
);

const buildRawSourceRows = (batch: TrackingBatch): SnapshotExportRow[] => {
  return batch.products.map((p, idx) => ({
    '批次编号': batch.id,
    '渠道': batch.channelName || '京东换新',
    '操作日期': batch.date,
    '操作主管': batch.operator,
    '设定边际底线': formatPercent(batch.marginBottomLine),
    '测算模式': pricingModeText(batch),
    '快照备注': batch.remarks || '',
    '线上行号': idx + 1,
    '源工作表': p.sourceSheet,
    '源行号': p.sourceRowNumber,
    '源字段数': p.sourceFieldCount,
    ...p.rawFields
  }));
};

const buildOnlineSnapshotRows = (batch: TrackingBatch): SnapshotExportRow[] => {
  return batch.products.map((p, idx) => ({
    '行号': idx + 1,
    '渠道': batch.channelName || '京东换新',
    '新机系列': p.newSeries,
    '旧机型号': p.oldModel,
    'PPV': p.ppv,
    '测算模式': pricingModeText(batch),
    'ppv近30天成交量': p.soldVolume || 0,
    'jd裸机价': p.jdPrice,
    'AHS投入': p.ahsInput,
    'jd到手价': p.jdHandPrice,
    'tm裸机价': p.tmPrice,
    'tm到手价': p.tmHandPrice,
    'zz裸机价': p.zzPrice,
    'zz券后价': p.zzHandPrice,
    '基准价': p.basePrice,
    '追前边际': formatPercent(p.preMarginalProfit),
    '推荐追价后': p.recommendJdPrice,
    '调整金额': p.recommendAdjustment,
    '本次竞争调整预估投入金额': estimatedAdjustmentInvestment(p),
    '追后边际': formatPercent(p.postMarginalProfit),
    '状态': statusText(p),
    '备注': p.pricingRemark
  }));
};

const buildFullSnapshotRows = (batch: TrackingBatch): SnapshotExportRow[] => {
  return batch.products.map((p, idx) => ({
    '批次编号': batch.id,
    '渠道': batch.channelName || '京东换新',
    '操作日期': batch.date,
    '操作主管': batch.operator,
    '设定边际底线': formatPercent(batch.marginBottomLine),
    '测算模式': pricingModeText(batch),
    '快照备注': batch.remarks || '',
    '本次竞争调整预估投入总额': batch.investmentRateMetrics?.estimatedInvestmentAmount ?? null,
    '手机安卓近30天回收预估销售总额': batch.investmentRateInputs?.androidSalesAmount30d ?? null,
    '手机安卓大盘竞争投入费率': batch.investmentRateMetrics ? formatPercent(batch.investmentRateMetrics.androidOverallRate) : '',
    '手机安卓近30天京东换新渠道销售额': batch.investmentRateInputs?.androidJdTradeInSalesAmount30d ?? null,
    '手机安卓换新渠道竞争投入费率': batch.investmentRateMetrics ? formatPercent(batch.investmentRateMetrics.androidJdTradeInRate) : '',
    '线上行号': idx + 1,
    '源工作表': p.sourceSheet,
    '源行号': p.sourceRowNumber,
    '源字段数': p.sourceFieldCount,
    ...p.rawFields,
    '线上_含AHS补贴后报价(L)': p.ahsQuotedPrice,
    '线上_京东到手价(N)': p.jdHandPrice,
    '线上_天猫到手价(S)': p.tmHandPrice,
    '线上_转转券(U)': p.zzCoupon,
    '线上_转转券后价(V)': p.zzHandPrice,
    '线上_追前边际利润率(AJ)': formatPercent(p.preMarginalProfit),
    '线上_推荐追价后京东物品价(AL)': p.recommendJdPrice,
    '线上_调整金额(AM)': p.recommendAdjustment,
    '线上_本次竞争调整预估投入金额': estimatedAdjustmentInvestment(p),
    '线上_追价备注': p.pricingRemark,
    '线上_追后AHS投入(BA)': p.ahsSubsidyAfter,
    '线上_追后含AHS补贴后报价(BB)': p.postAhsPrice,
    '线上_追后线性费用(BC)': p.postLinearCost,
    '线上_追后边际利润率(BE)': formatPercent(p.postMarginalProfit),
    '线上_追后京东到手价(BF)': p.postJdHandPrice,
    '线上_追后天猫物品价竞争力(AT)': p.postTmItemWin ? 1 : 0,
    '线上_追后天猫到手价竞争力(AU)': p.postTmHandWin ? 1 : 0,
    '线上_追后转转物品价竞争力(BI)': p.postZzItemWin ? 1 : 0,
    '线上_追后AHS对转转到手竞争力(BJ)': p.postAhsZzHandWin ? 1 : 0,
    '线上_状态': statusText(p)
  }));
};

const downloadWorkbook = (workbook: XLSX.WorkBook, fileName: string) => {
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

export default function HistoryPanel({ historyBatches, onDeleteBatch, channelName = '京东换新' }: Props) {
  // Selection for comparison
  const [selectedBatchIds, setSelectedBatchIds] = useState<string[]>([]);
  // Individual batch inspection
  const [inspectedBatch, setInspectedBatch] = useState<TrackingBatch | null>(null);
  // Compare State flag
  const [isComparing, setIsComparing] = useState<boolean>(false);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');

  // Handle batch inspection click
  const handleInspect = (batch: TrackingBatch) => {
    setInspectedBatch(batch);
    setIsComparing(false);
  };

  // Toggle selection for comparison
  const handleToggleSelectCompare = (id: string) => {
    setSelectedBatchIds(prev => {
      if (prev.includes(id)) {
        return prev.filter(item => item !== id);
      }
      if (prev.length >= 2) {
        // limit to 2
        return [prev[1], id];
      }
      return [...prev, id];
    });
  };

  // Clear selections
  const clearCompare = () => {
    setSelectedBatchIds([]);
    setIsComparing(false);
  };

  // Get selected batches actual structures
  const batchA = historyBatches.find(b => b.id === selectedBatchIds[0]);
  const batchB = historyBatches.find(b => b.id === selectedBatchIds[1]);

  // Export any individual batch
  const exportBatchExcel = (batch: TrackingBatch) => {
    try {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(buildRawSourceRows(batch)), "原始字段");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(buildOnlineSnapshotRows(batch)), "线上测算");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(buildFullSnapshotRows(batch)), "全字段快照");
      downloadWorkbook(wb, `${batch.channelName || channelName}_竞争追价全字段快照_${batch.id}.xlsx`);
    } catch (err: any) {
      alert('导出历史快照失败: ' + err.message);
    }
  };

  // Build a map of items for side-by-side delta calculation
  const getComparisonRows = () => {
    if (!batchA || !batchB) return [];

    const productsAMap = new Map<string, CalculatedProduct>();
    batchA.products.forEach(p => productsAMap.set(p.ppv, p));
    const productsBMap = new Map<string, CalculatedProduct>();
    batchB.products.forEach(p => productsBMap.set(p.ppv, p));
    const allPpvs = Array.from(new Set([...productsAMap.keys(), ...productsBMap.keys()]));

    return allPpvs.map(ppv => {
      const pB = productsBMap.get(ppv);
      const pA = productsAMap.get(ppv);
      const product = pB || pA;
      const priceDiff = pA && pB ? pB.recommendPrice - pA.recommendPrice : null;
      const marginDiff = pA && pB ? pB.estMarginRate - pA.estMarginRate : null;

      return {
        ppv,
        model: product?.model || '',
        brand: product?.brand || '',
        // Batch A
        priceA: pA ? pA.recommendPrice : null,
        marginA: pA ? pA.estMarginRate : null,
        // Batch B
        priceB: pB ? pB.recommendPrice : null,
        marginB: pB ? pB.estMarginRate : null,
        // Deltas
        priceDiff,
        marginDiff,
      };
    });
  };

  const comparisonRows = getComparisonRows();
  const inspectedSnapshotRows = inspectedBatch ? buildOnlineSnapshotRows(inspectedBatch) : [];
  const inspectedSnapshotColumns = inspectedSnapshotRows[0] ? Object.keys(inspectedSnapshotRows[0]) : [];

  return (
    <div className="bg-white rounded-none border border-[#141414] p-6 space-y-6" id="history-panel-area">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 border-b border-[#141414] pb-4 bg-[#F0EFEC] -mx-6 -mt-6 p-5">
        <div>
          <h3 className="font-bold text-[#141414] text-base flex items-center gap-2">
            <History className="w-5 h-5" />
            历史报价测算快照库
          </h3>
          <p className="text-xs text-[#141414]/70 mt-1">
            查看快照，或勾选两期对比价格和利润。
          </p>
        </div>

        {selectedBatchIds.length > 0 && (
          <div className="flex items-center gap-2 bg-[#D8D7D2] border border-[#141414] px-3 py-1.5 rounded-none text-xs">
            <span className="text-black font-bold">
              已选对比版本: <strong>{selectedBatchIds.length} / 2</strong>
            </span>
            {selectedBatchIds.length === 2 && (
              <button
                onClick={() => setIsComparing(true)}
                className="px-3 py-1 bg-[#141414] hover:bg-neutral-800 text-white rounded-none font-bold text-[11px]"
              >
                对比
              </button>
            )}
            <button onClick={clearCompare} className="text-slate-600 hover:text-black underline ml-1">
              重置
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Archives List */}
        <div className="lg:col-span-4 border border-[#141414] rounded-none overflow-hidden flex flex-col">
          <div className="bg-[#F0EFEC] p-3 border-b border-[#141414] flex items-center justify-between">
            <span className="font-bold text-[#141414] text-xs">{channelName}已保存快照</span>
            <span className="px-2 py-0.5 border border-[#141414] bg-white text-black text-[10px]">
              {historyBatches.length}
            </span>
          </div>

          <div className="divide-y divide-[#141414]/10 max-h-[460px] overflow-y-auto bg-white">
            {historyBatches.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs">
                暂无快照
              </div>
            ) : (
              historyBatches.map(batch => {
                const isSelected = selectedBatchIds.includes(batch.id);
                const isInspected = inspectedBatch?.id === batch.id;
                return (
                  <div 
                    key={batch.id} 
                    className={`p-3.5 hover:bg-[#F0EFEC] cursor-pointer transition-colors space-y-2 border-b border-[#141414]/10 ${
                      isInspected ? 'bg-[#EAE8E4] border-l-4 border-[#141414]' : ''
                    } ${isSelected ? 'bg-amber-500/10' : ''}`}
                    onClick={() => handleInspect(batch)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-xs text-[#141414] bg-[#D8D7D2] px-1">{batch.id}</span>
                      <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelectCompare(batch.id)}
                          className="w-4 h-4 text-[#141414] border-[#141414] rounded-none cursor-pointer focus:ring-0 accent-neutral-900"
                          title="加入对比"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 text-[10px] text-slate-600 font-mono">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-[#141414]" /> {batch.date}
                      </span>
                      <span className="text-right">操作员: <strong className="font-extrabold">{batch.operator}</strong></span>
                    </div>

	                    <div className="text-[11px] bg-white border border-[#141414]/30 p-2 rounded-none text-[#141414] flex justify-between font-mono">
	                      <span>模式: <strong>{batch.isSummaryOnly ? '竞争力纯落数' : pricingModeText(batch)}</strong></span>
	                      <span className="text-right font-extrabold">
                          {batch.isCompetitivenessConfirmed ? '正式落数' : `${batch.products.length} 款商品`}
                        </span>
	                    </div>

                    {batch.remarks && (
                      <p className="text-[10px] text-slate-500 italic font-sans overflow-hidden text-ellipsis whitespace-nowrap bg-[#F0EFEC]/40 p-1">
                        备注: {batch.remarks}
                      </p>
                    )}

                    <div className="flex justify-between items-center pt-1" onClick={e => e.stopPropagation()}>
	                      {batch.isSummaryOnly ? (
                          <span className="text-[10px] text-slate-500 font-mono font-bold">纯落数无明细下载</span>
                        ) : (
                          <button
                            onClick={() => exportBatchExcel(batch)}
                            className="text-[10px] text-slate-700 hover:text-black hover:underline flex items-center gap-1 font-mono font-bold"
                            title="下载Excel"
                          >
                            <Download className="w-3 h-3" /> 下载
                          </button>
                        )}
                      
                      {onDeleteBatch && batch.id !== 'TRACK-20260524-INIT' && (
                        <button
                          onClick={() => onDeleteBatch(batch.id)}
                          className="text-[10px] text-red-700 hover:text-red-900 font-mono"
                        >
                          删除快照
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Dynamic Panel (Inspection details OR Comparative Deltas) */}
        <div className="lg:col-span-8 border border-[#141414] rounded-none p-5 flex flex-col justify-between min-h-[400px] bg-white">
          {isComparing && batchA && batchB ? (
            /* Comparing Mode */
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-[#141414] pb-3">
                <div>
                  <h4 className="font-bold text-[#141414] text-sm uppercase tracking-wider flex items-center gap-2 font-mono">
                    <ArrowLeftRight className="w-4 h-4" />
                    版本对比
                  </h4>
                  <p className="text-xs text-slate-500 mt-1 font-mono">
                    <strong className="text-black bg-[#EAE8E4] px-1">{batchA.id}</strong> → <strong className="text-black bg-[#EAE8E4] px-1">{batchB.id}</strong>
                  </p>
                </div>
                <button
                  onClick={() => setIsComparing(false)}
                  className="px-3 py-1.5 border border-[#141414] bg-white text-black hover:bg-[#F0EFEC] text-xs font-mono uppercase"
                >
                  返回
                </button>
              </div>

              {/* Side-by-Side comparison Grid */}
              <div className="overflow-x-auto border border-[#141414]">
                <table className="min-w-full divide-y divide-[#141414] text-xs">
                  <thead className="bg-[#F0EFEC] text-[#141414] font-mono font-bold">
                    <tr>
                      <th className="px-3 py-2.5 text-left border-r border-[#141414]/30">商品 / PPV</th>
                      <th className="px-3 py-2.5 text-right font-mono border-r border-[#141414]/30 bg-neutral-100">{batchA.id}</th>
                      <th className="px-3 py-2.5 text-right font-mono border-r border-[#141414]/30 bg-amber-500/10">{batchB.id}</th>
                      <th className="px-3 py-2.5 text-center border-r border-[#141414]/30">价格差</th>
                      <th className="px-3 py-2.5 text-right">边际</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#141414]/20 bg-white">
                    {comparisonRows.map(row => {
                      const isUp = row.priceDiff !== null && row.priceDiff > 0;
                      const isDown = row.priceDiff !== null && row.priceDiff < 0;

                      return (
                        <tr key={row.ppv} className="hover:bg-[#F0EFEC]/40">
                          <td className="px-3 py-3 border-r border-[#141414]/20">
                            <span className="font-bold text-[#141414] block text-[11px] uppercase">{row.model}</span>
                            <span className="text-[9px] text-[#141414]/60 font-mono">{row.ppv}</span>
                          </td>
                          <td className="px-3 py-3 text-right font-mono border-r border-[#141414]/20 bg-neutral-100/50 text-[#141414]">
                            {row.priceA ? formatRMB(row.priceA) : 'N/A'}
                          </td>
                          <td className="px-3 py-3 text-right font-mono border-r border-[#141414]/20 bg-amber-500/5 text-[#141414] font-extrabold">
                            {row.priceB ? formatRMB(row.priceB) : 'N/A'}
                          </td>
                          {/* Price Delta column with coloring */}
                          <td className="px-3 py-3 text-center font-mono border-r border-[#141414]/20">
                            {isUp && (
                              <span className="inline-block bg-green-100 text-green-900 border border-green-500 text-[10px] uppercase px-1.5 py-0.5 font-bold">
                                +¥{row.priceDiff!.toFixed(2)}
                              </span>
                            )}
                            {isDown && (
                              <span className="inline-block bg-rose-100 text-rose-900 border border-red-500 text-[10px] uppercase px-1.5 py-0.5 font-bold animate-pulse">
                                -¥{Math.abs(row.priceDiff!).toFixed(2)}
                              </span>
                            )}
                            {row.priceDiff === 0 && (
                              <span className="text-slate-400 font-mono">-</span>
                            )}
                            {row.priceDiff === null && (
                              <span className="text-slate-400 font-mono">N/A</span>
                            )}
                          </td>
                          {/* Profit margin shift */}
                          <td className="px-3 py-3 text-right font-mono text-slate-800">
                            <div className="font-bold">
                              {row.marginB ? formatPercent(row.marginB) : 'N/A'}
                            </div>
                            {row.marginDiff !== null && row.marginDiff !== 0 && (
                              <span className={`text-[10px] font-bold ${row.marginDiff > 0 ? 'text-green-600' : 'text-rose-600'}`}>
                                {row.marginDiff > 0 ? '▲' : '▼'} {Math.abs(row.marginDiff * 100).toFixed(2)}%
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
	          ) : inspectedBatch ? (
	            /* Selected Batch details */
	            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-[#141414] pb-3 gap-2">
                <div>
                  <h4 className="font-bold text-[#141414] text-xs uppercase tracking-wider font-mono">
                    快照: <span className="font-bold bg-[#141414] text-white px-1 leading-tight">{inspectedBatch.id}</span>
                  </h4>
                  <p className="text-[10px] text-slate-600 mt-1 font-mono uppercase">
                    模式 <strong>{pricingModeText(inspectedBatch)}</strong> |
                    操作 <strong>{inspectedBatch.operator}</strong> |
                    日期 <strong>{inspectedBatch.date}</strong>
                  </p>
                </div>
	                {!inspectedBatch.isSummaryOnly && (
                    <button
                      onClick={() => exportBatchExcel(inspectedBatch)}
                      className="px-3 py-1.5 border border-[#141414] bg-white text-black hover:bg-[#F0EFEC] text-xs font-mono uppercase flex items-center gap-1 font-bold"
                    >
                      <Download className="w-3.5 h-3.5" /> 下载全字段
                    </button>
                  )}
	              </div>

                {inspectedBatch.investmentRateMetrics && (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="border border-[#141414] bg-[#F0EFEC] p-3">
                      <div className="text-[10px] text-[#141414]/60">本次竞争调整预估投入</div>
                      <div className="font-mono font-black text-lg">{formatRMB(inspectedBatch.investmentRateMetrics.estimatedInvestmentAmount)}</div>
                    </div>
                    <div className="border border-[#141414] bg-[#F0EFEC] p-3">
                      <div className="text-[10px] text-[#141414]/60">手机安卓大盘竞争投入费率</div>
                      <div className="font-mono font-black text-lg">{formatPercent(inspectedBatch.investmentRateMetrics.androidOverallRate)}</div>
                    </div>
                    <div className="border border-[#141414] bg-[#F0EFEC] p-3">
                      <div className="text-[10px] text-[#141414]/60">手机安卓换新渠道竞争投入费率</div>
                      <div className="font-mono font-black text-lg">{formatPercent(inspectedBatch.investmentRateMetrics.androidJdTradeInRate)}</div>
                    </div>
                    <div className="border border-[#141414] bg-[#F0EFEC] p-3">
                      <div className="text-[10px] text-[#141414]/60">调整PPV / 成交量</div>
                      <div className="font-mono font-black text-lg">
                        {inspectedBatch.investmentRateMetrics.adjustedPpvCount} / {inspectedBatch.investmentRateMetrics.adjustedDealVolume30d}
                      </div>
                    </div>
                  </div>
                )}
	
	              {inspectedBatch.isSummaryOnly && inspectedBatch.competitivenessMetrics ? (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="border border-[#141414] bg-[#F0EFEC] p-3">
                      <div className="text-[10px] text-[#141414]/60">天猫物品价竞争力</div>
                      <div className="font-mono font-black text-lg">{inspectedBatch.competitivenessMetrics.tmItemScore.toFixed(2)}%</div>
                    </div>
                    <div className="border border-[#141414] bg-[#F0EFEC] p-3">
                      <div className="text-[10px] text-[#141414]/60">天猫到手价竞争力</div>
                      <div className="font-mono font-black text-lg">{inspectedBatch.competitivenessMetrics.tmDirectScore.toFixed(2)}%</div>
                    </div>
                    <div className="border border-[#141414] bg-[#F0EFEC] p-3">
                      <div className="text-[10px] text-[#141414]/60">转转物品价竞争力</div>
                      <div className="font-mono font-black text-lg">{inspectedBatch.competitivenessMetrics.zzItemScore.toFixed(2)}%</div>
                    </div>
                    <div className="border border-[#141414] bg-[#F0EFEC] p-3">
                      <div className="text-[10px] text-[#141414]/60">物品价+AHS补贴 vs 转转到手价</div>
                      <div className="font-mono font-black text-lg">{inspectedBatch.competitivenessMetrics.ahsVsZzDirectScore.toFixed(2)}%</div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="text-[11px] text-[#141414]/70 font-mono">
                      页面仅展示关键字段；下载文件保留完整原始字段。
                    </div>
                    <div className="overflow-auto max-h-[420px] border border-[#141414] rounded-none">
                      <table className="min-w-[1800px] divide-y divide-[#141414] text-[10px]">
                        <thead className="bg-[#F0EFEC] text-[#141414] font-bold font-mono sticky top-0 border-b border-[#141414]">
                          <tr>
                            {inspectedSnapshotColumns.map(column => (
                              <th key={column} className="px-2 py-2 text-left border-r border-[#141414]/30 min-w-[120px] max-w-[240px]">
                                <div className="w-[120px] truncate" title={column}>{column}</div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#141414]/10 bg-white text-[#141414] font-mono">
                          {inspectedSnapshotRows.map((row, rowIndex) => (
                            <tr key={`${inspectedBatch.id}-${rowIndex}`} className="hover:bg-[#F0EFEC]/40">
                              {inspectedSnapshotColumns.map(column => {
                                const value = displaySnapshotValue(row[column]);
                                return (
                                  <td key={column} className="px-2 py-1.5 border-r border-[#141414]/10 align-top">
                                    <div className="max-w-[220px] whitespace-nowrap truncate" title={value}>
                                      {value}
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              
              {inspectedBatch.remarks && (
                <div className="p-3 bg-white border border-[#141414] rounded-none text-xs">
                  <span className="font-bold text-[#141414] block">备注</span>
                  <p className="text-[#141414] mt-1 leading-relaxed italic">
                    "{inspectedBatch.remarks}"
                  </p>
                </div>
              )}
            </div>
          ) : (
            /* Idle Screen */
            <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
              <div className="bg-[#141414] text-[#E4E3E0] p-4 rounded-none">
                <History className="w-8 h-8" />
              </div>
              <h4 className="font-extrabold text-[#141414] text-xs">未选择快照</h4>
              <p className="text-[11px] text-slate-500 max-w-sm leading-relaxed">
                左侧选择快照，或勾选两期对比。
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
