import assert from 'node:assert/strict';
import {
  backfillTmRecyclerCompetitivenessBatch,
  tmRecyclerSubsidyAtPrice
} from '../shared/tmRecyclerCompetitiveness.mjs';

assert.deepEqual(
  [199, 200, 299, 300, 399, 400, 799, 800, 1199, 1200, 3499, 3500, 4999, 5000, 9999]
    .map(tmRecyclerSubsidyAtPrice),
  [0, 45, 45, 45, 45, 90, 90, 180, 180, 280, 350, 480, 480, 630, 630]
);

const backfilled = backfillTmRecyclerCompetitivenessBatch({
  channelId: 'tradeIn',
  products: [
    { tmPrice: 1000, postAhsPrice: 1180, zzHandPrice: 1100, postJdHandPrice: 1099, quoteVolume: 30 },
    { tmPrice: 1200, postAhsPrice: 1479, zzHandPrice: 1300, postJdHandPrice: 1300, quoteVolume: 70 },
    { tmPrice: 0, postAhsPrice: 9999, zzHandPrice: 0, postJdHandPrice: 9999, quoteVolume: 100 }
  ],
  competitivenessMetrics: { tmItemScore: 1, tmDirectScore: 2, zzItemScore: 3, ahsVsZzDirectScore: 4 }
});

assert.equal(backfilled.products[0].tmRecyclerSubsidy, 180);
assert.equal(backfilled.products[0].tmRecyclerQuotedPrice, 1180);
assert.equal(backfilled.products[0].postAhsTmRecyclerWin, true);
assert.equal(backfilled.products[0].postJdZzHandWin, false);
assert.equal(backfilled.competitivenessMetrics.ahsVsTmRecyclerScore, 30);
assert.equal(backfilled.competitivenessMetrics.jdVsZzDirectScore, 70);
assert.equal(backfilled.competitivenessMetrics.tmItemScore, 1);

const summaryOnly = backfillTmRecyclerCompetitivenessBatch({
  channelId: 'tradeIn',
  isSummaryOnly: true,
  products: [],
  competitivenessMetrics: { tmItemScore: 1, tmDirectScore: 2, zzItemScore: 3, ahsVsZzDirectScore: 4 }
});
assert.equal(summaryOnly.competitivenessMetrics.ahsVsTmRecyclerScore, null);
assert.equal(summaryOnly.competitivenessMetrics.jdVsZzDirectScore, null);

console.log('tm recycler competitiveness checks passed');
