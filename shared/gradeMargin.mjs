import {roundUploadPrice} from './uploadPrice.mjs';

export const GRADE_MARGIN_FLOOR = 0.03;
export const GRADE_PRICING_VERSION = 4;
export const gradeMarginalProfit = (price,subsidy,base) => price == null || subsidy == null || !(base>0) ? null
  : 1-((price+subsidy)*1.0466+base*.0218+81)/base;
const norm = v => String(v??'').replace(/\s+/g,'').toLowerCase();
const fmt = v => Number(v).toFixed(2);
export function gradeBasePrice(lookup = {}) {
  if (lookup.matched===false) return null;
  const raw=lookup['BI基准价']??lookup.biBasePrice;
  return raw!=='' && raw!=null && Number.isFinite(Number(raw)) && Number(raw)>0 ? Number(raw) : null;
}
export const gradeSubsidyAtPrice = (price,rules,key='ahsInput') => {
  if(price==null || !rules.length)return null;
  const match=rules.filter(r=>r.threshold<=price).at(-1);
  return match ? match[key] : 0;
};

// The upload rounding is not idempotent (250 -> 245 -> 240). Search its output
// values, including the look-ahead, rather than rounding a legal price again.
export function floorGradeUploadPrice(limit) {
  if (!Number.isFinite(limit)||limit<2)return null;
  let best=0;
  for(let raw=Math.floor(limit)+10;raw>=Math.max(1,Math.floor(limit)-20);raw--){
    const price=roundUploadPrice(raw);
    if(price>0&&price<=limit&&price>best)best=price;
  }
  return best||null;
}

export function applyGradeMarginFloor(plan,subsidyRules=[],dailyRows=[]) {
  const daily=new Map(dailyRows.map(r=>[norm(r.ppv),r]));
  const rows=plan.rows.map(row=>{
    if(row.origin!=='等级推算')return {...row,marginRemark:'已有定价保留，不执行等级推算的3%底线修正'};
    const ratioPrice=row.price;
    const base=gradeBasePrice(daily.get(norm(row.ppv)));
    const rules=subsidyRules.filter(r=>r.newSeries===row.newSeries).sort((a,b)=>a.threshold-b.threshold);
    const pending=reason=>({...row,ratioPrice,price:null,marginFloor:GRADE_MARGIN_FLOOR,marginBeforeCorrection:null,marginAfterCorrection:null,
      marginRemark:`固定边际利润率底线3.00%；${reason}，暂不生成最终价格`,status:[...row.status,reason]});
    if(base==null)return pending('缺少BI基准价，无法校验3%底线');
    if(!rules.length)return pending('缺少本系列补贴规则，无法校验3%底线');
    const marginBeforeCorrection=gradeMarginalProfit(ratioPrice,gradeSubsidyAtPrice(ratioPrice,rules),base);
    const finish=(price,marginAfterCorrection)=>({...row,ratioPrice,price,marginFloor:GRADE_MARGIN_FLOOR,marginBeforeCorrection,marginAfterCorrection,
      marginRemark:`固定边际利润率底线3.00%；比例推算取整价¥${fmt(ratioPrice)}（${fmt(marginBeforeCorrection*100)}%）`+
        (price===ratioPrice?'，已达底线，保留':` → 修正价¥${fmt(price)}（${fmt(marginAfterCorrection*100)}%）；已按修正价重新匹配补贴及取整`),
      status:price===ratioPrice?row.status:[...row.status,'已按3%边际利润率底线修正']});
    if(marginBeforeCorrection>=GRADE_MARGIN_FLOOR-1e-12)return finish(ratioPrice,marginBeforeCorrection);
    // Subsidies can jump or fall between tiers; solve each interval independently.
    const tiers=[...new Map([{threshold:0,ahsInput:0},...rules].map(r=>[r.threshold,r])).values()].sort((a,b)=>a.threshold-b.threshold);
    let best=null;
    for(let i=0;i<tiers.length;i++){
      const tier=tiers[i];
      const cap=Math.min(ratioPrice,(base*(1-GRADE_MARGIN_FLOOR-.0218)-81)/1.0466-tier.ahsInput,
        tiers[i+1]?tiers[i+1].threshold-1e-7:Infinity);
      const price=floorGradeUploadPrice(cap);
      if(price==null||price<tier.threshold)continue;
      const margin=gradeMarginalProfit(price,gradeSubsidyAtPrice(price,rules),base);
      if(margin>=GRADE_MARGIN_FLOOR-1e-12&&(best==null||price>best))best=price;
    }
    if(best==null)return {...pending('无满足3%底线的有效正报价'),marginBeforeCorrection};
    return finish(best,gradeMarginalProfit(best,gradeSubsidyAtPrice(best,rules),base));
  });
  return {...plan,rows,pricingVersion:GRADE_PRICING_VERSION};
}
