export const TM_RECYCLER_SUBSIDY_RULES = [
  { threshold: 200, subsidy: 45 },
  { threshold: 300, subsidy: 45 },
  { threshold: 400, subsidy: 90 },
  { threshold: 500, subsidy: 90 },
  { threshold: 800, subsidy: 180 },
  { threshold: 1000, subsidy: 180 },
  { threshold: 1200, subsidy: 280 },
  { threshold: 2000, subsidy: 350 },
  { threshold: 3000, subsidy: 350 },
  { threshold: 3500, subsidy: 480 },
  { threshold: 5000, subsidy: 630 }
];

const finiteNumber = value => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

export const tmRecyclerSubsidyAtPrice = priceValue => {
  const price = finiteNumber(priceValue);
  if (price < TM_RECYCLER_SUBSIDY_RULES[0].threshold) return 0;
  return TM_RECYCLER_SUBSIDY_RULES.filter(rule => price >= rule.threshold).at(-1)?.subsidy || 0;
};

const weightedScore = (products, isEligible, isCompetitive) => {
  const eligible = products.filter(isEligible);
  const totalQuoteVolume = eligible.reduce((sum, product) => sum + Math.max(0, finiteNumber(product.quoteVolume)), 0);
  if (totalQuoteVolume <= 0) return 0;
  const competitiveQuoteVolume = eligible
    .filter(isCompetitive)
    .reduce((sum, product) => sum + Math.max(0, finiteNumber(product.quoteVolume)), 0);
  return Math.round((competitiveQuoteVolume / totalQuoteVolume) * 1000) / 10;
};

export const backfillTmRecyclerCompetitivenessBatch = batch => {
  if (!batch || (batch.channelId && batch.channelId !== 'tradeIn')) return batch;

  const products = Array.isArray(batch.products) ? batch.products : [];
  if (batch.isSummaryOnly || products.length === 0) {
    return {
      ...batch,
      competitivenessMetrics: batch.competitivenessMetrics
        ? {
            ...batch.competitivenessMetrics,
            ahsVsTmRecyclerScore: batch.competitivenessMetrics.ahsVsTmRecyclerScore ?? null,
            jdVsZzDirectScore: batch.competitivenessMetrics.jdVsZzDirectScore ?? null
          }
        : batch.competitivenessMetrics
    };
  }

  const nextProducts = products.map(product => {
    const tmPrice = finiteNumber(product.tmPrice);
    const tmRecyclerSubsidy = tmRecyclerSubsidyAtPrice(tmPrice);
    const tmRecyclerQuotedPrice = tmPrice > 0 ? tmPrice + tmRecyclerSubsidy : 0;
    const postAhsPrice = finiteNumber(product.postAhsPrice);
    const postJdHandPrice = finiteNumber(product.postJdHandPrice);
    const zzHandPrice = finiteNumber(product.zzHandPrice);
    return {
      ...product,
      tmRecyclerSubsidy,
      tmRecyclerQuotedPrice,
      postAhsTmRecyclerWin: tmRecyclerQuotedPrice > 0 && postAhsPrice >= tmRecyclerQuotedPrice,
      postJdZzHandWin: zzHandPrice > 0 && postJdHandPrice >= zzHandPrice
    };
  });

  const competitivenessMetrics = {
    ...(batch.competitivenessMetrics || {}),
    ahsVsTmRecyclerScore: weightedScore(
      nextProducts,
      product => product.tmRecyclerQuotedPrice > 0,
      product => product.postAhsTmRecyclerWin
    ),
    jdVsZzDirectScore: weightedScore(
      nextProducts,
      product => finiteNumber(product.zzHandPrice) > 0,
      product => product.postJdZzHandWin
    )
  };

  return { ...batch, products: nextProducts, competitivenessMetrics };
};
