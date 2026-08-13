import assert from 'node:assert/strict';
import { getTrendRangeData } from './trendRange';

const twentyPoints = Array.from({ length: 20 }, (_, index) => index + 1);

assert.deepEqual(
  getTrendRangeData(twentyPoints),
  [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
);

assert.deepEqual(getTrendRangeData([1, 2, 3]), [1, 2, 3]);
assert.deepEqual(getTrendRangeData(twentyPoints, 'all'), twentyPoints);

console.log('trend range checks passed');
