import assert from 'node:assert/strict';
import {snapshotPricingProducts} from './snapshotPricingDraft';
import {runBatchCalculations} from './formulas';
import type {TrackingBatch} from '../types';

const batch={products:[{id:'p',ppv:'A+ phone',newSeries:'new',jdPrice:500,tmPrice:1000,
  ahsInput:0,jdSubsidy:0,basePrice:1000,tmSubsidyManual:0,tmSubsidySheet:0,zzPrice:0,
  quoteVolume:10,soldVolume:2,rawFields:{BK_品牌名称:'品牌'},recommendJdPrice:999,
  manualRecommendJdPrice:999,handPriceAdjustment:{aligned:true}}]} as unknown as TrackingBatch;
const before=structuredClone(batch);
const inputs=snapshotPricingProducts(batch);
assert.equal(inputs[0].jdPrice,500);
assert.equal('recommendJdPrice' in inputs[0],false);
assert.equal('manualRecommendJdPrice' in inputs[0],false);
assert.equal('handPriceAdjustment' in inputs[0],false);
const low=runBatchCalculations(inputs,-.03,[],'margin');
const high=runBatchCalculations(inputs,.03,[],'margin');
assert.ok(low[0].recommendJdPrice>high[0].recommendJdPrice);
assert.equal(high[0].quoteVolume,10);
inputs[0].rawFields.BK_品牌名称='编辑后';
assert.deepEqual(batch,before);
console.log('Snapshot input reuse and live margin recalculation passed; saved snapshot unchanged.');
