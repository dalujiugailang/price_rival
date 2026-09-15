import assert from 'node:assert/strict';
import { CalculatedProduct } from '../types';
import { calculateBrandCompetitionInvestmentMetrics } from './investment';

const product = (
  brand: string,
  recommendAdjustment: number,
  soldVolume: number,
  rawFields: Record<string, string> = {}
) => ({ brand, recommendAdjustment, soldVolume, rawFields } as CalculatedProduct);

const rows = calculateBrandCompetitionInvestmentMetrics([
  product('小米', 10, 5, { 'BK_品牌名称': 'iQOO' }),
  product('荣耀', 20, 2),
  product('荣耀', 0, 100),
  product('realme', 3, 4)
], [
  { brand: 'iQOO', displayName: 'iQOO', salesAmount30d: 1000 },
  { brand: '荣耀', displayName: '荣耀', salesAmount30d: 2000 },
  { brand: '真我', displayName: 'realme／真我', salesAmount30d: 600 }
]);

assert.deepEqual(rows.map(row => ({
  brand: row.brand,
  workspaceRowCount: row.workspaceRowCount,
  adjustedPpvCount: row.adjustedPpvCount,
  estimatedInvestmentAmount: row.estimatedInvestmentAmount,
  investmentRate: row.investmentRate
})), [
  { brand: 'iQOO', workspaceRowCount: 1, adjustedPpvCount: 1, estimatedInvestmentAmount: 50, investmentRate: 0.05 },
  { brand: '荣耀', workspaceRowCount: 2, adjustedPpvCount: 1, estimatedInvestmentAmount: 40, investmentRate: 0.02 },
  { brand: '真我', workspaceRowCount: 1, adjustedPpvCount: 1, estimatedInvestmentAmount: 12, investmentRate: 0.02 }
]);

console.log('Brand investment rate: BK brand grouping, numerator and denominator passed.');
