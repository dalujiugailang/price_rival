import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';
import { buildPpvAggregation } from './UploadSection';

const file = (rows: unknown[][], name = 'test.xlsx') => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  return new File([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], name);
};
const flowHeaders = ['商品型号', '商品SKUID', '商品SKU', '商品LEVEL', '报价量', '成交量'];
const soldHeaders = ['质检SKUID', '质检LEVEL', '成交订单量', '质检型号', '质检SKU'];
const flow = file([flowHeaders,
  ['甲', '1', '甲256', 'A', 30, 9999],
  ['甲', '1', '甲256', 'A', 20, 9999],
  ['甲', '1', '甲256', 'B', 40, 9999],
  ['甲', '2', '甲512', 'A', 10, 9999],
  ['甲', '3', '甲128', 'S', 99999, 9999],
  ['乙', '4', '乙256', '99-S', 10, 9999],
  ['乙', '5', '乙512', '95-S', 10, 9999],
  ['乙', '6', '乙128', 'B', 10, 9999],
]);
const sold = file([soldHeaders, ['1', 'A', 2, '甲', '甲256'], ['1', 'A', 3, '甲', '甲256'], ['2', 'A', 5, '甲', '甲512'], ['9', 'B', 7, '丙', '丙256']]);
const result = await buildPpvAggregation(flow, sold, 'tradeIn');
assert.equal(result.fullRows.find(r => r.skuId === '1' && r.level === 'A')?.quoteVolume, 50);
assert.equal(result.fullRows.find(r => r.skuId === '1' && r.level === 'A')?.soldVolume, 5, 'duplicate source rows must not multiply sales');
assert.equal(result.fullRows.find(r => r.skuId === '1' && r.level === 'B')?.soldVolume, 0, 'same SKU different grade must not match');
assert.equal(result.fullRows.reduce((sum, r) => sum + r.soldVolume, 0), 17, 'union retains sales-only combinations and ignores old inquiry-linked sales');
assert.deepEqual(result.outputRows.filter(r => r.model === '甲').map(r => r.skuId + r.level).sort(), ['1A', '1B']);
assert.equal(result.outputRows.filter(r => r.model === '乙').length, 3, 'second-place ties and compound S grades remain');
assert.ok(!result.outputRows.some(r => r.level === 'S'));
assert.match(result.audit, /仅成交表 1 个组合、成交量 7/);
assert.equal(result.fullRows.find(r => r.skuId === '9')?.quoteVolume, 0);
assert.ok(!result.outputRows.some(r => r.skuId === '9'));
await assert.rejects(buildPpvAggregation(flow, file([soldHeaders, ['9', 'A', 1]]), 'tradeIn'), /缺少质检型号或质检SKU/);
await assert.rejects(buildPpvAggregation(file([flowHeaders, ['甲', '', '甲', 'A', 1, 0]]), sold, 'tradeIn'), /缺少/);
await assert.rejects(buildPpvAggregation(flow, file([soldHeaders, ['1', 'A', -1]]), 'tradeIn'), /非负整数/);
const self = await buildPpvAggregation(file([['商品型号', '商品SKUID', '商品SKU', '商品LEVEL', '报价访客数'], ['甲', '1', '甲256', 'A', 20]]), sold, 'selfOperated');
assert.equal(self.outputRows[0].quoteVolume, 20);
assert.equal(self.outputRows[0].soldVolume, 5);

// Optional real source verification, without retaining its contents in the repository.
if (process.env.PPV_SOLD_SOURCE) {
  const bytes = await readFile(process.env.PPV_SOLD_SOURCE);
  const wb = XLSX.read(bytes, { type: 'buffer' });
  const records = XLSX.utils.sheet_to_json<Record<string, string | number>>(wb.Sheets[wb.SheetNames[0]]);
  const realFlow = file([flowHeaders, ...records.map(r => [r['质检型号'], r['质检SKUID'], r['质检SKU'], r['质检LEVEL'], 10, 99999])]);
  const real = await buildPpvAggregation(realFlow, new File([bytes], 'real.xlsx'), 'tradeIn');
  const total = records.reduce((sum, r) => sum + Number(r['成交订单量']), 0);
  assert.equal(real.fullRows.reduce((sum, r) => sum + r.soldVolume, 0), total);
  console.log(`Real source: ${records.length} rows, sales ${total}, matched without multiplication.`);
}
console.log('PPV separate sources: aggregation, grade identity, ranking, ties, validation and both channels passed.');
