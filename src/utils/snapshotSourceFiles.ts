import type { SourceUploadRecord, TrackingBatch } from '../types';

// Upload history stays complete; a snapshot binds only the latest record of each file type.
export function selectSnapshotSourceFiles(records: SourceUploadRecord[]): SourceUploadRecord[] {
  return (['base', 'subsidy'] as const).flatMap(type => {
    const latest = records.reduce<SourceUploadRecord | undefined>((selected, record) => (
      record.type === type && (!selected || record.uploadedAt > selected.uploadedAt) ? record : selected
    ), undefined);
    return latest ? [latest] : [];
  });
}

export function getSnapshotSourceFiles(batch: TrackingBatch): SourceUploadRecord[] {
  return selectSnapshotSourceFiles(batch.snapshotSourceFiles ?? batch.sourceUploadRecords ?? []);
}
