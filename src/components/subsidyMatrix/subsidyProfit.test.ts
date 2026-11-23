import test from 'node:test';
import assert from 'node:assert/strict';
import {calcMarginalProfit} from '../../utils/formulas';
import {compareSubsidyProfit} from '../../../shared/subsidyMatrix.mjs';
test('matrix system mode matches existing pricing formula across price and subsidy changes',()=>{
  for(const basePrice of [800,1200,3000])for(const price of [199,401,1000])for(const before of [0,100,300])for(const after of [0,180,700]) {
    const baseProfit=calcMarginalProfit(price,before,basePrice)*basePrice;
    const result=compareSubsidyProfit({baseProfit,basePrice,baselineSubsidy:before,subsidy:after,floor:.03,mode:'system'});
    assert.ok(Math.abs(result.rate-calcMarginalProfit(price,after,basePrice))<1e-10);
  }
});
