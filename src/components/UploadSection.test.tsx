import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import UploadSection from './UploadSection';
import { SourceUploadRecord } from '../types';

const record = (id: string, type: 'base' | 'subsidy', sourceFileId?: string): SourceUploadRecord => ({
  id,
  type,
  fileName: `${id}.xlsx`,
  sourceFileId,
  uploadedAt: '2026-09-30 10:00:00',
  rowCount: 1
});

const records = [
  record('base-new', 'base', 'file-base-new'),
  record('subsidy-new', 'subsidy', 'file-subsidy-new'),
  record('base-old', 'base', 'file-base-old'),
  record('subsidy-old', 'subsidy', 'file-subsidy-old'),
  record('base-no-file', 'base')
];

const render = (restoredSnapshotFiles: { batchId: string; uploadRecords: SourceUploadRecord[] } | null) => renderToStaticMarkup(
  <UploadSection
    channelId="tradeIn"
    currentProducts={[]}
    dailyPrices={[]}
    subsidyRules={[]}
    selfSubsidyRules={[]}
    uploadRecords={records}
    restoredSnapshotFiles={restoredSnapshotFiles}
    onBaseProductsLoaded={() => {}}
    onDailyPricesLoaded={async () => {}}
    onSubsidyRulesLoaded={() => {}}
    onSelfSubsidyRulesLoaded={() => {}}
    onCompetitivenessHistoryLoaded={() => {}}
  />
);

const ordinary = render(null);
assert.doesNotMatch(ordinary, /已归档原文件/);
assert.match(ordinary, /aria-label="下载 base-old.xlsx"/, 'upload history keeps earlier downloads');
const uploadTable = ordinary.slice(ordinary.indexOf('上传记录'));
assert.match(uploadTable, /<th[^>]*>操作<\/th>/);
const rows = [...uploadTable.matchAll(/<tr[^>]*>(.*?)<\/tr>/g)].map(match => match[1]);
const cellsFor = (name: string) => [...(rows.find(row => row.includes(`${name}.xlsx`)) || '').matchAll(/<td[^>]*>(.*?)<\/td>/g)].map(match => match[1]);
const baseCells = cellsFor('base-new');
assert.equal(baseCells.length, 7);
assert.doesNotMatch(baseCells[1], /<a|<svg/, 'file name cell contains only file name text');
assert.match(baseCells[6], /href="\/api\/source-files\/file-base-new\/file"/, 'download stays bound to its own row');
assert.match(baseCells[6], /下载/);
const missingCells = cellsFor('base-no-file');
assert.match(missingCells[6], /<button[^>]*disabled=""/);
assert.doesNotMatch(missingCells[6], /<a/, 'a missing original has no download link');

const restored = render({ batchId: 'TRACK-TEST', uploadRecords: records });
const archive = restored.split('上传记录')[0];
assert.match(archive, /已归档原文件/);
assert.match(archive, /file-base-new/);
assert.match(archive, /file-subsidy-new/);
assert.doesNotMatch(archive, /file-base-old|file-subsidy-old/, 'archive shows one latest file per type');

const missingLatest = render({ batchId: 'TRACK-OLD', uploadRecords: [record('base-missing', 'base'), ...records] });
const missingArchive = missingLatest.split('上传记录')[0];
assert.doesNotMatch(missingArchive, /file-base-new/, 'a missing latest original never falls back to an unrelated earlier file');
assert.match(missingArchive, /file-subsidy-new/);

console.log('Snapshot source files: hidden by default, latest per type, upload history and missing originals passed.');
