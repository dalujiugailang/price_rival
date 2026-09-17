/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BrandCompetitionInvestmentMetrics,
  BrandSalesAmount30d,
  CalculatedProduct,
  CompetitionInvestmentMetrics,
  InvestmentRateInputs,
  GradeInvestmentContribution
} from '../types';
import { resolveCompetitivenessBrand } from './brandCompetitiveness';

const round2 = (value: number) => Math.round(value * 100) / 100;

export const calculateCompetitionInvestmentMetrics = (
  products: CalculatedProduct[],
  inputs: InvestmentRateInputs,
  gradeInvestment?: GradeInvestmentContribution
): CompetitionInvestmentMetrics => {
  const adjustedRows = products.filter(product => product.recommendAdjustment > 0);
  const extra=gradeInvestment?.confirmedAt ? gradeInvestment : undefined;
  const adjustedPpvCount = adjustedRows.length+(extra?.ppvCount||0);
  const adjustedDealVolume30d = adjustedRows.reduce((sum, product) => sum + (product.soldVolume || 0), 0)+(extra?.soldVolume||0);
  const estimatedInvestmentAmount = adjustedRows.reduce((sum, product) => (
    sum + product.recommendAdjustment * (product.soldVolume || 0)
  ), 0)+(extra?.amount||0);

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
  brandSalesAmounts30d: BrandSalesAmount30d[],
  gradeInvestment?: GradeInvestmentContribution
): BrandCompetitionInvestmentMetrics[] => {
  const extra=gradeInvestment?.confirmedAt ? gradeInvestment : undefined;
  const sources=new Map(brandSalesAmounts30d.map(b=>[b.brand,b]));
  for(const brand of [...products.map(p=>resolveCompetitivenessBrand(p)||'未识别品牌'),...(extra?.byBrand||[]).map(b=>b.brand)]) {
    if(!sources.has(brand))sources.set(brand,{brand,displayName:brand,salesAmount30d:0});
  }
  return [...sources.values()].map(source => {
  const brandProducts = products.filter(product => (resolveCompetitivenessBrand(product)||'未识别品牌') === source.brand);
  const metrics = calculateCompetitionInvestmentMetrics(brandProducts, {
    androidSalesAmount30d: source.salesAmount30d,
    androidJdTradeInSalesAmount30d: source.salesAmount30d
  });
  const grade=extra?.byBrand.find(b=>b.brand===source.brand);
  const total=round2(metrics.estimatedInvestmentAmount+(grade?.amount||0));
  return {
    ...source,
    workspaceRowCount: brandProducts.length,
    adjustedPpvCount: metrics.adjustedPpvCount+(grade?.ppvCount||0),
    adjustedDealVolume30d: metrics.adjustedDealVolume30d+(grade?.soldVolume||0),
    coreInvestmentAmount:metrics.estimatedInvestmentAmount,
    gradeInvestmentAmount:grade?.amount||0,
    pendingGradeRows:grade?.pendingRows||0,
    estimatedInvestmentAmount:total,
    investmentRate:source.salesAmount30d>0?total/source.salesAmount30d:null
  };
  });
};
