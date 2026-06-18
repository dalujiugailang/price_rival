/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  CalculatedProduct, 
  DailyPriceRow,
  InvestmentRateInputs,
  PricingMode,
  Product, 
  SourceUploadRecord,
  SubsidyRule,
  TrackingBatch 
} from './types';
import { 
  INITIAL_PRODUCTS, 
  applyManualRecommendedPrice,
  calculateProductPrice, 
  runBatchCalculations,
  formatPercent
} from './utils/formulas';
import { calculateCompetitivenessMetrics } from './utils/competitiveness';
import { calculateCompetitionInvestmentMetrics } from './utils/investment';
import { 
  TrendingDown, 
  Layers, 
  History, 
  Server, 
  RefreshCw, 
  TrendingUp, 
  ShieldAlert,
  Download,
  Info,
  Sliders,
  DollarSign
} from 'lucide-react';
import DashboardStats from './components/DashboardStats';
import InvestmentRatePanel from './components/InvestmentRatePanel';
import MainTable from './components/MainTable';
import UploadSection from './components/UploadSection';
import HistoryPanel from './components/HistoryPanel';
import CompetitivenessSummary from './components/CompetitivenessSummary';

const normalizeFieldName = (value: string) => value.replace(/^[A-Z]+_/, '').trim().replace(/\s+/g, '').toLowerCase();

const toSourceNumber = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? '').replace(/[¥,%\s,]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

const getRawProductField = (product: Product, aliases: string[]) => {
  const entries = Object.entries(product.rawFields || {});
  const found = entries.find(([key]) => aliases.some(alias => normalizeFieldName(key) === normalizeFieldName(alias)));
  return found ? found[1] : null;
};

const hydrateThirtyDayQuoteVolume = (product: Product): Product => {
  const sourceValue = getRawProductField(product, ['ppv近30天报价量', '近30天报价量']);
  return sourceValue === null ? product : { ...product, quoteVolume: toSourceNumber(sourceValue) };
};

const hydrateThirtyDaySoldVolume = (product: Product): Product => {
  const sourceValue = getRawProductField(product, ['ppv近30天成交量', '近30天成交量']);
  return sourceValue === null ? product : { ...product, soldVolume: toSourceNumber(sourceValue) };
};

const hydrateThirtyDayVolumes = (product: Product): Product => hydrateThirtyDaySoldVolume(hydrateThirtyDayQuoteVolume(product));

const DEFAULT_INVESTMENT_RATE_INPUTS: InvestmentRateInputs = {
  androidSalesAmount30d: 0,
  androidJdTradeInSalesAmount30d: 0
};

const SMALL_GAP_THRESHOLD = 20;

const round2 = (value: number) => Math.round(value * 100) / 100;

const topTwentyPercentThreshold = (values: number[]) => {
  const sorted = values.filter(value => value > 0).sort((a, b) => b - a);
  if (sorted.length === 0) return 0;
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.2) - 1)] || 0;
};

const addSmallGapOpportunityRemarks = (products: CalculatedProduct[]) => {
  const quoteThreshold = topTwentyPercentThreshold(products.map(product => product.quoteVolume || 0));
  const soldThreshold = topTwentyPercentThreshold(products.map(product => product.soldVolume || 0));

  return products.map(product => {
    const hasTmPrice = product.tmPrice > 0;
    const hasRecommendAdjustment = round2(product.recommendAdjustment) !== 0;
    const alreadyWonBefore = hasTmPrice && product.jdPrice > product.tmPrice;
    const alreadyWonAfter = hasTmPrice && product.recommendJdPrice > product.tmPrice;
    if (!hasTmPrice || !hasRecommendAdjustment || alreadyWonBefore || alreadyWonAfter) return product;

    const gapToTm = round2(product.tmPrice - product.recommendJdPrice);
    const isSmallGap = gapToTm >= 0 && gapToTm <= SMALL_GAP_THRESHOLD;
    if (!isSmallGap) return product;

    const highQuoteVolume = quoteThreshold > 0 && product.quoteVolume >= quoteThreshold;
    const highSoldVolume = soldThreshold > 0 && (product.soldVolume || 0) >= soldThreshold;
    const valueText = highQuoteVolume || highSoldVolume ? '高价值小差额提醒' : '小差额提醒';
    const volumeText = [
      highQuoteVolume ? '报价量Top20%' : '',
      highSoldVolume ? '成交量Top20%' : ''
    ].filter(Boolean).join('、');
    const note = `${valueText}：距tm裸机价差${gapToTm}元${volumeText ? `，${volumeText}` : ''}`;

    return {
      ...product,
      smallGapOpportunity: true,
      smallGapOpportunityRemark: note
    };
  });
};

