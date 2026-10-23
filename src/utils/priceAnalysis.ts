import {resolveCompetitivenessBrand, resolveCompetitivenessSeries} from './brandCompetitiveness';
import {applyManualRecommendedPrice} from './formulas';
import {CalculatedProduct, TrackingBatch} from '../types';
import {snapshotPricingTimeLabel} from './snapshotHistory';
type IdentityProduct = Pick<CalculatedProduct, 'brand' | 'newSeries'> & Partial<CalculatedProduct>;
const identities = new WeakMap<IdentityProduct, {brand: string; newSeries: string}>();
export function analysisIdentity(product: IdentityProduct) {
  let identity = identities.get(product);
  if (!identity) {
    identity = {brand: resolveCompetitivenessBrand(product as CalculatedProduct), newSeries: resolveCompetitivenessSeries(product as CalculatedProduct)};
    identities.set(product, identity);
  }
  return identity;
}
export function analysisHierarchy(batches: TrackingBatch[]) {
  const hierarchy = new Map<string, Set<string>>();
  for (const batch of batches) for (const product of batch.products) {
    const {brand, newSeries} = analysisIdentity(product);
    if (!brand) continue;
    if (!hierarchy.has(brand)) hierarchy.set(brand, new Set());
    if (newSeries) hierarchy.get(brand)!.add(newSeries);
  }
  return new Map([...hierarchy].sort(([a], [b]) => a.localeCompare(b, 'zh-CN')).map(([brand, series]) => [brand, [...series].sort((a, b) => a.localeCompare(b, 'zh-CN'))]));
}
export const matchesAnalysisScope = (product: IdentityProduct, brand = '', newSeries = '') => {
  const identity = analysisIdentity(product);
  return (!brand || identity.brand === brand) && (!newSeries || identity.newSeries === newSeries);
};
// Compare against the explicitly selected reference, with its fixed weights and metadata.
export const comparisonScope = (comparison: TrackingBatch, baseline: TrackingBatch) => ({
  rows: comparePrices(baseline, comparison), batches: [baseline, comparison]
});
export const metrics = [
  ['basePrice','基准价'], ['recommendJdPrice','京东物品价－追价后'],
  ['totalSubsidy','对应新品型号jd总投入－追价后'], ['postJdHandPrice','jd总到手价－追价后'],
  ['tmPrice','tm裸机价'], ['tmSubsidyManual','tm总补贴－人工'], ['tmHandPrice','tm总到手价']
] as const;
export type Metric = typeof metrics[number][0];
export const value = (p: CalculatedProduct | undefined, key: Metric): number | null => {
  const n = p?.[key];
  return typeof n === 'number' && Number.isFinite(n) && (key === 'totalSubsidy' || key === 'tmSubsidyManual' ? n >= 0 : n > 0) ? n : null;
};
// Saved snapshots are immutable. Object-keyed caches are reclaimed when history is replaced.
const timeLabels = new WeakMap<TrackingBatch, string>();
export function analysisTimeLabel(batch: TrackingBatch) {
  let label = timeLabels.get(batch);
  if (label === undefined) { label = snapshotPricingTimeLabel(batch); timeLabels.set(batch, label); }
  return label;
}
type PpvIndex = {rows: Map<string, CalculatedProduct>; conflicts: Set<string>; missing: number};
const ppvIndexes = new WeakMap<TrackingBatch, PpvIndex>();
export function indexPpv(batch: TrackingBatch): PpvIndex {
  const cached = ppvIndexes.get(batch);
  if (cached) return cached;
  const rows = new Map<string, CalculatedProduct>();
  const conflicts = new Set<string>();
  let missing = 0;
  for (const p of batch.products) {
    if (!p.ppv?.trim()) { missing++; continue; }
    if (rows.has(p.ppv)) conflicts.add(p.ppv);
    else rows.set(p.ppv,p);
  }
  for (const key of conflicts) rows.delete(key);
  const result = {rows, conflicts, missing};
  ppvIndexes.set(batch, result);
  return result;
}
export const chronological = (batches: TrackingBatch[]) => [...batches].sort((a,b)=>analysisTimeLabel(a).localeCompare(analysisTimeLabel(b)) || a.id.localeCompare(b.id));
export function comparePrices(a: TrackingBatch, b: TrackingBatch) {
  const ia=indexPpv(a), ib=indexPpv(b);
  return [...new Set([...ia.rows.keys(),...ib.rows.keys()])].filter(k=>!ia.conflicts.has(k)&&!ib.conflicts.has(k)).map(ppv=>({ppv,a:ia.rows.get(ppv),b:ib.rows.get(ppv)}));
}
export function aggregate(batches: TrackingBatch[], brand = '', newSeries = '') {
  if (!batches.length) return {points:[],count:0,coverage:0};
  const indexes=batches.map(indexPpv), first=indexes[0].rows;
  const universe=[...first.values()].filter(p=>matchesAnalysisScope(p,brand,newSeries));
  const validWeight=(p:CalculatedProduct)=>Number.isFinite(p.quoteVolume)&&p.quoteVolume>0?p.quoteVolume:0;
  const total=universe.reduce((s,p)=>s+validWeight(p),0);
  // One fixed basket for all seven metrics and all periods preserves additive attribution.
  const basket=universe.filter(p=>validWeight(p)>0&&indexes.every(i=>{
    const row=i.rows.get(p.ppv); return row&&metrics.every(([key])=>value(row,key)!==null);
  }));
  const weight=basket.reduce((s,p)=>s+p.quoteVolume,0);
  const points=batches.map((batch,i)=>{
    const point:Record<string,string|number|null>={name:analysisTimeLabel(batch),batch:batch.id};
    for(const [key] of metrics) {
      point[key]=weight?basket.reduce((s,p)=>s+p.quoteVolume*value(indexes[i].rows.get(p.ppv),key)!,0)/weight:null;
      point[key+'Abs']=weight?basket.reduce((s,p)=>s+p.quoteVolume*Math.abs(value(indexes[i].rows.get(p.ppv),key)!-value(first.get(p.ppv),key)!),0)/weight:null;
    }
    for(const [key,jk,tk] of [['itemWin','recommendJdPrice','tmPrice'],['handWin','postJdHandPrice','tmHandPrice']] as const) {
      point[key]=weight?basket.reduce((s,p)=>s+p.quoteVolume*(value(indexes[i].rows.get(p.ppv),jk)!>=value(indexes[i].rows.get(p.ppv),tk)!?1:0),0)/weight:null;
    }
    return point;
  });
  return {points,count:basket.length,coverage:total?weight/total:null};
}
export function advice(batch: TrackingBatch) {
  return [...indexPpv(batch).rows.values()].flatMap(p=>{
    const jd=value(p,'recommendJdPrice'),tm=value(p,'tmPrice'),hand=value(p,'postJdHandPrice'),th=value(p,'tmHandPrice');
    const results:Array<{ppv:string;brand:string;type:string;owner:string;gap:number;detail:string;newSeries:string;targetMargin?:number|null}>=[];
    if(jd!==null&&tm!==null&&jd<tm){
      // maxPriceByMargin is the saved algorithm's ceiling, including its subsidy rules.
      const ceiling=Number.isFinite(p.maxPriceByMargin)&&p.maxPriceByMargin>0?p.maxPriceByMargin:null;
      // Subsidy after crossing a threshold is unknown from a price pair; do not invent target profit.
      const target = batch.restorePayload && value(p,'basePrice') !== null ? applyManualRecommendedPrice({...p,pricingRemark:p.pricingRemark||''},tm,batch.marginBottomLine,batch.restorePayload.subsidyRules) : null;
      const loss=target!==null&&target.postMarginalProfit<0;
      const constrained=target ? target.postMarginalProfit < batch.marginBottomLine : ceiling!==null&&tm>ceiling;
      if(loss||constrained||(target===null&&ceiling===null)) results.push({ppv:p.ppv,...analysisIdentity(p),type:loss?'亏损风险':constrained?'利润底线限制':ceiling===null?'利润空间待核验':'仍有追价空间',owner:loss?'分货+销售':'我方定价决策',targetMargin:target&&Number.isFinite(target.postMarginalProfit)?target.postMarginalProfit:null,gap:tm-jd,detail:`追平后边际 ${target ? (target.postMarginalProfit*100).toFixed(2)+'%' : '规则缺失，待核验'}；当前边际 ${Number.isFinite(p.postMarginalProfit)?(p.postMarginalProfit*100).toFixed(2)+'%':'缺失'}；快照底线 ${(batch.marginBottomLine*100).toFixed(2)}%；算法最高可报价 ${ceiling??'缺失'}。${loss?'按快照补贴规则追平天猫后预计亏损。':constrained?'追平后低于利润底线；未保存补贴规则时按算法上限识别，亏损风险待核验。':'核查保存时策略与手工调整。'}`});
    }
    if(jd!==null&&tm!==null&&jd>tm&&hand!==null&&th!==null&&hand<=th) results.push({ppv:p.ppv,...analysisIdentity(p),type:'补贴竞争力不足',owner:'京东换新渠道方',gap:th-hand,detail:`物品价已高于天猫，但到手价未超过天猫；请京东换新渠道方与采销协商补贴，目标为到手价高于天猫。物品价差 ${jd!==null&&tm!==null?(jd-tm).toFixed(2):'缺失'} 元；补贴差 ${value(p,'totalSubsidy')!==null&&value(p,'tmSubsidyManual')!==null?(value(p,'totalSubsidy')!-value(p,'tmSubsidyManual')!).toFixed(2):'缺失'} 元。`});
    return results;
  }).sort((a,b)=>b.gap-a.gap);
}

