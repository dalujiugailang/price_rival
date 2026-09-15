/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BrandCompetitionInvestmentMetrics,
  BrandSalesAmount30d,
  CalculatedProduct,
  CompetitionInvestmentMetrics,
  InvestmentRateInputs
} from '../types';
import { resolveCompetitivenessBrand } from './brandCompetitiveness';

const round2 = (value: number) => Math.round(value * 100) / 100;

export const calculateCompetitionInvestmentMetrics = (
  products: CalculatedProduct[],
  inputs: InvestmentRateInputs
): CompetitionInvestmentMetrics => {
  const adjustedRows = products.filter(product => product.recommendAdjustment > 0);
  const adjustedPpvCount = adjustedRows.length;
  const adjustedDealVolume30d = adjustedRows.reduce((sum, product) => sum + (product.soldVolume || 0), 0);
  const estimatedInvestmentAmount = adjustedRows.reduce((sum, product) => (
    sum + product.recommendAdjustment * (product.soldVolume || 0)
  ), 0);

  return {
    adjustedPpvCount,
    adjustedDealVolume30d,
    estimatedInvestmentAmount: round2(estimatedInvestmentAmount),
    androidOverallRate: inputs.androidSalesAmount30d > 0 ? estimatedInvestmentAmount / inputs.androidSalesAmount30d : 0,
    androidJdTradeInRate: inputs.androidJdTradeInSalesAmount30d > 0 ? estimatedInvestmentAmount / inputs.androidJdTradeInSalesAmount30d : 0
  };
};

export const calculateBrandCompetitionInvestmentMetrics = (
  products: CalculatedProduct[],
  brandSalesAmounts30d: BrandSalesAmount30d[]
): BrandCompetitionInvestmentMetrics[] => brandSalesAmounts30d.map(source => {
  const brandProducts = products.filter(product => resolveCompetitivenessBrand(product) === source.brand);
  const metrics = calculateCompetitionInvestmentMetrics(brandProducts, {
    androidSalesAmount30d: source.salesAmount30d,
    androidJdTradeInSalesAmount30d: source.salesAmount30d
  });
  return {
    ...source,
    workspaceRowCount: brandProducts.length,
    adjustedPpvCount: metrics.adjustedPpvCount,
    adjustedDealVolume30d: metrics.adjustedDealVolume30d,
    estimatedInvestmentAmount: metrics.estimatedInvestmentAmount,
    investmentRate: metrics.androidJdTradeInRate
  };
});
