import assert from 'node:assert/strict';
import {test} from 'node:test';
import {addGradePresentation,gradeRowDisplay,gradeSourceDisplay} from '../shared/gradePresentation.mjs';
import {buildGradePlan} from '../shared/gradeExpansion.mjs';
import {pricingColumnKeys,pricingColumnLabels,pricingColumnCodes,pricingColumnWidths} from '../shared/pricingColumns.mjs';

const row={ppv:'B型号甲 256G',skuId:'1',model:'型号甲',level:'B',newSeries:'新品甲',sourcePriceId:'anchor',origin:'等级推算',strategyPrice:900,price:1100,adjustment:200,quoteVolume:10,soldVolume:2,investment:400,anchorPrice:1500,ratio:.8,anchorRatio:1,status:[]};
const rules=[{newSeries:'新品甲',threshold:0,ahsInput:20,jdSubsidy:50},{newSeries:'新品甲',threshold:1000,ahsInput:80,jdSubsidy:150},{newSeries:'新品乙',threshold:0,ahsInput:999,jdSubsidy:999}];
const daily=[{ppv:row.ppv,matched:true,最终报价:900,BI基准价:1600,等级id:'B-ID',品牌名称:'品牌甲',ZZ券前价:12345}];
const request={prices:[{id:'anchor',newSeries:'新品甲',display:{brand:'品牌甲',ahsInput:888,tmPrice:999}}],subsidyRules:rules};
const present=(r=row,req=request,d=daily)=>addGradePresentation({rows:[r],summary:{totalInvestment:400}},req,d);

test('display uses own grade base, original series and separate before/after subsidy tiers without repricing',()=>{
  const r=present();const p=r.rows[0].display;
  assert.equal(p.newSeries,'新品甲'); assert.equal(p.jdPrice,900);assert.equal(p.basePrice,1600);assert.equal(p.levelId,'B-ID');
  assert.equal(p.ahsInput,20);assert.equal(p.ahsSubsidyAfter,80);assert.equal(p.jdHandPrice,950);assert.equal(p.postJdHandPrice,1250);
  assert.equal(p.postAhsPrice,1180);assert.ok(Math.abs(p.postMarginalProfit-0.1557075)<1e-10);
  assert.equal(p.recommendJdPrice,1100);assert.equal(r.rows[0].price,1100);assert.equal(r.rows[0].investment,400);assert.deepEqual(r.summary,{totalInvestment:400});
  for(const key of ['tmPrice','zzPrice','tmSubsidyManual','tmHandPrice','postTmItemWin','postZzItemWin','postItemGap'])assert.equal(p[key],null);
});
test('missing rule/base/lookup is unknown, whereas a provided zero subsidy remains zero',()=>{
  const missing=present(row,{...request,subsidyRules:[]}).rows[0];
  assert.equal(missing.display.ahsInput,null);assert.equal(missing.display.postMarginalProfit,null);assert.ok(missing.displayStatus.length);
  const zero=present(row,{...request,subsidyRules:[{newSeries:'新品甲',threshold:2000,ahsInput:20,jdSubsidy:50}]}).rows[0].display;
  assert.equal(zero.ahsInput,0);assert.equal(zero.postAhsPrice,1100);assert.ok(zero.postMarginalProfit>0);
  assert.equal(present(row,request,[]).rows[0].display.postMarginalProfit,null);
  assert.equal(present(row,request,[{...daily[0],matched:false}]).rows[0].display.basePrice,null);
});
test('preserved prices keep the selected record fields; expanded grades do not copy them',()=>{
  const original={newSeries:'新品甲',jdPrice:850,basePrice:1500,tmPrice:1150,tmHandPrice:1200,jdHandPrice:950,postJdHandPrice:1300,ahsInput:70,ahsSubsidyAfter:75,postMarginalProfit:.123,recommendAdjustment:250,secret:'excluded'};
  const req={...request,prices:[{id:'anchor',display:gradeSourceDisplay(original)}]};
  const p=present({...row,origin:'重点追价'},req).rows[0].display;
  assert.equal(p.jdPrice,850);assert.equal(p.ahsInput,70);assert.equal(p.postMarginalProfit,.123);assert.equal(p.postItemGap,-50);assert.equal(p.postHandGap,100);assert.equal(p.secret,undefined);
  assert.equal(present(row,req).rows[0].display.tmPrice,null);
});
test('grade plan inherits anchor series while an already priced grade keeps its own series',()=>{
  const plan=buildGradePlan({volume:{rows:[{skuId:'1',model:'型号甲',sku:'型号甲 256G',level:'A',soldVolume:1,quoteVolume:2}]},template:{models:{型号甲:'模板甲'},rules:['A','B','C'].map((level,i)=>({template:'模板甲',rank:i+1,level,ratio:1-i*.1}))},skuIds:['1'],prices:[{id:'a',skuId:'1',model:'型号甲',level:'A',ppv:'A型号甲 256G',price:1000,newSeries:'系列甲',display:{recommendAdjustment:100}},{id:'b',skuId:'1',model:'型号甲',level:'B',ppv:'B型号甲 256G',price:800,newSeries:'系列乙',display:{recommendAdjustment:100}}]});
  assert.deepEqual(plan.rows.map(r=>[r.level,r.newSeries,r.sourcePriceId]),[['A','系列甲','a'],['B','系列乙','b'],['C','系列乙','b']]);
});
test('old saved run display is frozen and falls back only to its saved anchor',()=>{
  const p=gradeRowDisplay({...row,newSeries:undefined},{prices:[{ppv:row.anchorPpv,price:row.anchorPrice,skuId:'1',newSeries:'保存系列'}]});
  assert.equal(p.newSeries,'保存系列');assert.equal(p.recommendJdPrice,1100);assert.equal(p.tmPrice,undefined);
  assert.equal(pricingColumnKeys.length,45);assert.equal(pricingColumnLabels().length,45);assert.equal(pricingColumnCodes.length,45);assert.equal(pricingColumnWidths.length,45);
});
