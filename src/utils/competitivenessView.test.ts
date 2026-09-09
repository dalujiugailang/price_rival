import assert from 'node:assert/strict';
import { CalculatedProduct, TrackingBatch } from '../types';
import { ALL_BRANDS, ALL_SERIES } from './brandCompetitiveness';
import { ALL_BATCHES, LIVE_DRAFT, buildCompetitivenessView, getCompetitivenessViewRange } from './competitivenessView';

const product = (brand: string, newSeries: string, quoteVolume: number, win: boolean) => ({
  brand, newSeries, quoteVolume, rawFields: { '品牌名称': brand },
  tmPrice: 100, tmHandPrice: 120, tmRecyclerQuotedPrice: 110, zzPrice: 100, zzHandPrice: 130,
  postTmItemWin: win, postTmHandWin: win, postAhsTmRecyclerWin: win,
  postZzItemWin: win, postAhsZzHandWin: win, postJdZzHandWin: win
} as unknown as CalculatedProduct);
const score = (value: number) => ({ tmItemScore: value, tmDirectScore: value, ahsVsTmRecyclerScore: value,
  zzItemScore: value, ahsVsZzDirectScore: value, jdVsZzDirectScore: value });
const history = [
  { id: 'SUMMARY', date: '2026-08-01', isCompetitivenessConfirmed: true, isSummaryOnly: true,
    products: [], competitivenessMetrics: score(70) },
  { id: 'TRACK-OLD', date: '2026-08-02', isCompetitivenessConfirmed: true,
    products: [product('华为', 'Mate 60', 30, true), product('华为', 'Mate 60', 70, false), product('OPPO', 'Find X8', 50, true)] },
  { id: 'TRACK-NEW', date: '2026-08-03', isCompetitivenessConfirmed: true,
    products: [product('小米', '小米15', 100, true)], competitivenessMetrics: score(81) },
  { id: 'TRACK-DRAFT', date: '2026-08-04', isCompetitivenessConfirmed: false,
    products: [product('荣耀', 'Magic 7', 100, false)] }
] as TrackingBatch[];
const live = [product('小米', '小米15', 80, false), product('vivo', 'X200', 20, true)];
const input = { historyBatches: history, currentCalculatedItems: live };
const original = JSON.stringify(input);

const all = buildCompetitivenessView(input);
assert.equal(all.sourceId, ALL_BATCHES);
assert.deepEqual(new Set(all.brandOptions), new Set(['华为', 'OPPO', '小米', '荣耀', 'vivo']));
assert.ok(all.seriesOptions.includes('Mate 60'));
assert.ok(all.seriesOptions.includes('Magic 7'), 'unconfirmed saved records are available to inspect');
assert.equal(all.details?.batchId, LIVE_DRAFT);
assert.equal(all.metrics.tmItemScore, 20, 'compute the latest batch alone; never pool history and live weights');
assert.deepEqual(all.timeline.map(point => point.batchId), ['SUMMARY', 'TRACK-OLD', 'TRACK-NEW', LIVE_DRAFT]);

const historicalOnly = buildCompetitivenessView({ ...input, brand: '华为', newSeries: 'Mate 60' });
assert.equal(historicalOnly.details?.batchId, 'TRACK-OLD');
assert.equal(historicalOnly.metrics.tmItemScore, 30);
assert.equal(historicalOnly.details?.products.length, 2);
assert.equal(historicalOnly.timeline.find(point => point.batchId === 'SUMMARY')?.tmItemScore, null, 'summary-only data cannot be split');
assert.equal(historicalOnly.timeline.find(point => point.batchId === LIVE_DRAFT)?.tmItemScore, null, 'no matching rows is a gap, not zero');

const track = buildCompetitivenessView({ ...input, sourceId: 'TRACK-OLD', brand: '华为', newSeries: 'Mate 60' });
assert.equal(track.metrics.tmItemScore, 30);
assert.equal(track.details?.batchId, 'TRACK-OLD');
assert.deepEqual(track.brandOptions, ['OPPO', '华为']);
assert.deepEqual(track.seriesOptions, ['Mate 60']);
assert.deepEqual(track.timeline, historicalOnly.timeline, 'choosing a batch preserves the historical comparison');
const changedLive = buildCompetitivenessView({ ...input, currentCalculatedItems: [product('华为', 'Mate 60', 999, true)], sourceId: 'TRACK-OLD', brand: '华为' });
assert.equal(changedLive.metrics.tmItemScore, 30, 'live edits cannot change a selected historical batch');
assert.equal(changedLive.timeline.at(-1)?.tmItemScore, 100);

