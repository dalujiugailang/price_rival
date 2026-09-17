export interface GradeVolumeRow {
  model: string; sku: string; skuId: string; level: string; ppv: string;
  quoteVolume: number | null; soldVolume: number | null; sourceRows: number[];
}
export interface GradeRule { template: string; rank: number; level: string; ratio: number }
export interface GradeSource {
  id: string; kind: 'volume' | 'template'; fileName: string; createdAt: string;
  periodStart: string; periodEnd: string; hash: string; rowCount: number;
  data?: { rows?: GradeVolumeRow[]; models?: Record<string,string>; rules?: GradeRule[] };
}
export interface GradePriceInput {
  id: string; ppv: string; skuId: string; model: string; level: string; price: number; newSeries: string;
  display?: Record<string,string|number|boolean|null>;
}
export interface GradeRequest {
  trackingBatchId?: string;
  volumeId: string; templateId: string; prices: GradePriceInput[]; skuIds: string[];
  priceChoices: Record<string, string>; workspaceVersion: string;
  subsidyRules?: Array<{newSeries:string;threshold:number;ahsInput:number;jdSubsidy:number}>;
}
export interface GradeOutputRow {
  priceBeforeOrder?:number;
  orderReference?:{ppv:string;skuId:string;level:string;rank:number;price:number;ratio:number};
  orderSteps?:Array<{round:number;reference:{ppv:string;skuId:string;level:string;rank:number;price:number;ratio:number};before:number;ratioTarget:number;roundedTarget:number|null;after:number|null;marginAfter:number|null}>;
  orderRemark?:string;
  model: string; sku: string; skuId: string; ppv: string; level: string; rank: number;
  template: string; ratio: number; anchorPpv: string; anchorPrice: number; anchorRatio: number;
  origin: '重点追价' | '等级推算'; targetPrice: number; price: number | null;
  ratioPrice?:number; marginFloor?:number; marginBeforeCorrection?:number|null; marginAfterCorrection?:number|null; marginRemark?:string;
  strategyPrice: number | null; adjustment: number | null;
  quoteVolume: number | null; soldVolume: number | null; investment: number | null;
  status: string[];
  newSeries?:string; sourcePriceId?:string;
  display?:Record<string,string|number|boolean|null>; displayStatus?:string[];
}
export interface GradeIssue { skuId: string; model: string; message: string }
export interface GradeSummary {
  coreInvestment: number; expansionInvestment: number; totalInvestment: number;
  pendingRows: number; adjustedRows: number; soldVolume: number;
}
export interface GradeRun {
  isFinal?:boolean;investmentConfirmedAt?:string;
  trackingBatchId?: string; savedAt?: string; parentRunId?: string;
  orderSummary?:{rounds:number;affectedSkus:number;correctedRows:number;unresolved:number;pendingRows:number};
  orderIssues?:Array<{skuId:string;model:string;higherPpv:string;lowerPpv:string;message:string}>;
  skippedSkus?:Array<{skuId:string;model:string;reason:string}>;
  id: string; title: string; createdAt: string; saved: boolean;
  request: GradeRequest; rows: GradeOutputRow[]; issues: GradeIssue[]; summary: GradeSummary;
  sources: { volume: GradeSource; template: GradeSource };
  dailyPriceDate: string; dailyPriceFetchedAt: string;
  presentationVersion?:number;
  pricingVersion?:number;
}
export type GradeRunSummary = Pick<GradeRun,'id'|'title'|'createdAt'|'saved'|'savedAt'|'isFinal'|'investmentConfirmedAt'>;
export interface GradeRunEvent { id:number; runId:string; title:string; action:string; createdAt:string; actorName:string }
