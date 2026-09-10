import assert from 'node:assert/strict';
import LZString from 'lz-string';
import { createWorkspaceDraftStorage, CHANNEL_STATE_STORAGE_KEY } from './workspaceDraftStorage';
import { createSnapshotSync } from './snapshotSync';
import type { TrackingBatch } from '../types';

const { compressToUTF16, decompressFromUTF16 } = LZString;

const batch = { id: 'old-snapshot', products: [], isSummaryOnly: true } as TrackingBatch;
const channel = (name: string, history: TrackingBatch[] = []) => ({
  productsMaster: [{ id: name, ppv: 'same-ppv', rawFields: { 品牌: name, 备注: '=1+1' } }],
  dailyPriceRows: [], subsidyRules: [], historyBatches: history, marginBottomLine: .03,
  manualRecommendPrices: {}, extensionFromOldDraft: name
});
type State = ReturnType<typeof channel>;
const initial = { tradeIn: channel('A', [batch]), selfOperated: channel('B') };
const pack = (value: unknown) => 'lz:' + compressToUTF16(JSON.stringify(value));
const unpack = (value: string) => JSON.parse(value.startsWith('lz:') ? decompressFromUTF16(value.slice(3)) : value);
const storage = (value: string) => ({
  value, reads: 0, writes: 0, fail: false,
  getItem(key: string) { assert.equal(key, CHANNEL_STATE_STORAGE_KEY); this.reads++; return this.value; },
  setItem(key: string, next: string) { assert.equal(key, CHANNEL_STATE_STORAGE_KEY); this.writes++; if (this.fail) throw new Error('quota'); this.value = next; }
});

for (const source of [JSON.stringify(initial), pack(initial)]) {
  const disk = storage(source);
  const keeper = createWorkspaceDraftStorage<State>(disk);
  const states = keeper.initial as typeof initial;
  keeper.initialize(states);
  assert.equal(keeper.readError, '');
  assert.equal(keeper.save(states, ['tradeIn', 'selfOperated']).saved, false);
  const synced = { ...states, tradeIn: { ...states.tradeIn, historyBatches: [{ ...batch, id: 'from-server' }] } };
  keeper.save(synced, ['tradeIn', 'selfOperated']);
  keeper.save({ ...synced }, ['tradeIn', 'selfOperated']); // renewed permissions/container identity
  assert.equal(disk.reads, 1, 'unchanged history/auth must not read or decode storage again');
  assert.equal(disk.writes, 0, 'mount and history-only changes must not write a draft');

  const changed = { ...synced, tradeIn: { ...synced.tradeIn, marginBottomLine: .05 } };
  assert.equal(keeper.save(changed, ['tradeIn']).saved, true);
  assert.equal(disk.writes, 1);
  let saved = unpack(disk.value);
  assert.deepEqual(saved.tradeIn.historyBatches, [batch], 'retain unmigrated local history if migration fails');
  assert.deepEqual(saved.selfOperated, initial.selfOperated, 'preserve the other channel and original fields');
  keeper.confirmHistoryMigration([batch.id]);
  const changedAgain = { ...changed, tradeIn: { ...changed.tradeIn, marginBottomLine: .06 } };
  keeper.save(changedAgain, ['tradeIn']);
  saved = unpack(disk.value);
  assert.deepEqual(saved.tradeIn.historyBatches, [], 'drop only confirmed legacy migration records, never store fetched history');
  assert.deepEqual(saved.tradeIn.productsMaster, initial.tradeIn.productsMaster);
}

