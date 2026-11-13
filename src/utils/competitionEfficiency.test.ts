import assert from 'node:assert/strict';
import test from 'node:test';
import type { TrackingBatch } from '../types';
import { buildEfficiencyPeriods } from './competitionEfficiency';
const batch = (id: string, saved: string, extra = {}) => ({ id, channelId: 'tradeIn', batchType: 'regular', serverCreatedAt: saved,
  competitionCoveragePpvs: ['one', 'two'], products: [
    { ppv: 'one', quoteVolume: 60, tmHandPrice: 100, postJdHandPrice: 100 },
    { ppv: 'two', quoteVolume: 40, tmHandPrice: 100, postJdHandPrice: 90 },
    { ppv: 'outside', quoteVolume: 1000, tmHandPrice: 100, postJdHandPrice: 200 },
  ], ...extra } as unknown as TrackingBatch);

test('Shanghai save days produce inclusive next-save-day windows; same-day last version wins', () => {
  const result = buildEfficiencyPeriods([
    batch('a', '2026-11-09T10:00:00Z'), batch('b-old', '2026-11-12T09:00:00Z'),
    batch('b', '2026-11-12T10:00:00Z'), batch('c', '2026-11-16T09:00:00Z'),
  ]);
  assert.deepEqual(result.periods.map(p => [p.batch.id, p.start, p.end]), [
    ['a', '2026-11-10', '2026-11-12'], ['b', '2026-11-13', '2026-11-16'], ['c', '2026-11-17', null],
  ]);
  assert.equal(result.sameDayReplaced, 1);
  assert.equal(result.periods[0].score, 60);
});
test('missing coverage and zero valid competitor denominator remain unavailable', () => {
  assert.equal(buildEfficiencyPeriods([batch('a', '2026-11-09T18:00:00+08:00', { competitionCoveragePpvs: undefined })]).periods[0].score, null);
  const p = buildEfficiencyPeriods([batch('a', '2026-11-09T18:00:00+08:00', { products: [{ ppv: 'one', quoteVolume: 60, tmHandPrice: 0, postJdHandPrice: 100 }], competitionCoveragePpvs: ['one'] })]).periods[0];
  assert.equal(p.score, null);
  assert.equal(p.priceCoverage, 0);
});
test('legacy imports and timestamps with no timezone are not silently used as save instants', () => {
  const result = buildEfficiencyPeriods([batch('RECOVERED-old', '2026-07-17T10:00:00Z'), batch('bad', '2026-11-09 18:00'), batch('real', '2026-11-09T18:00:00+08:00')]);
  assert.equal(result.excluded, 2);
  assert.equal(result.periods.length, 1);
});
