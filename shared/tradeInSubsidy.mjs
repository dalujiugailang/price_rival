import {roundUploadPrice} from './uploadPrice.mjs';
export const TRADE_IN_ALGORITHM_VERSION='inflation-v2';
export const hasInflationRules=rules=>rules.some(r=>r.ruleVersion===2 || Object.hasOwn(r,'inflationTotal'));
const EPS=1e-9;
const cache=new WeakMap();
export function prepareTradeInRules(rules) {
 if(cache.has(rules))return cache.get(rules);
 const sorted=[...rules].sort((a,b)=>a.threshold-b.threshold);
 const seen=new Map();let max=0,chosen=null;
 const prepared=sorted.map(r=>{
  const e=r.inflationTotal??0,a=r.inflationAhs??0;
  if(![r.threshold,r.ahsInput,r.jdSubsidy,e,a].every(n=>Number.isFinite(n)&&n>=0)||a>e||e>r.jdSubsidy||a>r.ahsInput)throw new Error('膨胀或补贴金额无效，拆后补贴不得为负');
  const value=JSON.stringify([r.jdSubsidy,r.ahsInput,e,a]);
  if(seen.has(r.threshold)&&seen.get(r.threshold)!==value)throw new Error(`同系列门槛${r.threshold}补贴规则冲突`);
  seen.set(r.threshold,value);
  if(e>=max){max=e;chosen=r;}
  return {...r,inflationTotal:e,inflationAhs:a,netJd:r.jdSubsidy-e,netAhs:r.ahsInput-a,maxInflation:max,maxInflationAhs:chosen?.inflationAhs??0,inflationThreshold:chosen?.threshold??null};
 });
 cache.set(rules,prepared);return prepared;
}
function reached(rules,price){let lo=0,hi=rules.length-1,hit=-1;while(lo<=hi){const mid=(lo+hi)>>1;if(rules[mid].threshold<=price+EPS){hit=mid;lo=mid+1;}else hi=mid-1;}return hit<0?null:rules[hit];}
export function evaluateTradeInPrice(price,rules,basePrice=0) {
 if(!Number.isFinite(price)||price<0)throw new Error('裸机价无效');
 const prepared=prepareTradeInRules(rules);
 const inflation=reached(prepared,price),inflationTotal=inflation?.maxInflation??0,inflationAhs=inflation?.maxInflationAhs??0;
 const subsidyMatchPrice=price+inflationTotal,regular=reached(prepared,subsidyMatchPrice);
 const regularJd=regular?.netJd??0,regularAhs=regular?.netAhs??0;
 const itemPrice=price+inflationAhs,handPrice=price+inflationTotal+regularJd,costPrice=price+inflationAhs+regularAhs;
 const linearCost=costPrice*.0466+basePrice*.0218+81;
 return {price,inflationTotal,inflationAhs,inflationThreshold:inflation?.inflationThreshold??null,subsidyMatchPrice,regularThreshold:regular?.threshold??null,regularJd,regularAhs,itemPrice,handPrice,costPrice,linearCost,grossMargin:basePrice>0?1-costPrice/basePrice:null,marginalProfit:basePrice>0?1-(costPrice+linearCost)/basePrice:null,algorithmVersion:TRADE_IN_ALGORITHM_VERSION};
}
// Preserve the raw preimage: rounding 250 -> 245 -> 240 must never happen twice.
export function legalTradeInPrices(min,max) {
 const values=new Map();
 if(!Number.isFinite(max)||max<0)return values;
 for(let raw=Math.max(1,Math.floor(min)-10);raw<=Math.ceil(max)+10;raw++){
  const price=roundUploadPrice(raw);
  if(price>0&&price+EPS>=min&&price<=max+EPS&&!values.has(price))values.set(price,raw);
 }
 return values;
}
export function findTradeInPrice({rules,basePrice,min=2,max,itemTarget=null,handTarget=null,marginFloor=null,prefer='lowest'}) {
 let best=null;
 for(const [price,rawPrice] of legalTradeInPrices(min,max)){
  const result=evaluateTradeInPrice(price,rules,basePrice);
  if(itemTarget!=null&&result.itemPrice+EPS<itemTarget || handTarget!=null&&result.handPrice+EPS<handTarget || marginFloor!=null&&!(result.marginalProfit+1e-12>=marginFloor))continue;
  if(!best||(prefer==='highest'?price>best.price:price<best.price))best={...result,rawPrice};
 }
 return best;
}
export const tradeInMarginUpper=(base,floor)=>(base*(1-floor-.0218)-81)/1.0466;
