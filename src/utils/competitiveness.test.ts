import assert from 'node:assert/strict';
import { CalculatedProduct } from '../types';
import { calculateCompetitivenessMetrics } from './competitiveness';

const product = (
  quoteVolume: number,
  tmRecyclerQuotedPrice: number,
  postAhsTmRecyclerWin: boolean,
  zzHandPrice: number,
  postJdZzHandWin: boolean
) => ({
  quoteVolume,
  tmRecyclerQuotedPrice,
  postAhsTmRecyclerWin,
  zzHandPrice,
  postJdZzHandWin,
  tmPrice: 1,
  tmHandPrice: 1,
  zzPrice: 1,
  postTmItemWin: true,
  postTmHandWin: true,
  postZzItemWin: true,
  postAhsZzHandWin: true
} as CalculatedProduct);

const metrics = calculateCompetitivenessMetrics([
  product(30, 1180, true, 1100, false),
  product(70, 1480, false, 1300, true),
  product(100, 0, true, 0, true)
]);

assert.equal(metrics.ahsVsTmRecyclerScore, 30);
assert.equal(metrics.jdVsZzDirectScore, 70);

console.log('competitiveness metric checks passed');
