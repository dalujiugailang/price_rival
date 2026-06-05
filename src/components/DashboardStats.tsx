/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { CalculatedProduct, PricingMode } from '../types';
import { TrendingDown, ShieldAlert, CheckCircle2, Award, Zap, Percent, RefreshCw } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend, Cell } from 'recharts';
import { formatPercent } from '../utils/formulas';

interface Props {
  products: CalculatedProduct[];
  marginBottomLine: number;
  pricingMode: PricingMode;
}

export default function DashboardStats({
  products,
  marginBottomLine,
  pricingMode
}: Props) {
  // Stats
  const totalCount = products.length;
  const withTrackingSpace = products.filter(p => p.hasSpace).length;
  const criticalCount = products.filter(p => p.riskWarning === 'CRITICAL').length;
  const warningCount = products.filter(p => p.riskWarning === 'WARNING').length;
  const safeCount = totalCount - criticalCount - warningCount;

  const totalQuoteVolume = products.reduce((acc, curr) => acc + curr.quoteVolume, 0);

  // Average profit estimation
  const avgExpectedMargin = products.reduce((acc, curr) => acc + curr.estMarginRate, 0) / (totalCount || 1);

  // Prepare chart data: only PPVs with trackable uplift, matching the right-side KPI.
  const chartData = products.filter(p => p.hasSpace).map(p => ({
    fullName: p.oldModel,
    'jd裸机价': p.jdPrice,
    'tm裸机价': p.targetCompetitorPrice,
    '京东物品价-追价后': p.recommendJdPrice,
    risk: p.riskWarning
  }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* 图表展示区 */}
      <div className="lg:col-span-2 bg-white p-5 rounded-none border border-[#141414] flex flex-col justify-between">
        <div>
          <h3 className="font-bold text-[#141414] text-sm flex items-center justify-between mb-1">
            <span>京东报价与竞品追价空间分析图</span>
            <span className="text-xs text-[#141414] bg-[#E4E3E0] px-2 py-0.5 border border-[#141414]">
              {pricingMode === 'fullCompetition' ? `100%竞争力 / 风险底线 ${formatPercent(marginBottomLine)}` : `追后边际底线: ${formatPercent(marginBottomLine)}`}
            </span>
          </h3>
          <p className="text-xs text-[#141414]/75 mb-4">
            比对京东当前报价、竞品高报价与系统推荐追后报价，识别可追价空间与利润拦截。
          </p>
        </div>

        <div className="h-64 w-full bg-[#F0EFEC] border border-[#141414] p-3">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#D8D7D2" />
              <XAxis
                dataKey="fullName"
                tick={{ fontSize: 9, fill: '#141414' }}
                tickFormatter={(value) => {
                  const text = String(value || '');
                  return text.length > 8 ? `${text.slice(0, 8)}...` : text;
                }}
                stroke="#141414"
              />
              <YAxis tick={{ fontSize: 9, fill: '#141414' }} stroke="#141414" />
              <Tooltip 
                contentStyle={{ fontSize: '11px', borderRadius: '0px', border: '1px solid #141414', backgroundColor: '#ffffff' }}
                labelStyle={{ maxWidth: 360, whiteSpace: 'normal', fontWeight: 700, color: '#141414' }}
                formatter={(value: any, name: any) => [`¥${Number(value).toFixed(2)}`, name]}
              />
              <Legend verticalAlign="top" height={32} iconType="square" wrapperStyle={{ fontSize: '11px', color: '#141414' }} />
              <Bar dataKey="jd裸机价" fill="#141414" radius={[0, 0, 0, 0]} barSize={16} />
              <Bar dataKey="tm裸机价" fill="#dc2626" radius={[0, 0, 0, 0]} barSize={16} />
              <Bar dataKey="京东物品价-追价后" fill="#16a34a" radius={[0, 0, 0, 0]} barSize={16} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* KPI数据块 */}
      <div className="space-y-4 flex flex-col justify-between">
        
        {/* 数据汇报 */}
        <div className="bg-[#141414] text-[#E4E3E0] rounded-none p-4 border border-[#141414] flex flex-col justify-between h-[31%] relative">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[#E4E3E0]/70 text-[10px] font-bold">询价 PPV 汇总数</p>
              <h4 className="text-3xl font-bold mt-1 text-white">
                {totalCount} <span className="text-xs text-[#E4E3E0]/60">条规则</span>
              </h4>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-4 text-[11px]">
            <span className="px-1.5 py-0.5 bg-green-700 text-white text-[10px] border border-white">
              {totalQuoteVolume} 近30天报价量
            </span>
            <span className="opacity-80">样本覆盖 {totalCount} 条 PPV</span>
          </div>
        </div>

        {/* 追逐状况 */}
        <div className="bg-white text-[#141414] rounded-none p-4 border border-[#141414] flex flex-col justify-between h-[32%]">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[#141414]/65 text-[10px] font-bold">具备追价提升空间</p>
              <h4 className="text-2xl font-bold text-green-700 mt-1">
                {withTrackingSpace} <span className="text-[#141414]/60 text-xs">条 PPV</span>
              </h4>
            </div>
          </div>
          <div className="text-[11px] text-[#141414]/80 mt-3 pt-2 border-t border-[#141414]/20">
            {pricingMode === 'fullCompetition'
              ? `检测到 ${withTrackingSpace} 条 PPV 已按天猫裸机价+2生成追价建议。`
              : `检测到 ${withTrackingSpace} 条 PPV 可在利润约束内向竞品高报价追平。`}
          </div>
        </div>

        {/* 拦截阻断 */}
        <div className={`rounded-none p-4 border border-[#141414] flex flex-col justify-between h-[32%] transition-all ${
          criticalCount > 0 
            ? 'bg-rose-100 text-[#141414]' 
            : 'bg-emerald-50 text-[#141414]'
        }`}>
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[#141414]/75 text-[10px] font-bold">追后利润底线拦截</p>
              <h4 className={`text-2xl font-bold mt-1 ${criticalCount > 0 ? 'text-red-700 font-black' : 'text-emerald-700'}`}>
                {criticalCount} <span className="text-xs opacity-75">条需要复核</span>
              </h4>
            </div>
            <span className="px-1.5 py-0.5 bg-[#141414] text-white text-[10px]">
              {criticalCount > 0 ? '需复核' : '可执行'}
            </span>
          </div>
          <div className="text-[11px] mt-3 pt-2 border-t border-[#141414]/15 flex items-center justify-between">
            <span className="font-bold flex items-center gap-1">
              <span className={`w-1.5 h-1.5 border border-[#141414] ${criticalCount > 0 ? 'bg-red-600 animate-ping' : 'bg-green-600'}`} />
              <span>{criticalCount > 0 ? '低于边际底线' : '全部满足边际底线'}</span>
            </span>
            <span className="font-bold">
              平均追后边际: {formatPercent(avgExpectedMargin)}
            </span>
          </div>
        </div>

      </div>
    </div>
  );
}
