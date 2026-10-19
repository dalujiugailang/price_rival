import assert from 'node:assert/strict';
import { batchScopeKey, batchTypeLabel, filterBatchScope } from './batchScope';
import { TrackingBatch } from '../types';
const batches = [{ id: 'legacy' }, { id: 'regular', batchType: 'regular' }, { id: 'a', batchType: 'launch', launchActivity: '小米发新' }, { id: 'b', batchType: 'launch', launchActivity: 'vivo发新' }] as TrackingBatch[];
assert.deepEqual(filterBatchScope(batches, 'regular', '').map(b => b.id), ['regular']);
assert.deepEqual(filterBatchScope(batches, 'unclassified', '').map(b => b.id), ['legacy']);
assert.deepEqual(filterBatchScope(batches, 'launch', '小米发新').map(b => b.id), ['a']);
assert.notEqual(batchScopeKey(batches[0]), batchScopeKey(batches[1]));
assert.equal(batchScopeKey(batches[2]), batchScopeKey({ batchType: 'launch', launchActivity: ' 小米发新 ' }));
assert.equal(batchTypeLabel(batches[2]), '发新期');
assert.equal(batchTypeLabel({ batchType: 'launch' }), '发新期');
console.log('PASS: regular, launch activity and legacy scopes stay separate');

assert.deepEqual(filterBatchScope(batches, 'launch').map(b => b.id), batches.filter(b => b.batchType === 'launch').map(b => b.id));