const saved = buildCompetitivenessView({ ...input, sourceId: 'TRACK-NEW' });
assert.equal(saved.metrics.tmItemScore, 81, 'unfiltered historical scores retain their saved value');
const savedFiltered = buildCompetitivenessView({ ...input, sourceId: 'TRACK-NEW', brand: '小米' });
assert.equal(savedFiltered.metrics.tmItemScore, 100, 'dimension filters aggregate saved row flags with saved weights');
assert.equal(savedFiltered.timeline.find(point => point.batchId === 'TRACK-NEW')?.tmItemScore, 100);

const current = buildCompetitivenessView({ ...input, sourceId: LIVE_DRAFT, brand: '华为', newSeries: 'Mate 60' });
assert.deepEqual(current.brandOptions, ['vivo', '小米']);
assert.equal(current.brand, ALL_BRANDS);
assert.equal(current.newSeries, ALL_SERIES);
assert.equal(current.details?.batchId, LIVE_DRAFT);
const realZero = buildCompetitivenessView({ ...input, sourceId: LIVE_DRAFT, brand: '小米' });
assert.equal(realZero.metrics.tmItemScore, 0, 'a measured loss remains zero');

const summary = buildCompetitivenessView({ ...input, sourceId: 'SUMMARY', brand: '华为', newSeries: 'Mate 60' });
assert.equal(summary.details?.isSummaryOnly, true);
assert.equal(summary.metrics.tmItemScore, 70);
assert.deepEqual(summary.brandOptions, []);
assert.deepEqual(summary.seriesOptions, []);
assert.equal(summary.brand, ALL_BRANDS);

const draft = buildCompetitivenessView({ ...input, sourceId: 'TRACK-DRAFT' });
assert.equal(draft.details?.isConfirmed, false);
assert.equal(draft.metrics.tmItemScore, 0);
assert.equal(draft.timeline.at(-1)?.isSnapshot, true);
assert.equal(draft.timeline.at(-1)?.tmItemScore, null, 'unconfirmed scores are rendered as separate reference dots');
const draftOnlyBrand = buildCompetitivenessView({ ...input, brand: '荣耀' });
assert.equal(draftOnlyBrand.details?.batchId, 'TRACK-DRAFT');
assert.equal(draftOnlyBrand.timeline.at(-1)?.isSnapshot, true);

const noWeight = buildCompetitivenessView({ historyBatches: [], currentCalculatedItems: [product('小米', '小米15', 0, true)], sourceId: LIVE_DRAFT });
assert.equal(noWeight.metrics.tmItemScore, null);
const noPrice = buildCompetitivenessView({ historyBatches: [], currentCalculatedItems: [{ ...live[0], tmPrice: 0 }], sourceId: LIVE_DRAFT });
assert.equal(noPrice.metrics.tmItemScore, null);
assert.equal(noPrice.metrics.zzItemScore, 0);
const empty = buildCompetitivenessView({ historyBatches: [], currentCalculatedItems: [], sourceId: LIVE_DRAFT });
assert.equal(empty.details?.batchId, LIVE_DRAFT);
assert.ok(Object.values(empty.metrics).every(value => value === null));
assert.equal(buildCompetitivenessView({ historyBatches: [], currentCalculatedItems: [] }).details, null);
assert.equal(buildCompetitivenessView({ ...input, sourceId: 'deleted-batch' }).sourceId, ALL_BATCHES);

const duplicateDates = buildCompetitivenessView({ ...input, historyBatches: [...history, { ...history[2], id: 'TRACK-SAME-DAY' }] });
assert.equal(new Set(duplicateDates.timeline.map(point => point.batchId)).size, duplicateDates.timeline.length);
const many = Array.from({ length: 20 }, (_, i) => ({ ...all.timeline[1], batchId: `TRACK-${i}` }));
assert.equal(getCompetitivenessViewRange(many, 'recent15', 'TRACK-0').range, 'all');
assert.equal(getCompetitivenessViewRange(many, 'recent15', 'TRACK-0').points.length, 20);
assert.equal(getCompetitivenessViewRange(many, 'recent15', 'TRACK-19').points.length, 15);

const self = buildCompetitivenessView({ ...input, historyBatches: [...history, { ...history[2], channelId: 'selfOperated', id: 'SELF' }], channelId: 'selfOperated' });
assert.deepEqual(self.batches.map(batch => batch.id), ['SELF']);
assert.deepEqual(self.seriesOptions, []);
assert.equal(JSON.stringify(input), original, 'view selection never mutates saved snapshots or live rows');
console.log('competitiveness view: scope, snapshots, weighting, missing data, timeline and channel checks passed');
