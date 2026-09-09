/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalculatedProduct, ChannelId, PricingMode, SelfOperatedSubsidyRule, SubsidyRule, TrackingBatch } from '../types';
import { formatRMB, formatPercent } from '../utils/formulas';
import { calculateCompetitivenessMetrics } from '../utils/competitiveness';
import { addDynamicPricingWorkbookSheets } from '../utils/pricingWorkbook';
import { getSmallGapTolerancePrices } from '../utils/smallGapTolerance';
import { getTmPriceGaps } from '../utils/tmPriceGaps';
import { createSnapshotWorkbook } from '../utils/snapshotHistory';
import {
  ColumnFilters,
  EMPTY_COLUMN_FILTER_VALUE,
  getColumnFilterOptions,
  matchesColumnFilters,
  matchesTableSearch,
  setColumnFilter
} from '../utils/tableColumnFilters';
import ColumnFilterButton from './ColumnFilterButton';
import * as XLSX from 'xlsx';

interface Props {
  readOnly?: boolean;
  snapshot?: TrackingBatch;
  products: CalculatedProduct[];
  marginBottomLine: number;
  pricingMode: PricingMode;
  channelId?: ChannelId;
  subsidyRules: SubsidyRule[];
  selfSubsidyRules: SelfOperatedSubsidyRule[];
  smallGapToleranceMargin: number;
  onMarginChange: (margin: number) => void;
  onApplySmallGapTolerance: (margin: number, pricesByPpv: Record<string, number>) => void;
  onPricingModeChange: (mode: PricingMode) => void;
  onSaveBatch: (
    remarks: string,
    operator: string,
    options?: {
      confirmCompetitiveness: boolean;
      competitivenessDate: string;
      pricingTimestamp: string;
    }
  ) => Promise<{ success: boolean; error?: string }>;
  onTriggerApiRefresh: () => void;
  lastApiSyncTime: string;
  competitionVersionName: string;
  selectedCompetitionPpvs: string[];
  onToggleCompetitionPpv: (ppv: string, selected: boolean) => void;
  onCreateCompetitionVersion: () => void;
  onManualRecommendPriceChange: (ppv: string, price?: number) => void;
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

const marginInputText = (margin: number) => String(Math.round(margin * 1000) / 10);

export default function MainTable({
  readOnly: requestedReadOnly = false,
  snapshot,
  products,
  marginBottomLine,
  pricingMode,
  channelId = 'tradeIn',
  subsidyRules,
  selfSubsidyRules,
  smallGapToleranceMargin,
  onMarginChange,
  onApplySmallGapTolerance,
  onPricingModeChange,
  onSaveBatch,
  onManualRecommendPriceChange,
}: Props) {
  const readOnly = requestedReadOnly || Boolean(snapshot);
  const isSelfOperated = channelId === 'selfOperated';
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [batchRemarks, setBatchRemarks] = useState('');
  const [operatorName, setOperatorName] = useState('定价运营');
  const [confirmCompetitiveness, setConfirmCompetitiveness] = useState(true);
  const [competitivenessDate, setCompetitivenessDate] = useState(currentLocalDate);
  const [pricingTimestamp, setPricingTimestamp] = useState(currentLocalDateTime);
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>({});
  const [tableSearch, setTableSearch] = useState('');
  const [openColumnFilter, setOpenColumnFilter] = useState<string | null>(null);
  const [editingRecommendPpv, setEditingRecommendPpv] = useState<string | null>(null);
  const [editingRecommendValue, setEditingRecommendValue] = useState('');
  const [savingBatch, setSavingBatch] = useState(false);
  const smallGapToleranceTriggerRef = useRef<HTMLButtonElement>(null);
  const smallGapTolerancePopoverRef = useRef<HTMLDivElement>(null);
  const [showSmallGapTolerancePopover, setShowSmallGapTolerancePopover] = useState(false);
  const [smallGapTolerancePopoverPosition, setSmallGapTolerancePopoverPosition] = useState({ top: 0, left: 0 });
  const [marginInput, setMarginInput] = useState(marginInputText(marginBottomLine));
  const [smallGapToleranceInput, setSmallGapToleranceInput] = useState(marginInputText(smallGapToleranceMargin));

  useEffect(() => {
    setMarginInput(marginInputText(marginBottomLine));
  }, [marginBottomLine]);

  useEffect(() => {
    setSmallGapToleranceInput(marginInputText(smallGapToleranceMargin));
  }, [smallGapToleranceMargin]);

  useEffect(() => {
    setColumnFilters({});
    setTableSearch('');
    setOpenColumnFilter(null);
  }, [channelId]);

  useEffect(() => {
    if (!showSmallGapTolerancePopover) return;

    const updatePosition = () => {
      const trigger = smallGapToleranceTriggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const popupWidth = 220;
      setSmallGapTolerancePopoverPosition({
        top: rect.bottom + 4,
        left: Math.max(8, Math.min(rect.right - popupWidth, window.innerWidth - popupWidth - 8))
      });
    };
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !smallGapToleranceTriggerRef.current?.contains(target)
        && !smallGapTolerancePopoverRef.current?.contains(target)
      ) {
        setShowSmallGapTolerancePopover(false);
        setSmallGapToleranceInput(marginInputText(smallGapToleranceMargin));
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setShowSmallGapTolerancePopover(false);
      setSmallGapToleranceInput(marginInputText(smallGapToleranceMargin));
    };

    updatePosition();
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [showSmallGapTolerancePopover, smallGapToleranceMargin]);

  const splitFieldKey = (key: string) => {
    const match = key.match(/^([A-Z]+)_(.*)$/);
    return match ? { code: match[1], label: match[2] } : { code: '', label: key };
  };

  const rawFieldKeys = Array.from(products.reduce((fields, product) => {
    Object.keys(product.rawFields || {}).forEach(key => fields.add(key));
    return fields;
  }, new Set<string>())).filter(key => {
    if (!isSelfOperated) return true;
    const { label } = splitFieldKey(key);
    return !/(新机系列|tm|天猫|jd总到手价|京东总补贴|对应新品型号ahs投入|含AHS补贴后报价)/i.test(`${key}${label}`);
  });
  const quoteWeightLabel = isSelfOperated ? 'ppv近30天报价访客数' : 'ppv近30天报价量';
  const displayedCompetitiveness = snapshot
    ? snapshot.competitivenessMetrics
    : calculateCompetitivenessMetrics(products, channelId);
  const formatScore = (value: number | null | undefined) => (
    value == null || !Number.isFinite(value) ? '—' : `${value.toFixed(1)}%`
  );

  const handleConfirmSave = async () => {
    if (readOnly) return;
    if (!operatorName.trim()) {
      alert('请填写操作人姓名。');
      return;
    }
    if (confirmCompetitiveness && (!competitivenessDate || !pricingTimestamp)) {
      alert('请填写落数日期和追价时间。');
      return;
    }
    setSavingBatch(true);
    try {
      const result = await onSaveBatch(batchRemarks, operatorName, {
        confirmCompetitiveness,
        competitivenessDate,
        pricingTimestamp: pricingTimestamp.replace('T', ' ')
      });
      if (!result.success) {
        alert(`保存失败：${result.error || '服务端未确认写入'}`);
        return;
      }
      setShowSaveModal(false);
      setBatchRemarks('');
    } catch (error) {
      alert(`保存失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSavingBatch(false);
    }
  };

  const handleMarginInputChange = (value: string) => {
    if (readOnly) return;
    setMarginInput(value);
    if (!/^-?\d*(\.\d*)?$/.test(value) || value === '' || value === '-' || value === '.') return;

    const nextValue = Number(value);
    if (!Number.isFinite(nextValue)) return;
    onMarginChange(Math.max(-50, Math.min(50, nextValue)) / 100);
  };

  const smallGapTolerancePrices = snapshot ? {} : getSmallGapTolerancePrices(products);
  const smallGapToleranceCount = Object.keys(smallGapTolerancePrices).length;
  const parsedSmallGapToleranceInput = /^-?\d+(\.\d*)?$/.test(smallGapToleranceInput)
    ? Number(smallGapToleranceInput)
    : Number.NaN;
  const previewSmallGapToleranceMargin = Number.isFinite(parsedSmallGapToleranceInput)
    ? Math.max(-50, Math.min(50, parsedSmallGapToleranceInput)) / 100
    : null;
  const previewSmallGapTolerancePrices = snapshot || previewSmallGapToleranceMargin === null
    ? {}
    : getSmallGapTolerancePrices(products, previewSmallGapToleranceMargin);
  const previewSmallGapToleranceCount = Object.keys(previewSmallGapTolerancePrices).length;

  const closeSmallGapTolerancePopover = () => {
    setShowSmallGapTolerancePopover(false);
    setSmallGapToleranceInput(marginInputText(smallGapToleranceMargin));
  };

  const toggleSmallGapTolerancePopover = () => {
    if (readOnly) return;
    if (!showSmallGapTolerancePopover) {
      setSmallGapToleranceInput(marginInputText(smallGapToleranceMargin));
    }
    setShowSmallGapTolerancePopover(previous => !previous);
  };

  const handleApplySmallGapTolerance = () => {
    if (readOnly) return;
    if (previewSmallGapToleranceMargin === null) return;
    const latestPrices = getSmallGapTolerancePrices(products, previewSmallGapToleranceMargin);
    const count = Object.keys(latestPrices).length;
    if (count === 0) return;
    const confirmed = window.confirm(
      `确认一键容忍 ${count} 条 PPV 吗？\n` +
      `容忍边际底线：${formatPercent(previewSmallGapToleranceMargin)}\n` +
      '目标价将按现有取整规则调整至不低于 tm裸机价的首个合法价格。'
    );
    if (!confirmed) return;
    onApplySmallGapTolerance(previewSmallGapToleranceMargin, latestPrices);
    setShowSmallGapTolerancePopover(false);
  };

  const exportToExcel = () => {
    if (snapshot) {
      const workbook = createSnapshotWorkbook(snapshot, filteredProducts, exportColumns);
      XLSX.writeFile(workbook, `${snapshot.channelName || '京东换新'}_历史快照_${snapshot.id}.xlsx`);
      return;
    }
    const inquirySheetName = getInquirySheetName();
    const channelName = isSelfOperated ? '自营' : '京东换新';
    const pricingSheetName = `${inquirySheetName}_${channelName}追价`;
    const profitFloorText = pricingMode === 'fullCompetition' ? '100%竞争力' : formatPercent(marginBottomLine);
    const dataToExport = [
      exportColumns.map(column => column.code),
      exportColumns.map(column => column.label),
      ...filteredProducts.map(p => exportColumns.map(column => column.getValue(p)))
    ];

    const ws = XLSX.utils.aoa_to_sheet(dataToExport);
    ws['!cols'] = exportColumns.map(column => ({ wch: Math.max(10, Math.round(column.width / 7)) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, pricingSheetName);
    addDynamicPricingWorkbookSheets({
      workbook: wb,
      pricingSheet: ws,
      pricingSheetName,
      products: filteredProducts,
      channelId,
      subsidyRules,
      selfSubsidyRules
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['渠道', channelName],
      ['当前追价模式/利润底线', profitFloorText]
    ]), '测算设置');
    XLSX.writeFile(wb, `${inquirySheetName}_${channelName}竞争追价测算_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const displayValue = (value: string | number | boolean | null) => {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'number') {
      return Number.isInteger(value) ? String(value) : String(Math.round(value * 10000) / 10000);
    }
    return String(value);
  };

  const beginRecommendEdit = (product: CalculatedProduct) => {
    if (readOnly) return;
    setEditingRecommendPpv(product.ppv);
    setEditingRecommendValue(displayValue(product.recommendJdPrice));
  };

  const commitRecommendEdit = () => {
    if (!editingRecommendPpv) return;
    const text = editingRecommendValue.trim();
    if (!text) {
      onManualRecommendPriceChange(editingRecommendPpv, undefined);
      setEditingRecommendPpv(null);
      setEditingRecommendValue('');
      return;
    }

    const parsed = Number(text.replace(/[¥,\s]/g, ''));
    if (!Number.isFinite(parsed) || parsed < 0) {
      alert('请输入有效的追价后价格。');
      return;
    }

    onManualRecommendPriceChange(editingRecommendPpv, parsed);
    setEditingRecommendPpv(null);
    setEditingRecommendValue('');
  };

  const cancelRecommendEdit = () => {
    setEditingRecommendPpv(null);
    setEditingRecommendValue('');
  };

  const getInquirySheetName = () => {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `询价表${month}${day}`;
  };

  const fixedColumnWidths = [
    112, 126, 420, 112, 96, 128, 116, 92, 148, 132, 150, 104, 92, 154, 168, 116, 104, 92, 104, 92, 100, 120, 120, 94, 94, 94, 132, 156, 180, 150, 180, 148, 148, 110, 150, 120, 120, 132, 160, 220, 160, 160, 220, 190, 120
  ];
  const fixedCodes = [
    'A', 'E', 'F', 'T', 'U', 'H', 'I', 'W', 'X', 'Y', 'Z', 'AA', 'AB', 'AB-TM补', 'AB-TM补后', 'AC', 'AF', 'AG', 'AI', 'AT', 'AW', 'AW物差', 'AW到手差', 'AO', 'AP', 'AQ', 'AR', 'AY', 'AY说明', 'AZ', 'AZ提醒', 'BA', 'BB', 'BF', 'BE', 'BE物差', 'BE到手差', 'BE说明', 'BG', 'BG-TM补', 'BH', 'BI', 'BJ', 'BJ-ZZ', 'BK'
  ];
  const fixedLabels = [
    '新机系列',
    '旧机型号',
    'ppv',
    '商品SKUID',
    '等级id',
    quoteWeightLabel,
    'ppv近30天成交量',
    'jd裸机价',
    isSelfOperated ? '自营普发券AHS补贴' : '对应新品型号ahs投入',
    isSelfOperated ? 'jd裸机价+AHS补贴' : '含AHS补贴后报价',
    '对应新品型号jd总投入',
    'jd总到手价',
    'tm裸机价',
    '对应新品型号tm回收商投入',
    '含tm回收商补贴后报价',
    'tm总补贴-人工',
    'tm总到手价',
    'zz裸机价',
    'zz券后价',
    '基准价',
    '追前边际利润率',
    '追前tm物品价差',
    '追前tm到手价差',
    '裸机比tm',
    '到手比tm',
    '裸机比zz',
    '仅含ahs补贴+裸机 vs zz到手',
    '京东物品价-追价后',
    '京东物品价-追价后理由',
    '京东物品价-追价后调整金额',
    '小差额提醒',
    isSelfOperated ? '追后AHS补贴' : 'ahs承担补贴-追价后',
    isSelfOperated ? '追后物品价+AHS补贴' : '含AHS补贴后报价-追价后',
    'jd总到手价-追价后',
    '追后边际利润率',
    '追后tm物品价差',
    '追后tm到手价差',
    '追后边际利润率说明',
    '京东物品价-追价后 vs 天猫',
    '京东物品价+ahs补贴-追价后 vs天猫',
    '京东到手价-追价后 vs 天猫',
    '京东物品价-追价后 vs 转转',
    '京东物品价+ahs补贴-追价后 vs 转转',
    '京东到手价-追价后vs转转',
    '品牌名称'
  ];
  const selfHiddenExportColumnIndexes = new Set([0, 10, 11, 12, 13, 14, 15, 16, 21, 22, 23, 24, 30, 33, 35, 36, 38, 39, 40, 43]);
  const noteDisplayHiddenColumnIndexes = new Set([28, 37]);
  const selfHiddenDisplayColumnIndexes = new Set([...selfHiddenExportColumnIndexes, ...noteDisplayHiddenColumnIndexes]);
  const isFixedColumnVisible = (index: number) => !noteDisplayHiddenColumnIndexes.has(index) && (!isSelfOperated || !selfHiddenDisplayColumnIndexes.has(index));
  const isFixedColumnExported = (index: number) => !isSelfOperated || !selfHiddenExportColumnIndexes.has(index) || index === 31;
  const exportFixedIndexes = fixedCodes.map((_, index) => index).filter(isFixedColumnExported);
  const visibleFixedIndexes = fixedCodes.map((_, index) => index).filter(isFixedColumnVisible);
  const visibleFixedColumnWidths = fixedColumnWidths.filter((_, index) => isFixedColumnVisible(index));
  const fixedColumnStyle = (index: number): React.CSSProperties | undefined => (
    isFixedColumnVisible(index) ? undefined : { display: 'none' }
  );

  const getFixedExportValues = (p: CalculatedProduct) => {
    const gaps = getTmPriceGaps(p);
    const booleanValue = (value: boolean | undefined) => (
      snapshot && value == null ? null : value ? 1 : 0
    );
    return [
    p.newSeries,
    p.oldModel,
    p.ppv,
    p.skuId,
    p.levelId || '',
    p.quoteVolume,
    snapshot ? p.soldVolume ?? null : p.soldVolume || 0,
    p.jdPrice,
    p.ahsInput,
    p.ahsQuotedPrice,
    p.jdSubsidy,
    p.jdHandPrice,
    p.tmPrice,
    p.tmRecyclerSubsidy,
    p.tmRecyclerQuotedPrice,
    p.tmSubsidyManual,
    p.tmHandPrice,
    p.zzPrice,
    p.zzHandPrice,
    p.basePrice,
    p.preMarginalProfit,
    gaps.preItemGap ?? '',
    gaps.preHandGap ?? '',
    booleanValue(p.tmItemWin),
    booleanValue(p.tmHandWin),
    booleanValue(p.zzItemWin),
    booleanValue(p.ahsZzHandWin),
    p.recommendJdPrice,
    p.pricingRemark || '',
    p.recommendAdjustment,
    p.smallGapOpportunityRemark || '',
    p.ahsSubsidyAfter,
    p.postAhsPrice,
    p.postJdHandPrice,
    p.postMarginalProfit,
    gaps.postItemGap ?? '',
    gaps.postHandGap ?? '',
    snapshot && p.maxPriceByMargin == null ? null : `${pricingMode === 'fullCompetition' ? '目标' : '上限'} ${formatRMB(p.maxPriceByMargin)}`,
    booleanValue(p.postTmItemWin),
    booleanValue(p.postAhsTmRecyclerWin),
    booleanValue(p.postTmHandWin),
    booleanValue(p.postZzItemWin),
    booleanValue(p.postAhsZzHandWin),
    booleanValue(p.postJdZzHandWin),
    p.brand || ''
    ];
  };

  const fixedColumnFilterKey = (index: number) => `fixed:${index}`;
  const getColumnFilterValue = (product: CalculatedProduct, columnKey: string) => {
    if (columnKey.startsWith('fixed:')) {
      const index = Number(columnKey.slice('fixed:'.length));
      return getFixedExportValues(product)[index];
    }
    return '';
  };
  const getTableSearchValues = (product: CalculatedProduct) => [
    ...getFixedExportValues(product),
    ...rawFieldKeys.map(key => product.rawFields?.[key])
  ];
  const filteredProducts = products.filter(product => (
    matchesColumnFilters(product, columnFilters, getColumnFilterValue)
    && matchesTableSearch(product, tableSearch, getTableSearchValues)
  ));
  const activeColumnFilterCount = Object.keys(columnFilters).length;
  const hasTableSearch = tableSearch.trim().length > 0;
  const moneyColumnIndexes = new Set([9, 11, 13, 14, 16, 18, 19, 21, 22, 27, 29, 31, 32, 33, 35, 36]);
  const percentColumnIndexes = new Set([20, 34]);
  const formatColumnFilterOption = (columnKey: string, value: string) => {
    if (value === EMPTY_COLUMN_FILTER_VALUE) return '(空白)';
    if (!columnKey.startsWith('fixed:')) return value;
    const index = Number(columnKey.slice('fixed:'.length));
    const numericValue = Number(value);
    if (percentColumnIndexes.has(index) && Number.isFinite(numericValue)) return formatPercent(numericValue);
    if (moneyColumnIndexes.has(index) && Number.isFinite(numericValue)) return formatRMB(numericValue);
    return value;
  };
  const getFilterButtonOptions = (columnKey: string) => (
    getColumnFilterOptions(products, columnKey, columnFilters, getColumnFilterValue).map(option => ({
      ...option,
      label: formatColumnFilterOption(columnKey, option.value)
    }))
  );
  const renderColumnFilterButton = (label: string, columnKey: string) => {
    const isOpen = openColumnFilter === columnKey;
    return (
      <ColumnFilterButton
        label={label}
        options={isOpen ? getFilterButtonOptions(columnKey) : []}
        activeValues={columnFilters[columnKey] || []}
        isOpen={isOpen}
        onToggle={() => setOpenColumnFilter(current => current === columnKey ? null : columnKey)}
        onClose={() => setOpenColumnFilter(current => current === columnKey ? null : current)}
        onApply={values => setColumnFilters(current => setColumnFilter(current, columnKey, values))}
      />
    );
  };

  const exportColumns = exportFixedIndexes.flatMap(index => {
    const baseColumn = {
      code: fixedCodes[index],
      label: fixedLabels[index],
      width: fixedColumnWidths[index],
      numberFormat: percentColumnIndexes.has(index) ? '0.00%' : moneyColumnIndexes.has(index) ? '#,##0.00' : undefined,
      getValue: (product: CalculatedProduct) => getFixedExportValues(product)[index]
    };

    if (snapshot) return [baseColumn];

    if (index === 27) {
      return [
        {
          code: 'AY系统',
          label: '系统推荐追后价',
          width: fixedColumnWidths[index],
          getValue: (product: CalculatedProduct) => product.recommendJdPrice
        },
        { ...baseColumn, label: '试算追后价' }
      ];
    }
    if (index === 28) return [{ ...baseColumn, label: '系统追价理由' }];
    if (index === 30) return [{ ...baseColumn, label: '系统小差额提醒' }];
    if (index === 31) return [{ ...baseColumn, label: '追后AHS补贴' }];
    if (index === 32) return [{ ...baseColumn, label: '追后含AHS补贴报价' }];
    if (index === 33) {
      return [
        {
          code: 'BF补贴',
          label: '追后京东总补贴',
          width: 132,
          getValue: (product: CalculatedProduct) => product.totalSubsidy
        },
        { ...baseColumn, label: '追后京东总到手价' }
      ];
    }
    return [baseColumn];
  });

  const tableWidth = visibleFixedColumnWidths.reduce((sum, width) => sum + width, 0);

  const headerClass = 'px-2 py-1 border-r border-[#141414] text-center leading-tight align-middle';
  const bodyClass = 'px-2 py-1 border-r border-[#141414]/20 align-middle';
  const headerLabel = (label: string) => (
    <div className="w-full truncate mx-auto" title={label}>
      {label}
    </div>
  );
  const renderGapCell = (index: number, value: number | null) => (
    <td
      key={index}
      style={fixedColumnStyle(index)}
      className={`px-2 py-1 text-right border-r border-[#141414]/20 font-mono font-bold ${
        value === null
          ? 'text-[#141414]/30'
          : value > 0
            ? 'text-green-700'
            : value < 0
              ? 'text-red-700'
              : 'text-[#141414]'
      }`}
    >
      {value === null ? '-' : formatRMB(value)}
    </td>
  );
  const renderFixedCell = (p: CalculatedProduct, index: number, savedValues?: ReturnType<typeof getFixedExportValues>) => {
    const style = fixedColumnStyle(index);
    const savedValue = savedValues?.[index];
    if (savedValues && (savedValue == null || savedValue === '' || (typeof savedValue === 'number' && !Number.isFinite(savedValue)))) {
      return <td key={index} style={style} className={`${bodyClass} text-center text-[#141414]/40`}>—</td>;
    }
    const gaps = getTmPriceGaps(p);
    switch (index) {
      case 0:
        return <td key={index} style={style} className={bodyClass}><div className="whitespace-nowrap font-bold">{p.newSeries}</div></td>;
      case 1:
        return <td key={index} style={style} className={bodyClass}><div className="whitespace-nowrap font-bold">{p.oldModel}</div></td>;
      case 2:
        return <td key={index} style={style} className={bodyClass}><div className="truncate font-bold text-[#141414]" title={p.ppv}>{p.ppv}</div></td>;
      case 3:
        return <td key={index} style={style} className="px-2 py-1 text-right border-r border-[#141414]/20 font-mono">{displayValue(p.skuId)}</td>;
      case 4:
        return <td key={index} style={style} className="px-2 py-1 text-right border-r border-[#141414]/20 font-mono">{p.levelId || ''}</td>;
      case 5:
        return <td key={index} style={style} className="px-2 py-1 text-right border-r border-[#141414]/20 font-mono">{p.quoteVolume}</td>;
      case 6:
        return <td key={index} style={style} className="px-2 py-1 text-right border-r border-[#141414]/20 font-mono">{p.soldVolume || 0}</td>;
      case 7:
        return <td key={index} style={style} className="px-2 py-1 text-right border-r border-[#141414]/20 font-mono">{displayValue(p.jdPrice)}</td>;
      case 8:
        return <td key={index} style={style} className="px-2 py-1 text-right border-r border-[#141414]/20 font-mono">{displayValue(p.ahsInput)}</td>;
      case 9:
        return <td key={index} style={style} className="px-2 py-1 text-right border-r border-[#141414]/20 font-mono">{formatRMB(p.ahsQuotedPrice)}</td>;
      case 10:
        return <td key={index} style={style} className="px-2 py-1 text-right border-r border-[#141414]/20 font-mono">{displayValue(p.jdSubsidy)}</td>;
      case 11:
        return <td key={index} style={style} className="px-2 py-1 text-right border-r border-[#141414]/20 font-mono">{formatRMB(p.jdHandPrice)}</td>;
      case 12:
        return <td key={index} style={style} className="px-2 py-1 text-right border-r border-[#141414]/20 font-mono">{displayValue(p.tmPrice)}</td>;
      case 13:
        return <td key={index} style={style} className="px-2 py-1 text-right border-r border-[#141414]/20 font-mono">{formatRMB(p.tmRecyclerSubsidy)}</td>;
      case 14:
        return <td key={index} style={style} className="px-2 py-1 text-right border-r border-[#141414]/20 font-mono">{formatRMB(p.tmRecyclerQuotedPrice)}</td>;
      case 15:
        return <td key={index} style={style} className="px-2 py-1 text-right border-r border-[#141414]/20 font-mono">{displayValue(p.tmSubsidyManual)}</td>;
      case 16:
        return <td key={index} style={style} className="px-2 py-1 text-right border-r border-[#141414]/20 font-mono">{formatRMB(p.tmHandPrice)}</td>;
      case 17:
        return <td key={index} style={style} className="px-2 py-1 text-right border-r border-[#141414]/20 font-mono">{displayValue(p.zzPrice)}</td>;
      case 18:
        return <td key={index} style={style} className="px-2 py-1 text-right border-r border-[#141414]/20 font-mono">{formatRMB(p.zzHandPrice)}</td>;
      case 19:
        return <td key={index} style={style} className="px-2 py-1 text-right border-r border-[#141414]/20 font-mono">{formatRMB(p.basePrice)}</td>;
      case 20:
        return <td key={index} style={style} className={`px-2 py-1 text-right border-r border-[#141414]/20 font-bold ${p.preMarginalProfit < marginBottomLine ? 'text-red-700' : 'text-green-700'}`}>{formatPercent(p.preMarginalProfit)}</td>;
      case 21:
        return renderGapCell(index, gaps.preItemGap);
      case 22:
        return renderGapCell(index, gaps.preHandGap);
      case 23:
        return <td key={index} style={style} className="px-2 py-1 text-center border-r border-[#141414]/20 font-mono">{p.tmItemWin ? 1 : 0}</td>;
      case 24:
        return <td key={index} style={style} className="px-2 py-1 text-center border-r border-[#141414]/20 font-mono">{p.tmHandWin ? 1 : 0}</td>;
      case 25:
        return <td key={index} style={style} className="px-2 py-1 text-center border-r border-[#141414]/20 font-mono">{p.zzItemWin ? 1 : 0}</td>;
      case 26:
        return <td key={index} style={style} className="px-2 py-1 text-center border-r border-[#141414]/20 font-mono">{p.ahsZzHandWin ? 1 : 0}</td>;
      case 27:
        return (
          <td
            key={index}
            data-tour="manual-price"
            style={style}
            className={`px-2 py-1 text-right border-r border-[#141414]/20 bg-[#D8D7D2] font-extrabold ${p.manualRecommendJdPrice !== undefined ? 'text-blue-700' : ''}`}
            onDoubleClick={readOnly ? undefined : () => beginRecommendEdit(p)}
            title={readOnly ? '只读快照' : '双击手动改价'}
          >
            {editingRecommendPpv === p.ppv ? (
              <input
                autoFocus
                type="text"
                inputMode="decimal"
                value={editingRecommendValue}
                onChange={(e) => setEditingRecommendValue(e.target.value)}
                onBlur={commitRecommendEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRecommendEdit();
                  if (e.key === 'Escape') cancelRecommendEdit();
                }}
                className="w-full border border-[#141414] bg-white px-1 py-0.5 text-right font-mono text-[11px]"
              />
            ) : (
              formatRMB(p.recommendJdPrice)
            )}
            {p.pricingRemark && <div className="truncate text-[10px] font-normal text-[#141414]/60" title={p.pricingRemark}>{p.pricingRemark}</div>}
          </td>
        );
      case 28:
        return <td key={index} style={style} className="px-2 py-1 border-r border-[#141414]/20 text-left text-[10px]">{p.pricingRemark || ''}</td>;
      case 29:
        return <td key={index} style={style} className={`px-2 py-1 text-right border-r border-[#141414]/20 bg-[#D8D7D2] font-bold ${p.recommendAdjustment > 0 ? 'text-green-700' : 'text-slate-500'}`}>{formatRMB(p.recommendAdjustment)}</td>;
      case 30:
        return (
          <td key={index} data-tour={p.smallGapOpportunityRemark ? 'small-gap-reminder' : undefined} style={style} className="px-2 py-1 border-r border-[#141414]/20 text-left text-[10px] font-bold leading-snug">
            {p.smallGapOpportunityRemark ? (
              <div className="line-clamp-3 text-amber-800" title={p.smallGapOpportunityRemark}>{p.smallGapOpportunityRemark}</div>
            ) : (
              <span className="text-[#141414]/30">-</span>
            )}
          </td>
        );
      case 31:
        return <td key={index} style={style} className="px-2 py-1 text-right border-r border-[#141414]/20 font-mono">{formatRMB(p.ahsSubsidyAfter)}</td>;
      case 32:
        return <td key={index} style={style} className="px-2 py-1 text-right border-r border-[#141414]/20 font-mono">{formatRMB(p.postAhsPrice)}</td>;
      case 33:
        return <td key={index} style={style} className="px-2 py-1 text-right border-r border-[#141414]/20 font-mono">{formatRMB(p.postJdHandPrice)}</td>;
      case 34:
        return (
          <td key={index} style={style} className={`px-2 py-1 text-right border-r border-[#141414]/20 font-extrabold ${p.postMarginalProfit < marginBottomLine ? 'text-red-700' : 'text-green-700'}`}>
            {formatPercent(p.postMarginalProfit)}
            {(!snapshot || p.maxPriceByMargin != null) && <div className="text-[10px] text-slate-500">{pricingMode === 'fullCompetition' ? '目标' : '上限'} {formatRMB(p.maxPriceByMargin)}</div>}
          </td>
        );
      case 35:
        return renderGapCell(index, gaps.postItemGap);
      case 36:
        return renderGapCell(index, gaps.postHandGap);
      case 37:
        return <td key={index} style={style} className="px-2 py-1 text-left border-r border-[#141414]/20 text-[10px]">{pricingMode === 'fullCompetition' ? '目标' : '上限'} {formatRMB(p.maxPriceByMargin)}</td>;
      case 38:
        return <td key={index} style={style} className="px-2 py-1 text-center border-r border-[#141414]/20 font-mono">{p.postTmItemWin ? 1 : 0}</td>;
      case 39:
        return <td key={index} style={style} className="px-2 py-1 text-center border-r border-[#141414]/20 font-mono">{p.postAhsTmRecyclerWin ? 1 : 0}</td>;
      case 40:
        return <td key={index} style={style} className="px-2 py-1 text-center border-r border-[#141414]/20 font-mono">{p.postTmHandWin ? 1 : 0}</td>;
      case 41:
        return <td key={index} style={style} className="px-2 py-1 text-center border-r border-[#141414]/20 font-mono">{p.postZzItemWin ? 1 : 0}</td>;
      case 42:
        return <td key={index} style={style} className="px-2 py-1 text-center border-r border-[#141414]/20 font-mono">{p.postAhsZzHandWin ? 1 : 0}</td>;
      case 43:
        return <td key={index} style={style} className="px-2 py-1 text-center border-r border-[#141414]/20 font-mono">{p.postJdZzHandWin ? 1 : 0}</td>;
      case 44:
        return <td key={index} style={style} className="px-2 py-1 border-r border-[#141414]/20 font-bold">{p.brand || '-'}</td>;
      default:
        return null;
    }
  };
  const smallGapTolerancePopover = !readOnly && showSmallGapTolerancePopover ? createPortal((
    <div
      ref={smallGapTolerancePopoverRef}
      role="dialog"
      aria-label="小差额容忍设置"
      className="fixed z-[9999] w-[220px] border border-[#141414] bg-white p-3 text-left shadow-[3px_3px_0_#141414]"
      style={{ top: smallGapTolerancePopoverPosition.top, left: smallGapTolerancePopoverPosition.left }}
    >
      <div className="mb-2 text-[11px] font-black">小差额容忍</div>
      <label className="block text-[10px] font-bold">
        <span className="mb-1 block">追后边际利润率底线</span>
        <span className="flex items-center gap-1">
          <input
            autoFocus
            type="text"
            inputMode="decimal"
            aria-label="小差额容忍边际底线"
            value={smallGapToleranceInput}
            onChange={(event) => {
              const value = event.target.value;
              if (/^-?\d*(\.\d*)?$/.test(value)) setSmallGapToleranceInput(value);
            }}
            onBlur={() => {
              if (previewSmallGapToleranceMargin !== null) {
                setSmallGapToleranceInput(marginInputText(previewSmallGapToleranceMargin));
              }
            }}
            className="h-7 w-20 border border-[#141414] bg-white px-2 text-right font-mono text-xs"
          />
          <span>%</span>
        </span>
      </label>
      <div className="mt-2 border-y border-[#141414]/20 py-2 text-[10px] font-bold">
        {previewSmallGapToleranceMargin === null
          ? '请输入 -50% 至 50%'
          : `可一键应用 ${previewSmallGapToleranceCount} 条 PPV`}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={closeSmallGapTolerancePopover}
          className="h-6 border border-[#141414] bg-white px-2 text-[10px] font-bold hover:bg-[#E4E3E0]"
        >
          取消
        </button>
        <button
          type="button"
          disabled={previewSmallGapToleranceMargin === null || previewSmallGapToleranceCount === 0}
          onClick={handleApplySmallGapTolerance}
          className="h-6 border border-[#141414] bg-[#141414] px-2 text-[10px] font-bold text-white hover:bg-white hover:text-[#141414] disabled:cursor-not-allowed disabled:opacity-40"
        >
          一键应用
        </button>
      </div>
    </div>
  ), document.body) : null;

  return (
    <div className="bg-white border border-[#141414] overflow-hidden" id={snapshot ? 'snapshot-tracking-panel' : 'main-tracking-panel'}>
      {smallGapTolerancePopover}
      <div className="p-3 border-b border-[#141414] bg-[#F0EFEC] flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-bold text-[#141414] flex items-center gap-2">
            <span className="bg-[#141414] text-[#E4E3E0] px-2 py-0.5 text-xs">{snapshot ? '只读' : getInquirySheetName()}</span>
            {snapshot ? '快照明细' : '竞争追价控制台'}
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold">
            <span className="border border-[#141414] bg-white px-2 py-1">
              {snapshot ? '保存时 · ' : ''}{isSelfOperated ? '转转物品价竞争力' : '天猫物品价竞争力'} {formatScore(isSelfOperated ? displayedCompetitiveness?.zzItemScore : displayedCompetitiveness?.tmItemScore)}
            </span>
            <span className="border border-[#141414] bg-white px-2 py-1">
              {snapshot ? '保存时 · ' : ''}{isSelfOperated ? 'AHS补贴后 vs 转转到手价' : '天猫到手价竞争力'} {formatScore(isSelfOperated ? displayedCompetitiveness?.ahsVsZzDirectScore : displayedCompetitiveness?.tmDirectScore)}
            </span>
          </div>
        </div>
        <button onClick={exportToExcel} className="px-3 py-1.5 border border-[#141414] bg-white hover:bg-black hover:text-white text-xs font-bold">
          {snapshot ? '导出快照' : '导出追价表'}
        </button>
        {!readOnly && (
          <button onClick={() => setShowSaveModal(true)} id="save-snapshot-btn-element" className="hidden">
            保存快照
          </button>
        )}
      </div>

      <div data-tour="pricing-strategy" className="grid grid-cols-1 border-b border-[#141414] bg-[#D8D7D2] lg:grid-cols-[minmax(0,1fr)_minmax(280px,420px)]">
        <div className="flex flex-wrap items-center gap-3 p-3">
          {snapshot ? (
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
              <span>保存模式：<strong>{pricingMode === 'fullCompetition' ? '100%竞争力' : '边际底线模式'}</strong></span>
              <span>边际底线：<strong>{formatPercent(marginBottomLine)}</strong></span>
              <span className="text-[#555]">价格及测算结果以保存时为准</span>
            </div>
          ) : (
          <>
          <label className="text-xs font-bold">追后边际利润率底线：</label>
          <div className="flex gap-1 bg-white p-0.5 border border-[#141414]">
            {[-0.03, 0, 0.03].map(val => (
              <button key={val} type="button" disabled={readOnly} onClick={() => onMarginChange(val)} className={`px-3 py-1 text-xs font-bold disabled:cursor-not-allowed ${pricingMode === 'margin' && marginBottomLine === val ? 'bg-[#141414] text-white' : 'hover:bg-black/10 disabled:text-[#777]'}`}>
                {formatPercent(val)}
              </button>
            ))}
            <button type="button" disabled={readOnly} onClick={() => onPricingModeChange('fullCompetition')} className={`px-3 py-1 text-xs font-bold disabled:cursor-not-allowed ${pricingMode === 'fullCompetition' ? 'bg-[#141414] text-white' : 'hover:bg-black/10 disabled:text-[#777]'}`}>
              100%竞争力
            </button>
          </div>
          <input
            type="text"
            inputMode="decimal"
            value={marginInput}
            disabled={readOnly}
            onChange={(e) => handleMarginInputChange(e.target.value)}
            onBlur={() => setMarginInput(marginInputText(marginBottomLine))}
            className="w-24 px-2 py-1 border border-[#141414] text-xs font-bold disabled:cursor-not-allowed disabled:bg-[#F0EFEC] disabled:text-[#555]"
          />
          <span className="text-xs">%</span>
          </>
          )}
        </div>
        <div className="flex items-center border-t border-[#141414]/30 p-3 lg:border-l lg:border-t-0">
          <label htmlFor={snapshot ? 'snapshot-table-search' : 'tracking-table-search'} className="sr-only">{snapshot ? '搜索快照明细' : '搜索工作台数据'}</label>
          <div className="relative w-full">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#555]"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              id={snapshot ? 'snapshot-table-search' : 'tracking-table-search'}
              type="search"
              value={tableSearch}
              onChange={(event) => setTableSearch(event.target.value)}
              placeholder="搜索型号、PPV、SKU或任意字段"
              className="h-8 w-full border border-[#141414] bg-white py-1 pl-8 pr-3 text-xs font-bold outline-none placeholder:font-normal placeholder:text-[#777] focus:ring-2 focus:ring-[#141414]/20"
            />
          </div>
        </div>
      </div>

      {(activeColumnFilterCount > 0 || hasTableSearch) && (
        <div className="flex items-center justify-between gap-3 border-b border-[#141414] bg-[#E4E3E0] px-3 py-2 text-[11px] font-bold">
          <span>
            {activeColumnFilterCount > 0 ? `已按 ${activeColumnFilterCount} 列筛选` : '未启用列筛选'}
            {hasTableSearch ? `；搜索“${tableSearch.trim()}”` : ''}
            {`，显示 ${filteredProducts.length} / ${products.length} 行`}
          </span>
          <button
            type="button"
            onClick={() => {
              setColumnFilters({});
              setTableSearch('');
              setOpenColumnFilter(null);
            }}
            className="border border-[#141414] bg-white px-2 py-1 text-[10px] font-black hover:bg-[#141414] hover:text-white"
          >
            清除筛选与搜索
          </button>
        </div>
      )}

      <div className="tracking-table-scroll">
        <table className="table-fixed text-[11px] leading-tight" style={{ width: tableWidth, minWidth: tableWidth }}>
          <colgroup>
            {fixedColumnWidths.map((width, index) => (
              <col key={`fixed-${index}`} style={isFixedColumnVisible(index) ? { width } : { display: 'none', width: 0 }} />
            ))}
          </colgroup>
          <thead className="tracking-table-head bg-[#F0EFEC] border-b border-[#141414]">
            <tr>
              {fixedCodes.map((code, index) => (
                <th
                  key={code}
                  style={fixedColumnStyle(index)}
                  className={`${headerClass} ${index === 27 || index === 28 || index === 30 ? 'repricing-header bg-[#D8D7D2]' : ''}`}
                >
                  {code}
                </th>
              ))}
            </tr>
            <tr>
              {fixedLabels.map((label, index) => (
                index === 30 ? (
                  <th
                    key={index}
                    style={fixedColumnStyle(index)}
                    className={`${headerClass} repricing-header bg-[#D8D7D2]`}
                    title="小差额提醒批量容忍"
                  >
                    <div className="flex items-center justify-center gap-1 whitespace-nowrap">
                      <span className="min-w-0 flex-1 truncate text-[10px] font-black" title={label}>{label}</span>
                      {!readOnly && (
                        <button
                          ref={smallGapToleranceTriggerRef}
                          type="button"
                          title="一键容忍符合条件的小差额 PPV"
                          aria-haspopup="dialog"
                          aria-expanded={showSmallGapTolerancePopover}
                          onClick={toggleSmallGapTolerancePopover}
                          className="h-4 border border-[#141414] bg-white px-1 text-[9px] font-black leading-none hover:bg-[#141414] hover:text-white"
                        >
                          容忍({smallGapToleranceCount})
                        </button>
                      )}
                      {renderColumnFilterButton(label, fixedColumnFilterKey(index))}
                    </div>
                  </th>
                ) : (
                  <th
                    key={index}
                    style={fixedColumnStyle(index)}
                    className={`${headerClass} ${index === 27 ? 'repricing-header bg-[#D8D7D2]' : ''}`}
                  >
                    <div className="flex min-w-0 items-center justify-center gap-1">
                      <div className="min-w-0 flex-1">{headerLabel(label)}</div>
                      {renderColumnFilterButton(label, fixedColumnFilterKey(index))}
                    </div>
                  </th>
                )
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredProducts.map((p, rowIndex) => {
              const savedValues = snapshot ? getFixedExportValues(p) : undefined;
              return (
                <tr key={`${p.id}-${rowIndex}`} className={`border-b border-[#141414]/20 ${p.riskWarning === 'CRITICAL' ? 'bg-rose-50' : p.riskWarning === 'WARNING' ? 'bg-amber-50' : 'hover:bg-[#F9F9F8]'}`}>
                  {fixedCodes.map((_, index) => renderFixedCell(p, index, savedValues))}
                </tr>
              );
            })}
            {filteredProducts.length === 0 && (
              <tr><td colSpan={fixedCodes.length} className="p-6 text-left text-xs text-[#555]">{products.length ? '没有符合筛选条件的明细。' : '暂无明细。'}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {snapshot && (
        <div className="flex flex-wrap justify-between gap-2 border-t border-[#141414] bg-[#F0EFEC] px-3 py-2 text-xs text-[#555]">
          <span>显示 {filteredProducts.length} / {products.length} 行</span>
          <span>导出当前筛选结果 · 缺失历史字段显示 —</span>
        </div>
      )}

      {!readOnly && showSaveModal && (
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
                  <button type="button" disabled={savingBatch} onClick={handleConfirmSave} className="px-3 py-1.5 bg-[#141414] text-white disabled:opacity-50">
                    {savingBatch ? '正在写入共享数据库…' : confirmCompetitiveness ? '保存并确认落数' : '确认保存'}
                  </button>
                </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const ignoreSnapshotAction = () => {};
const noSnapshotSave = async () => ({ success: false, error: '历史快照仅可查看' });
const emptySnapshotSubsidies: SubsidyRule[] = [];
const emptySelfSnapshotSubsidies: SelfOperatedSubsidyRule[] = [];
const emptySnapshotSelection: string[] = [];

export function SnapshotTable({ batch }: { batch: TrackingBatch }) {
  return (
    <MainTable
      readOnly
      snapshot={batch}
      products={batch.products}
      channelId={batch.channelId || 'tradeIn'}
      marginBottomLine={batch.marginBottomLine}
      pricingMode={batch.pricingMode || 'margin'}
      subsidyRules={emptySnapshotSubsidies}
      selfSubsidyRules={emptySelfSnapshotSubsidies}
      smallGapToleranceMargin={0}
      onMarginChange={ignoreSnapshotAction}
      onApplySmallGapTolerance={ignoreSnapshotAction}
      onPricingModeChange={ignoreSnapshotAction}
      onSaveBatch={noSnapshotSave}
      onTriggerApiRefresh={ignoreSnapshotAction}
      lastApiSyncTime=""
      competitionVersionName=""
      selectedCompetitionPpvs={emptySnapshotSelection}
      onToggleCompetitionPpv={ignoreSnapshotAction}
      onCreateCompetitionVersion={ignoreSnapshotAction}
      onManualRecommendPriceChange={ignoreSnapshotAction}
    />
  );
}
