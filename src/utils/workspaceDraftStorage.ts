import type { ChannelId, TrackingBatch } from '../types';
import LZString from 'lz-string';

const { compressToUTF16, decompressFromUTF16 } = LZString;

export const CHANNEL_STATE_STORAGE_KEY = 'pricing_channel_states_v1';
const PREFIX = 'lz:';

type Workspace = { historyBatches: TrackingBatch[] };
type Stored<State> = Partial<Record<ChannelId, Partial<State>>>;
type DraftFields = Record<string, unknown>;
type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;

const fields = (state: object): DraftFields => Object.fromEntries(
  Object.entries(state).filter(([key]) => key !== 'historyBatches')
);
const sameFields = (left: DraftFields | undefined, right: DraftFields) => (
  !!left && Object.keys(left).length === Object.keys(right).length
  && Object.keys(right).every(key => Object.is(left[key], right[key]))
);

const decode = <State,>(raw: string | null): Stored<State> => {
  if (raw === null) return {};
  const json = raw.startsWith(PREFIX) ? decompressFromUTF16(raw.slice(PREFIX.length)) : raw;
  if (!json) throw new Error('本地草稿无法读取，原稿已保留，请先备份再处理。');
  const value = JSON.parse(json);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('本地草稿格式异常，原稿已保留。');
  for (const channel of ['tradeIn', 'selfOperated']) {
    const state = value[channel];
    if (state !== undefined && (!state || typeof state !== 'object' || Array.isArray(state))) {
      throw new Error('本地草稿格式异常，原稿已保留。');
    }
    if (!state) continue;
    for (const field of ['productsMaster', 'dailyPriceRows', 'subsidyRules', 'selfSubsidyRules', 'sourceUploadRecords', 'selectedCompetitionPpvs', 'historyBatches']) {
      if (state[field] !== undefined && !Array.isArray(state[field])) throw new Error('本地草稿字段异常，原稿已保留。');
    }
  }
  return value;
};

// Keep the v1 format. Read/decompress once, then do work only for changed editable drafts.
export const createWorkspaceDraftStorage = <State extends Workspace>(storage: StoragePort) => {
  let raw: string | null = null;
  let stored: Stored<State> = {};
  let readError = '';
  const savedFields: Partial<Record<ChannelId, DraftFields>> = {};
  const migratedIds = new Set<string>();
  try {
    raw = storage.getItem(CHANNEL_STATE_STORAGE_KEY);
    stored = decode<State>(raw);
  } catch {
    readError = '本地草稿无法读取，原稿已保留。请勿清缓存；新编辑暂不写回，可导出当前草稿备份。';
  }
  return {
    initial: stored,
    readError,
    initialize(states: Record<ChannelId, State>) {
      for (const channel of ['tradeIn', 'selfOperated'] as const) savedFields[channel] = fields(states[channel]);
    },
    confirmHistoryMigration(ids: string[]) {
      ids.forEach(id => migratedIds.add(id));
    },
    save(states: Record<ChannelId, State>, editableChannels: ChannelId[]) {
      const nextFields = Object.fromEntries(editableChannels.map(channel => [channel, fields(states[channel])])) as Partial<Record<ChannelId, DraftFields>>;
      const changed = editableChannels.filter(channel => !sameFields(savedFields[channel], nextFields[channel]!));
      if (!changed.length) return { saved: false, error: readError };
      if (readError) return { saved: false, error: readError };
      try {
        const currentRaw = storage.getItem(CHANNEL_STATE_STORAGE_KEY);
        const current = currentRaw === raw ? stored : decode<State>(currentRaw);
        // Merge another window's other-channel edits; never overwrite its newer same-channel draft.
        if (currentRaw !== raw && changed.some(channel => JSON.stringify(current[channel]) !== JSON.stringify(stored[channel]))) {
          return { saved: false, error: '该渠道草稿已在其他窗口修改，未覆盖原稿。请先导出当前草稿备份，再重新进入页面。' };
        }
        const next = { ...current };
        for (const channel of changed) {
          const legacyHistory = (current[channel]?.historyBatches || []) as TrackingBatch[];
          next[channel] = {
            ...current[channel], ...nextFields[channel],
            historyBatches: legacyHistory.filter(batch => !migratedIds.has(batch.id))
          } as Partial<State>;
        }
        const encoded = PREFIX + compressToUTF16(JSON.stringify(next));
        storage.setItem(CHANNEL_STATE_STORAGE_KEY, encoded);
        // Commit bookkeeping only after the write succeeds, so retry does not lose dirty fields.
        raw = encoded;
        stored = next;
        changed.forEach(channel => { savedFields[channel] = nextFields[channel]; });
        return { saved: true, error: '' };
      } catch {
        return { saved: false, error: '本地草稿保存失败，当前编辑仍在页面中。请勿关闭页面，可重试或导出草稿备份。' };
      }
    }
  };
};
