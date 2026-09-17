import { gradeBatchMismatch } from './gradeHistory.mjs';
const round=value=>Math.round(value*100)/100;
const aliases={redmi:'小米',xiaomi:'小米',huawei:'华为',honor:'荣耀',iqoo:'iQOO',oppo:'OPPO',vivo:'vivo',realme:'真我',oneplus:'一加',samsung:'三星',motorola:'摩托罗拉',nubia:'努比亚'};
const brandOf=(row,source)=>{
  const raw=Object.entries(source?.rawFields||{}).find(([key])=>['品牌名称','品牌','brandname','brand'].includes(key.replace(/^[A-Z]+_/,'').replace(/\s+/g,'').toLowerCase()))?.[1];
  const explicit=String(raw || row.display?.brand || source?.brand || '').trim();
  const prefix=String(row.model || '').match(/^(华为|荣耀|摩托罗拉|努比亚|红魔|三星|小米|一加|真我|iQOO|OPPO|vivo|Redmi|Huawei|Honor|Motorola|Nubia|Samsung|Xiaomi|OnePlus|realme)(?=\s|\d|[^a-zA-Z]|$)/i)?.[1] || '';
  const brand=explicit || prefix;
  return aliases[brand.toLowerCase()] || (brand==='红魔'?'努比亚':brand) || '未识别品牌';
};

// Only newly inferred PPVs contribute. Core prices already appear in the core fee.
export function gradeInvestmentContribution(run,products=[]) {
  if(!run?.saved || !run.isFinal || !run.investmentConfirmedAt)return null;
  const brands=new Map();
  const seen=new Set();
  const sources=new Map(products.map(p=>[p.id,p]));
  for(const row of run.rows) {
    if(row.origin!=='等级推算')continue;
    const key=JSON.stringify([row.skuId,row.level]);
    if(seen.has(key))continue;
    seen.add(key);
    const brand=brandOf(row,sources.get(row.sourcePriceId)), total=brands.get(brand)||{brand,amount:0,ppvCount:0,soldVolume:0,pendingRows:0};
    if(row.investment==null || !Number.isFinite(row.investment))total.pendingRows++;
    else if(row.investment>0){total.amount+=row.investment;total.ppvCount++;total.soldVolume+=row.soldVolume || 0;}
    brands.set(brand,total);
  }
  const byBrand=[...brands.values()].map(b=>({...b,amount:round(b.amount)}));
  return {runId:run.id,confirmedAt:run.investmentConfirmedAt,amount:round(byBrand.reduce((sum,b)=>sum+b.amount,0)),
    ppvCount:byBrand.reduce((sum,b)=>sum+b.ppvCount,0),soldVolume:byBrand.reduce((sum,b)=>sum+b.soldVolume,0),
    pendingRows:byBrand.reduce((sum,b)=>sum+b.pendingRows,0),unmatchedSkus:run.issues?.length||0,byBrand};
}

export function withGradeInvestment(batch,run) {
  const contribution=(batch.channelId || 'tradeIn')==='tradeIn' && run?.trackingBatchId===batch.id && !gradeBatchMismatch(run.request,batch)
    ? gradeInvestmentContribution(run,batch.products) : null;
  const core=batch.investmentRateMetrics;
  const revenue=contribution ? run.investmentRevenue : null;
  const inputs=revenue ? {androidSalesAmount30d:revenue.androidSalesAmount30d,androidJdTradeInSalesAmount30d:revenue.androidJdTradeInSalesAmount30d} : batch.investmentRateInputs;
  const amount=core?.estimatedInvestmentAmount + (contribution?.amount||0);
  return {...batch,gradeInvestment:contribution || undefined,
    gradeFinalRunId:run?.isFinal ? run.id : undefined,
    investmentBrandSalesAmounts30d:revenue?.brandSalesAmounts30d || batch.investmentBrandSalesAmounts30d || [],
    totalInvestmentRateInputs:contribution ? inputs : undefined,
    gradeInvestmentRevenueDate:revenue?.dataDate,
    totalInvestmentRateMetrics:contribution && core && inputs ? {...core,
      estimatedInvestmentAmount:round(amount),adjustedPpvCount:core.adjustedPpvCount+contribution.ppvCount,
      adjustedDealVolume30d:core.adjustedDealVolume30d+contribution.soldVolume,
      androidOverallRate:inputs.androidSalesAmount30d>0?amount/inputs.androidSalesAmount30d:null,
      androidJdTradeInRate:inputs.androidJdTradeInSalesAmount30d>0?amount/inputs.androidJdTradeInSalesAmount30d:null
    } : undefined};
}
