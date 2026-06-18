/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Product {
  id: string;
  sourceSheet: string;
  sourceRowNumber: number;
  sourceFieldCount: number;
  rawFields: Record<string, string | number | boolean | null>;
  newSeries: string;
  oldModel: string;
  ppv: string;
  brand: string;
  level: string;
  skuId: number;
  levelId?: string;
  quoteVolume: number;
  soldVolume?: number;
  description: string;

  jdPrice: number;          // J 京东物品裸机价
  ahsInput: number;         // K 对应新品型号 AHS 投入
  jdSubsidy: number;        // M 京东总补贴
  tmPrice: number;          // O 天猫裸机价
  tmSubsidyManual: number;  // P 天猫总补贴-人工
  tmSubsidySheet: number;   // Q 天猫总补贴-线下表
  zzPrice: number;          // T 转转裸机价
  basePrice: number;        // AG 基准价

  manualOperator?: string;
  manualUpdateTime?: string;
}

export interface SubsidyRow {
  ppv: string;
  brand: string;
  model: string;
  generalSubsidy: number;
  tradeInSubsidy: number;
  incentiveSubsidy: number;
  effectiveDate: string;
  remarks?: string;
}

export interface DailyPriceRow {
  ppv: string;
  biBasePrice: number;
  costPrice: number;
  levelId: string;
  rawFields: Record<string, string | number | boolean | null>;
}

export interface SubsidyRule {
  newSeries: string;
  threshold: number;
  ahsInput: number;
  jdSubsidy: number;
  rawFields: Record<string, string | number | boolean | null>;
}

export type PricingMode = 'margin' | 'fullCompetition';

export interface CompetitivenessMetrics {
  tmItemScore: number;
  tmDirectScore: number;
  zzItemScore: number;
  ahsVsZzDirectScore: number;
}

export interface InvestmentRateInputs {
  androidSalesAmount30d: number;
  androidJdTradeInSalesAmount30d: number;
}

export interface CompetitionInvestmentMetrics {
  adjustedPpvCount: number;
  adjustedDealVolume30d: number;
  estimatedInvestmentAmount: number;
  androidOverallRate: number;
  androidJdTradeInRate: number;
}

export interface ManualPriceRow {
  ppv: string;
  tmPrice: number;
  tmSubsidyManual: number;
  zzPrice: number;
  rawFields: Record<string, string | number | boolean | null>;
}

export interface SourceUploadRecord {
  id: string;
  type: 'base' | 'dailyPrice' | 'subsidy' | 'manualPrice' | 'competitivenessHistory';
  fileName: string;
  uploadedAt: string;
  rowCount: number;
  matchedCount?: number;
  remarks?: string;
}

export interface CalculatedProduct extends Product {
  ahsQuotedPrice: number;       // L = J + K
  jdHandPrice: number;          // N = J + M
  tmHandPrice: number;          // S = O + P
  zzCoupon: number;             // AH zz券
  zzHandPrice: number;          // AI zz券后价

  jdVsTmItemGap: number;        // W = J - O
  jdVsTmHandGap: number;        // X = N - S
  jdVsZzItemGap: number;        // Y = J - T
  ahsVsZzHandGap: number;       // Z = L - V
  jdVsZzHandGap: number;        // AA = N - V

  tmItemWin: boolean;           // AB
  tmHandWin: boolean;           // AC
  zzItemWin: boolean;           // AD
  ahsZzHandWin: boolean;        // AE
  jdZzHandWin: boolean;         // AF

  preGrossMargin: number;       // AH = 1 - L / AG
  preLinearCost: number;        // AI = L * 4.66% + AG * 2.18% + 81
  preMarginalProfit: number;    // AJ = 1 - (L + AI) / AG
  preGapRate: number;           // AK = W / AG

  recommendJdPrice: number;     // AL 线上推荐追价后京东物品价
  recommendAdjustment: number;  // AM = AL - J
  ahsSubsidyAfter: number;      // AN
  postAhsPrice: number;         // AO = AL + AN
  postLinearCost: number;       // AP
  postGrossMargin: number;      // AQ
  postMarginalProfit: number;   // AR
  postJdHandPrice: number;      // AS

  postTmItemWin: boolean;       // AT
  postTmHandWin: boolean;       // AU
  postZzItemWin: boolean;       // BI
  postAhsZzHandWin: boolean;    // BJ

  targetCompetitorPrice: number;
  maxPriceByMargin: number;
  riskWarning: 'SAFE' | 'WARNING' | 'CRITICAL';
  hasSpace: boolean;
  pricingRemark: string;

  // Compatibility aliases used by history and summary components.
  model: string;
  category: string;
  baseCost: number;
  currentPrice: number;
  totalSubsidy: number;
  competitorLowestPrice: number;
  competitorLowestSource: string;
  minAllowedPrice: number;
  isBelowBottomLine: boolean;
  maxTrackSpace: number;
  recommendPrice: number;
  estMarginRate: number;
  generalSubsidy: number;
  tradeInSubsidy: number;
  incentiveSubsidy: number;
  tmSubsidy: number;
}

export interface TrackingBatch {
  id: string;
  date: string;
  operator: string;
  dataDate: string;
  marginBottomLine: number;
  pricingMode?: PricingMode;
  products: CalculatedProduct[];
  remarks?: string;
  subsidyFileName?: string;
  subsidyUploadTime?: string;
  isCompetitivenessConfirmed?: boolean;
  competitivenessDate?: string;
  pricingTimestamp?: string;
  confirmedAt?: string;
  competitivenessMetrics?: CompetitivenessMetrics;
  investmentRateInputs?: InvestmentRateInputs;
  investmentRateMetrics?: CompetitionInvestmentMetrics;
  isSummaryOnly?: boolean;
}

export interface OperationsLog {
  id: string;
  timestamp: string;
  operator: string;
  action: string;
  module: string;
  details: string;
}
