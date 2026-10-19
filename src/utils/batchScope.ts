import { TrackingBatch } from '../types';
export const batchScopeKey = (batch: Pick<TrackingBatch, 'batchType' | 'launchActivity'>) => JSON.stringify([batch.batchType || 'unclassified', batch.batchType === 'launch' ? (batch.launchActivity || '').trim() : '']);
export const batchTypeLabel = (batch: Pick<TrackingBatch, 'batchType' | 'launchActivity'>) => batch.batchType === 'launch' ? '发新期' : batch.batchType === 'regular' ? '常规期' : '未分类';
export const filterBatchScope = (batches: TrackingBatch[], type: string, activity?: string) => batches.filter(batch => (batch.batchType || 'unclassified') === type && (type !== 'launch' || activity === undefined || (batch.launchActivity || '').trim() === activity.trim()));
