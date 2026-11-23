import {test} from 'node:test';import assert from 'node:assert/strict';
import {pricingColumnKeys,pricingColumnOrder,pricingInflationGroup,pricingHeaderMerges,pricingColumnLabels} from './pricingColumns.mjs';
test('four before fields follow raw JD price and four after fields follow small-gap reminder',()=>{
 const keys=pricingColumnOrder.map(i=>pricingColumnKeys[i]);
 assert.equal(new Set(pricingColumnOrder).size,pricingColumnKeys.length);
 assert.deepEqual(keys.slice(keys.indexOf('jdPrice')+1,keys.indexOf('jdPrice')+5),['inflationAhsBefore','inflationItemPriceBefore','inflationTotalBefore','subsidyMatchPriceBefore']);
 assert.deepEqual(keys.slice(keys.indexOf('smallGapOpportunityRemark')+1,keys.indexOf('smallGapOpportunityRemark')+5),['inflationAhsAfter','inflationItemPriceAfter','inflationTotalAfter','subsidyMatchPriceAfter']);
 for(const group of ['追价前','追价后'])assert.equal(pricingColumnOrder.filter(i=>pricingInflationGroup(i)===group).length,4);
 const merges=pricingHeaderMerges(pricingColumnOrder.map(i=>pricingInflationGroup(i)||String(i)));
 assert.deepEqual(merges,[]);
 assert.equal(pricingColumnLabels()[52],'含旧机膨胀款后物品价-追价前');assert.equal(pricingColumnLabels()[53],'含旧机膨胀款后物品价-追价后');
});
