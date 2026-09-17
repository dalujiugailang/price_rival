/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
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
  applyManualRecommendedPrice,
  runBatchCalculations,
  formatPercent
} from './utils/formulas';
import { calculateCompetitivenessMetrics } from './utils/competitiveness';
import { calculateCompetitionInvestmentMetrics } from './utils/investment';
import { evaluateSmallGapTolerance } from './utils/smallGapTolerance';
import { applyHandPriceAdjustment, handPriceRowKey, updateHandPriceAdjustments, type HandPriceAction, type HandPriceAdjustments } from './utils/handPriceAlignment';
import { createWorkspaceDraftStorage } from './utils/workspaceDraftStorage';
import { createSnapshotSync } from './utils/snapshotSync';
import { snapshotPricingProducts } from './utils/snapshotPricingDraft';
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
import GradeExpansionPanel from './components/GradeExpansionPanel';
import {gradeBatchMismatch} from '../shared/gradeHistory.mjs';
import MainTable from './components/MainTable';
import UploadSection from './components/UploadSection';
import HistoryPanel from './components/HistoryPanel';
import CompetitivenessSummary from './components/CompetitivenessSummary';
import TmHandPriceGapPanel from './components/TmHandPriceGapPanel';
import OnboardingTour, { TourStep } from './components/OnboardingTour';
import AuditLogPanel from './components/AuditLogPanel';
import PermissionPanel from './components/PermissionPanel';
import SharedSourcesPanel from './components/SharedSourcesPanel';
import ProductTutorial from './components/ProductTutorial';
import { ACCESS_PAGES, accessibleChannels, canAccess, canEdit, isEditor } from '../shared/accessPolicy.mjs';
import { useAuth } from './components/AuthGate';
import { CHANNELS, DEFAULT_CHANNEL_ID } from './config/channels';
import {
  deleteTrackingBatch,
  getLatestAndroidRevenueSnapshot,
  importTrackingBatches,
  listTrackingBatches,
  saveTrackingBatch,
  AndroidRevenueSnapshot
} from './api';

const normalizeFieldName = (value: string) => value.replace(/^[A-Z]+_/, '').trim().replace(/\s+/g, '').toLowerCase();

const createBatchRandomSuffix = () => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID().slice(0, 6).toUpperCase();
  }
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(3));
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  return Math.floor(Math.random() * 0x1000000).toString(16).padStart(6, '0').toUpperCase();
};

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

type SaveBatchOptions = {
  confirmCompetitiveness: boolean;
  competitivenessDate: string;
  pricingTimestamp: string;
};

type ViewTab = 'workspace' | 'upload' | 'history' | 'competitiveness' | 'tmHandGap' | 'audit' | 'permissions' | 'tutorial';

type ChannelWorkspaceState = {
  productsMaster: Product[];
  dailyPriceRows: DailyPriceRow[];
  subsidyRules: SubsidyRule[];
  selfSubsidyRules: SelfOperatedSubsidyRule[];
  sourceUploadRecords: SourceUploadRecord[];
  manualRecommendPrices: Record<string, number>;
  handPriceAdjustments: HandPriceAdjustments;
  handPriceMargin: number;
  investmentRateInputs: InvestmentRateInputs;
  selectedCompetitionPpvs: string[];
  historyBatches: TrackingBatch[];
  activeSubsidyFileName: string;
  marginBottomLine: number;
  smallGapToleranceMargin: number;
  pricingMode: PricingMode;
  lastApiSyncTime: string;
  competitionVersionIndex: number;
};

type ChannelStates = Record<ChannelId, ChannelWorkspaceState>;

const normalizeState = (state: Partial<ChannelWorkspaceState>, fallbackProducts: Product[], channelId: ChannelId): ChannelWorkspaceState => ({
  productsMaster: (state.productsMaster || fallbackProducts).map(product => hydrateThirtyDayVolumes(product, channelId)),
  dailyPriceRows: state.dailyPriceRows || [],
  subsidyRules: state.subsidyRules || [],
  selfSubsidyRules: state.selfSubsidyRules || [],
  sourceUploadRecords: state.sourceUploadRecords || [],
  manualRecommendPrices: state.manualRecommendPrices || {},
  handPriceAdjustments: state.handPriceAdjustments || {},
  handPriceMargin: typeof state.handPriceMargin === 'number' && Number.isFinite(state.handPriceMargin) ? state.handPriceMargin : -0.05,
  investmentRateInputs: { ...DEFAULT_INVESTMENT_RATE_INPUTS, ...(state.investmentRateInputs || {}) },
  selectedCompetitionPpvs: state.selectedCompetitionPpvs || (state.productsMaster || fallbackProducts).map(product => product.ppv),
  historyBatches: state.historyBatches || [],
  activeSubsidyFileName: state.activeSubsidyFileName || '未上传补贴表，沿用基础表字段',
  marginBottomLine: typeof state.marginBottomLine === 'number' ? state.marginBottomLine : 0.03,
  smallGapToleranceMargin: typeof state.smallGapToleranceMargin === 'number' && Number.isFinite(state.smallGapToleranceMargin)
    ? state.smallGapToleranceMargin
    : -0.02,
  pricingMode: state.pricingMode || 'margin',
  lastApiSyncTime: state.lastApiSyncTime || '等待上传数据',
  competitionVersionIndex: state.competitionVersionIndex || 1
});