{
  const disk = storage(pack(initial)), keeper = createWorkspaceDraftStorage<State>(disk);
  keeper.initialize(initial);
  const next = { ...initial, tradeIn: { ...initial.tradeIn, marginBottomLine: .09 } };
  disk.fail = true;
  const before = disk.value;
  assert.match(keeper.save(next, ['tradeIn']).error, /保存失败/);
  assert.equal(disk.value, before, 'quota error preserves the original storage');
  disk.fail = false;
  assert.equal(keeper.save(next, ['tradeIn']).saved, true, 'same pending draft can be retried');
  assert.equal(unpack(disk.value).tradeIn.marginBottomLine, .09);
}
for (const broken of ['lz:broken', '{invalid', '[]', '{"tradeIn":{"productsMaster":{}}}']) {
  const disk = storage(broken), keeper = createWorkspaceDraftStorage<State>(disk);
  keeper.initialize(initial);
  const next = { ...initial, tradeIn: { ...initial.tradeIn, marginBottomLine: .09 } };
  assert.ok(keeper.readError);
  assert.ok(keeper.save(next, ['tradeIn']).error);
  assert.equal(disk.writes, 0);
  assert.equal(disk.value, broken, 'do not replace unreadable data with a fallback draft');
}
{
  const disk = storage(pack(initial)), keeper = createWorkspaceDraftStorage<State>(disk);
  keeper.initialize(initial);
  const otherWindow = { ...initial, selfOperated: { ...initial.selfOperated, marginBottomLine: .12 } };
  disk.value = pack(otherWindow);
  const next = { ...initial, tradeIn: { ...initial.tradeIn, marginBottomLine: .09 } };
  assert.equal(keeper.save(next, ['tradeIn']).saved, true);
  assert.equal(unpack(disk.value).selfOperated.marginBottomLine, .12, 'merge newer other-channel edits');

  disk.value = pack({ ...unpack(disk.value), tradeIn: { ...next.tradeIn, marginBottomLine: .20 } });
  const before = disk.value;
  assert.match(keeper.save({ ...next, tradeIn: { ...next.tradeIn, marginBottomLine: .10 } }, ['tradeIn']).error, /其他窗口/);
  assert.equal(disk.value, before, 'never overwrite a newer same-channel draft');
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
{
  const old = deferred<string>(), latest = deferred<string>(), applied: string[] = [], errors: unknown[] = [];
  let calls = 0;
  const sync = createSnapshotSync(() => (++calls === 1 ? old.promise : latest.promise), value => applied.push(value), error => errors.push(error));
  const first = sync.refresh();
  assert.equal(sync.refresh(), first, 'focus/visibility/manual concurrent reads share a request');
  await Promise.resolve();
  sync.invalidate(); // snapshot POST, DELETE or backfill completed
  const second = sync.refresh();
  latest.resolve('new-snapshot');
  await second;
  old.resolve('before-save');
  await first;
  assert.deepEqual(applied, ['new-snapshot'], 'a pre-mutation read must not overwrite new shared history');
  assert.equal(calls, 2);
  assert.equal(errors.length, 0);
  sync.dispose();
  await assert.rejects(sync.refresh(), /已结束/);
  assert.equal(calls, 2);
}
{
  const pending = deferred<string>(), applied: string[] = [], errors: unknown[] = [];
  let calls = 0;
  const sync = createSnapshotSync(() => { calls++; return pending.promise; }, value => applied.push(value), error => errors.push(error));
  const first = sync.refresh();
  await Promise.resolve();
  sync.dispose(); // logout or scope change remounts App
  pending.resolve('old-user-data');
  await first;
  assert.deepEqual(applied, [], 'discard responses owned by an unmounted user/session');
  assert.equal(errors.length, 0);
}
{
  let calls = 0;
  const errors: unknown[] = [], applied: string[] = [];
  const sync = createSnapshotSync(async () => { if (++calls === 1) throw new Error('offline'); return 'recovered'; }, value => applied.push(value), error => errors.push(error));
  await assert.rejects(sync.refresh(), /offline/);
  await sync.refresh();
  assert.equal(errors.length, 1);
  assert.deepEqual(applied, ['recovered'], 'failed sync can recover with an explicit refresh');
}
console.log('Workspace sync: unchanged drafts, v1 compatibility, quota/corruption, legacy migration, channel conflicts, request deduplication and stale-response isolation passed.');
