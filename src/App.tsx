/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  CalculatedProduct, 
  DailyPriceRow,
  InvestmentRateInputs,
  PricingMode,
  Product, 
  ChannelId,
  SelfOperatedSubsidyRule,
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
import TmHandPriceGapPanel from './components/TmHandPriceGapPanel';
import OnboardingTour, { TourStep } from './components/OnboardingTour';
import { CHANNELS, DEFAULT_CHANNEL_ID } from './config/channels';

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

const hydrateThirtyDayQuoteVolume = (product: Product, channelId: ChannelId = 'tradeIn'): Product => {
  const aliases = channelId === 'selfOperated'
    ? ['ppv近30天报价访客数', '近30天报价访客数', 'ppv近30天报价量', '近30天报价量']
    : ['ppv近30天报价量', '近30天报价量'];
  const sourceValue = getRawProductField(product, aliases);
  return sourceValue === null ? product : { ...product, quoteVolume: toSourceNumber(sourceValue) };
};

const hydrateThirtyDaySoldVolume = (product: Product): Product => {
  const sourceValue = getRawProductField(product, ['ppv近30天成交量', '近30天成交量']);
  return sourceValue === null ? product : { ...product, soldVolume: toSourceNumber(sourceValue) };
};

const hydrateThirtyDayVolumes = (product: Product, channelId: ChannelId = 'tradeIn'): Product => hydrateThirtyDaySoldVolume(hydrateThirtyDayQuoteVolume(product, channelId));

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

type ViewTab = 'workspace' | 'upload' | 'history' | 'competitiveness' | 'tmHandGap';

type ChannelWorkspaceState = {
  productsMaster: Product[];
  dailyPriceRows: DailyPriceRow[];
  subsidyRules: SubsidyRule[];
  selfSubsidyRules: SelfOperatedSubsidyRule[];
  sourceUploadRecords: SourceUploadRecord[];
  manualRecommendPrices: Record<string, number>;
  investmentRateInputs: InvestmentRateInputs;
  selectedCompetitionPpvs: string[];
  historyBatches: TrackingBatch[];
  activeSubsidyFileName: string;
  marginBottomLine: number;
  pricingMode: PricingMode;
  lastApiSyncTime: string;
  competitionVersionIndex: number;
};

type ChannelStates = Record<ChannelId, ChannelWorkspaceState>;

const CHANNEL_STATE_STORAGE_KEY = 'pricing_channel_states_v1';

const safeParse = <T,>(value: string | null, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch (err) {
    return fallback;
  }
};

