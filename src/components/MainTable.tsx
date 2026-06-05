/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { CalculatedProduct, PricingMode } from '../types';
import { formatRMB, formatPercent } from '../utils/formulas';
import * as XLSX from 'xlsx';

interface Props {
  products: CalculatedProduct[];
  marginBottomLine: number;
  pricingMode: PricingMode;
  onMarginChange: (margin: number) => void;
  onPricingModeChange: (mode: PricingMode) => void;
  onSaveBatch: (
    remarks: string,
    operator: string,
    options?: {
      confirmCompetitiveness: boolean;
      competitivenessDate: string;
      pricingTimestamp: string;
    }
  ) => void;
  onTriggerApiRefresh: () => void;
  lastApiSyncTime: string;
  competitionVersionName: string;
  selectedCompetitionPpvs: string[];
  onToggleCompetitionPpv: (ppv: string, selected: boolean) => void;
  onCreateCompetitionVersion: () => void;
}

const currentLocalDate = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const currentLocalDateTime = () => {
  const now = new Date();
  const date = currentLocalDate();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${date}T${hours}:${minutes}`;
};

export default function MainTable({
  products,
  marginBottomLine,
  pricingMode,
  onMarginChange,
  onPricingModeChange,
  onSaveBatch,
}: Props) {
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [batchRemarks, setBatchRemarks] = useState('');
  const [operatorName, setOperatorName] = useState('定价运营');
  const [confirmCompetitiveness, setConfirmCompetitiveness] = useState(true);
  const [competitivenessDate, setCompetitivenessDate] = useState(currentLocalDate);
  const [pricingTimestamp, setPricingTimestamp] = useState(currentLocalDateTime);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSeries, setSelectedSeries] = useState('ALL');
  const [filterRisk, setFilterRisk] = useState<'ALL' | 'CRITICAL' | 'WARNING' | 'SAFE'>('ALL');

  const seriesList = ['ALL', ...Array.from(new Set(products.map(p => p.newSeries)))];
  const rawFieldKeys = products[0] ? Object.keys(products[0].rawFields) : [];

  const handleConfirmSave = () => {
    if (!operatorName.trim()) {
      alert('请填写操作人姓名。');
      return;
    }
    if (confirmCompetitiveness && (!competitivenessDate || !pricingTimestamp)) {
      alert('请填写落数日期和追价时间。');
      return;
    }
    onSaveBatch(batchRemarks, operatorName, {
      confirmCompetitiveness,
      competitivenessDate,
      pricingTimestamp: pricingTimestamp.replace('T', ' ')
    });
    setShowSaveModal(false);
    setBatchRemarks('');
    alert(confirmCompetitiveness ? '测算快照已保存，并已确认为竞争力落数。' : '测算快照已保存，可在历史对比中查看。');
  };

  const exportToExcel = () => {
    const inquirySheetName = getInquirySheetName();
    const dataToExport = products.map((p, idx) => ({
      ...p.rawFields,
      '线上行号': idx + 1,
      '源工作表': p.sourceSheet,
      '源行号': p.sourceRowNumber,
      '源字段数': p.sourceFieldCount,
      '线上_测算模式': pricingMode === 'fullCompetition' ? '100%竞争力' : `边际底线${formatPercent(marginBottomLine)}`,
      '线上_ppv近30天成交量': p.soldVolume || 0,
      '线上_含AHS补贴后报价(L)': p.ahsQuotedPrice,
      '线上_京东到手价(N)': p.jdHandPrice,
      '线上_天猫到手价(S)': p.tmHandPrice,
      '线上_转转券(U)': p.zzCoupon,
      '线上_转转券后价(V)': p.zzHandPrice,
      '线上_追前边际利润率(AJ)': formatPercent(p.preMarginalProfit),
      '线上_推荐追价后京东物品价(AL)': p.recommendJdPrice,
      '线上_调整金额(AM)': p.recommendAdjustment,
      '线上_本次竞争调整预估投入金额': p.recommendAdjustment > 0 ? p.recommendAdjustment * (p.soldVolume || 0) : 0,
      '线上_追价备注': p.pricingRemark,
      '线上_追后AHS投入(BA)': p.ahsSubsidyAfter,
      '线上_追后含AHS补贴后报价(BB)': p.postAhsPrice,
      '线上_追后京东到手价(BF)': p.postJdHandPrice,
      '线上_追后边际利润率(BE)': formatPercent(p.postMarginalProfit),
      '线上_追后天猫物品价竞争力(AT)': p.postTmItemWin ? 1 : 0,
      '线上_追后天猫到手价竞争力(AU)': p.postTmHandWin ? 1 : 0,
      '线上_追后转转物品价竞争力(BI)': p.postZzItemWin ? 1 : 0,
      '线上_追后AHS对转转到手竞争力(BJ)': p.postAhsZzHandWin ? 1 : 0,
      '线上_状态': p.riskWarning === 'CRITICAL' ? '利润击穿' : p.riskWarning === 'WARNING' ? '逼近底线' : '可执行'
    }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `${inquirySheetName}_线上追价`);
    XLSX.writeFile(wb, `${inquirySheetName}_线上竞争追价测算_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const filteredProducts = products.filter(p => {
    const query = searchTerm.toLowerCase();
    const matchesSearch = p.ppv.toLowerCase().includes(query) || p.oldModel.toLowerCase().includes(query) || p.newSeries.toLowerCase().includes(query);
    const matchesSeries = selectedSeries === 'ALL' || p.newSeries === selectedSeries;
    const matchesRisk = filterRisk === 'ALL' || p.riskWarning === filterRisk;
    return matchesSearch && matchesSeries && matchesRisk;
  });

  const displayValue = (value: string | number | boolean | null) => {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'number') {
      return Number.isInteger(value) ? String(value) : String(Math.round(value * 10000) / 10000);
    }
    return String(value);
  };

  const splitFieldKey = (key: string) => {
    const match = key.match(/^([A-Z]+)_(.*)$/);
    return match ? { code: match[1], label: match[2] } : { code: '', label: key };
  };

  const getInquirySheetName = () => {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `询价表${month}${day}`;
  };

  const fixedColumnWidths = [
    112, 126, 420, 128, 116, 92, 148, 104, 104, 92, 92, 104, 92, 104, 92, 100, 94, 94, 94, 132, 156, 168, 116, 148, 148, 110, 150, 160, 160, 220
  ];

  const rawFieldWidth = (key: string) => {
    const { label } = splitFieldKey(key);
    const text = `${key}${label}`.toLowerCase();
    if (/ppv|sku|描述|标题|名称/.test(text)) return 300;
    if (/型号|系列|品牌|等级/.test(text)) return 168;
    if (/日期|时间|备注|原因|链接/.test(text)) return 180;
    if (/补贴|价格|裸机|到手|价|毛利|边际|金额|费用|成本|基准/.test(text)) return 116;
    if (/数量|报价量|成交|销量|占比|率|id/.test(text)) return 96;
    return 132;
  };

  const rawColumnWidths = rawFieldKeys.map(rawFieldWidth);
  const tableWidth = fixedColumnWidths.reduce((sum, width) => sum + width, 0) + rawColumnWidths.reduce((sum, width) => sum + width, 0);
  const rawHeaderStyle = (key: string): React.CSSProperties => {
    const width = rawFieldWidth(key);
    return { width, minWidth: width, maxWidth: width };
  };

  const headerClass = 'px-2 py-1 border-r border-[#141414] text-center leading-tight align-middle';
  const bodyClass = 'px-2 py-1 border-r border-[#141414]/20 align-middle';
  const headerLabel = (label: string) => (
    <div className="w-full truncate mx-auto" title={label}>
      {label}
    </div>
  );

  return (
    <div className="bg-white border border-[#141414] overflow-hidden" id="main-tracking-panel">
      <div className="p-3 border-b border-[#141414] bg-[#F0EFEC] flex items-center justify-between gap-3">
        <h2 className="text-base font-bold text-[#141414] flex items-center gap-2">
          <span className="bg-[#141414] text-[#E4E3E0] px-2 py-0.5 text-xs">{getInquirySheetName()}</span>
          竞争追价控制台
        </h2>
        <button onClick={exportToExcel} className="px-3 py-1.5 border border-[#141414] bg-white hover:bg-black hover:text-white text-xs font-bold">
          导出追价表
        </button>
        <button onClick={() => setShowSaveModal(true)} id="save-snapshot-btn-element" className="hidden">
          保存快照
        </button>
      </div>

      <div className="p-3 border-b border-[#141414] bg-[#D8D7D2] grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3 items-center">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs font-bold">追后边际利润率底线：</label>
          <div className="flex gap-1 bg-white p-0.5 border border-[#141414]">
            {[-0.03, 0, 0.03].map(val => (
              <button key={val} type="button" onClick={() => onMarginChange(val)} className={`px-3 py-1 text-xs font-bold ${pricingMode === 'margin' && marginBottomLine === val ? 'bg-[#141414] text-white' : 'hover:bg-black/10'}`}>
                {formatPercent(val)}
              </button>
            ))}
            <button type="button" onClick={() => onPricingModeChange('fullCompetition')} className={`px-3 py-1 text-xs font-bold ${pricingMode === 'fullCompetition' ? 'bg-[#141414] text-white' : 'hover:bg-black/10'}`}>
              100%竞争力
            </button>
          </div>
          <input type="number" min="-50" max="50" step="0.1" value={Math.round(marginBottomLine * 1000) / 10} onChange={(e) => onMarginChange(Math.max(-50, Math.min(50, parseFloat(e.target.value) || 0)) / 100)} className="w-24 px-2 py-1 border border-[#141414] text-xs font-bold" />
          <span className="text-xs">%</span>
        </div>
        <div className="text-xs bg-white/70 border border-[#141414]/20 p-2">
          {pricingMode === 'fullCompetition'
            ? '100%竞争力：所有 jd裸机价<tm裸机价 的行强制追到 tm裸机价+2；补贴、线性费用、追后边际仍照常重算。'
            : '公式口径：补贴按新机系列+门槛动态命中；线性费用=(追价后京东物品价+补贴)*4.66%+基准价*2.18%+81；追后边际=BE。'}
        </div>
      </div>

      <div className="bg-[#E4E3E0] p-3 border-b border-[#141414] flex flex-wrap gap-3 items-center justify-between">
        <div className="flex flex-wrap gap-2">
          <select value={selectedSeries} onChange={(e) => setSelectedSeries(e.target.value)} className="bg-white border border-[#141414] py-1.5 px-3 text-xs">
            {seriesList.map(s => <option key={s} value={s}>{s === 'ALL' ? '全部新机系列' : s}</option>)}
          </select>
          <select value={filterRisk} onChange={(e) => setFilterRisk(e.target.value as any)} className="bg-white border border-[#141414] py-1.5 px-3 text-xs">
            <option value="ALL">全部状态</option>
            <option value="SAFE">可执行</option>
            <option value="WARNING">逼近底线</option>
            <option value="CRITICAL">利润击穿</option>
          </select>
        </div>
        <input type="text" placeholder="搜索新机系列 / 旧机型号 / PPV" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full sm:w-80 bg-white border border-[#141414] px-3 py-1.5 text-xs font-bold" />
      </div>

      <div className="overflow-x-auto">
        <table className="table-fixed text-[11px] leading-tight" style={{ width: tableWidth, minWidth: tableWidth }}>
          <colgroup>
            {fixedColumnWidths.map((width, index) => (
              <col key={`fixed-${index}`} style={{ width }} />
            ))}
            {rawColumnWidths.map((width, index) => (
              <col key={`raw-${rawFieldKeys[index]}`} style={{ width }} />
            ))}
          </colgroup>
          <thead className="bg-[#F0EFEC] border-b border-[#141414]">
            <tr>
              <th className={headerClass}>A</th>
              <th className={headerClass}>E</th>
              <th className={headerClass}>F</th>
              <th className={headerClass}>H</th>
              <th className={headerClass}>I</th>
              <th className={headerClass}>W</th>
              <th className={headerClass}>X</th>
              <th className={headerClass}>Y</th>
              <th className={headerClass}>AA</th>
              <th className={headerClass}>AB</th>
              <th className={headerClass}>AC</th>
              <th className={headerClass}>AF</th>
              <th className={headerClass}>AG</th>
              <th className={headerClass}>AI</th>
              <th className={headerClass}>AT</th>
              <th className={headerClass}>AW</th>
              <th className={headerClass}>AO</th>
              <th className={headerClass}>AP</th>
              <th className={headerClass}>AQ</th>
              <th className={headerClass}>AR</th>
	              <th className={`${headerClass} bg-[#D8D7D2]`}>AY</th>
	              <th className={`${headerClass} bg-[#D8D7D2]`}>AZ</th>
	              <th className={headerClass}>BA</th>
	              <th className={headerClass}>BB</th>
	              <th className={headerClass}>BF</th>
	              <th className={headerClass}>BE</th>
              <th className={headerClass}>BG</th>
              <th className={headerClass}>BH</th>
              <th className={headerClass}>BI</th>
              <th className={headerClass}>BJ</th>
              {rawFieldKeys.map(key => (
                <th key={`code-${key}`} style={rawHeaderStyle(key)} className="px-2 py-1 text-center border-r border-[#141414]">
                  {splitFieldKey(key).code}
                </th>
              ))}
            </tr>
            <tr>
              <th className={headerClass}>{headerLabel('新机系列')}</th>
              <th className={headerClass}>{headerLabel('旧机型号')}</th>
              <th className={headerClass}>{headerLabel('ppv')}</th>
              <th className={headerClass}>{headerLabel('ppv近30天报价量')}</th>
              <th className={headerClass}>{headerLabel('ppv近30天成交量')}</th>
              <th className={headerClass}>{headerLabel('jd裸机价')}</th>
              <th className={headerClass}>{headerLabel('对应新品型号ahs投入')}</th>
              <th className={headerClass}>{headerLabel('含AHS补贴后报价')}</th>
              <th className={headerClass}>{headerLabel('jd总到手价')}</th>
              <th className={headerClass}>{headerLabel('tm裸机价')}</th>
              <th className={headerClass}>{headerLabel('tm总补贴-人工')}</th>
              <th className={headerClass}>{headerLabel('tm总到手价')}</th>
              <th className={headerClass}>{headerLabel('zz裸机价')}</th>
              <th className={headerClass}>{headerLabel('zz券后价')}</th>
              <th className={headerClass}>{headerLabel('基准价')}</th>
              <th className={headerClass}>{headerLabel('追前边际利润率')}</th>
              <th className={headerClass}>{headerLabel('裸机比tm')}</th>
              <th className={headerClass}>{headerLabel('到手比tm')}</th>
              <th className={headerClass}>{headerLabel('裸机比zz')}</th>
              <th className={headerClass}>{headerLabel('仅含ahs补贴+裸机 vs zz到手')}</th>
	              <th className={`${headerClass} bg-[#D8D7D2]`}>{headerLabel('京东物品价-追价后')}</th>
	              <th className={`${headerClass} bg-[#D8D7D2]`}>{headerLabel('京东物品价-追价后调整金额')}</th>
	              <th className={headerClass}>{headerLabel('ahs承担补贴-追价后')}</th>
	              <th className={headerClass}>{headerLabel('含AHS补贴后报价-追价后')}</th>
	              <th className={headerClass}>{headerLabel('jd总到手价-追价后')}</th>
	              <th className={headerClass}>{headerLabel('追后边际利润率')}</th>
              <th className={headerClass}>{headerLabel('京东物品价-追价后 vs 天猫')}</th>
              <th className={headerClass}>{headerLabel('京东到手价-追价后 vs 天猫')}</th>
              <th className={headerClass}>{headerLabel('京东物品价-追价后 vs 转转')}</th>
              <th className={headerClass}>{headerLabel('京东物品价+ahs补贴-追价后 vs 转转')}</th>
              {rawFieldKeys.map(key => (
                <th key={`label-${key}`} style={rawHeaderStyle(key)} className="px-2 py-1 text-left border-r border-[#141414]">
                  <div className="w-full truncate" title={splitFieldKey(key).label}>
                    {splitFieldKey(key).label}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredProducts.map(p => (
              <tr key={p.id} className={`border-b border-[#141414]/20 ${p.riskWarning === 'CRITICAL' ? 'bg-rose-50' : p.riskWarning === 'WARNING' ? 'bg-amber-50' : 'hover:bg-[#F9F9F8]'}`}>
                <td className={bodyClass}>
                  <div className="whitespace-nowrap font-bold">{p.newSeries}</div>
                </td>
                <td className={bodyClass}>
                  <div className="whitespace-nowrap font-bold">{p.oldModel}</div>
                </td>
                <td className={bodyClass}>
                  <div className="truncate font-bold text-[#141414]" title={p.ppv}>{p.ppv}</div>
                </td>
                <td className="px-2 py-1 text-right border-r border-[#141414]/20 font-mono">{p.quoteVolume}</td>
                <td className="px-2 py-1 text-right border-r border-[#141414]/20 font-mono">{p.soldVolume || 0}</td>
                <td className="px-2 py-1 text-right border-r border-[#141414]/20 font-mono">
                  {displayValue(p.jdPrice)}
                </td>
                <td className="px-2 py-1 text-right border-r border-[#141414]/20 font-mono">
                  {displayValue(p.ahsInput)}
                </td>
                <td className="px-2 py-1 text-right border-r border-[#141414]/20 font-mono">{formatRMB(p.ahsQuotedPrice)}</td>
                <td className="px-2 py-1 text-right border-r border-[#141414]/20 font-mono">{formatRMB(p.jdHandPrice)}</td>
                <td className="px-2 py-1 text-right border-r border-[#141414]/20 font-mono">
                  {displayValue(p.tmPrice)}
                </td>
                <td className="px-2 py-1 text-right border-r border-[#141414]/20 font-mono">
                  {displayValue(p.tmSubsidyManual)}
                </td>
                <td className="px-2 py-1 text-right border-r border-[#141414]/20 font-mono">{formatRMB(p.tmHandPrice)}</td>
                <td className="px-2 py-1 text-right border-r border-[#141414]/20 font-mono">
                  {displayValue(p.zzPrice)}
                </td>
                <td className="px-2 py-1 text-right border-r border-[#141414]/20 font-mono">
                  {formatRMB(p.zzHandPrice)}
                </td>
                <td className="px-2 py-1 text-right border-r border-[#141414]/20 font-mono">{formatRMB(p.basePrice)}</td>
                <td className={`px-2 py-1 text-right border-r border-[#141414]/20 font-bold ${p.preMarginalProfit < marginBottomLine ? 'text-red-700' : 'text-green-700'}`}>{formatPercent(p.preMarginalProfit)}</td>
                <td className="px-2 py-1 text-center border-r border-[#141414]/20 font-mono">{p.tmItemWin ? 1 : 0}</td>
                <td className="px-2 py-1 text-center border-r border-[#141414]/20 font-mono">{p.tmHandWin ? 1 : 0}</td>
                <td className="px-2 py-1 text-center border-r border-[#141414]/20 font-mono">{p.zzItemWin ? 1 : 0}</td>
                <td className="px-2 py-1 text-center border-r border-[#141414]/20 font-mono">{p.ahsZzHandWin ? 1 : 0}</td>
                <td className="px-2 py-1 text-right border-r border-[#141414]/20 bg-[#D8D7D2] font-extrabold">
                  {formatRMB(p.recommendJdPrice)}
                  {p.pricingRemark && <div className="truncate text-[10px] font-normal text-[#141414]/60" title={p.pricingRemark}>{p.pricingRemark}</div>}
                </td>
	                <td className={`px-2 py-1 text-right border-r border-[#141414]/20 bg-[#D8D7D2] font-bold ${p.recommendAdjustment > 0 ? 'text-green-700' : 'text-slate-500'}`}>{formatRMB(p.recommendAdjustment)}</td>
	                <td className="px-2 py-1 text-right border-r border-[#141414]/20 font-mono">{formatRMB(p.ahsSubsidyAfter)}</td>
	                <td className="px-2 py-1 text-right border-r border-[#141414]/20 font-mono">{formatRMB(p.postAhsPrice)}</td>
	                <td className="px-2 py-1 text-right border-r border-[#141414]/20 font-mono">{formatRMB(p.postJdHandPrice)}</td>
	                <td className={`px-2 py-1 text-right border-r border-[#141414]/20 font-extrabold ${p.postMarginalProfit < marginBottomLine ? 'text-red-700' : 'text-green-700'}`}>
                  {formatPercent(p.postMarginalProfit)}
                  <div className="text-[10px] text-slate-500">{pricingMode === 'fullCompetition' ? '目标' : '上限'} {formatRMB(p.maxPriceByMargin)}</div>
                </td>
                <td className="px-2 py-1 text-center border-r border-[#141414]/20 font-mono">{p.postTmItemWin ? 1 : 0}</td>
                <td className="px-2 py-1 text-center border-r border-[#141414]/20 font-mono">{p.postTmHandWin ? 1 : 0}</td>
                <td className="px-2 py-1 text-center border-r border-[#141414]/20 font-mono">{p.postZzItemWin ? 1 : 0}</td>
                <td className="px-2 py-1 text-center border-r border-[#141414]/20 font-mono">{p.postAhsZzHandWin ? 1 : 0}</td>
                {rawFieldKeys.map(key => (
                  <td key={key} style={rawHeaderStyle(key)} className="px-2 py-1 border-r border-[#141414]/10 align-top">
                    <div className="max-h-10 overflow-hidden text-ellipsis break-words font-mono text-[10px] leading-snug" title={displayValue(p.rawFields[key])}>
                      {displayValue(p.rawFields[key])}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showSaveModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white max-w-sm w-full border border-[#141414]">
            <div className="p-4 bg-[#141414] text-white flex items-center justify-between">
              <h3 className="font-bold text-xs">保存测算快照</h3>
              <button onClick={() => setShowSaveModal(false)} className="text-xs underline">关闭</button>
            </div>
              <div className="p-5 space-y-4">
                <input type="text" value={operatorName} onChange={(e) => setOperatorName(e.target.value)} className="w-full bg-[#F0EFEC] border border-[#141414] p-2 text-xs font-bold" placeholder="操作人" />
                <label className="flex items-center gap-2 border border-[#141414] bg-[#F9F9F8] p-2 text-xs font-bold">
                  <input
                    type="checkbox"
                    checked={confirmCompetitiveness}
                    onChange={(e) => setConfirmCompetitiveness(e.target.checked)}
                    className="h-4 w-4 accent-neutral-900"
                  />
                  确认为竞争力落数
                </label>
                {confirmCompetitiveness && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="space-y-1 text-[11px] font-bold text-[#141414]">
                      <span>落数日期</span>
                      <input
                        type="date"
                        value={competitivenessDate}
                        onChange={(e) => setCompetitivenessDate(e.target.value)}
                        className="w-full bg-[#F0EFEC] border border-[#141414] p-2 text-xs font-bold"
                      />
                    </label>
                    <label className="space-y-1 text-[11px] font-bold text-[#141414]">
                      <span>追价时间</span>
                      <input
                        type="datetime-local"
                        value={pricingTimestamp}
                        onChange={(e) => setPricingTimestamp(e.target.value)}
                        className="w-full bg-[#F0EFEC] border border-[#141414] p-2 text-xs font-bold"
                      />
                    </label>
                  </div>
                )}
                <textarea rows={2} value={batchRemarks} onChange={(e) => setBatchRemarks(e.target.value)} className="w-full bg-[#F0EFEC] border border-[#141414] p-2 text-xs" placeholder="测算版本备注" />
                <div className="pt-2 border-t border-[#141414] flex justify-end gap-2 text-xs">
                  <button type="button" onClick={() => setShowSaveModal(false)} className="px-3 py-1.5 border border-[#141414]">取消</button>
                  <button type="button" onClick={handleConfirmSave} className="px-3 py-1.5 bg-[#141414] text-white">
                    {confirmCompetitiveness ? '保存并确认落数' : '确认保存'}
                  </button>
                </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
