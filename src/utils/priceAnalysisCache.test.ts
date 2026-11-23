import assert from 'node:assert/strict';import {createPriceAnalysisCache} from './priceAnalysisCache';import {TrackingBatch} from '../types';
let calls=0;const rows=[{id:'A'}] as TrackingBatch[];
const cache=createPriceAnalysisCache(async etag=>{calls++;return etag?{notModified:true}:{notModified:false,etag:'v1',batches:rows};});
const first=cache.load('user:1');assert.equal(cache.load('user:1'),first,'deduplicate concurrent mounts');assert.equal((await first).batches,rows);
assert.equal((await cache.load('user:1')).batches,rows,'304 reuses object identities');assert.equal(calls,2);
await cache.load('other:1');assert.equal(calls,3);cache.clear();await cache.load('other:1');assert.equal(calls,4);
let forbidden=false;const secure=createPriceAnalysisCache(async etag=>{if(forbidden)throw Object.assign(new Error('denied'),{status:403});return {notModified:false,etag:'v',batches:rows};});await secure.load('u:1');forbidden=true;await assert.rejects(secure.load('u:1'));
console.log('Analysis client cache: in-flight dedup, 304 identity, account isolation, logout and revocation passed.');