type SaveBatchOptions = {
  confirmCompetitiveness: boolean;
  competitivenessDate: string;
  pricingTimestamp: string;
};

const INITIAL_COMPETITIVENESS_HISTORY: TrackingBatch[] = [
  {
    id: 'COMP-20260331-001',
    date: '2026-03-31',
    operator: '历史导入',
    dataDate: '2026-03-31',
    marginBottomLine: 0,
    products: [],
    remarks: '历史竞争力纯落数',
    isCompetitivenessConfirmed: true,
    competitivenessDate: '2026-03-31',
    pricingTimestamp: '2026-03-31',
    competitivenessMetrics: { tmItemScore: 41.04, tmDirectScore: 47.07, zzItemScore: 31.18, ahsVsZzDirectScore: 16.88 },
    isSummaryOnly: true
  },
  {
    id: 'COMP-20260404-001',
    date: '2026-04-04',
    operator: '历史导入',
    dataDate: '2026-04-04',
    marginBottomLine: 0,
    products: [],
    remarks: '历史竞争力纯落数',
    isCompetitivenessConfirmed: true,
    competitivenessDate: '2026-04-04',
    pricingTimestamp: '2026-04-04',
    competitivenessMetrics: { tmItemScore: 35.34, tmDirectScore: 32.56, zzItemScore: 35.49, ahsVsZzDirectScore: 20.67 },
    isSummaryOnly: true
  },
  {
    id: 'COMP-20260407-001',
    date: '2026-04-07',
    operator: '历史导入',
    dataDate: '2026-04-07',
    marginBottomLine: 0,
    products: [],
    remarks: '历史竞争力纯落数',
    isCompetitivenessConfirmed: true,
    competitivenessDate: '2026-04-07',
    pricingTimestamp: '2026-04-07',
    competitivenessMetrics: { tmItemScore: 40.91, tmDirectScore: 30.83, zzItemScore: 33.41, ahsVsZzDirectScore: 17.15 },
    isSummaryOnly: true
  },
  {
    id: 'COMP-20260414-001',
    date: '2026-04-14',
    operator: '历史导入',
    dataDate: '2026-04-14',
    marginBottomLine: 0,
    products: [],
    remarks: '历史竞争力纯落数',
    isCompetitivenessConfirmed: true,
    competitivenessDate: '2026-04-14',
    pricingTimestamp: '2026-04-14',
    competitivenessMetrics: { tmItemScore: 54.07, tmDirectScore: 40.14, zzItemScore: 40.16, ahsVsZzDirectScore: 28.06 },
    isSummaryOnly: true
  },
  {
    id: 'COMP-20260518-001',
    date: '2026-05-18',
    operator: '历史导入',
    dataDate: '2026-05-18',
    marginBottomLine: 0,
    products: [],
    remarks: '历史竞争力纯落数',
    isCompetitivenessConfirmed: true,
    competitivenessDate: '2026-05-18',
    pricingTimestamp: '2026-05-18',
    competitivenessMetrics: { tmItemScore: 54.30, tmDirectScore: 30.00, zzItemScore: 50.92, ahsVsZzDirectScore: 18.04 },
    isSummaryOnly: true
  },
  {
    id: 'COMP-20260522-001',
    date: '2026-05-22',
    operator: '历史导入',
    dataDate: '2026-05-22',
    marginBottomLine: 0,
    products: [],
    remarks: '历史竞争力纯落数',
    isCompetitivenessConfirmed: true,
    competitivenessDate: '2026-05-22',
    pricingTimestamp: '2026-05-22',
    competitivenessMetrics: { tmItemScore: 47.81, tmDirectScore: 38.39, zzItemScore: 25.52, ahsVsZzDirectScore: 25.48 },
    isSummaryOnly: true
  },
  {
    id: 'COMP-20260527-001',
    date: '2026-05-27',
    operator: '历史导入',
    dataDate: '2026-05-27',
    marginBottomLine: 0,
    products: [],
    remarks: '历史竞争力纯落数',
    isCompetitivenessConfirmed: true,
    competitivenessDate: '2026-05-27',
    pricingTimestamp: '2026-05-27',
    competitivenessMetrics: { tmItemScore: 77.06, tmDirectScore: 43.39, zzItemScore: 33.43, ahsVsZzDirectScore: 16.92 },
    isSummaryOnly: true
  }
];

