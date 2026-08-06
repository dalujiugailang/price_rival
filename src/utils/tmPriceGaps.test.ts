import assert from 'node:assert/strict';
import { getTmPriceGaps } from './tmPriceGaps';

assert.deepEqual(getTmPriceGaps({
  jdPrice: 1100,
  jdHandPrice: 1200,
  recommendJdPrice: 1150,
  postJdHandPrice: 1250,
  tmPrice: 1000,
  tmHandPrice: 1180
}), {
  preItemGap: 100,
  preHandGap: 20,
  postItemGap: 150,
  postHandGap: 70
});

assert.deepEqual(getTmPriceGaps({
  jdPrice: 900,
  jdHandPrice: 1000,
  recommendJdPrice: 950,
  postJdHandPrice: 1050,
  tmPrice: 1000,
  tmHandPrice: 1100
}), {
  preItemGap: -100,
  preHandGap: -100,
  postItemGap: -50,
  postHandGap: -50
});

assert.deepEqual(getTmPriceGaps({
  jdPrice: 1000,
  jdHandPrice: 1000,
  recommendJdPrice: 1000,
  postJdHandPrice: 1000,
  tmPrice: 0,
  tmHandPrice: 1000
}), {
  preItemGap: null,
  preHandGap: 0,
  postItemGap: null,
  postHandGap: 0
});

console.log('tm price gap checks passed');
