/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { CalculatedProduct, InvestmentRateInputs } from '../types';
import { formatRMB, formatPercent } from '../utils/formulas';
import { calculateCompetitionInvestmentMetrics } from '../utils/investment';

interface Props {
  products: CalculatedProduct[];
  investmentRateInputs: InvestmentRateInputs;
  onInvestmentRateInputsChange: (inputs: InvestmentRateInputs) => void;
}

export default function InvestmentRatePanel({
  products,
  investmentRateInputs,
  onInvestmentRateInputsChange
}: Props) {
  const [draftInputs, setDraftInputs] = useState(investmentRateInputs);
  const investmentMetrics = calculateCompetitionInvestmentMetrics(products, investmentRateInputs);
  const isDraftChanged = (
    draftInputs.androidSalesAmount30d !== investmentRateInputs.androidSalesAmount30d
    || draftInputs.androidJdTradeInSalesAmount30d !== investmentRateInputs.androidJdTradeInSalesAmount30d
  );

  useEffect(() => {
    setDraftInputs(investmentRateInputs);
  }, [investmentRateInputs]);

  return (
    <div id="investment-rate-panel" className="mb-2 border border-[#141414] bg-white overflow-hidden">
      <div className="p-3 border-b border-[#141414] bg-[#F0EFEC] flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <h2 className="text-base font-bold text-[#141414] flex items-center gap-2">
          <span className="bg-[#141414] text-[#E4E3E0] px-2 py-0.5 text-xs">费率测算</span>
          竞争预计投入费率测算
        </h2>
        <div className="text-[10px] font-bold text-[#141414]/65">
          正向调整金额 × ppv近30天成交量；保存并确认落数时写入历史快照。
        </div>
      </div>

      <div className="bg-white p-3 grid grid-cols-1 xl:grid-cols-[1fr_320px_320px] gap-3 items-stretch">
        <div className="border border-[#141414] bg-[#F9F9F8] p-3 flex flex-col justify-between min-h-[128px]">
          <div className="flex items-center justify-between border-b border-[#141414] pb-2">
            <div className="text-xs font-black text-[#141414]">投入费率结果</div>
            <div className="text-[10px] font-bold text-[#141414]/60">
              已按最近一次计算刷新
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
              <div className="text-[10px] font-bold text-[#141414]/65 leading-tight">手机安卓换新渠道竞争投入费率</div>
              <div className="font-mono text-2xl 2xl:text-[40px] font-black text-green-700 mt-1 leading-none min-h-6 2xl:min-h-[57px]">
                {formatPercent(investmentMetrics.androidJdTradeInRate)}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-[#141414] text-white border border-[#141414] p-4 flex flex-col justify-around items-start gap-0 min-h-[128px]">
          <div className="text-[10px] font-bold text-white/70">竞争预估投入费用</div>
          <div>
            <div className="font-mono text-3xl font-black leading-none tracking-normal">
              {formatRMB(investmentMetrics.estimatedInvestmentAmount)}
            </div>
            <div className="mt-3 pt-2 border-t border-white/20 text-[10px] font-bold text-white/65">
              调整 PPV {investmentMetrics.adjustedPpvCount} 条 / 成交量 {investmentMetrics.adjustedDealVolume30d}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 content-center border border-[#141414] bg-[#D8D7D2] p-3">
          <label className="space-y-1">
            <span className="block text-[10px] font-bold text-[#141414]/70">手机安卓近30天回收预估销售总额</span>
            <input
              type="number"
              min="0"
              value={draftInputs.androidSalesAmount30d || ''}
              onChange={(event) => setDraftInputs({
                ...draftInputs,
                androidSalesAmount30d: Number(event.target.value) || 0
              })}
              className="w-full h-8 border border-[#141414] bg-white px-2 text-xs font-mono focus:outline-none focus:ring-0 focus:border-[#141414]"
              placeholder="输入销售额"
            />
          </label>
          <label className="space-y-1">
            <span className="block text-[10px] font-bold text-[#141414]/70">手机安卓近30天京东换新渠道销售额</span>
            <input
              type="number"
              min="0"
              value={draftInputs.androidJdTradeInSalesAmount30d || ''}
              onChange={(event) => setDraftInputs({
                ...draftInputs,
                androidJdTradeInSalesAmount30d: Number(event.target.value) || 0
              })}
              className="w-full h-8 border border-[#141414] bg-white px-2 text-xs font-mono focus:outline-none focus:ring-0 focus:border-[#141414]"
              placeholder="输入销售额"
            />
          </label>
          <button
            type="button"
            onClick={() => onInvestmentRateInputsChange(draftInputs)}
            className={`h-7 border border-[#141414] text-xs font-black transition-colors ${
              isDraftChanged
                ? 'bg-[#141414] text-white hover:bg-[#2A2A2B]'
                : 'bg-white text-[#141414] hover:bg-[#141414] hover:text-white'
            } focus:outline-none focus:ring-0 focus:border-[#141414]`}
          >
            计算费率
          </button>
        </div>
      </div>
    </div>
  );
}
