import assert from 'node:assert/strict';
import { Product } from '../types';
import { getDailyPriceLookupPpvs } from './dailyPriceLookup';

const product = (ppv: string) => ({ ppv } as Product);

const currentUpload = [product('CURRENT-1'), product('CURRENT-2'), product('CURRENT-1'), product('')];
const historicalProducts = [product('HISTORY-ONLY')];

assert.deepEqual(
  getDailyPriceLookupPpvs(currentUpload),
  ['CURRENT-1', 'CURRENT-2']
);
assert.equal(
  getDailyPriceLookupPpvs(currentUpload).includes(historicalProducts[0].ppv),
  false
);

console.log('daily price lookup scope checks passed');