// The timeline is a union of saved PPVs, with independently valid prices per period.
// Scope membership in any saved period includes the PPV's complete history.
export function priceTimelineCatalog(batches: TrackingBatch[], brand = '', newSeries = '') {
  const catalog = new Map<string, {product: CalculatedProduct; observations: number}>();
  for (const batch of chronological(batches)) for (const [ppv, product] of indexPpv(batch).rows) {
    if (!matchesAnalysisScope(product, brand, newSeries)) continue;
    const previous = catalog.get(ppv);
    catalog.set(ppv, {product, observations: (previous?.observations || 0) + 1});
  }
  return [...catalog.values()].sort((a,b)=>b.observations-a.observations || a.product.ppv.localeCompare(b.product.ppv,'zh-CN'));
}
export function priceTimelinePoints(batches: TrackingBatch[], ppv: string) {
  return chronological(batches).map(batch=>({
    name: analysisTimeLabel(batch), batch: batch.id, present: indexPpv(batch).rows.has(ppv)?1:0,
    ...Object.fromEntries(metrics.map(([key])=>[key,value(indexPpv(batch).rows.get(ppv),key)]))
  })) as Array<Record<string,string|number|null>>;
}

// Monotone cubic interpolation: smooth known observations without overshooting prices.
// Null entries split the path so missing snapshots are never bridged.
export function smoothPricePath(points: Array<{x:number;y:number}|null>) {
  const segments:Array<Array<{x:number;y:number}>>=[];
  for(const point of points){if(!point){if(segments.at(-1)?.length)segments.push([]);continue;}if(!segments.length)segments.push([]);segments.at(-1)!.push(point);}
  return segments.filter(segment=>segment.length).map(segment=>{
    let path=`M${segment[0].x.toFixed(1)},${segment[0].y.toFixed(1)}`;
    const slopes=segment.slice(1).map((p,i)=>(p.y-segment[i].y)/(p.x-segment[i].x));
    const tangents=segment.map((p,i)=>{
      if(i===0)return slopes[0]||0;
      if(i===segment.length-1)return slopes[i-1]||0;
      const left=slopes[i-1],right=slopes[i];
      if(left*right<=0)return 0;
      const h0=p.x-segment[i-1].x,h1=segment[i+1].x-p.x,w1=2*h1+h0,w2=h1+2*h0;
      return (w1+w2)/(w1/left+w2/right);
    });
    for(let i=0;i<slopes.length;i++){
      const slope=slopes[i];if(slope===0){tangents[i]=0;tangents[i+1]=0;continue;}
      const norm=Math.hypot(tangents[i]/slope,tangents[i+1]/slope);
      if(norm>3){tangents[i]*=3/norm;tangents[i+1]*=3/norm;}
    }
    for(let i=1;i<segment.length;i++){
      const a=segment[i-1],b=segment[i],h=(b.x-a.x)/3;
      path+=` C${(a.x+h).toFixed(1)},${(a.y+tangents[i-1]*h).toFixed(1)} ${(b.x-h).toFixed(1)},${(b.y-tangents[i]*h).toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
    }
    return path;
  }).join(' ');
}
