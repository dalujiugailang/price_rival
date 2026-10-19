import assert from 'node:assert/strict';
import { retainFilterScope, resolveFilteredRows } from './retainedFilterScope';

type Row = { id: string; ppv: string; price: number; win: number };
const rows: Row[] = [
  { id: 'source-1', ppv: 'same-ppv', price: 90, win: 0 },
  { id: 'source-2', ppv: 'same-ppv', price: 80, win: 0 },
  { id: 'source-3', ppv: 'other', price: 120, win: 1 }
];
const key = (row: Row) => row.id;
const scope = 'win=0;dataset=A';
const hits = rows.filter(row => row.win === 0);
const retained = retainFilterScope(scope, hits, key);
const updated = rows.map(row => row.id === 'source-1' ? { ...row, price: 130, win: 1 } : row);
const freshHits = updated.filter(row => row.win === 0);
const result = resolveFilteredRows(updated, freshHits, retained, scope, key);
assert.deepEqual(result.map(row => row.id), ['source-1', 'source-2']);
assert.equal(result[0].win, 1, 'show live competitiveness after price crosses the competitor');
assert.equal(result[0].price, 130, 'never retain stale prices');
assert.equal(result[0], updated[0], 'render current row objects');
assert.equal(result[1].ppv, result[0].ppv, 'source identity keeps duplicate PPVs distinct');
assert.deepEqual(resolveFilteredRows(updated, freshHits, null, scope, key).map(row => row.id), ['source-2'], 'explicit re-filter uses latest values');
assert.deepEqual(resolveFilteredRows(updated, freshHits, retained, 'win=0;dataset=B', key), freshHits, 'changing scope invalidates retained identities');
assert.deepEqual(resolveFilteredRows(updated.slice(1), freshHits, retained, scope, key).map(row => row.id), ['source-2'], 'deleted rows must not reappear');
const newlyMatching = updated.map(row => row.id === 'source-3' ? { ...row, win: 0 } : row);
assert.deepEqual(resolveFilteredRows(newlyMatching, newlyMatching.filter(row => row.win === 0), retained, scope, key).map(row => row.id), ['source-1', 'source-2'], 'retain this batch rather than silently adding new matches');
assert.deepEqual(rows.map(row => row.win), [0, 0, 1], 'do not mutate source rows');
console.log('retained filter scope: live values, fixed membership, duplicate PPVs, re-filter and scope changes passed');
