import {applyGradeMarginFloor,floorGradeUploadPrice} from './gradeMargin.mjs';
import {roundUploadPrice} from './uploadPrice.mjs';

const fmt=value=>Number(value).toFixed(2);
const valid=row=>Number.isFinite(row.price)&&row.price>0;

// After each margin pass, re-anchor the still-inverted tail at the lowest
// non-inverted grade above it. Only decrease inferred prices; fixed prices and
// other SKUs never change. Each round resolves the first inferred inversion,
// so the resolved prefix grows and at most N rounds are necessary per SKU.
export function stabilizeGradeOrder(plan,subsidyRules=[],dailyRows=[]) {
  const rows=plan.rows.map(row=>({...row,status:[...row.status],orderSteps:[]}));
  const groups=new Map();
  for(const row of rows){const group=groups.get(row.skuId)||[];group.push(row);groups.set(row.skuId,group);}
  const orderIssues=[];let rounds=0,affectedSkus=0;
  for(const [skuId,group] of groups){
    group.sort((a,b)=>a.rank-b.rank);
    let skuRounds=0;
    for(let iteration=1;iteration<=group.length;iteration++){
      let reference=null,found=null;
      for(const row of group){
        if(!valid(row))continue;
        if(!reference||row.price<=reference.price){reference=row;continue;}
        if(row.origin==='等级推算'){found={reference,row};break;}
        // A frozen lower-grade inversion cannot become a new reference.
      }
      if(!found)break;
      const ref={ppv:found.reference.ppv,skuId,level:found.reference.level,rank:found.reference.rank,
        price:found.reference.price,ratio:found.reference.ratio};
      skuRounds++;
      for(const row of group){
        if(row.rank<=ref.rank||row.origin!=='等级推算'||!valid(row))continue;
        const target=ref.price*row.ratio/ref.ratio;
        const limit=Math.min(row.price,ref.price,roundUploadPrice(target));
        const candidate=floorGradeUploadPrice(limit);
        if(candidate!==null&&candidate>=row.price)continue;
        const before=row.price;
        const checked=candidate===null ? null : applyGradeMarginFloor({rows:[{...row,price:candidate}]},subsidyRules,dailyRows).rows[0];
        row.priceBeforeOrder??=before;
        row.price=checked?.price??null;
        row.marginAfterCorrection=checked?.marginAfterCorrection??null;
        row.orderReference=ref;
        row.orderSteps.push({round:iteration,reference:ref,before,ratioTarget:Math.round(target*100)/100,
          roundedTarget:candidate,after:row.price,marginAfter:row.marginAfterCorrection});
        row.orderRemark=row.orderSteps.map(s=>`第${s.round}轮参考 SKU ${skuId} · ${s.reference.level} ¥${fmt(s.reference.price)}（等级比${fmt(s.reference.ratio*100)}%），按等级比重算 ¥${fmt(s.before)} → ${s.after===null?'待处理':`¥${fmt(s.after)}`}`).join('；');
        row.marginRemark=`固定边际利润率底线3.00%；首次比例推算取整价¥${fmt(row.ratioPrice)}`+
          (row.price===null?'；防倒挂后无可用报价，需人工处理':`；防倒挂后最终价¥${fmt(row.price)}（${fmt(row.marginAfterCorrection*100)}%）；已重新匹配补贴及取整`);
        row.status=[...new Set([...row.status,'已循环修正等级倒挂',...(checked?.status||[]),...(row.price===null?['防倒挂修正无可用报价']:[])])];
      }
    }
    rounds+=skuRounds;if(skuRounds)affectedSkus++;
    let reference=null;
    for(const row of group){
      if(!valid(row))continue;
      if(!reference||row.price<=reference.price){reference=row;continue;}
      const message=`等级倒挂未解决：${reference.level} ¥${fmt(reference.price)} < ${row.level} ¥${fmt(row.price)}；${row.origin==='重点追价'?'涉及已定价记录，保留原价，需人工确认':'自动修正未收敛，需人工确认'}`;
      orderIssues.push({skuId,model:row.model,higherPpv:reference.ppv,lowerPpv:row.ppv,message});
      row.status=[...new Set([...row.status,'等级倒挂待人工确认'])];
      reference.status=[...new Set([...reference.status,'等级倒挂待人工确认'])];
    }
  }
  return {...plan,rows,orderIssues,orderSummary:{rounds,affectedSkus,correctedRows:rows.filter(r=>r.orderSteps.length).length,
    unresolved:orderIssues.length,pendingRows:rows.filter(r=>!valid(r)).length}};
}
