import assert from 'node:assert/strict';
import { listChartsOnSheet } from '@office-kit/xlsx/drawing';
import { loadWorkbook } from '@office-kit/xlsx/io';
import { fromBuffer } from '@office-kit/xlsx/node';
import { getSheet, sheetNames } from '@office-kit/xlsx/workbook';
import { getCell } from '@office-kit/xlsx/worksheet';
import {
  createCompetitivenessTrendWorkbook,
  getCompetitivenessExportFileName,
  normalizeWorksheetNames
} from './competitivenessWorkbook.mjs';

const point = {
  date: '08-14',
  batchName: '批次一',
  nodeType: '历史正式',
  tmDirectScore: 58.6,
  tmItemScore: 61.2,
  ahsVsZzDirectScore: 42.3,
  zzItemScore: 55.4
};

assert.deepEqual(
  normalizeWorksheetNames(['总盘走势', 'A/B:C*D?E[F]G\\H', '同名', '同名']),
  ['总盘走势', 'A B C D E F G H', '同名', '同名 (2)']
);

assert.equal(
  getCompetitivenessExportFileName(new Date('2026-08-14T10:00:00+08:00')),
  '竞争力走势_总盘及品牌_2026-08-14.xlsx'
);

await assert.rejects(
  () => createCompetitivenessTrendWorkbook({ rangeLabel: '全部', sheets: [] }),
  /没有可导出的竞争力走势数据/
);

const buffer = await createCompetitivenessTrendWorkbook({
  rangeLabel: '近15次追价',
  sheets: [
    { sheetName: '总盘走势', chartTitle: '总盘竞争力波动走势', points: [point] },
    { sheetName: '小米', chartTitle: '小米 竞争力波动走势', points: [point] }
  ]
});

assert.equal(Buffer.isBuffer(buffer), true);
const workbook = await loadWorkbook(fromBuffer(buffer));
assert.deepEqual(sheetNames(workbook), ['总盘走势', '小米']);

for (const sheetName of sheetNames(workbook)) {
  const worksheet = getSheet(workbook, sheetName);
  assert.ok(worksheet);
  assert.equal(getCell(worksheet, 23, 1)?.value, '日期');
  assert.equal(getCell(worksheet, 24, 4)?.value, 0.586);
  const charts = listChartsOnSheet(worksheet);
  assert.equal(charts.length, 1);
  const chartItem = charts[0];
  assert.equal(chartItem.content.kind, 'chart');
  if (chartItem.content.kind === 'chart') {
    assert.equal(chartItem.content.chart.space?.plotArea.chart.kind, 'line');
    assert.equal(chartItem.content.chart.space?.plotArea.chart.series.length, 4);
  }
}

console.log('competitiveness workbook checks passed');
