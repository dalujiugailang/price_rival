import assert from 'node:assert/strict';
import {
  EMPTY_COLUMN_FILTER_VALUE,
  matchesNumericColumnFilters,
  type NumericFilterOperator,
  getColumnFilterOptions,
  matchesColumnFilters,
  matchesTableSearch,
  normalizeColumnFilterValue,
  setColumnFilter
} from './tableColumnFilters';

type Row = { brand: string; risk: string; amount: number; note?: string };

const rows: Row[] = [
  { brand: '华为', risk: 'SAFE', amount: 10 },
  { brand: '荣耀', risk: 'SAFE', amount: 20 },
  { brand: '华为', risk: 'CRITICAL', amount: 20, note: '' }
];
const getValue = (row: Row, key: string) => row[key as keyof Row];

assert.equal(normalizeColumnFilterValue(''), EMPTY_COLUMN_FILTER_VALUE);
assert.equal(normalizeColumnFilterValue(null), EMPTY_COLUMN_FILTER_VALUE);
assert.equal(normalizeColumnFilterValue(20), '20');

const filters = {
  brand: ['华为', '荣耀'],
  risk: ['SAFE']
};
assert.equal(matchesColumnFilters(rows[0], filters, getValue), true);
assert.equal(matchesColumnFilters(rows[1], filters, getValue), true);
assert.equal(matchesColumnFilters(rows[2], filters, getValue), false);

assert.equal(matchesTableSearch(rows[0], ' 华为 ', row => Object.values(row)), true);
assert.equal(matchesTableSearch(rows[1], 'safe', row => Object.values(row)), true);
assert.equal(matchesTableSearch(rows[2], '不存在', row => Object.values(row)), false);
assert.equal(matchesTableSearch(rows[2], '', row => Object.values(row)), true);

const brandOptions = getColumnFilterOptions(rows, 'brand', { risk: ['SAFE'] }, getValue);
assert.deepEqual(brandOptions, [
  { value: '华为', count: 1 },
  { value: '荣耀', count: 1 }
]);

const amountOptions = getColumnFilterOptions(rows, 'amount', { brand: ['华为'] }, getValue);
assert.deepEqual(amountOptions, [
  { value: '10', count: 1 },
  { value: '20', count: 1 }
]);

assert.deepEqual(setColumnFilter(filters, 'risk', []), { brand: ['华为', '荣耀'] });
assert.deepEqual(setColumnFilter(filters, 'risk', ['SAFE', 'SAFE']), {
  brand: ['华为', '荣耀'],
  risk: ['SAFE']
});

console.log('table column filters tests passed');

const compare = (value: unknown, operator: NumericFilterOperator, target: number, upper?: number) =>
  matchesNumericColumnFilters({ value }, { value: { operator, value: target, upper } }, (row, key) => row[key]);
for (const [operator, expected] of [['gt', false], ['gte', true], ['lt', false], ['lte', true], ['eq', true], ['neq', false]] as const) {
  assert.equal(compare(20, operator, 20), expected, `equal boundary for ${operator}`);
}
assert.equal(compare(21, 'gt', 20), true);
assert.equal(compare(-0.02, 'lt', 0), true);
assert.equal(compare(0.01 + 0.02, 'eq', 0.03), true);
assert.equal(compare(10, 'between', 10, 20), true);
assert.equal(compare(20, 'between', 10, 20), true);
assert.equal(compare(21, 'between', 10, 20), false);
assert.equal(compare(15, 'between', 20, 10), false);
for (const value of [null, undefined, '', ' ', '未知', NaN, Infinity, true]) {
  assert.equal(compare(value, 'neq', 0), false, `missing/nonnumeric ${String(value)} must not match`);
}
assert.equal(matchesNumericColumnFilters(rows[0], { amount: { operator: 'gt', value: 999 } }, getValue, 'amount'), true);
assert.deepEqual(rows.filter(row => matchesColumnFilters(row, { brand: ['华为'] }, getValue)
  && matchesNumericColumnFilters(row, { amount: { operator: 'gte', value: 20 } }, getValue)).map(row => row.risk), ['CRITICAL']);
console.log('numeric filters: operators, inclusive ranges, percentages, missing values and composition passed');