const mergeInitialCompetitivenessHistory = (batches: TrackingBatch[]) => {
  const confirmedDates = new Set(
    batches
      .filter(batch => batch.isCompetitivenessConfirmed)
      .map(batch => batch.competitivenessDate || batch.date)
  );
  const existingIds = new Set(batches.map(batch => batch.id));
  const missingInitialRows = INITIAL_COMPETITIVENESS_HISTORY.filter(batch => (
    !existingIds.has(batch.id) && !confirmedDates.has(batch.competitivenessDate || batch.date)
  ));
  return [...missingInitialRows, ...batches];
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'workspace' | 'upload' | 'history' | 'competitiveness'>('workspace');
  
  // App state
  const [productsMaster, setProductsMaster] = useState<Product[]>(() => {
    const saved = localStorage.getItem('products_master_rows');
    return saved ? JSON.parse(saved).map(hydrateThirtyDayVolumes) : INITIAL_PRODUCTS.map(hydrateThirtyDayVolumes);
  });
  const [dailyPriceRows, setDailyPriceRows] = useState<DailyPriceRow[]>(() => {
    const saved = localStorage.getItem('daily_price_rows');
    return saved ? JSON.parse(saved) : [];
  });
  const [subsidyRules, setSubsidyRules] = useState<SubsidyRule[]>(() => {
    const saved = localStorage.getItem('subsidy_rules');
    return saved ? JSON.parse(saved) : [];
  });
  const [sourceUploadRecords, setSourceUploadRecords] = useState<SourceUploadRecord[]>(() => {
    const saved = localStorage.getItem('source_upload_records');
    return saved ? JSON.parse(saved) : [
      {
        id: 'SRC-20260518-BASE',
        type: 'base',
        fileName: '手机安卓换新比价 (1).xlsx / 询价表0518',
        uploadedAt: '2026-05-18 00:00:00',
        rowCount: INITIAL_PRODUCTS.length,
        matchedCount: INITIAL_PRODUCTS.length,
        remarks: '内置初始化数据，保留询价表0518全部62个源字段。'
      }
    ];
  });
  const [marginBottomLine, setMarginBottomLine] = useState<number>(0.03); // 追后边际利润率底线
  const [pricingMode, setPricingMode] = useState<PricingMode>('margin');
  const [lastApiSyncTime, setLastApiSyncTime] = useState<string>('2026-05-18 询价表0518 已载入');
  const [activeCalculatedItems, setActiveCalculatedItems] = useState<CalculatedProduct[]>([]);
  const [manualRecommendPrices, setManualRecommendPrices] = useState<Record<string, number>>(() => {
    const saved = localStorage.getItem('manual_recommend_prices');
    if (!saved) return {};
    try {
      return JSON.parse(saved);
    } catch (err) {
      return {};
    }
  });
  const [investmentRateInputs, setInvestmentRateInputs] = useState<InvestmentRateInputs>(() => {
    const saved = localStorage.getItem('investment_rate_inputs');
    if (!saved) return DEFAULT_INVESTMENT_RATE_INPUTS;
    try {
      return { ...DEFAULT_INVESTMENT_RATE_INPUTS, ...JSON.parse(saved) };
    } catch (err) {
      return DEFAULT_INVESTMENT_RATE_INPUTS;
    }
  });
  const [competitionVersionIndex, setCompetitionVersionIndex] = useState<number>(1);
  const [selectedCompetitionPpvs, setSelectedCompetitionPpvs] = useState<string[]>(() => {
    const saved = localStorage.getItem('selected_competition_ppvs');
    return saved ? JSON.parse(saved) : productsMaster.map(p => p.ppv);
  });
  const [activeSubsidyFileName, setActiveSubsidyFileName] = useState<string>(() => {
    return localStorage.getItem('current_subsidies_filename') || '未上传补贴表，沿用基础表字段';
  });

  // Historical backups list (persisted in localStorage for robust record keeping "落库")
  const [historyBatches, setHistoryBatches] = useState<TrackingBatch[]>(() => {
    const saved = localStorage.getItem('history_batches_list');
    if (saved) {
      try {
        return mergeInitialCompetitivenessHistory(JSON.parse(saved));
      } catch (err) {
        // Fallback below
      }
    }
    
    // Build static default initial batch so first-time users see realistic reference values
    const baselineProducts = INITIAL_PRODUCTS.map(p => {
      const yestP: Product = {
        ...p,
        jdPrice: Math.round(p.jdPrice * 0.98),
        tmPrice: p.tmPrice > 0 ? Math.round(p.tmPrice * 1.01) : 0,
        zzPrice: p.zzPrice > 0 ? Math.round(p.zzPrice * 1.008) : 0,
      };
      return calculateProductPrice(yestP, 0.09); 
    });

    return [
      ...INITIAL_COMPETITIVENESS_HISTORY,
      {
        id: 'TRACK-20260518-INIT',
        date: '2026-05-18',
        operator: '定价运营',
        dataDate: '2026-05-18',
        marginBottomLine: 0.09,
        products: baselineProducts,
        remarks: '询价表0518线上化基准快照。保留全部源字段，采用9%追后边际利润率底线。',
        subsidyFileName: '手机安卓换新比价 (1).xlsx'
      }
    ];
  });

  // 1. Core pricing evaluation pipeline of the tracking table
  useEffect(() => {
    const dailyPriceByPpv = new Map<string, DailyPriceRow>(dailyPriceRows.map(row => [row.ppv, row]));
    const subsidyRulesBySeries = subsidyRules.reduce((acc, rule) => {
      const list = acc.get(rule.newSeries) || [];
      list.push(rule);
      acc.set(rule.newSeries, list);
      return acc;
    }, new Map<string, SubsidyRule[]>());

    const matchedProducts = productsMaster.map(prod => {
      const dailyMatch = dailyPriceByPpv.get(prod.ppv);
      let jdPrice = prod.jdPrice;
      let ahsInput = prod.ahsInput;
      let basePrice = prod.basePrice;
      let levelId = prod.levelId || '';

      if (dailyMatch) {
        if (dailyMatch.costPrice > 0) {
          jdPrice = dailyMatch.costPrice;
        }
        if (dailyMatch.biBasePrice > 0) {
          basePrice = dailyMatch.biBasePrice;
        }
        if (dailyMatch.levelId) {
          levelId = dailyMatch.levelId;
        }
      }

      const seriesRules = subsidyRulesBySeries.get(prod.newSeries);
      if (seriesRules && seriesRules.length > 0) {
        const sortedRules = [...seriesRules].sort((a, b) => a.threshold - b.threshold);
        const rule = sortedRules.filter(item => jdPrice >= item.threshold).at(-1);
        if (rule) {
          ahsInput = rule.ahsInput;
        }
      }

      return {
        ...prod,
        jdPrice,
        ahsInput,
        basePrice,
        levelId
      };
    });

    const calculated = runBatchCalculations(matchedProducts, marginBottomLine, subsidyRules, pricingMode);
    const withManualPrices = calculated.map(product => {
      const manualPrice = manualRecommendPrices[product.ppv];
      return Number.isFinite(manualPrice)
        ? applyManualRecommendedPrice(product, manualPrice, marginBottomLine, subsidyRules)
        : product;
    });
    setActiveCalculatedItems(addSmallGapOpportunityRemarks(withManualPrices));
  }, [productsMaster, dailyPriceRows, subsidyRules, marginBottomLine, pricingMode, manualRecommendPrices]);

  // 2. Sync historyBatches to localStorage on state changes for robust database preservation ("期期落库")
  useEffect(() => {
    localStorage.setItem('history_batches_list', JSON.stringify(historyBatches));
  }, [historyBatches]);

  useEffect(() => {
    localStorage.setItem('products_master_rows', JSON.stringify(productsMaster));
  }, [productsMaster]);

  useEffect(() => {
    localStorage.setItem('selected_competition_ppvs', JSON.stringify(selectedCompetitionPpvs));
  }, [selectedCompetitionPpvs]);

  useEffect(() => {
    localStorage.setItem('investment_rate_inputs', JSON.stringify(investmentRateInputs));
  }, [investmentRateInputs]);

  useEffect(() => {
    localStorage.setItem('daily_price_rows', JSON.stringify(dailyPriceRows));
  }, [dailyPriceRows]);

  useEffect(() => {
    localStorage.setItem('subsidy_rules', JSON.stringify(subsidyRules));
  }, [subsidyRules]);

  useEffect(() => {
    localStorage.setItem('manual_recommend_prices', JSON.stringify(manualRecommendPrices));
  }, [manualRecommendPrices]);

  useEffect(() => {
    localStorage.setItem('source_upload_records', JSON.stringify(sourceUploadRecords));
  }, [sourceUploadRecords]);

  const nowText = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

  const addUploadRecord = (record: Omit<SourceUploadRecord, 'id' | 'uploadedAt'>) => {
    setSourceUploadRecords(prev => [
      {
        ...record,
        id: `SRC-${Date.now()}`,
        uploadedAt: nowText()
      },
      ...prev
    ]);
  };

  const countPpvMatches = (rows: { ppv: string }[]) => {
    const ppvSet = new Set(rows.map(row => row.ppv));
    return productsMaster.filter(product => ppvSet.has(product.ppv)).length;
  };

  const countSubsidyMatches = (rows: SubsidyRule[]) => {
    const rulesBySeries = rows.reduce((acc, rule) => {
      const list = acc.get(rule.newSeries) || [];
      list.push(rule);
      acc.set(rule.newSeries, list);
      return acc;
    }, new Map<string, SubsidyRule[]>());

    return productsMaster.filter(product => {
      const rules = rulesBySeries.get(product.newSeries);
      return !!rules?.some(rule => product.jdPrice >= rule.threshold);
    }).length;
  };

  const handleBaseProductsLoaded = (products: Product[], fileName: string) => {
    setProductsMaster(products.map(hydrateThirtyDayVolumes));
    setManualRecommendPrices({});
    setSelectedCompetitionPpvs(products.map(product => product.ppv));
    setLastApiSyncTime(`${fileName} 已载入`);
    addUploadRecord({
      type: 'base',
      fileName,
      rowCount: products.length,
      matchedCount: products.length,
      remarks: `本次基础竞争表，保留 ${products[0]?.sourceFieldCount || 0} 个源字段。`
    });
  };

  const handleDailyPricesLoaded = (rows: DailyPriceRow[], fileName: string) => {
    setDailyPriceRows(rows);
    addUploadRecord({
      type: 'dailyPrice',
      fileName,
      rowCount: rows.length,
      matchedCount: countPpvMatches(rows),
      remarks: '按 ppv 匹配 daily price：最终报价写入 jd裸机价，BI基准价写入基准价，等级id写入等级id列。'
    });
  };

  const handleSubsidyRulesLoaded = (rules: SubsidyRule[], fileName: string) => {
    setSubsidyRules(rules);
    setActiveSubsidyFileName(fileName);
    localStorage.setItem('current_subsidies_filename', fileName);
    addUploadRecord({
      type: 'subsidy',
      fileName,
      rowCount: rules.length,
      matchedCount: countSubsidyMatches(rules),
      remarks: '按 新机系列 + jd裸机价门槛 匹配对应新品型号ahs投入。'
    });
  };

  // 6. User clicks Save Batch Snapshot
  const handleSaveBatch = (remarks: string, operator: string, options?: SaveBatchOptions) => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const timeCode = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
    const newBatchId = `TRACK-${todayStr.replace(/-/g, '')}-${timeCode}`;
    const confirmCompetitiveness = !!options?.confirmCompetitiveness;
    const competitivenessDate = options?.competitivenessDate || todayStr;
    const pricingTimestamp = options?.pricingTimestamp || new Date().toISOString().replace('T', ' ').slice(0, 19);
    const competitivenessMetrics = calculateCompetitivenessMetrics(activeCalculatedItems);
    const investmentRateMetrics = calculateCompetitionInvestmentMetrics(activeCalculatedItems, investmentRateInputs);

    const newBatch: TrackingBatch = {
      id: newBatchId,
      date: todayStr,
      operator: operator,
      dataDate: todayStr,
      marginBottomLine: marginBottomLine,
      pricingMode,
      // Create a deep copy snapshot of current calculated state
      products: JSON.parse(JSON.stringify(activeCalculatedItems)),
      remarks: `${remarks || ''}${remarks ? '；' : ''}${pricingMode === 'fullCompetition' ? '100%竞争力模式' : `边际底线${formatPercent(marginBottomLine)}`}；测算行 ${activeCalculatedItems.length} 条`,
      subsidyFileName: activeSubsidyFileName,
      subsidyUploadTime: new Date().toISOString().replace('T', ' ').slice(0, 19),
      isCompetitivenessConfirmed: confirmCompetitiveness,
      competitivenessDate: confirmCompetitiveness ? competitivenessDate : undefined,
      pricingTimestamp: confirmCompetitiveness ? pricingTimestamp : undefined,
      confirmedAt: confirmCompetitiveness ? new Date().toISOString().replace('T', ' ').slice(0, 19) : undefined,
      competitivenessMetrics: confirmCompetitiveness ? competitivenessMetrics : undefined,
      investmentRateInputs,
      investmentRateMetrics
    };

    setHistoryBatches(prev => [
      newBatch,
      ...prev.map(batch => (
        confirmCompetitiveness && batch.isCompetitivenessConfirmed && batch.competitivenessDate === competitivenessDate
          ? { ...batch, isCompetitivenessConfirmed: false }
          : batch
      ))
    ]);
  };

  const handleCompetitivenessHistoryLoaded = (batches: TrackingBatch[], fileName: string) => {
    const confirmedDates = new Set(batches.map(batch => batch.competitivenessDate || batch.date));
    setHistoryBatches(prev => [
      ...batches,
      ...prev.map(batch => (
        batch.isCompetitivenessConfirmed && confirmedDates.has(batch.competitivenessDate || batch.date)
          ? { ...batch, isCompetitivenessConfirmed: false }
          : batch
      ))
    ]);
    addUploadRecord({
      type: 'competitivenessHistory',
      fileName,
      rowCount: batches.length,
      matchedCount: batches.length,
      remarks: '导入历史竞争力汇总，并作为正式落数进入竞争力趋势。'
    });
  };

  // 7. Re-runs the deterministic matching pipeline after source uploads.
  const handleTriggerApiRefresh = () => {
    setLastApiSyncTime(`${nowText()} 已按当前上传数据重新匹配`);
  };

  // 8. Delete snapshot helper
  const handleDeleteBatch = (id: string) => {
    setHistoryBatches(prev => prev.filter(b => b.id !== id));
  };

  const handleToggleCompetitionPpv = (ppv: string, selected: boolean) => {
    setSelectedCompetitionPpvs(prev => {
      if (selected) {
        return prev.includes(ppv) ? prev : [...prev, ppv];
      }
      return prev.filter(item => item !== ppv);
    });
  };

  const handleMarginChange = (margin: number) => {
    setMarginBottomLine(margin);
    setPricingMode('margin');
  };

  const handleCreateCompetitionVersion = () => {
    setCompetitionVersionIndex(prev => prev + 1);
    setActiveTab('workspace');
  };

  const handleManualRecommendPriceChange = (ppv: string, price?: number) => {
    setManualRecommendPrices(prev => {
      const next = { ...prev };
      if (price === undefined) {
        delete next[ppv];
      } else {
        next[ppv] = price;
      }
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans overflow-x-hidden selection:bg-[#141414] selection:text-[#E4E3E0]">
      {/* 顶部标题栏 */}
      <header className="flex flex-col md:flex-row items-start md:items-center justify-between px-6 py-4 border-b border-[#141414] bg-[#E4E3E0] gap-4">
        <div className="flex flex-col">
          <h1 className="text-xl font-bold tracking-tight uppercase flex items-center flex-wrap gap-2">
            线上竞争追价系统
          </h1>
          <div className="flex flex-wrap gap-4 mt-1">
            <div className="flex items-center gap-2 text-xs text-[#141414]/70">
              <span>数据版本：{lastApiSyncTime}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button 
            onClick={() => setActiveTab('upload')}
            className={`px-4 py-2 border border-[#141414] text-xs font-bold transition-colors ${activeTab === 'upload' ? 'bg-[#141414] text-[#E4E3E0]' : 'bg-[#E4E3E0] text-[#141414] hover:bg-[#141414] hover:text-[#E4E3E0]'}`}
          >
            上传数据源
          </button>
          <button 
            onClick={() => {
              setActiveTab('workspace');
              setTimeout(() => {
                const el = document.getElementById('save-snapshot-btn-element');
                if (el) {
                  el.scrollIntoView({ behavior: 'smooth' });
                  el.click();
                } else {
                  alert('请在测算工作台点击“保存当前测算快照”');
                }
              }, 150);
            }}
            className="px-4 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold hover:bg-[#2A2A2B] transition-all"
          >
            保存测算快照
          </button>
        </div>
      </header>

      {/* 视图切换与全局参数配置区 */}
      <section className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4 px-6 py-3 border-b border-[#141414] bg-[#D8D7D2] items-center">
        {/* 导航标签 */}
        <div className="flex flex-wrap gap-4 items-center overflow-hidden">
          <span className="text-xs font-bold opacity-70">视图：</span>
          <div className="flex flex-wrap border border-[#141414] bg-white text-[12px]">
            <button 
              onClick={() => setActiveTab('workspace')}
              className={`px-4 py-1.5 border-r border-[#141414] hover:bg-black hover:text-white cursor-pointer font-bold transition-all ${activeTab === 'workspace' ? 'bg-[#141414] text-white' : 'text-[#141414]'}`}
            >
              竞争追价工作台
            </button>
            <button 
              onClick={() => setActiveTab('upload')}
              className={`px-4 py-1.5 border-r border-[#141414] hover:bg-black hover:text-white cursor-pointer font-bold transition-all ${activeTab === 'upload' ? 'bg-[#141414] text-white' : 'text-[#141414]'}`}
            >
              数据上传与匹配 ({sourceUploadRecords.length})
            </button>
            <button 
              onClick={() => setActiveTab('history')}
              className={`px-4 py-1.5 border-r border-[#141414] hover:bg-black hover:text-white cursor-pointer font-bold transition-all ${activeTab === 'history' ? 'bg-[#141414] text-white' : 'text-[#141414]'}`}
            >
              历史对比 ({historyBatches.length})
            </button>
            <button 
              onClick={() => setActiveTab('competitiveness')}
              className={`px-4 py-1.5 hover:bg-black hover:text-white cursor-pointer font-bold transition-all ${activeTab === 'competitiveness' ? 'bg-[#141414] text-white' : 'text-[#141414]'}`}
            >
              📊 竞争力走势与总结
            </button>
          </div>
        </div>

        {/* 全局追价策略 */}
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold opacity-70">追价策略：</span>
          <div className="flex gap-1 bg-white p-0.5 border border-[#141414]">
            {[-0.03, 0, 0.03].map(val => (
              <button 
                key={val}
                onClick={() => handleMarginChange(val)}
                className={`px-2.5 py-0.5 text-xs font-bold transition-all ${pricingMode === 'margin' && marginBottomLine === val ? 'bg-[#141414] text-white' : 'text-[#141414] hover:bg-black/10'}`}
              >
                {formatPercent(val)}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPricingMode('fullCompetition')}
              className={`px-2.5 py-0.5 text-xs font-bold transition-all ${pricingMode === 'fullCompetition' ? 'bg-[#141414] text-white' : 'text-[#141414] hover:bg-black/10'}`}
            >
              100%竞争力
            </button>
          </div>
        </div>
      </section>

      {/* Main Content Area */}
      <main className="px-6 py-6 space-y-6 max-w-[1440px] mx-auto">
        {/* Dynamic Visual Stats Area */}
        <DashboardStats 
          products={activeCalculatedItems} 
          marginBottomLine={marginBottomLine}
          pricingMode={pricingMode}
        />

        {/* Workspace Display with exact Industrial Border themes */}
        <div className="border border-[#141414] bg-white p-1">
          {activeTab === 'workspace' && (
            <>
              <InvestmentRatePanel
                products={activeCalculatedItems}
                investmentRateInputs={investmentRateInputs}
                onInvestmentRateInputsChange={setInvestmentRateInputs}
              />
              <MainTable
                products={activeCalculatedItems}
                marginBottomLine={marginBottomLine}
                pricingMode={pricingMode}
                onMarginChange={handleMarginChange}
                onPricingModeChange={setPricingMode}
                onSaveBatch={handleSaveBatch}
                onTriggerApiRefresh={handleTriggerApiRefresh}
                lastApiSyncTime={lastApiSyncTime}
                competitionVersionName={`竞争版本 V${competitionVersionIndex}`}
                selectedCompetitionPpvs={selectedCompetitionPpvs}
                onToggleCompetitionPpv={handleToggleCompetitionPpv}
                onCreateCompetitionVersion={handleCreateCompetitionVersion}
                onManualRecommendPriceChange={handleManualRecommendPriceChange}
              />
            </>
          )}

          {activeTab === 'upload' && (
            <UploadSection
              currentProducts={productsMaster}
              dailyPrices={dailyPriceRows}
              subsidyRules={subsidyRules}
              uploadRecords={sourceUploadRecords}
              onBaseProductsLoaded={handleBaseProductsLoaded}
              onDailyPricesLoaded={handleDailyPricesLoaded}
              onSubsidyRulesLoaded={handleSubsidyRulesLoaded}
              onCompetitivenessHistoryLoaded={handleCompetitivenessHistoryLoaded}
            />
          )}

          {activeTab === 'history' && (
            <HistoryPanel
              historyBatches={historyBatches}
              onDeleteBatch={handleDeleteBatch}
            />
          )}

          {activeTab === 'competitiveness' && (
            <CompetitivenessSummary
              historyBatches={historyBatches}
              currentCalculatedItems={activeCalculatedItems}
              activeSubsidyFileName={activeSubsidyFileName}
            />
          )}

        </div>
      </main>

      {/* 极简页脚 */}
      <footer className="mt-12 border-t border-[#141414] bg-[#D8D7D2] py-6 text-center text-[#141414] px-6 text-xs">
        <p className="opacity-80">
          线上竞争追价系统 © 2026
        </p>
      </footer>
    </div>
  );
}