export default function App() {
  const { user, logout } = useAuth();
  const isReadOnly = !isEditor(user);
  const isAdmin = user.role === 'admin';
  const channelOrder = accessibleChannels(user).map(channel => channel.id) as ChannelId[];
  const firstPage = (channel: ChannelId) => ACCESS_PAGES.find(page => canAccess(user, channel, page.id))?.id as ViewTab || 'workspace';
  const [activeChannelId, setActiveChannelId] = useState<ChannelId>(channelOrder[0] || DEFAULT_CHANNEL_ID);
  const [activeTab, setActiveTab] = useState<ViewTab>(() => firstPage(channelOrder[0] || DEFAULT_CHANNEL_ID));
  const [selectedHistoryBatchIds, setSelectedHistoryBatchIds] = useState<Partial<Record<ChannelId, string>>>({});
  const [draftStorage] = useState(() => createWorkspaceDraftStorage<ChannelWorkspaceState>({
    getItem: key => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value)
  }));
  const [channelStates, setChannelStates] = useState<ChannelStates>(() => {
    const saved = draftStorage.initial;
    const stateFor = (channel: ChannelId) => {
      const editable = canEdit(user, channel, 'workspace') || canEdit(user, channel, 'upload');
      const source: Partial<ChannelWorkspaceState> = editable ? saved[channel] || {} : {};
      // Restricted accounts start empty; their data is supplied by the authorized server response.
      return normalizeState({ ...source, historyBatches: canEdit(user, channel, 'upload') ? source.historyBatches || [] : [] }, [], channel);
    };
    const states = { tradeIn: stateFor('tradeIn'), selfOperated: stateFor('selfOperated') };
    draftStorage.initialize(states);
    return states;
  });
  const [activeCalculatedItems, setActiveCalculatedItems] = useState<CalculatedProduct[]>([]);
  const [workspacePane, setWorkspacePane] = useState<'pricing' | 'grades'>('pricing');
  const [handPriceUndo, setHandPriceUndo] = useState<{
    channel: ChannelId;
    before: HandPriceAdjustments;
    after: HandPriceAdjustments;
    products: Product[];
    rules: SubsidyRule[];
    dailyPrices: DailyPriceRow[];
    manualPrices: Record<string, number>;
    margin: number;
    mode: PricingMode;
  } | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  const [tourStepIndex, setTourStepIndex] = useState(0);
  const [historySyncStatus, setHistorySyncStatus] = useState('正在连接共享历史…');
  const [historyRefreshing, setHistoryRefreshing] = useState(true);
  const [androidRevenueSnapshot, setAndroidRevenueSnapshot] = useState<AndroidRevenueSnapshot | null>(null);
  const [androidRevenueStatus, setAndroidRevenueStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [androidRevenueError, setAndroidRevenueError] = useState('');
  const [draftSaveError, setDraftSaveError] = useState(draftStorage.readError);
  const historySyncRef = useRef<ReturnType<typeof createSnapshotSync<TrackingBatch[]>> | null>(null);
  const activeChannel = CHANNELS[activeChannelId];
  const activeState = channelStates[activeChannelId];
  const canEditWorkspace = canEdit(user, activeChannelId, 'workspace');
  const canEditUpload = canEdit(user, activeChannelId, 'upload');
  const canViewWorkspace = canAccess(user, activeChannelId, 'workspace');
  // Show saved prices until an editor changes strategy or uploads new inputs.
  const useSharedSnapshot = !canEditWorkspace || activeState.productsMaster.length === 0;
  const latestSnapshot = activeState.historyBatches.find(batch => !batch.isSummaryOnly && batch.products.length > 0);
  const readOnlySnapshot = useSharedSnapshot ? latestSnapshot : undefined;
  const effectiveMarginBottomLine = readOnlySnapshot?.marginBottomLine ?? activeState.marginBottomLine;
  const effectivePricingMode = readOnlySnapshot?.pricingMode ?? activeState.pricingMode;
  const effectiveInvestmentRateInputs = activeChannelId==='tradeIn'&&androidRevenueSnapshot
    ? {androidSalesAmount30d:androidRevenueSnapshot.androidSalesAmount30d,androidJdTradeInSalesAmount30d:androidRevenueSnapshot.androidJdTradeInSalesAmount30d}
    : readOnlySnapshot?.totalInvestmentRateInputs ?? readOnlySnapshot?.investmentRateInputs ?? activeState.investmentRateInputs;
  const isSelfOperated = activeChannelId === 'selfOperated';
  const gradeProducts = useSharedSnapshot ? readOnlySnapshot?.products || [] : activeCalculatedItems;
  const investmentBatch=useMemo(()=>{
    if(useSharedSnapshot)return readOnlySnapshot;
    const request={prices:gradeProducts.map(p=>({id:p.id,skuId:String(p.skuId),ppv:p.ppv,model:p.oldModel,newSeries:p.newSeries||'',price:p.recommendJdPrice,display:{recommendAdjustment:p.recommendAdjustment}}))};
    return activeState.historyBatches.find(b=>b.products.length===gradeProducts.length&&!gradeBatchMismatch(request,b));
  },[useSharedSnapshot,readOnlySnapshot,gradeProducts,activeState.historyBatches]);

  const refreshAndroidRevenue = useCallback(async () => {
    setAndroidRevenueStatus('loading');
    setAndroidRevenueError('');
    try {
      const { snapshot } = await getLatestAndroidRevenueSnapshot();
      setAndroidRevenueSnapshot(snapshot);
      setChannelStates(previous => ({
        ...previous,
        tradeIn: {
          ...previous.tradeIn,
          investmentRateInputs: {
            androidSalesAmount30d: snapshot.androidSalesAmount30d,
            androidJdTradeInSalesAmount30d: snapshot.androidJdTradeInSalesAmount30d
          }
        }
      }));
      setAndroidRevenueStatus('success');
    } catch (error) {
      setAndroidRevenueStatus('error');
      setAndroidRevenueError(error instanceof Error ? error.message : 'Supabase 安卓销售额拉取失败');
    }
  }, []);
  const tourSteps = useMemo<TourStep[]>(() => {
    const steps: TourStep[] = [
      {
        "tab": "competitiveness",
        "chapter": "竞争力看板",
        "target": "tab-competitiveness",
        "title": "进入竞争力走势",
        "action": "在此查看各批次的竞争力指标。",
        "body": "本导览覆盖数据查询与业务复盘。高亮区域支持直接操作，完成查看后可进入下一步。"
      },
      {
        "tab": "competitiveness",
        "chapter": "竞争力看板",
        "target": "trend-batch",
        "title": "选择数据批次",
        "action": "展开“数据范围”，选择需要查询的历史批次。",
        "body": "全量视图用于观察趋势，指定批次用于核对单期结果。批次选项包含日期及正式落数状态；只读账号仅查看已共享数据。"
      },
      {
        "tab": "competitiveness",
        "chapter": "竞争力看板",
        "target": "trend-brand",
        "title": "设置品牌范围",
        "action": "选择目标品牌；查看整体结果时选择“全部品牌”。",
        "body": "指标卡片、趋势和明细随筛选范围联动。跨期或跨品牌比较时，应核对样本范围是否一致。"
      },
      {
        "tab": "competitiveness",
        "chapter": "竞争力看板",
        "target": "trend-series",
        "title": "设置新机系列范围",
        "action": "选择需要查询的新机系列。",
        "body": "系列选项与品牌联动。仅汇总历史未保存PPV明细，不支持系列拆分，筛选项会显示为不可用。"
      },
      {
        "tab": "competitiveness",
        "chapter": "竞争力看板",
        "target": "competitiveness-source",
        "title": "核对指标数据来源",
        "action": "核对来源标签中的批次、日期及筛选范围。",
        "body": "部分系列没有当前数据时，卡片采用最近有效历史值。指标所属批次以来源标签为准。"
      },
      {
        "tab": "competitiveness",
        "chapter": "竞争力看板",
        "target": "trend-tm-metrics",
        "title": "查看天猫物品价竞争力",
        "action": "查看天猫指标组第一项。",
        "body": "追后京东物品价不低于天猫物品价时，判定为有竞争力；随后按近30天报价量加权。该指标不含补贴。"
      },
      {
        "tab": "competitiveness",
        "chapter": "竞争力看板",
        "target": "trend-tm-metrics",
        "title": "查看天猫补贴后竞争力",
        "action": "依次查看天猫指标组第二项、第三项。",
        "body": "第二项比较AHS补贴后与天猫回收商补贴后报价；第三项比较双方总到手价。物品价具备竞争力但到手价不足时，应继续核对补贴。"
      },
      {
        "tab": "competitiveness",
        "chapter": "竞争力看板",
        "target": "trend-zz-metrics",
        "title": "查看转转竞争力指标",
        "action": "依次查看物品价、AHS补贴后报价、京东到手价三项指标。",
        "body": "后两项均以转转到手价为对标价格，我方分别采用AHS补贴后报价和京东总到手价，需区分计算口径。"
      },
      {
        "tab": "tutorial",
        "chapter": "竞争力看板",
        "target": "guide-weighting",
        "title": "核对报价量加权口径",
        "action": "查看A、B两条记录及其计算结果。",
        "body": "A报价量为90且具备竞争力，B报价量为10且不具备竞争力，汇总结果为90%。按记录条数计算的50%不适用于本指标。"
      },
      {
        "tab": "competitiveness",
        "chapter": "竞争力看板",
        "target": "trend-lines",
        "title": "查看历史节点指标",
        "action": "将鼠标悬停在趋势图的日期节点。",
        "body": "横轴表示批次，纵轴表示竞争力。悬停可查看该期指标。60%升至65%为提高5个百分点；样本和补贴版本变化也可能影响结果。"
      },
      {
        "tab": "competitiveness",
        "chapter": "竞争力看板",
        "target": "trend-lines",
        "title": "切换曲线显示状态",
        "action": "点击图例中的指标名称，重复点击可恢复显示。",
        "body": "可仅保留天猫物品价与到手价曲线进行比较。曲线显示状态不影响原始数据。"
      },
      {
        "tab": "competitiveness",
        "chapter": "竞争力看板",
        "target": "trend-range",
        "title": "设置趋势展示期数",
        "action": "选择“近15次追价”或“全部”。",
        "body": "该设置控制图表显示期数。查询较早批次时可选择全部；定位历史批次时，图表也可能自动展开相应范围。"
      },
      {
        "tab": "competitiveness",
        "chapter": "竞争力看板",
        "target": "trend-export",
        "title": "导出竞争力走势",
        "action": "选择“导出全量走势Excel”。",
        "body": "使用导出文件前，应核对数据范围、批次与日期。无数据时按钮不可用；导览本身不会触发下载。"
      },
      {
        "tab": "competitiveness",
        "chapter": "补贴问题",
        "target": "trend-audit",
        "title": "查看品牌与系列诊断",
        "action": "查看下方“详细大底表横向竞争力审计诊断”。",
        "body": "诊断明细与批次及筛选范围保持一致。确认选定数据后，再比较天猫物品价竞争力、到手价竞争力及补贴承接缺口。"
      },
      {
        "tab": "competitiveness",
        "chapter": "补贴问题",
        "target": "audit-brand",
        "title": "展开品牌明细",
        "action": "点击品牌名称前的展开按钮。",
        "body": "重点查看物品价竞争力较高、到手价竞争力偏低的新机系列。",
        "fallbackTarget": "trend-audit",
        "unavailable": "当前范围暂无可展开的品牌明细。请选择包含PPV明细的批次；仅汇总历史不支持展开。"
      },
      {
        "tab": "competitiveness",
        "chapter": "补贴问题",
        "target": "audit-issues",
        "title": "查看补贴问题PPV",
        "action": "点击系列行“补贴问题明细”中的记录条数。",
        "body": "明细列出物品价具备竞争力、到手价缺乏竞争力的记录。优先核对报价量较高的PPV，并检查双方价格、补贴和到手价。",
        "fallbackTarget": "trend-audit",
        "unavailable": "请先展开品牌并定位系列行。缺少明细或问题记录时，不展示可展开的内容。"
      },
      {
        "tab": "competitiveness",
        "chapter": "补贴问题",
        "target": "audit-issue-details",
        "placement": "below",
        "title": "区分竞争力差值与价格差额",
        "action": "横向查看这块明细中的物品价差、补贴差和到手价差。",
        "body": "明细金额均按JD−TM计算：物品价差＋补贴差＝到手价差，单位为元。上方的天猫补贴承接缺口是两项竞争力之差，单位为百分点，不代表应追加的补贴金额。",
        "fallbackTarget": "trend-audit",
        "unavailable": "当前范围没有可展开的补贴问题PPV。请选择包含问题明细的批次、品牌或系列；仅汇总历史无法展开PPV明细。"
      },
      {
        "tab": "tmHandGap",
        "chapter": "高出TM",
        "target": "tm-hand-gap-list",
        "title": "查看到手价高出TM明细",
        "action": "按新机系列核对京东到手价、天猫到手价及高出金额。",
        "body": "高出金额不直接等于可削减补贴，需结合活动门槛评估。本页使用当前共享数据，不继承走势页的历史批次筛选。"
      },
      {
        "tab": "tmHandGap",
        "chapter": "高出TM",
        "target": "gap-preview",
        "title": "生成清单预览",
        "action": "选择“生成分享预览”。",
        "body": "核对预览中的型号和价格后，可自行下载或分享。无符合条件的记录时按钮不可用；导览不会自动发送内容。"
      },
      {
        "tab": "history",
        "chapter": "历史快照",
        "target": "history-library",
        "title": "选择历史快照",
        "action": "展开“全部快照”，选择需要核对的批次。",
        "body": "也可通过下方快照页签切换。应结合业务日期和备注定位批次，不仅依据保存时间。"
      },
      {
        "tab": "history",
        "chapter": "历史快照",
        "target": "history-meta",
        "title": "核对快照状态",
        "action": "核对保存时间、正式状态、落数日期和批次ID。",
        "body": "保存快照不等于确认正式落数。同渠道同落数日期重新确认时，旧正式记录降为未确认快照，并继续保留。",
        "fallbackTarget": "history-panel",
        "unavailable": "当前尚未选择快照，请通过“全部快照”选择记录。暂无历史数据时，可继续查看后续说明。"
      },
      {
        "tab": "history",
        "chapter": "历史快照",
        "target": "history-sources",
        "title": "核对补贴版本与投入来源",
        "action": "展开“保存时投入测算与来源”。",
        "body": "此处展示快照保存的补贴文件及投入测算。比较两期数据时，应核对补贴版本是否发生变化。",
        "fallbackTarget": "history-panel",
        "unavailable": "当前尚未选择快照，或所选快照未保存来源信息。来源缺失不代表补贴为0。"
      },
      {
        "tab": "history",
        "chapter": "历史快照",
        "target": "history-search",
        "title": "搜索快照明细",
        "action": "在搜索框输入型号、PPV或SKU。",
        "body": "搜索仅作用于当前快照。清空输入可恢复原范围；未匹配到记录时，应先核对批次。",
        "fallbackTarget": "history-panel",
        "unavailable": "请选择包含PPV明细的快照；两期对比模式下，需先选择“返回快照明细”。"
      },
      {
        "tab": "history",
        "chapter": "历史快照",
        "target": "history-table",
        "title": "设置明细列筛选",
        "action": "点击对应表头的筛选按钮。",
        "body": "同列多个选项按“或”匹配，跨列条件按“且”匹配，并可叠加搜索。选择“清除筛选与搜索”可恢复原范围。",
        "fallbackTarget": "history-panel",
        "unavailable": "当前未展示快照明细，或处于两期对比模式。仅汇总历史不支持逐条筛选。"
      },
      {
        "tab": "history",
        "chapter": "历史快照",
        "target": "history-export",
        "title": "导出快照明细",
        "action": "选择“导出快照”。",
        "body": "导出范围为当前筛选结果。导出整期数据前应清除筛选与搜索；历史缺失字段显示“—”，不使用当前数据补算。",
        "fallbackTarget": "history-panel",
        "unavailable": "请选择包含明细的快照；两期对比模式下，需先返回快照明细。"
      },
      {
        "tab": "history",
        "chapter": "历史快照",
        "target": "history-compare",
        "title": "对比两期快照",
        "action": "选择“两期对比”，再设置“对比基准”。",
        "body": "核对同一PPV两期的价格、边际利润率及单期新增或缺失记录。可对比快照不足两份时，按钮不可用。"
      },
      {
        "tab": "tutorial",
        "chapter": "完成",
        "target": "tab-tutorial",
        "title": "完成使用导览",
        "action": "通过左侧“产品教程”可随时查阅计算口径。",
        "body": "报告应注明批次、落数日期、品牌或系列及正式状态。涉及价格或补贴调整的问题，应由运营人员进一步核对。"
      }
    ];
    return steps.filter(step => canAccess(user, activeChannelId, step.tab));
  }, [activeChannelId, user]);

  const updateActiveState = (updater: (state: ChannelWorkspaceState) => ChannelWorkspaceState) => {
    if (!canEdit(user, activeChannelId, activeTab)) return;
    setChannelStates(prev => ({
      ...prev,
      [activeChannelId]: updater(prev[activeChannelId])
    }));
  };

  const applyServerBatches = (batches: TrackingBatch[]) => {
    setChannelStates(prev => ({
      tradeIn: {
        ...prev.tradeIn,
        historyBatches: batches.filter(batch => (batch.channelId || 'tradeIn') === 'tradeIn')
      },
      selfOperated: {
        ...prev.selfOperated,
        historyBatches: batches.filter(batch => batch.channelId === 'selfOperated')
      }
    }));
  };

  const refreshServerBatches = (afterMutation = false) => {
    const sync = historySyncRef.current;
    if (afterMutation) sync?.invalidate();
    return sync?.refresh() || Promise.resolve([]);
  };

  useEffect(() => {
    const localBatches = [...channelStates.tradeIn.historyBatches, ...channelStates.selfOperated.historyBatches]
      .filter(batch => canEdit(user, batch.channelId || 'tradeIn', 'upload'));
    let migration: Promise<void> | undefined;
    const sync = createSnapshotSync(async () => {
      setHistoryRefreshing(true);
      if (!migration) {
        migration = (async () => {
          if (!isReadOnly && localBatches.length > 0) {
            const result = await importTrackingBatches(localBatches);
            if (result.invalid.length) throw new Error(`有 ${result.invalid.length} 期本机历史未能迁移，原记录已保留`);
            draftStorage.confirmHistoryMigration(localBatches.map(batch => batch.id));
          }
        })().catch(error => { migration = undefined; throw error; });
      }
      await migration;
      return (await listTrackingBatches()).batches;
    }, batches => {
      applyServerBatches(batches);
      setHistorySyncStatus(`共享历史已同步：${batches.length} 期`);
      setHistoryRefreshing(false);
    }, error => {
      setHistorySyncStatus(`共享历史同步失败：${error instanceof Error ? error.message : String(error)}`);
      setHistoryRefreshing(false);
    });
    historySyncRef.current = sync;
    void sync.refresh().catch(() => undefined);
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void sync.refresh().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      sync.dispose();
      if (historySyncRef.current === sync) historySyncRef.current = null;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);

  useEffect(() => {
    if (useSharedSnapshot) {
      setActiveCalculatedItems(readOnlySnapshot?.products || []);
      return;
    }
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
      let zzPrice = prod.zzPrice;
      let levelId = prod.levelId || '';
      let brand = prod.brand;

      if (dailyMatch) {
        if (dailyMatch.costPrice > 0) {
          jdPrice = dailyMatch.costPrice;
        }
        if (dailyMatch.biBasePrice > 0) {
          basePrice = dailyMatch.biBasePrice;
        }
        if (dailyMatch.zzPrePrice > 0) {
          zzPrice = dailyMatch.zzPrePrice;
        }
        if (dailyMatch.levelId) {
          levelId = dailyMatch.levelId;
        }
        if (dailyMatch.brandName) {
          brand = dailyMatch.brandName;
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
        zzPrice,
        levelId,
        brand
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
    const withSmallGap = activeChannelId === 'tradeIn'
      ? evaluateSmallGapTolerance({
        products: withManualPrices,
        toleranceMargin: activeState.smallGapToleranceMargin,
        subsidyRules: activeState.subsidyRules,
        channel: activeChannel,
        selfSubsidyRules: activeState.selfSubsidyRules
      })
      : withManualPrices;
    setActiveCalculatedItems(activeChannelId === 'tradeIn'
      ? withSmallGap.map(product => applyHandPriceAdjustment(product,
        activeState.handPriceAdjustments[handPriceRowKey(product)], activeState.subsidyRules, activeState.marginBottomLine))
      : withSmallGap);
  }, [activeChannel, activeChannelId, useSharedSnapshot, readOnlySnapshot,
    activeState.productsMaster, activeState.dailyPriceRows, activeState.subsidyRules,
    activeState.selfSubsidyRules, activeState.marginBottomLine, activeState.pricingMode,
    activeState.manualRecommendPrices, activeState.smallGapToleranceMargin, activeState.handPriceAdjustments]);

  const editableChannels = channelOrder.filter(channel => canEdit(user, channel, 'workspace') || canEdit(user, channel, 'upload'));
  const editableChannelKey = editableChannels.join(',');
  const persistDraft = () => {
    const result = draftStorage.save(channelStates, editableChannels);
    setDraftSaveError(result.error);
  };
  useEffect(persistDraft, [channelStates, editableChannelKey, draftStorage]);

  useEffect(() => {
    if (activeChannelId !== 'tradeIn' || !canEditWorkspace) return;
    void refreshAndroidRevenue();
  }, [activeChannelId, canEditWorkspace, refreshAndroidRevenue]);

  const exportDraftBackup = () => {
    const backup = Object.fromEntries(editableChannels.map(channel => [channel, { ...channelStates[channel], historyBatches: [] }]));
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `竞争追价草稿备份-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

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
      handPriceAdjustments: {},
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

  const handleDailyPricesLoaded = async (rows: DailyPriceRow[], fileName: string) => {
    const matchedCount = countPpvMatches(rows);
    const brandsByPpv = Object.fromEntries(
      rows.filter(row => row.ppv && row.brandName).map(row => [row.ppv, row.brandName])
    );
    updateActiveState(state => ({
      ...state,
      dailyPriceRows: rows,
      productsMaster: state.productsMaster.map(product => ({
        ...product,
        brand: brandsByPpv[product.ppv] || product.brand
      })),
      sourceUploadRecords: [
        {
          id: `SRC-${Date.now()}`,
          type: 'dailyPrice',
          fileName,
          uploadedAt: nowText(),
          rowCount: rows.length,
          matchedCount,
          remarks: '按 ppv 匹配 daily price：品牌名称写入BK列，最终报价写入 jd裸机价，BI基准价写入基准价，ZZ券前价写入 zz裸机价，等级id写入等级id列。'
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

  const handleSaveBatch = async (remarks: string, operator: string, options?: SaveBatchOptions) => {
    if (!canEditWorkspace || useSharedSnapshot) return { success: false, error: '请先上传本次竞争表，再保存新的追价快照' };
    const todayStr = new Date().toISOString().slice(0, 10);
    const timeCode = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
    const randomSuffix = createBatchRandomSuffix();
    const newBatchId = `TRACK-${todayStr.replace(/-/g, '')}-${timeCode}-${randomSuffix}`;
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
      sourceUploadRecords: activeState.sourceUploadRecords,
      remarks: `${remarks || ''}${remarks ? '；' : ''}${activeState.pricingMode === 'fullCompetition' ? '100%竞争力模式' : `边际底线${formatPercent(activeState.marginBottomLine)}`}；${activeChannel.name}；测算行 ${activeCalculatedItems.length} 条`,
      subsidyFileName: activeState.activeSubsidyFileName,
      subsidyUploadTime: new Date().toISOString().replace('T', ' ').slice(0, 19),
      isCompetitivenessConfirmed: confirmCompetitiveness,
      competitivenessDate: confirmCompetitiveness ? competitivenessDate : undefined,
      pricingTimestamp: confirmCompetitiveness ? pricingTimestamp : undefined,
      confirmedAt: confirmCompetitiveness ? new Date().toISOString().replace('T', ' ').slice(0, 19) : undefined,
      competitivenessMetrics,
      investmentRateInputs: activeState.investmentRateInputs,
      investmentBrandSalesAmounts30d:activeChannelId==='tradeIn'?androidRevenueSnapshot?.brandSalesAmounts30d:undefined,
      investmentRateSource: activeChannelId === 'tradeIn' && androidRevenueSnapshot ? {
        provider: 'supabase',
        dataDate: androidRevenueSnapshot.dataDate,
        periodStart: androidRevenueSnapshot.periodStart,
        periodEnd: androidRevenueSnapshot.periodEnd,
        syncedAt: androidRevenueSnapshot.syncedAt
      } : undefined,
      investmentRateMetrics
    };

    try {
      const result = await saveTrackingBatch(newBatch);
      updateActiveState(state => ({
        ...state,
        historyBatches: [
          result.batch,
          ...state.historyBatches.map(batch => (
            confirmCompetitiveness && batch.isCompetitivenessConfirmed && (batch.competitivenessDate || batch.date) === competitivenessDate
              ? { ...batch, isCompetitivenessConfirmed: false }
              : batch
          ))
        ]
      }));
      setHistorySyncStatus(`已写入共享历史：${result.batch.id}`);
      void refreshServerBatches(true).catch(() => {
        setHistorySyncStatus('快照已保存，共享历史刷新失败，可手动刷新。');
      });
      if (canAccess(user, activeChannelId, 'history')) {
        setSelectedHistoryBatchIds(previous => ({ ...previous, [activeChannelId]: result.batch.id }));
        setActiveTab('history');
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  };

  const handleCompetitivenessHistoryLoaded = (batches: TrackingBatch[], fileName: string) => {
    if (!canEditUpload) return;
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
    importTrackingBatches(normalizedBatches)
      .then(() => refreshServerBatches(true))
      .catch(error => alert(`历史落数已读入本机，但同步到共享数据库失败：${error instanceof Error ? error.message : String(error)}`));
  };

  const handleTriggerApiRefresh = () => {
    updateActiveState(state => ({
      ...state,
      lastApiSyncTime: `${nowText()} 已按当前上传数据重新匹配`
    }));
  };

  const handleDeleteBatch = async (id: string) => {
    if (!canEdit(user, activeChannelId, 'history')) return;
    if (!window.confirm(`确认删除快照 ${id} 吗？服务端将软删除并保留完整操作日志。`)) return;
    try {
      await deleteTrackingBatch(id);
      updateActiveState(state => ({
        ...state,
        historyBatches: state.historyBatches.filter(batch => batch.id !== id)
      }));
      setHistorySyncStatus(`已从共享历史删除：${id}`);
      void refreshServerBatches(true).catch(() => {
        setHistorySyncStatus('快照已删除，共享历史刷新失败，可手动刷新。');
      });
    } catch (error) {
      alert(`删除失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleToggleCompetitionPpv = (ppv: string, selected: boolean) => {
    updateActiveState(state => ({
      ...state,
      selectedCompetitionPpvs: selected
        ? (state.selectedCompetitionPpvs.includes(ppv) ? state.selectedCompetitionPpvs : [...state.selectedCompetitionPpvs, ppv])
        : state.selectedCompetitionPpvs.filter(item => item !== ppv)
    }));
  };

  const handleStrategyChange = (mode: PricingMode, margin = effectiveMarginBottomLine) => {
    if (!canEditWorkspace) return;
    updateActiveState(state => ({
      ...state,
      ...(readOnlySnapshot ? {
        productsMaster: snapshotPricingProducts(readOnlySnapshot),
        dailyPriceRows: [], manualRecommendPrices: {}, handPriceAdjustments: {},
        selectedCompetitionPpvs: readOnlySnapshot.products.map(p => p.ppv),
        sourceUploadRecords: readOnlySnapshot.sourceUploadRecords || state.sourceUploadRecords,
        lastApiSyncTime: `沿用 ${readOnlySnapshot.date} 快照原价`,
      } : {}),
      marginBottomLine: margin, pricingMode: mode
    }));
  };
  const handleMarginChange = (margin: number) => handleStrategyChange('margin', margin);
  const handlePricingModeChange = (mode: PricingMode) => handleStrategyChange(mode);

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

  const handleApplySmallGapTolerance = (margin: number, pricesByPpv: Record<string, number>) => {
    updateActiveState(state => ({
      ...state,
      smallGapToleranceMargin: Math.max(-0.5, Math.min(0.5, margin)),
      manualRecommendPrices: {
        ...state.manualRecommendPrices,
        ...pricesByPpv
      }
    }));
  };

  const canUndoHandPrice = Boolean(handPriceUndo
    && handPriceUndo.channel === activeChannelId
    && handPriceUndo.after === activeState.handPriceAdjustments
    && handPriceUndo.products === activeState.productsMaster
    && handPriceUndo.rules === activeState.subsidyRules
    && handPriceUndo.dailyPrices === activeState.dailyPriceRows
    && handPriceUndo.manualPrices === activeState.manualRecommendPrices
    && handPriceUndo.margin === activeState.marginBottomLine
    && handPriceUndo.mode === activeState.pricingMode);

  const handleHandPriceAction = (action: HandPriceAction, keys: string[], floor: number) => {
    if (!canEditWorkspace || activeChannelId !== 'tradeIn' || keys.length === 0
      || !Number.isFinite(floor) || floor < -1 || floor > 1) return;
    const next = updateHandPriceAdjustments(activeCalculatedItems, keys,
      activeState.handPriceAdjustments, activeState.subsidyRules, action, floor);
    setHandPriceUndo({ channel: activeChannelId, before: activeState.handPriceAdjustments, after: next,
      products: activeState.productsMaster, rules: activeState.subsidyRules,
      dailyPrices: activeState.dailyPriceRows, manualPrices: activeState.manualRecommendPrices,
      margin: activeState.marginBottomLine, mode: activeState.pricingMode });
    updateActiveState(state => ({ ...state, handPriceAdjustments: next,
      handPriceMargin: action === 'rollback' ? floor : state.handPriceMargin }));
  };

  const handleUndoHandPrice = () => {
    if (!canEditWorkspace || !canUndoHandPrice || !handPriceUndo) return;
    updateActiveState(state => ({ ...state, handPriceAdjustments: handPriceUndo.before }));
    setHandPriceUndo(null);
  };

  const setInvestmentRateInputs = (inputs: InvestmentRateInputs) => {
    updateActiveState(state => ({
      ...state,
      investmentRateInputs: inputs
    }));
  };
  const startTour = () => {
    setActiveTab(tourSteps[tourStepIndex]?.tab as ViewTab || 'tutorial');
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

  useEffect(() => {
    if (!channelOrder.includes(activeChannelId) && channelOrder[0]) setActiveChannelId(channelOrder[0]);
    if (activeTab === 'permissions' ? !(isAdmin && activeChannelId === 'tradeIn') : !canAccess(user, activeChannelId, activeTab)) {
      setActiveTab(firstPage(activeChannelId));
    }
  }, [activeChannelId, activeTab, user]);

  const viewButtons: { id: ViewTab; label: string }[] = ACCESS_PAGES
    .filter(page => canAccess(user, activeChannelId, page.id))
    .map(page => ({ id: page.id as ViewTab, label: page.id === 'history' ? `历史 (${activeState.historyBatches.length})`
      : isSelfOperated && page.selfName ? page.selfName : page.name }));
  if (isAdmin && activeChannelId === 'tradeIn') viewButtons.push({ id: 'permissions', label: '权限管理' });
  const showWorkspaceControls = canViewWorkspace && !['permissions', 'history', 'tutorial'].includes(activeTab);
  const hasPausedTour = !tourOpen && tourStepIndex > 0;
  const channelTargetLabel = (channelId: ChannelId) => (
    CHANNELS[channelId].targetCompetitor === 'zz' ? '转转裸机价×103%' : '天猫裸机价×103%'
  );

  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans overflow-x-hidden selection:bg-[#141414] selection:text-[#E4E3E0]">
      <div className={`flex min-h-screen ${activeTab === 'tutorial' ? 'flex-col md:flex-row' : ''}`}>
        <aside className={`${activeTab === 'tutorial' ? 'w-full md:w-[260px]' : 'w-[260px]'} shrink-0 border-r border-[#141414] bg-[#F0EFEC] flex flex-col`}>
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
                      if (!selected) {
                        setTourOpen(false);
                        setTourStepIndex(0);
                        setActiveTab(firstPage(channelId));
                        void refreshServerBatches().catch(() => undefined);
                      }
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
                    <nav className={`${activeTab === 'tutorial' ? 'grid grid-cols-2 gap-2 md:block md:ml-6 md:space-y-2' : 'ml-6 space-y-2'} text-sm font-bold`}>
                      {viewButtons.map((button, index) => {
                        const active = activeTab === button.id;
                        const marker = index === viewButtons.length - 1 ? '└' : '├';
                        return (
                          <button
                            key={button.id}
                            type="button"
                            data-tour={`tab-${button.id}`}
                            onClick={() => {
                              setActiveTab(button.id);
                              if (!active && !['permissions', 'tutorial'].includes(button.id)) void refreshServerBatches().catch(() => undefined);
                            }}
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

          {activeTab !== 'permissions' && (canEditWorkspace || canEditUpload) && <div className="p-4 border-t border-[#141414] space-y-2">
            {canEditUpload && <button
              type="button"
              data-tour="open-upload"
              onClick={() => {
                setActiveTab('upload');
              }}
              className="w-full border border-[#141414] bg-white px-3 py-2 text-xs font-bold hover:bg-[#141414] hover:text-white"
            >
              上传数据源
            </button>}
            {canEditWorkspace && !useSharedSnapshot && <button
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
            </button>}
          </div>}
        </aside>

        <div className="min-w-0 flex-1">
          <header className="flex flex-col md:flex-row items-start md:items-center justify-between px-6 py-4 border-b border-[#141414] bg-[#E4E3E0] gap-4">
            <div className="flex flex-col">
              <div className="flex flex-wrap items-center gap-2">
                <span className="border border-[#141414] bg-[#141414] px-2 py-0.5 text-xs font-black text-white">{activeChannel.name}</span>
                <h2 className="text-xl font-bold tracking-tight uppercase">{activeTab === 'tutorial' ? '产品教程' : activeTab === 'permissions' ? '人员与访问权限' : activeTab === 'history' ? '历史快照' : '竞争追价控制台'}</h2>
              </div>
              {activeTab !== 'permissions' && <div className="flex flex-wrap gap-4 mt-1">
                {activeTab !== 'history' && <div className="flex items-center gap-2 text-xs text-[#141414]/70">
                  <span>
                    数据版本：{useSharedSnapshot
                      ? (readOnlySnapshot ? `共享快照 ${readOnlySnapshot.id}` : '暂无可查看的共享快照')
                      : activeState.lastApiSyncTime}
                  </span>
                </div>}
                <div className="flex items-center gap-2 text-xs text-[#141414]/70">
                  <span>{historySyncStatus}</span>
                  <button type="button" disabled={historyRefreshing}
                    onClick={() => { void refreshServerBatches().catch(() => undefined); }}
                    className="inline-flex items-center gap-1 underline disabled:opacity-50">
                    <RefreshCw className={`h-3 w-3 ${historyRefreshing ? 'animate-spin' : ''}`} />
                    刷新共享历史
                  </button>
                </div>
              </div>}
              {draftSaveError && editableChannels.length > 0 && <div role="alert" className="mt-2 border border-amber-700 bg-amber-50 p-2 text-xs text-amber-900">
                <span>{draftSaveError}</span>
                <button type="button" onClick={persistDraft} className="ml-2 underline">重试保存草稿</button>
                <button type="button" onClick={exportDraftBackup} className="ml-2 underline">导出当前草稿备份</button>
              </div>}
            </div>

            <div className="flex items-center gap-3">
              <div className="border border-[#141414] bg-white px-3 py-1 text-xs font-bold">
                {user.name} · {isAdmin ? '管理员' : isReadOnly ? '只读' : '可编辑'}
                <button type="button" onClick={logout} className="ml-2 underline">退出</button>
              </div>
              {canAccess(user, activeChannelId, 'tutorial') && activeTab !== 'permissions' && <button
                type="button"
                data-tour="tutorial-button"
                onClick={startTour}
                className="inline-flex items-center gap-1.5 border border-[#141414] bg-white px-3 py-1 text-xs font-black hover:bg-[#141414] hover:text-white"
              >
                <Info className="h-3.5 w-3.5" />
                {hasPausedTour ? '继续教程' : '新手教程'}
              </button>}
              {showWorkspaceControls && <><span className="text-xs font-bold opacity-70">追价策略：</span>
              <div data-tour="top-strategy" className="flex gap-1 bg-white p-0.5 border border-[#141414]">
                {[-0.03, 0, 0.03].map(val => (
                  <button
                    key={val}
                    disabled={!canEditWorkspace}
                    onClick={() => handleMarginChange(val)}
                    className={`px-2.5 py-0.5 text-xs font-bold transition-all disabled:cursor-not-allowed ${effectivePricingMode === 'margin' && effectiveMarginBottomLine === val ? 'bg-[#141414] text-white' : 'text-[#141414] hover:bg-black/10 disabled:text-[#777]'}`}
                  >
                    {formatPercent(val)}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={!canEditWorkspace}
                  onClick={() => handlePricingModeChange('fullCompetition')}
                  className={`px-2.5 py-0.5 text-xs font-bold transition-all disabled:cursor-not-allowed ${effectivePricingMode === 'fullCompetition' ? 'bg-[#141414] text-white' : 'text-[#141414] hover:bg-black/10 disabled:text-[#777]'}`}
                >
                  100%竞争力
                </button>
              </div></>}
            </div>
          </header>

          <main className={`px-6 py-6 space-y-6 mx-auto ${activeTab === 'history' ? 'max-w-none' : 'max-w-[1440px]'}`}>
            {activeTab === 'workspace' && canEditWorkspace && readOnlySnapshot && <div className="border border-[#141414] bg-white px-4 py-3 text-sm">
              当前展示 {readOnlySnapshot.date} 保存的追价快照，共 {readOnlySnapshot.products.length} 行。切换追价策略或边际底线即可基于这批机型实时重算。
            </div>}
            {showWorkspaceControls && !(activeTab === 'workspace' && activeChannelId === 'tradeIn' && workspacePane === 'grades' && canEditWorkspace) && <DashboardStats
              products={activeCalculatedItems}
              marginBottomLine={effectiveMarginBottomLine}
              pricingMode={effectivePricingMode}
              channelId={activeChannelId}
            />}

            <div className={activeTab === 'history' ? 'min-w-0' : 'border border-[#141414] bg-white p-1'}>
              {activeTab === 'permissions' && isAdmin && <PermissionPanel />}
              {activeTab === 'tutorial' && canAccess(user, activeChannelId, 'tutorial') && <ProductTutorial tourTarget={tourOpen ? tourSteps[tourStepIndex]?.target : undefined} onStartTour={() => {
                setTourStepIndex(0);
                setActiveTab('tutorial');
                setTourOpen(true);
              }} />}
              {activeTab === 'workspace' && canViewWorkspace && (
                <>
                  {activeChannelId === 'tradeIn' && canEditWorkspace && <div className="flex gap-2 border-b border-[#141414] bg-[#F0EFEC] p-3">
                    <button className={`border border-[#141414] px-4 py-2 text-xs font-bold ${workspacePane === 'pricing' ? 'bg-[#141414] text-white' : 'bg-white'}`} onClick={() => setWorkspacePane('pricing')}>重点追价</button>
                    <button className={`border border-[#141414] px-4 py-2 text-xs font-bold ${workspacePane === 'grades' ? 'bg-[#141414] text-white' : 'bg-white'}`} onClick={() => setWorkspacePane('grades')}>等级推算</button>
                  </div>}
                  {activeChannelId === 'tradeIn' && canEditWorkspace && workspacePane === 'grades' ? <GradeExpansionPanel
                    products={gradeProducts}
                    subsidyRules={activeState.subsidyRules}
                    trackingBatchId={readOnlySnapshot?.id}
                    historyBatches={activeState.historyBatches}
                    onSaved={()=>refreshServerBatches(true)}
                    onViewHistory={canAccess(user, 'tradeIn', 'history') ? id => {
                      setSelectedHistoryBatchIds(previous => ({ ...previous, tradeIn: id }));
                      setActiveTab('history');
                    } : undefined}
                    workspaceVersion={readOnlySnapshot ? `共享快照 ${readOnlySnapshot.id}` : `竞争版本 V${activeState.competitionVersionIndex}`}
                    canUpload={canEditUpload}
                  /> : <>
                  <InvestmentRatePanel
                    products={gradeProducts}
                    showGradeInvestment={activeChannelId==='tradeIn'}
                    gradeInvestment={activeChannelId==='tradeIn'?investmentBatch?.gradeInvestment:undefined}
                    brandSalesAmounts30d={androidRevenueSnapshot?.brandSalesAmounts30d ?? investmentBatch?.investmentBrandSalesAmounts30d}
                    investmentRateInputs={effectiveInvestmentRateInputs}
                    onInvestmentRateInputsChange={setInvestmentRateInputs}
                    channelSalesLabel={activeChannel.channelSalesLabel}
                    readOnly={!canEditWorkspace || useSharedSnapshot}
                    automaticSnapshot={activeChannelId === 'tradeIn' && canEditWorkspace ? androidRevenueSnapshot : undefined}
                    automaticStatus={activeChannelId === 'tradeIn' && canEditWorkspace ? androidRevenueStatus : undefined}
                    automaticError={activeChannelId === 'tradeIn' && canEditWorkspace ? androidRevenueError : undefined}
                    onAutomaticRefresh={activeChannelId === 'tradeIn' && canEditWorkspace ? refreshAndroidRevenue : undefined}
                  />
                  <MainTable
                    readOnly={!canEditWorkspace || useSharedSnapshot}
                    strategyReadOnly={!canEditWorkspace}
                    products={activeCalculatedItems}
                    marginBottomLine={effectiveMarginBottomLine}
                    pricingMode={effectivePricingMode}
                    channelId={activeChannelId}
                    subsidyRules={activeState.subsidyRules}
                    selfSubsidyRules={activeState.selfSubsidyRules}
                    smallGapToleranceMargin={activeState.smallGapToleranceMargin}
                    handPriceMargin={activeState.handPriceMargin}
                    onHandPriceAction={handleHandPriceAction}
                    onUndoHandPrice={handleUndoHandPrice}
                    canUndoHandPrice={canUndoHandPrice}
                    onMarginChange={handleMarginChange}
                    onApplySmallGapTolerance={handleApplySmallGapTolerance}
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
                  </>}
                </>
              )}

              {activeTab === 'upload' && canAccess(user, activeChannelId, 'upload') && (canEditUpload ? (
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
              ) : <SharedSourcesPanel batch={latestSnapshot} />)}

              {activeTab === 'history' && canAccess(user, activeChannelId, 'history') && (
                <div key={activeChannelId}>
                <HistoryPanel
                  historyBatches={activeState.historyBatches}
                  selectedBatchId={selectedHistoryBatchIds[activeChannelId]}
                  onSelectBatch={id => setSelectedHistoryBatchIds(previous => ({ ...previous, [activeChannelId]: id }))}
                  onDeleteBatch={canEdit(user, activeChannelId, 'history') ? handleDeleteBatch : undefined}
                  channelName={activeChannel.name}
                />
                </div>
              )}

              {activeTab === 'competitiveness' && canAccess(user, activeChannelId, 'competitiveness') && (
                <CompetitivenessSummary
                  revealIssueDetails={tourOpen && tourSteps[tourStepIndex]?.target === 'audit-issue-details'}
                  historyBatches={activeState.historyBatches}
                  currentCalculatedItems={useSharedSnapshot ? [] : activeCalculatedItems}
                  activeSubsidyFileName={activeState.activeSubsidyFileName}
                  channelId={activeChannelId}
                  channelName={activeChannel.name}
                />
              )}

              {activeTab === 'tmHandGap' && canAccess(user, activeChannelId, 'tmHandGap') && (
                <TmHandPriceGapPanel
                  products={activeCalculatedItems}
                  channelName={activeChannel.name}
                  channelId={activeChannelId}
                />
              )}

              {activeTab === 'audit' && canAccess(user, activeChannelId, 'audit') && <AuditLogPanel channelId={activeChannelId} isAdmin={isAdmin} />}
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
        onSelect={goToTourStep}
        currentIndex={tourStepIndex}
        onPause={() => setTourOpen(false)}
        onFinish={finishTour}
        onNext={() => goToTourStep(tourStepIndex + 1)}
        onPrev={() => goToTourStep(tourStepIndex - 1)}
      />
    </div>
  );
}