const defaultUploadRecords = (): SourceUploadRecord[] => [
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

const buildInitialHistoryBatches = () => {
  const baselineProducts = INITIAL_PRODUCTS.map(p => {
    const yestP: Product = {
      ...p,
      jdPrice: Math.round(p.jdPrice * 0.98),
      tmPrice: p.tmPrice > 0 ? Math.round(p.tmPrice * 1.01) : 0,
      zzPrice: p.zzPrice > 0 ? Math.round(p.zzPrice * 1.008) : 0
    };
    return calculateProductPrice(yestP, 0.09);
  });

  return [
    ...INITIAL_COMPETITIVENESS_HISTORY,
    {
      id: 'TRACK-20260518-INIT',
      channelId: 'tradeIn' as ChannelId,
      channelName: CHANNELS.tradeIn.name,
      date: '2026-05-18',
      operator: '定价运营',
      dataDate: '2026-05-18',
      marginBottomLine: 0.09,
      products: baselineProducts,
      remarks: '询价表0518线上化基准快照。保留全部源字段，采用9%追后边际利润率底线。',
      subsidyFileName: '手机安卓换新比价 (1).xlsx'
    }
  ];
};

const normalizeState = (state: Partial<ChannelWorkspaceState>, fallbackProducts: Product[], channelId: ChannelId): ChannelWorkspaceState => ({
  productsMaster: (state.productsMaster || fallbackProducts).map(product => hydrateThirtyDayVolumes(product, channelId)),
  dailyPriceRows: state.dailyPriceRows || [],
  subsidyRules: state.subsidyRules || [],
  selfSubsidyRules: state.selfSubsidyRules || [],
  sourceUploadRecords: state.sourceUploadRecords || [],
  manualRecommendPrices: state.manualRecommendPrices || {},
  investmentRateInputs: { ...DEFAULT_INVESTMENT_RATE_INPUTS, ...(state.investmentRateInputs || {}) },
  selectedCompetitionPpvs: state.selectedCompetitionPpvs || (state.productsMaster || fallbackProducts).map(product => product.ppv),
  historyBatches: state.historyBatches || [],
  activeSubsidyFileName: state.activeSubsidyFileName || '未上传补贴表，沿用基础表字段',
  marginBottomLine: typeof state.marginBottomLine === 'number' ? state.marginBottomLine : 0.03,
  pricingMode: state.pricingMode || 'margin',
  lastApiSyncTime: state.lastApiSyncTime || '2026-05-18 询价表0518 已载入',
  competitionVersionIndex: state.competitionVersionIndex || 1
});

const createInitialChannelStates = (): ChannelStates => {
  const saved = safeParse<Partial<ChannelStates>>(localStorage.getItem(CHANNEL_STATE_STORAGE_KEY), {});
  if (saved.tradeIn || saved.selfOperated) {
    return {
      tradeIn: normalizeState(saved.tradeIn || {}, INITIAL_PRODUCTS, 'tradeIn'),
      selfOperated: normalizeState(saved.selfOperated || {}, INITIAL_PRODUCTS, 'selfOperated')
    };
  }

  const legacyProducts = safeParse<Product[] | null>(localStorage.getItem('products_master_rows'), null);
  const tradeInProducts = (legacyProducts || INITIAL_PRODUCTS).map(product => hydrateThirtyDayVolumes(product, 'tradeIn'));
  const legacyHistory = safeParse<TrackingBatch[] | null>(localStorage.getItem('history_batches_list'), null);
  const historyBatches = legacyHistory
    ? mergeInitialCompetitivenessHistory(legacyHistory).map(batch => ({
      ...batch,
      channelId: batch.channelId || 'tradeIn',
      channelName: batch.channelName || CHANNELS.tradeIn.name
    }))
    : buildInitialHistoryBatches();

  return {
    tradeIn: normalizeState({
      productsMaster: tradeInProducts,
      dailyPriceRows: safeParse<DailyPriceRow[]>(localStorage.getItem('daily_price_rows'), []),
      subsidyRules: safeParse<SubsidyRule[]>(localStorage.getItem('subsidy_rules'), []),
      sourceUploadRecords: safeParse<SourceUploadRecord[]>(localStorage.getItem('source_upload_records'), defaultUploadRecords()),
      manualRecommendPrices: safeParse<Record<string, number>>(localStorage.getItem('manual_recommend_prices'), {}),
      investmentRateInputs: safeParse<InvestmentRateInputs>(localStorage.getItem('investment_rate_inputs'), DEFAULT_INVESTMENT_RATE_INPUTS),
      selectedCompetitionPpvs: safeParse<string[]>(localStorage.getItem('selected_competition_ppvs'), tradeInProducts.map(product => product.ppv)),
      historyBatches,
      activeSubsidyFileName: localStorage.getItem('current_subsidies_filename') || '未上传补贴表，沿用基础表字段'
    }, INITIAL_PRODUCTS, 'tradeIn'),
    selfOperated: normalizeState({
      productsMaster: tradeInProducts,
      sourceUploadRecords: defaultUploadRecords().map(record => ({
        ...record,
        id: 'SRC-SELF-20260518-BASE',
        remarks: '自营渠道初始化沿用基础竞争表，补贴按自营普发券单独维护。'
      })),
      historyBatches: [],
      activeSubsidyFileName: '未粘贴自营普发券'
    }, INITIAL_PRODUCTS, 'selfOperated')
  };
};

export default function App() {
  const [activeChannelId, setActiveChannelId] = useState<ChannelId>(DEFAULT_CHANNEL_ID);
  const [activeTab, setActiveTab] = useState<ViewTab>('workspace');
  const [channelStates, setChannelStates] = useState<ChannelStates>(createInitialChannelStates);
  const [activeCalculatedItems, setActiveCalculatedItems] = useState<CalculatedProduct[]>([]);
  const [tourOpen, setTourOpen] = useState(false);
  const [tourStepIndex, setTourStepIndex] = useState(0);
  const activeChannel = CHANNELS[activeChannelId];
  const activeState = channelStates[activeChannelId];
  const isSelfOperated = activeChannelId === 'selfOperated';
  const tourSteps = useMemo<TourStep[]>(() => [
    {
      target: `channel-${activeChannelId}`,
      title: '第一步：选择业务渠道',
      body: `先确认当前渠道是“${activeChannel.name}”。京东换新对标 TM，自营对标 ZZ，后续上传字段、补贴和竞争力口径都会跟着切换。`
    },
    {
      target: 'tab-upload',
      title: '第二步：进入数据源',
      body: '点这里进入数据源页。新手先从这里开始，不要直接在工作台改价格。',
      tab: 'upload'
    },
    {
      target: 'base-upload',
      title: '第三步：上传本次竞争追价表',
      body: isSelfOperated
        ? '点这里上传自营竞争表，需要包含旧机型号、ppv、zz裸机价等字段。'
        : '点这里上传京东换新竞争表，需要包含新机系列、旧机型号、ppv、tm裸机价、tm总补贴-人工、zz裸机价等字段。',
      tab: 'upload'
    },
    {
      target: 'daily-api',
      title: '第四步：匹配 daily price',
      body: '点这个按钮自动按 ppv 匹配 JD 最终报价、BI 基准价和等级 id。匹配完再进入测算。',
      tab: 'upload'
    },
    {
      target: isSelfOperated ? 'self-subsidy' : 'subsidy-upload',
      title: isSelfOperated ? '第五步：粘贴自营普发券' : '第五步：上传补贴表',
      body: isSelfOperated
        ? '在这里粘贴门槛和优惠金额，然后点击“应用自营普发券规则”。补贴会按追后价格动态命中。'
        : '点这里上传补贴表，系统会按新机系列和 JD 物品价门槛命中 AHS 投入、京东补贴。',
      tab: 'upload'
    },
    {
      target: 'top-strategy',
      title: '第六步：调整追价策略',
      body: '教程会自动回到工作台。这里就是切换边际底线或 100%竞争力的按钮组，切换后追后价格、利润、投入费率和高出清单会实时变化。',
      tab: 'workspace'
    },
    {
      target: 'small-gap-reminder',
      title: '第七步：小额价差提醒与手动改价',
      body: '先看 AZ提醒列的小额价差机会。遇到距竞品只差一点的高价值机型，可以双击“京东物品价-追价后”这一格手动改价，再按新的价格重算利润和竞争力。',
      tab: 'workspace'
    },
    {
      target: 'investment-rate',
      title: '第八步：计算投入费率',
      body: '填入近 30 天销售额后点击“计算费率”。注意输入框变化不会立即刷新，必须点计算按钮。',
      tab: 'workspace'
    },
    {
      target: 'save-snapshot',
      title: '第九步：保存和输出',
      body: '确认结果后点这里保存测算快照。需要汇报时，可再导出追价表、查看竞争力走势或生成追后高出清单。',
      tab: 'workspace'
    },
    {
      target: 'competitiveness-trend-chart',
      title: '第十步：查看竞争力走势',
      body: '教程会进入竞争力走势页。重点看“历史追平周期竞争力波动走势”折线图，用正式落数和当前工作台草稿做追价复盘和汇报。',
      tab: 'competitiveness'
    }
  ], [activeChannel.name, activeChannelId, isSelfOperated]);

  const updateActiveState = (updater: (state: ChannelWorkspaceState) => ChannelWorkspaceState) => {
    setChannelStates(prev => ({
      ...prev,
      [activeChannelId]: updater(prev[activeChannelId])
    }));
  };

  useEffect(() => {
    const dailyPriceByPpv = new Map<string, DailyPriceRow>(activeState.dailyPriceRows.map(row => [row.ppv, row]));
    const subsidyRulesBySeries = activeState.subsidyRules.reduce((acc, rule) => {
      const list = acc.get(rule.newSeries) || [];
      list.push(rule);
      acc.set(rule.newSeries, list);
      return acc;
    }, new Map<string, SubsidyRule[]>());

    const matchedProducts = activeState.productsMaster.map(prod => {
      const dailyMatch = dailyPriceByPpv.get(prod.ppv);
      let jdPrice = prod.jdPrice;
      let ahsInput = prod.ahsInput;
      let jdSubsidy = prod.jdSubsidy;
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

      const seriesRules = activeChannel.subsidyMode === 'seriesThreshold' ? subsidyRulesBySeries.get(prod.newSeries) : undefined;
      if (seriesRules && seriesRules.length > 0) {
        const sortedRules = [...seriesRules].sort((a, b) => a.threshold - b.threshold);
        const rule = sortedRules.filter(item => jdPrice >= item.threshold).at(-1);
        if (rule) {
          ahsInput = rule.ahsInput;
          jdSubsidy = rule.jdSubsidy;
        }
      } else if (activeChannel.subsidyMode === 'generalThreshold') {
        ahsInput = 0;
        jdSubsidy = 0;
      }

      return {
        ...prod,
        jdPrice,
        ahsInput,
        jdSubsidy,
        basePrice,
        levelId
      };
    });

    const calculated = runBatchCalculations(matchedProducts, activeState.marginBottomLine, activeState.subsidyRules, activeState.pricingMode, {
      channel: activeChannel,
      selfSubsidyRules: activeState.selfSubsidyRules
    });
    const withManualPrices = calculated.map(product => {
      const manualPrice = activeState.manualRecommendPrices[product.ppv];
      return Number.isFinite(manualPrice)
        ? applyManualRecommendedPrice(product, manualPrice, activeState.marginBottomLine, activeState.subsidyRules, {
          channel: activeChannel,
          selfSubsidyRules: activeState.selfSubsidyRules
        })
        : product;
    });
    setActiveCalculatedItems(activeChannelId === 'tradeIn' ? addSmallGapOpportunityRemarks(withManualPrices) : withManualPrices);
  }, [activeChannel, activeChannelId, activeState]);

  useEffect(() => {
    localStorage.setItem(CHANNEL_STATE_STORAGE_KEY, JSON.stringify(channelStates));
  }, [channelStates]);

  useEffect(() => {
    if (!tourOpen) return;
    const nextTab = tourSteps[tourStepIndex]?.tab as ViewTab | undefined;
    if (nextTab && nextTab !== activeTab) {
      setActiveTab(nextTab);
    }
  }, [activeTab, tourOpen, tourStepIndex, tourSteps]);

  const nowText = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

  const addUploadRecord = (record: Omit<SourceUploadRecord, 'id' | 'uploadedAt'>) => {
    updateActiveState(state => ({
      ...state,
      sourceUploadRecords: [
        {
          ...record,
          id: `SRC-${Date.now()}`,
          uploadedAt: nowText()
        },
        ...state.sourceUploadRecords
      ]
    }));
  };

  const countPpvMatches = (rows: { ppv: string }[]) => {
    const ppvSet = new Set(rows.map(row => row.ppv));
    return activeState.productsMaster.filter(product => ppvSet.has(product.ppv)).length;
  };

  const countSubsidyMatches = (rows: SubsidyRule[]) => {
    const rulesBySeries = rows.reduce((acc, rule) => {
      const list = acc.get(rule.newSeries) || [];
      list.push(rule);
      acc.set(rule.newSeries, list);
      return acc;
    }, new Map<string, SubsidyRule[]>());

    return activeState.productsMaster.filter(product => {
      const rules = rulesBySeries.get(product.newSeries);
      return !!rules?.some(rule => product.jdPrice >= rule.threshold);
    }).length;
  };

  const handleBaseProductsLoaded = (products: Product[], fileName: string) => {
    const nextProducts = products.map(product => hydrateThirtyDayVolumes(product, activeChannelId));
    updateActiveState(state => ({
      ...state,
      productsMaster: nextProducts,
      manualRecommendPrices: {},
      selectedCompetitionPpvs: nextProducts.map(product => product.ppv),
      lastApiSyncTime: `${fileName} 已载入`,
      sourceUploadRecords: [
        {
          id: `SRC-${Date.now()}`,
          type: 'base',
          fileName,
          uploadedAt: nowText(),
          rowCount: nextProducts.length,
          matchedCount: nextProducts.length,
          remarks: `本次基础竞争表，保留 ${nextProducts[0]?.sourceFieldCount || 0} 个源字段。`
        },
        ...state.sourceUploadRecords
      ]
    }));
  };

  const handleDailyPricesLoaded = (rows: DailyPriceRow[], fileName: string) => {
    const matchedCount = countPpvMatches(rows);
    updateActiveState(state => ({
      ...state,
      dailyPriceRows: rows,
      sourceUploadRecords: [
        {
          id: `SRC-${Date.now()}`,
          type: 'dailyPrice',
          fileName,
          uploadedAt: nowText(),
          rowCount: rows.length,
          matchedCount,
          remarks: '按 ppv 匹配 daily price：最终报价写入 jd裸机价，BI基准价写入基准价，等级id写入等级id列。'
        },
        ...state.sourceUploadRecords
      ]
    }));
  };

  const handleSubsidyRulesLoaded = (rules: SubsidyRule[], fileName: string) => {
    const matchedCount = countSubsidyMatches(rules);
    updateActiveState(state => ({
      ...state,
      subsidyRules: rules,
      activeSubsidyFileName: fileName,
      sourceUploadRecords: [
        {
          id: `SRC-${Date.now()}`,
          type: 'subsidy',
          fileName,
          uploadedAt: nowText(),
          rowCount: rules.length,
          matchedCount,
          remarks: '按 新机系列 + jd裸机价门槛 匹配对应新品型号ahs投入。'
        },
        ...state.sourceUploadRecords
      ]
    }));
  };

  const handleSelfSubsidyRulesLoaded = (rules: SelfOperatedSubsidyRule[], sourceName: string) => {
    updateActiveState(state => ({
      ...state,
      selfSubsidyRules: rules,
      activeSubsidyFileName: sourceName,
      sourceUploadRecords: [
        {
          id: `SRC-${Date.now()}`,
          type: 'selfSubsidy',
          fileName: sourceName,
          uploadedAt: nowText(),
          rowCount: rules.length,
          matchedCount: activeState.productsMaster.filter(product => rules.some(rule => product.jdPrice >= rule.threshold)).length,
          remarks: '自营普发券：不分新机系列，按京东物品价门槛匹配，补贴全部计入AHS承担。'
        },
        ...state.sourceUploadRecords
      ]
    }));
  };

  const handleSaveBatch = (remarks: string, operator: string, options?: SaveBatchOptions) => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const timeCode = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
    const newBatchId = `TRACK-${todayStr.replace(/-/g, '')}-${timeCode}`;
    const confirmCompetitiveness = !!options?.confirmCompetitiveness;
    const competitivenessDate = options?.competitivenessDate || todayStr;
    const pricingTimestamp = options?.pricingTimestamp || new Date().toISOString().replace('T', ' ').slice(0, 19);
    const competitivenessMetrics = calculateCompetitivenessMetrics(activeCalculatedItems, activeChannelId);
    const investmentRateMetrics = calculateCompetitionInvestmentMetrics(activeCalculatedItems, activeState.investmentRateInputs);

    const newBatch: TrackingBatch = {
      id: newBatchId,
      channelId: activeChannelId,
      channelName: activeChannel.name,
      date: todayStr,
      operator,
      dataDate: todayStr,
      marginBottomLine: activeState.marginBottomLine,
      pricingMode: activeState.pricingMode,
      products: JSON.parse(JSON.stringify(activeCalculatedItems)),
      remarks: `${remarks || ''}${remarks ? '；' : ''}${activeState.pricingMode === 'fullCompetition' ? '100%竞争力模式' : `边际底线${formatPercent(activeState.marginBottomLine)}`}；${activeChannel.name}；测算行 ${activeCalculatedItems.length} 条`,
      subsidyFileName: activeState.activeSubsidyFileName,
      subsidyUploadTime: new Date().toISOString().replace('T', ' ').slice(0, 19),
      isCompetitivenessConfirmed: confirmCompetitiveness,
      competitivenessDate: confirmCompetitiveness ? competitivenessDate : undefined,
      pricingTimestamp: confirmCompetitiveness ? pricingTimestamp : undefined,
      confirmedAt: confirmCompetitiveness ? new Date().toISOString().replace('T', ' ').slice(0, 19) : undefined,
      competitivenessMetrics: confirmCompetitiveness ? competitivenessMetrics : undefined,
      investmentRateInputs: activeState.investmentRateInputs,
      investmentRateMetrics
    };

    updateActiveState(state => ({
      ...state,
      historyBatches: [
        newBatch,
        ...state.historyBatches.map(batch => (
          confirmCompetitiveness && batch.isCompetitivenessConfirmed && (batch.competitivenessDate || batch.date) === competitivenessDate
            ? { ...batch, isCompetitivenessConfirmed: false }
            : batch
        ))
      ]
    }));
  };

  const handleCompetitivenessHistoryLoaded = (batches: TrackingBatch[], fileName: string) => {
    const normalizedBatches = batches.map(batch => ({
      ...batch,
      channelId: activeChannelId,
      channelName: activeChannel.name
    }));
    const confirmedDates = new Set(normalizedBatches.map(batch => batch.competitivenessDate || batch.date));
    updateActiveState(state => ({
      ...state,
      historyBatches: [
        ...normalizedBatches,
        ...state.historyBatches.map(batch => (
          batch.isCompetitivenessConfirmed && confirmedDates.has(batch.competitivenessDate || batch.date)
            ? { ...batch, isCompetitivenessConfirmed: false }
            : batch
        ))
      ],
      sourceUploadRecords: [
        {
          id: `SRC-${Date.now()}`,
          type: 'competitivenessHistory',
          fileName,
          uploadedAt: nowText(),
          rowCount: batches.length,
          matchedCount: batches.length,
          remarks: '导入历史竞争力汇总，并作为正式落数进入竞争力趋势。'
        },
        ...state.sourceUploadRecords
      ]
    }));
  };

  const handleTriggerApiRefresh = () => {
    updateActiveState(state => ({
      ...state,
      lastApiSyncTime: `${nowText()} 已按当前上传数据重新匹配`
    }));
  };

  const handleDeleteBatch = (id: string) => {
    updateActiveState(state => ({
      ...state,
      historyBatches: state.historyBatches.filter(batch => batch.id !== id)
    }));
  };

  const handleToggleCompetitionPpv = (ppv: string, selected: boolean) => {
    updateActiveState(state => ({
      ...state,
      selectedCompetitionPpvs: selected
        ? (state.selectedCompetitionPpvs.includes(ppv) ? state.selectedCompetitionPpvs : [...state.selectedCompetitionPpvs, ppv])
        : state.selectedCompetitionPpvs.filter(item => item !== ppv)
    }));
  };

  const handleMarginChange = (margin: number) => {
    updateActiveState(state => ({
      ...state,
      marginBottomLine: margin,
      pricingMode: 'margin'
    }));
  };

  const handlePricingModeChange = (mode: PricingMode) => {
    updateActiveState(state => ({
      ...state,
      pricingMode: mode
    }));
  };

  const handleCreateCompetitionVersion = () => {
    updateActiveState(state => ({
      ...state,
      competitionVersionIndex: state.competitionVersionIndex + 1
    }));
    setActiveTab('workspace');
  };

  const handleManualRecommendPriceChange = (ppv: string, price?: number) => {
    updateActiveState(state => {
      const next = { ...state.manualRecommendPrices };
      if (price === undefined) {
        delete next[ppv];
      } else {
        next[ppv] = price;
      }
      return {
        ...state,
        manualRecommendPrices: next
      };
    });
  };

  const setInvestmentRateInputs = (inputs: InvestmentRateInputs) => {
    updateActiveState(state => ({
      ...state,
      investmentRateInputs: inputs
    }));
  };
  const startTour = () => {
    setTourOpen(true);
  };
  const finishTour = () => {
    setTourOpen(false);
    setTourStepIndex(0);
  };
  const goToTourStep = (nextIndex: number) => {
    const boundedIndex = Math.max(0, Math.min(nextIndex, tourSteps.length - 1));
    const nextTab = tourSteps[boundedIndex]?.tab as ViewTab | undefined;
    if (nextTab && nextTab !== activeTab) {
      setActiveTab(nextTab);
    }
    setTourStepIndex(boundedIndex);
  };

  const viewButtons: { id: ViewTab; label: string }[] = [
    { id: 'workspace', label: '追价工作台' },
    { id: 'upload', label: `数据源 (${activeState.sourceUploadRecords.length})` },
    { id: 'history', label: `历史 (${activeState.historyBatches.length})` },
    { id: 'competitiveness', label: '竞争力走势' },
    { id: 'tmHandGap', label: activeChannelId === 'selfOperated' ? '追后AHS高出ZZ' : '追后到手高出TM' }
  ];
  const channelOrder: ChannelId[] = ['tradeIn', 'selfOperated'];
  const hasPausedTour = !tourOpen && tourStepIndex > 0;
  const channelTargetLabel = (channelId: ChannelId) => (
    CHANNELS[channelId].targetCompetitor === 'zz' ? '转转裸机价×103%' : '天猫裸机价×103%'
  );

  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans overflow-x-hidden selection:bg-[#141414] selection:text-[#E4E3E0]">
      <div className="flex min-h-screen">
        <aside className="w-[260px] shrink-0 border-r border-[#141414] bg-[#F0EFEC] flex flex-col">
          <div className="p-5 border-b border-[#141414] bg-[#E4E3E0]">
            <h1 className="text-lg font-black leading-tight">线上竞争追价系统</h1>
          </div>

          <div className="flex-1 p-5 space-y-7">
            {channelOrder.map(channelId => {
              const channel = CHANNELS[channelId];
              const selected = activeChannelId === channelId;
              return (
                <div key={channelId} className="space-y-5">
                  <button
                    type="button"
                    data-tour={`channel-${channelId}`}
                    onClick={() => {
                      setActiveChannelId(channelId);
                      if (!selected) setActiveTab('workspace');
                    }}
                    className={`relative w-full border-2 px-5 py-4 text-left text-xs font-black transition-colors ${
                      selected
                        ? 'border-[#141414] bg-[#141414] text-white'
                        : 'border-[#141414] bg-white text-[#141414] hover:bg-[#141414] hover:text-white'
                    }`}
                  >
                    <div className="text-sm leading-none">
                      {channel.name} {selected ? '▼' : ''}
                    </div>
                    <div className="mt-3 text-sm leading-none font-bold">
                      {channelTargetLabel(channelId)}
                    </div>
                  </button>

                  {selected && (
                    <nav className="ml-6 space-y-2 text-sm font-bold">
                      {viewButtons.map((button, index) => {
                        const active = activeTab === button.id;
                        const marker = index === viewButtons.length - 1 ? '└' : '├';
                        return (
                          <button
                            key={button.id}
                            type="button"
                            data-tour={`tab-${button.id}`}
                            onClick={() => setActiveTab(button.id)}
                            className={`block w-full border px-3 py-2 text-left text-xs transition-colors ${
                              active
                                ? 'border-[#141414] bg-[#141414] text-white font-black'
                                : 'border-[#141414] bg-white text-[#141414] hover:bg-[#141414] hover:text-white'
                            }`}
                          >
                            <span className="inline-block w-5 font-mono">{marker}</span>
                            <span>{button.label}</span>
                          </button>
                        );
                      })}
                    </nav>
                  )}
                </div>
              );
            })}
          </div>

          <div className="p-4 border-t border-[#141414] space-y-2">
            <button
              type="button"
              data-tour="open-upload"
              onClick={() => {
                setActiveTab('upload');
              }}
              className="w-full border border-[#141414] bg-white px-3 py-2 text-xs font-bold hover:bg-[#141414] hover:text-white"
            >
              上传数据源
            </button>
            <button
              type="button"
              data-tour="save-snapshot"
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
              className="w-full border border-[#141414] bg-[#141414] px-3 py-2 text-xs font-bold text-white hover:bg-[#2A2A2B]"
            >
              保存测算快照
            </button>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="flex flex-col md:flex-row items-start md:items-center justify-between px-6 py-4 border-b border-[#141414] bg-[#E4E3E0] gap-4">
            <div className="flex flex-col">
              <div className="flex flex-wrap items-center gap-2">
                <span className="border border-[#141414] bg-[#141414] px-2 py-0.5 text-xs font-black text-white">{activeChannel.name}</span>
                <h2 className="text-xl font-bold tracking-tight uppercase">竞争追价控制台</h2>
              </div>
              <div className="flex flex-wrap gap-4 mt-1">
                <div className="flex items-center gap-2 text-xs text-[#141414]/70">
                  <span>数据版本：{activeState.lastApiSyncTime}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                data-tour="tutorial-button"
                onClick={startTour}
                className="inline-flex items-center gap-1.5 border border-[#141414] bg-white px-3 py-1 text-xs font-black hover:bg-[#141414] hover:text-white"
              >
                <Info className="h-3.5 w-3.5" />
                {hasPausedTour ? '继续教程' : '新手教程'}
              </button>
              <span className="text-xs font-bold opacity-70">追价策略：</span>
              <div data-tour="top-strategy" className="flex gap-1 bg-white p-0.5 border border-[#141414]">
                {[-0.03, 0, 0.03].map(val => (
                  <button
                    key={val}
                    onClick={() => handleMarginChange(val)}
                    className={`px-2.5 py-0.5 text-xs font-bold transition-all ${activeState.pricingMode === 'margin' && activeState.marginBottomLine === val ? 'bg-[#141414] text-white' : 'text-[#141414] hover:bg-black/10'}`}
                  >
                    {formatPercent(val)}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => handlePricingModeChange('fullCompetition')}
                  className={`px-2.5 py-0.5 text-xs font-bold transition-all ${activeState.pricingMode === 'fullCompetition' ? 'bg-[#141414] text-white' : 'text-[#141414] hover:bg-black/10'}`}
                >
                  100%竞争力
                </button>
              </div>
            </div>
          </header>

          <main className="px-6 py-6 space-y-6 max-w-[1440px] mx-auto">
            <DashboardStats
              products={activeCalculatedItems}
              marginBottomLine={activeState.marginBottomLine}
              pricingMode={activeState.pricingMode}
              channelId={activeChannelId}
            />

            <div className="border border-[#141414] bg-white p-1">
              {activeTab === 'workspace' && (
                <>
                  <InvestmentRatePanel
                    products={activeCalculatedItems}
                    investmentRateInputs={activeState.investmentRateInputs}
                    onInvestmentRateInputsChange={setInvestmentRateInputs}
                    channelSalesLabel={activeChannel.channelSalesLabel}
                  />
                  <MainTable
                    products={activeCalculatedItems}
                    marginBottomLine={activeState.marginBottomLine}
                    pricingMode={activeState.pricingMode}
                    channelId={activeChannelId}
                    onMarginChange={handleMarginChange}
                    onPricingModeChange={handlePricingModeChange}
                    onSaveBatch={handleSaveBatch}
                    onTriggerApiRefresh={handleTriggerApiRefresh}
                    lastApiSyncTime={activeState.lastApiSyncTime}
                    competitionVersionName={`竞争版本 V${activeState.competitionVersionIndex}`}
                    selectedCompetitionPpvs={activeState.selectedCompetitionPpvs}
                    onToggleCompetitionPpv={handleToggleCompetitionPpv}
                    onCreateCompetitionVersion={handleCreateCompetitionVersion}
                    onManualRecommendPriceChange={handleManualRecommendPriceChange}
                  />
                </>
              )}

              {activeTab === 'upload' && (
                <UploadSection
                  channelId={activeChannelId}
                  currentProducts={activeState.productsMaster}
                  dailyPrices={activeState.dailyPriceRows}
                  subsidyRules={activeState.subsidyRules}
                  selfSubsidyRules={activeState.selfSubsidyRules}
                  uploadRecords={activeState.sourceUploadRecords}
                  onBaseProductsLoaded={handleBaseProductsLoaded}
                  onDailyPricesLoaded={handleDailyPricesLoaded}
                  onSubsidyRulesLoaded={handleSubsidyRulesLoaded}
                  onSelfSubsidyRulesLoaded={handleSelfSubsidyRulesLoaded}
                  onCompetitivenessHistoryLoaded={handleCompetitivenessHistoryLoaded}
                />
              )}

              {activeTab === 'history' && (
                <HistoryPanel
                  historyBatches={activeState.historyBatches}
                  onDeleteBatch={handleDeleteBatch}
                  channelName={activeChannel.name}
                />
              )}

              {activeTab === 'competitiveness' && (
                <CompetitivenessSummary
                  historyBatches={activeState.historyBatches}
                  currentCalculatedItems={activeCalculatedItems}
                  activeSubsidyFileName={activeState.activeSubsidyFileName}
                  channelId={activeChannelId}
                  channelName={activeChannel.name}
                />
              )}

              {activeTab === 'tmHandGap' && (
                <TmHandPriceGapPanel
                  products={activeCalculatedItems}
                  channelName={activeChannel.name}
                  channelId={activeChannelId}
                />
              )}
            </div>
          </main>

          <footer className="mt-12 border-t border-[#141414] bg-[#D8D7D2] py-6 text-center text-[#141414] px-6 text-xs">
            <p className="opacity-80">线上竞争追价系统 © 2026</p>
          </footer>
        </div>
      </div>
      <OnboardingTour
        open={tourOpen}
        steps={tourSteps}
        currentIndex={tourStepIndex}
        onPause={() => setTourOpen(false)}
        onFinish={finishTour}
        onNext={() => goToTourStep(tourStepIndex + 1)}
        onPrev={() => goToTourStep(tourStepIndex - 1)}
      />
    </div>
  );
}
