/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { CalculatedProduct, InvestmentRateInputs, GradeInvestmentContribution, BrandSalesAmount30d } from '../types';
import { formatRMB, formatPercent } from '../utils/formulas';
import { calculateBrandCompetitionInvestmentMetrics, calculateCompetitionInvestmentMetrics } from '../utils/investment';
import { ChevronDown, RefreshCw } from 'lucide-react';
import { AndroidRevenueSnapshot } from '../api';

interface Props {
  gradeInvestment?:GradeInvestmentContribution;
  brandSalesAmounts30d?:BrandSalesAmount30d[];
  showGradeInvestment?:boolean;
  products: CalculatedProduct[];
  investmentRateInputs: InvestmentRateInputs;
  onInvestmentRateInputsChange: (inputs: InvestmentRateInputs) => void;
  channelSalesLabel?: string;
  readOnly?: boolean;
  automaticSnapshot?: AndroidRevenueSnapshot | null;
  automaticStatus?: 'idle' | 'loading' | 'success' | 'error';
  automaticError?: string;
  onAutomaticRefresh?: () => void | Promise<void>;
}

export default function InvestmentRatePanel({
  products,
  investmentRateInputs,
  onInvestmentRateInputsChange,
  channelSalesLabel = '手机安卓近30天京东换新渠道销售额',
  readOnly = false,
  automaticSnapshot,
  automaticStatus = 'idle',
  automaticError,
  onAutomaticRefresh,
  gradeInvestment,
  brandSalesAmounts30d,
  showGradeInvestment=false
}: Props) {
  const [draftInputs, setDraftInputs] = useState(investmentRateInputs);
  const [showBrandRates, setShowBrandRates] = useState(false);
  const investmentMetrics = calculateCompetitionInvestmentMetrics(products, investmentRateInputs,gradeInvestment);
  const brandInvestmentMetrics = showBrandRates
    ? calculateBrandCompetitionInvestmentMetrics(products, brandSalesAmounts30d ?? automaticSnapshot?.brandSalesAmounts30d ?? [],gradeInvestment)
    : [];
  const isDraftChanged = (
    draftInputs.androidSalesAmount30d !== investmentRateInputs.androidSalesAmount30d
    || draftInputs.androidJdTradeInSalesAmount30d !== investmentRateInputs.androidJdTradeInSalesAmount30d
  );

  useEffect(() => {
    setDraftInputs(investmentRateInputs);
  }, [investmentRateInputs]);

  return (
    <div id="investment-rate-panel" data-tour="investment-rate" className="mb-2 border border-[#141414] bg-white overflow-hidden">
      <div className="p-3 border-b border-[#141414] bg-[#F0EFEC] flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <h2 className="text-base font-bold text-[#141414] flex items-center gap-2">
          <span className="bg-[#141414] text-[#E4E3E0] px-2 py-0.5 text-xs">费率测算</span>
          竞争预计投入费率测算
        </h2>
        <div className="text-[10px] font-bold text-[#141414]/65">
          {showGradeInvestment?'重点追价投入 + 已保存确认的等级新增投入':'正向调整金额 × ppv近30天成交量；保存并确认落数时写入历史快照。'}
        </div>
      </div>

      <div className="bg-white p-3 grid grid-cols-1 xl:grid-cols-[1fr_320px_320px] gap-3 items-stretch">
        <div className="border border-[#141414] bg-[#F9F9F8] p-3 flex flex-col justify-between min-h-[128px]">
          <div className="flex items-center justify-between border-b border-[#141414] pb-2">
            <div className="text-xs font-black text-[#141414]">投入费率结果</div>
            <div className="text-[10px] font-bold text-[#141414]/60">
              {onAutomaticRefresh && automaticStatus === 'loading'
                ? '正在更新分母'
                : automaticStatus === 'error' ? '自动分母更新失败' : '已按最近一次计算刷新'}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="pt-2 min-h-[86px] flex flex-col justify-center min-w-0">
              <div className="text-[10px] font-bold text-[#141414]/65 leading-tight">手机安卓大盘竞争投入费率</div>
              <div className="font-mono text-2xl 2xl:text-[40px] font-black text-green-700 mt-1 leading-none min-h-6 2xl:min-h-[57px]">
                {formatPercent(investmentMetrics.androidOverallRate)}
              </div>
            </div>
            <div className="pt-2 min-h-[86px] flex flex-col justify-center min-w-0">
              <div className="text-[10px] font-bold text-[#141414]/65 leading-tight">{channelSalesLabel.replace('销售额', '竞争投入费率')}</div>
              <div className="font-mono text-2xl 2xl:text-[40px] font-black text-green-700 mt-1 leading-none min-h-6 2xl:min-h-[57px]">
                {formatPercent(investmentMetrics.androidJdTradeInRate)}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-[#141414] text-white border border-[#141414] p-4 flex flex-col justify-around items-start gap-0 min-h-[128px]">
          <div className="text-[10px] font-bold text-white/70">{showGradeInvestment?'合计预估投入费用':'竞争预估投入费用'}</div>
          <div>
            <div className="font-mono text-3xl font-black leading-none tracking-normal">
              {formatRMB(investmentMetrics.estimatedInvestmentAmount)}
            </div>
            <div className="mt-3 pt-2 border-t border-white/20 text-[10px] font-bold text-white/65">
              调整 PPV {investmentMetrics.adjustedPpvCount} 条 / 成交量 {investmentMetrics.adjustedDealVolume30d}
              {showGradeInvestment&&<div className="mt-1">已确认等级新增投入 {formatRMB(gradeInvestment?.amount||0)}{gradeInvestment?.pendingRows?` · 待补 ${gradeInvestment.pendingRows} 行`:''}</div>}
            </div>
          </div>
        </div>

        {onAutomaticRefresh ? (
          <div className="grid grid-cols-1 gap-2 content-center border border-[#141414] bg-[#D8D7D2] p-3" aria-live="polite">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-black text-[#141414]">Supabase 自动分母</span>
              <button
                type="button"
                onClick={() => void onAutomaticRefresh()}
                disabled={automaticStatus === 'loading'}
                className="flex h-7 items-center gap-1 border border-[#141414] bg-white px-2 text-[10px] font-black hover:bg-[#141414] hover:text-white disabled:cursor-wait disabled:opacity-60"
              >
                <RefreshCw className={`h-3 w-3 ${automaticStatus === 'loading' ? 'animate-spin' : ''}`} />
                {automaticStatus === 'loading' ? '拉取中' : '刷新'}
              </button>
            </div>
            {automaticSnapshot ? (
              <>
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div className="border border-[#141414]/40 bg-white p-2">
                    <div className="font-bold text-[#141414]/60">安卓大盘</div>
                    <div className="mt-1 font-mono font-black">{formatRMB(automaticSnapshot.androidSalesAmount30d)}</div>
                  </div>
                  <button
                    type="button"
                    aria-expanded={showBrandRates}
                    aria-controls="brand-investment-rate-detail"
                    onClick={() => setShowBrandRates(value => !value)}
                    className="border border-[#141414]/40 bg-white p-2 text-left transition-colors hover:border-[#141414] hover:bg-[#F0EFEC]"
                  >
                    <div className="font-bold text-[#141414]/60">京东换新</div>
                    <div className="mt-1 font-mono font-black">{formatRMB(automaticSnapshot.androidJdTradeInSalesAmount30d)}</div>
                    <div className="mt-1 flex items-center gap-1 font-bold text-[#141414]/60">
                      品牌费率 <ChevronDown className={`h-3 w-3 transition-transform ${showBrandRates ? 'rotate-180' : ''}`} />
                    </div>
                  </button>
                </div>
                <div className="text-[10px] font-bold leading-relaxed text-[#141414]/70">
                  数据日 {automaticSnapshot.dataDate} · {automaticSnapshot.periodStart} 至 {automaticSnapshot.periodEnd}
                </div>
              </>
            ) : (
              <div className="border border-dashed border-[#141414]/50 bg-white p-3 text-[10px] font-bold text-[#141414]/70">
                {automaticStatus === 'loading' ? '正在从 Supabase 获取近30天销售额…' : '尚未取得自动分母'}
              </div>
            )}
            {automaticError && (
              <div className="text-[10px] font-bold leading-relaxed text-red-700">
                {automaticError}；{automaticSnapshot ? '当前继续使用上次成功取得的分母。' : '未覆盖本地已有分母。'}
              </div>
            )}
          </div>
        ) : <div className="grid grid-cols-1 gap-2 content-center border border-[#141414] bg-[#D8D7D2] p-3">
          <label className="space-y-1">
            <span className="block text-[10px] font-bold text-[#141414]/70">手机安卓近30天回收预估销售总额</span>
            <input
              type="number"
              min="0"
              value={draftInputs.androidSalesAmount30d || ''}
              disabled={readOnly}
              onChange={(event) => setDraftInputs({
                ...draftInputs,
                androidSalesAmount30d: Number(event.target.value) || 0
              })}
              className="w-full h-8 border border-[#141414] bg-white px-2 text-xs font-mono focus:outline-none focus:ring-0 focus:border-[#141414] disabled:cursor-not-allowed disabled:bg-[#F0EFEC] disabled:text-[#555]"
              placeholder="输入销售额"
            />
          </label>
          <label className="space-y-1">
            <span className="block text-[10px] font-bold text-[#141414]/70">{channelSalesLabel}</span>
            <input
              type="number"
              min="0"
              value={draftInputs.androidJdTradeInSalesAmount30d || ''}
              disabled={readOnly}
              onChange={(event) => setDraftInputs({
                ...draftInputs,
                androidJdTradeInSalesAmount30d: Number(event.target.value) || 0
              })}
              className="w-full h-8 border border-[#141414] bg-white px-2 text-xs font-mono focus:outline-none focus:ring-0 focus:border-[#141414] disabled:cursor-not-allowed disabled:bg-[#F0EFEC] disabled:text-[#555]"
              placeholder="输入销售额"
            />
          </label>
          <button
            type="button"
            disabled={readOnly}
            onClick={() => onInvestmentRateInputsChange(draftInputs)}
            className={`h-7 border border-[#141414] text-xs font-black transition-colors ${
              isDraftChanged
                ? 'bg-[#141414] text-white hover:bg-[#2A2A2B]'
                : 'bg-white text-[#141414] hover:bg-[#141414] hover:text-white'
            } focus:outline-none focus:ring-0 focus:border-[#141414]`}
          >
            {readOnly ? '只读' : '计算费率'}
          </button>
        </div>}

        {showBrandRates && (
          <div id="brand-investment-rate-detail" className="xl:col-span-3 border border-[#141414] bg-[#F9F9F8]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#141414] bg-[#F0EFEC] px-3 py-2">
              <div>
                <div className="text-xs font-black">BK 品牌投入费率</div>
                <div className="mt-0.5 text-[10px] font-bold text-[#141414]/60">品牌费率＝（重点追价投入＋已确认等级新增投入）÷ 该品牌京东换新近30天销售额；缺少分母显示“-”。</div>
              </div>
              {automaticSnapshot&&<div className="text-[10px] font-bold text-[#141414]/60">数据日 {automaticSnapshot.dataDate}</div>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-[11px]">
                <thead>
                  <tr className="border-b border-[#141414] bg-white text-left">
                    <th className="px-3 py-2">BK 品牌名称</th>
                    <th className="px-3 py-2 text-right">工作台行数</th>
                    <th className="px-3 py-2 text-right">调整 PPV</th>
                    <th className="px-3 py-2 text-right">近30天成交量</th>
                    <th className="px-3 py-2 text-right">重点追价投入</th>
                    <th className="px-3 py-2 text-right">已确认等级投入</th>
                    <th className="px-3 py-2 text-right">合计投入</th>
                    <th className="px-3 py-2 text-right">品牌销售额分母</th>
                    <th className="px-3 py-2 text-right">品牌投入费率</th>
                  </tr>
                </thead>
                <tbody>
                  {brandInvestmentMetrics.map(row => (
                    <tr key={row.brand} className="border-b border-[#141414]/15 last:border-b-0">
                      <td className="px-3 py-2 font-black">{row.displayName}</td>
                      <td className="px-3 py-2 text-right font-mono">{row.workspaceRowCount}</td>
                      <td className="px-3 py-2 text-right font-mono">{row.adjustedPpvCount}</td>
                      <td className="px-3 py-2 text-right font-mono">{row.adjustedDealVolume30d}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatRMB(row.coreInvestmentAmount||0)}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatRMB(row.gradeInvestmentAmount||0)}{row.pendingGradeRows?`（待补${row.pendingGradeRows}行）`:''}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatRMB(row.estimatedInvestmentAmount)}</td>
                      <td className="px-3 py-2 text-right font-mono">{row.salesAmount30d>0?formatRMB(row.salesAmount30d):'-'}</td>
                      <td className="px-3 py-2 text-right font-mono font-black text-green-700">{row.investmentRate==null?'-':formatPercent(row.investmentRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
