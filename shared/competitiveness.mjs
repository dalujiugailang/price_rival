/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
export const emptyCompetitivenessMetrics = () => ({
    tmItemScore: 0,
    tmDirectScore: 0,
    zzItemScore: 0,
    ahsVsZzDirectScore: 0,
    ahsVsTmRecyclerScore: null,
    jdVsZzDirectScore: 0
});
const weightedScore = (products, isEligible, isCompetitive) => {
    const eligible = products.filter(isEligible);
    const totalQuoteVolume = eligible.reduce((sum, product) => sum + Math.max(0, product.quoteVolume || 0), 0);
    if (totalQuoteVolume <= 0)
        return 0;
    const competitiveQuoteVolume = eligible
        .filter(isCompetitive)
        .reduce((sum, product) => sum + Math.max(0, product.quoteVolume || 0), 0);
    return Math.round((competitiveQuoteVolume / totalQuoteVolume) * 1000) / 10;
};
export const calculateCompetitivenessMetrics = (products, channelId = 'tradeIn') => {
    if (!products || products.length === 0)
        return emptyCompetitivenessMetrics();
    const zzItemScore = weightedScore(products, p => p.zzPrice > 0, p => p.postZzItemWin);
    const ahsVsZzDirectScore = weightedScore(products, p => p.zzHandPrice > 0, p => p.postAhsZzHandWin);
    const jdVsZzDirectScore = weightedScore(products, p => p.zzHandPrice > 0, p => p.postJdZzHandWin);
    if (channelId === 'selfOperated') {
        return {
            tmItemScore: 0,
            tmDirectScore: 0,
            zzItemScore,
            ahsVsZzDirectScore,
            ahsVsTmRecyclerScore: null,
            jdVsZzDirectScore
        };
    }
    return {
        tmItemScore: weightedScore(products, p => p.tmPrice > 0, p => p.postTmItemWin),
        tmDirectScore: weightedScore(products, p => p.tmHandPrice > 0, p => p.postTmHandWin),
        ahsVsTmRecyclerScore: null,
        zzItemScore,
        ahsVsZzDirectScore,
        jdVsZzDirectScore
    };
};
