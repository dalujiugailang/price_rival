import {
  CalculatedProduct,
  ChannelConfig,
  SelfOperatedSubsidyRule,
  SubsidyRule
} from '../types';
import {
  applyManualRecommendedPrice,
  formatPercent,
  formatRMB,
  getRoundedCompetitivePrice
} from './formulas';

const SMALL_GAP_THRESHOLD = 20;

const round2 = (value: number) => Math.round(value * 100) / 100;

const topTwentyPercentThreshold = (values: number[]) => {
  const sorted = values.filter(value => value > 0).sort((a, b) => b - a);
  if (sorted.length === 0) return 0;
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.2) - 1)] || 0;
};

interface SmallGapToleranceOptions {
  products: CalculatedProduct[];
  toleranceMargin: number;
  subsidyRules: SubsidyRule[];
  channel: ChannelConfig;
  selfSubsidyRules?: SelfOperatedSubsidyRule[];
}

export const evaluateSmallGapTolerance = ({
  products,
  toleranceMargin,
  subsidyRules,
  channel,
  selfSubsidyRules = []
}: SmallGapToleranceOptions): CalculatedProduct[] => {
  if (channel.id !== 'tradeIn') return products;

  const quoteThreshold = topTwentyPercentThreshold(products.map(product => product.quoteVolume || 0));
  const soldThreshold = topTwentyPercentThreshold(products.map(product => product.soldVolume || 0));

  return products.map(product => {
    const hasTmPrice = product.tmPrice > 0;
    const hasRecommendAdjustment = round2(product.recommendAdjustment) !== 0;
    const alreadyWonBefore = hasTmPrice && product.jdPrice >= product.tmPrice;
    const alreadyWonAfter = hasTmPrice && product.recommendJdPrice >= product.tmPrice;
    if (!hasTmPrice || !hasRecommendAdjustment || alreadyWonBefore || alreadyWonAfter) return product;

    const gapToTm = round2(product.tmPrice - product.recommendJdPrice);
    if (gapToTm <= 0 || gapToTm > SMALL_GAP_THRESHOLD) return product;

    const tolerancePrice = getRoundedCompetitivePrice(product.tmPrice, product.tmPrice);
    if (tolerancePrice <= 0) return product;

    const simulated = applyManualRecommendedPrice(
      product,
      tolerancePrice,
      toleranceMargin,
      subsidyRules,
      { channel, selfSubsidyRules }
    );
    const toleranceEligible = simulated.postMarginalProfit >= toleranceMargin;
    const highQuoteVolume = quoteThreshold > 0 && product.quoteVolume >= quoteThreshold;
    const highSoldVolume = soldThreshold > 0 && (product.soldVolume || 0) >= soldThreshold;
    const valueText = highQuoteVolume || highSoldVolume ? '高价值小差额提醒' : '小差额提醒';
    const volumeText = [
      highQuoteVolume ? '报价量Top20%' : '',
      highSoldVolume ? '成交量Top20%' : ''
    ].filter(Boolean).join('、');
    const note = [
      `${valueText}：距tm裸机价差${gapToTm}元${volumeText ? `，${volumeText}` : ''}`,
      `取整容忍价${formatRMB(tolerancePrice)}`,
      `试算追后边际${formatPercent(simulated.postMarginalProfit)}`,
      toleranceEligible ? '可容忍' : '低于容忍底线'
    ].join('；');

    return {
      ...product,
      smallGapOpportunity: true,
      smallGapOpportunityRemark: note,
      smallGapTolerancePrice: tolerancePrice,
      smallGapToleranceMargin: simulated.postMarginalProfit,
      smallGapToleranceEligible: toleranceEligible
    };
  });
};

export const getSmallGapTolerancePrices = (products: CalculatedProduct[]) => Object.fromEntries(
  products
    .filter(product => product.smallGapToleranceEligible && Number.isFinite(product.smallGapTolerancePrice))
    .map(product => [product.ppv, product.smallGapTolerancePrice as number])
);
