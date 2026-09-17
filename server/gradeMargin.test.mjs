import assert from 'node:assert/strict';
import {test} from 'node:test';
import {applyGradeMarginFloor,floorGradeUploadPrice} from '../shared/gradeMargin.mjs';
import {roundUploadPrice} from '../shared/uploadPrice.mjs';
import {applyGradeStrategyPrices} from '../shared/gradeExpansion.mjs';
import {addGradePresentation} from '../shared/gradePresentation.mjs';
const makeRow=price=>({ppv:'B型号甲',skuId:'1',origin:'等级推算',newSeries:'新品',price,targetPrice:price,soldVolume:2,status:[]});
const makeRules=tiers=>tiers.map(([threshold,ahsInput])=>({newSeries:'新品',threshold,ahsInput,jdSubsidy:ahsInput+50}));
const profit=(price,ahs,base)=>1-(price+ahs+(price+ahs)*.0466+base*.0218+81)/base;
const ahs=(price,rules)=>rules.filter(r=>price>=r.threshold).at(-1)?.ahsInput??0;

test('margin correction matches exhaustive legal-price search across tier jumps, drops and rounding boundaries',()=>{
  const groups=[[[401,100],[501,300],[1001,500]],[[0,300],[501,30],[1601,400]],[[0,0]],[[250,80],[500,120],[1000,200]]];
  for(const tiers of groups)for(const base of [50,360,670,1400,3000])for(const raw of [245,250,501,995,1806,2805]){
    const rules=makeRules(tiers),ratioPrice=roundUploadPrice(raw),row=makeRow(ratioPrice);
    const guarded=applyGradeMarginFloor({rows:[row]},rules,[{ppv:row.ppv,BI基准价:base}]).rows[0];
    const candidates=[...new Set(Array.from({length:Math.ceil(ratioPrice)+11},(_,i)=>roundUploadPrice(i)))].filter(p=>p>0&&p<=ratioPrice&&profit(p,ahs(p,rules),base)>=.03-1e-12);
    const expected=candidates.length?Math.max(...candidates):null;
    assert.equal(guarded.price,expected,JSON.stringify({tiers,base,ratioPrice}));
    assert.match(guarded.marginRemark,/3.00%/);
  }
  assert.equal(floorGradeUploadPrice(245),245);
  assert.equal(floorGradeUploadPrice(249),245);
});
test('missing inputs and impossible positive price do not become zero-price or zero-spend recommendations',()=>{
  const row=makeRow(1000);
  for(const [rules,daily] of [[[],[{ppv:row.ppv,BI基准价:2000}]],[makeRules([[0,0]]),[]],[makeRules([[0,0]]),[{ppv:row.ppv,BI基准价:50}]]]){
    const guarded=applyGradeMarginFloor({rows:[row]},rules,daily);
    const result=applyGradeStrategyPrices(guarded,[{ppv:row.ppv,最终报价:800}]);
    assert.equal(result.rows[0].price,null);assert.equal(result.rows[0].investment,null);assert.equal(result.summary.pendingRows,1);
  }
});
test('existing priced rows remain exact even below floor; safe inferred prices are not raised',()=>{
  const rules=makeRules([[0,20]]),daily=[{ppv:'B型号甲',BI基准价:1600}];
  const core=applyGradeMarginFloor({rows:[{...makeRow(1500.25),origin:'重点追价'}]},rules,daily).rows[0];
  assert.equal(core.price,1500.25);assert.match(core.marginRemark,/已有定价保留/);
  assert.equal(applyGradeMarginFloor({rows:[makeRow(500)]},rules,daily).rows[0].price,500);
});
test('corrected prices re-match subsidy and propagate to displayed profit and investment',()=>{
  const rules=makeRules([[0,20],[1000,400]]);const row=makeRow(1400);
  const daily=[{ppv:row.ppv,BI基准价:1600,最终报价:800}];
  const result=addGradePresentation(applyGradeStrategyPrices(applyGradeMarginFloor({rows:[row]},rules,daily),daily),{subsidyRules:rules},daily);
  const r=result.rows[0];assert.equal(r.price,995);assert.equal(r.display.ahsSubsidyAfter,20);
  assert.equal(r.display.recommendJdPrice,995);assert.equal(r.investment,390);assert.ok(r.display.postMarginalProfit>=.03);
  assert.equal(r.display.postMarginalProfit,r.marginAfterCorrection);assert.match(r.display.marginRemark,/1400.00.*995.00/);
});
