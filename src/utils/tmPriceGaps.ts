interface TmPriceGapInput {
  jdPrice: number;
  jdHandPrice: number;
  recommendJdPrice: number;
  postJdHandPrice: number;
  tmPrice: number;
  tmHandPrice: number;
}

export interface TmPriceGaps {
  preItemGap: number | null;
  preHandGap: number | null;
  postItemGap: number | null;
  postHandGap: number | null;
}

export const getTmPriceGaps = (input: TmPriceGapInput): TmPriceGaps => ({
  preItemGap: input.tmPrice > 0 ? input.jdPrice - input.tmPrice : null,
  preHandGap: input.tmHandPrice > 0 ? input.jdHandPrice - input.tmHandPrice : null,
  postItemGap: input.tmPrice > 0 ? input.recommendJdPrice - input.tmPrice : null,
  postHandGap: input.tmHandPrice > 0 ? input.postJdHandPrice - input.tmHandPrice : null
});
