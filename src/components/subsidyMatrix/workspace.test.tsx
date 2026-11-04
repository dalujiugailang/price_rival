import {heatmapCell, ratioSpread, heatmapSpread, spreadText} from './heatmapStyle';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as XLSX from 'xlsx';
import {workbookToBytes} from '@office-kit/xlsx/io';
import type {CalculatedProduct, SubsidyRule, TrackingBatch} from '../../types';
import {buildNewSeriesScenarios, buildProfitView, buildSeriesProfitResults, buildWorkspaceMatrix, filterMatrixRows, getSeriesRuleDetails, resolveMatrixFilters, resolveMatrixWorkspace, sortMatrixRows, cycleMatrixSort, selectHeatmapGroups} from './model';
import {createMatrixWorkbook} from './workbook';
import SubsidyMatrixPanel from './SubsidyMatrixPanel';
import ProfitPerspectives from './ProfitPerspectives';
import {RuleTable} from './ui';
import type {MatrixWorkspace} from './types';

const rule = (series: string, threshold: number, ahs: number, brand = '新机品牌'): SubsidyRule => ({
  newSeries: series, threshold, ahsInput: ahs, jdSubsidy: ahs + 50,
  rawFields: {'品牌': brand, '新机系列': series, '门槛': threshold, '爱回收承担总补贴': ahs, '备注': '原始备注保留'}
});
const product = (id: string, series = '当前新机'): CalculatedProduct => ({
  id, newSeries: series, oldModel: '旧机型号', ppv: `PPV-${id}`, brand: '旧机品牌',
  recommendJdPrice: 1000, ahsSubsidyAfter: 100, basePrice: 1500, postMarginalProfit: .07
} as CalculatedProduct);
const liveRules = [rule('当前新机', 500, 150), rule('目标新机', 501, 180), rule('未用新机', 500, 200)];
const products = [product('p1'), product('p2'), product('p3', '目标新机'), product('p4', '缺规则系列')];
const workspace: MatrixWorkspace = {products, subsidyRules: liveRules, fileName: '本次工作台补贴.xlsx', label: '当前工作台 · 竞争版本 V2'};

test('current calculation pairs its own products, rules and source, even with a historical snapshot available', () => {
  const snapshot = {id: 'SAVED', products: [product('old')], subsidyFileName: 'old.xlsx', restorePayload: {subsidyRules: [rule('旧系列', 0, 0)]}} as TrackingBatch;
  const context = resolveMatrixWorkspace({useSharedSnapshot: false, snapshot, products, subsidyRules: liveRules, fileName: workspace.fileName, version: 2});
  assert.equal(context.products, products);
  assert.equal(context.subsidyRules, liveRules);
  assert.equal(context.fileName, workspace.fileName);
  assert.equal(context.snapshotId, undefined);
});

test('shared snapshot carries frozen rules and file metadata, never current or separate-upload rules', () => {
  const frozen = [rule('历史系列', 199, 98)];
  const frozenProducts = [product('saved', '历史系列')];
  const snapshot = {id: 'SAVED', products: frozenProducts, subsidyFileName: 'legacy.xlsx', restorePayload: {subsidyRules: frozen, activeSubsidyFileName: 'snapshot.xlsx'}} as TrackingBatch;
  const context = resolveMatrixWorkspace({useSharedSnapshot: true, snapshot, products, subsidyRules: liveRules, fileName: workspace.fileName, version: 2});
  assert.equal(context.products, frozenProducts);
  assert.equal(context.subsidyRules, frozen);
  assert.equal(context.fileName, 'snapshot.xlsx');
  assert.equal(context.snapshotId, 'SAVED');
  const missing = resolveMatrixWorkspace({useSharedSnapshot: true, snapshot: {...snapshot, restorePayload: undefined}, products, subsidyRules: liveRules, fileName: workspace.fileName, version: 2});
  assert.deepEqual(missing.subsidyRules, []);
  assert.equal(missing.fileName, 'legacy.xlsx');
  const html = renderToStaticMarkup(<SubsidyMatrixPanel workspace={missing} marginBottomLine={.03}/>);
  assert.ok(html.includes('此快照未保存补贴规则'));
  assert.ok(!html.includes('本次工作台补贴.xlsx'));
});

test('active series come from exact newSeries, preserve counts, and retain missing-rule rows', () => {
  const matrix = buildWorkspaceMatrix(liveRules, products);
  assert.equal(matrix.usage.get('当前新机'), 2);
  assert.equal(matrix.usage.size, 3);
  assert.equal(matrix.rows.find(row => row.series === '目标新机').brand, '新机品牌');
  assert.ok(matrix.rows.every(row => !row.brand.includes('旧机品牌')));
  assert.equal(matrix.rows.at(-1).series, '未用新机');
  assert.deepEqual(matrix.missingSeries, ['缺规则系列']);
  assert.equal(matrix.rows.find(row => row.series === '缺规则系列').hasRules, false);
  assert.equal(matrix.rules[0].sourceRow, null, 'do not invent physical Excel row numbers absent from the workspace source');
  assert.equal(matrix.rules[0].raw, liveRules[0].rawFields);
  assert.deepEqual(buildWorkspaceMatrix([], []).rows, []);
});

test('series-only eligibility matches production across source brands and never duplicates risk rows', () => {
  const source = [rule('同系列', 199, 100, '品牌甲'), rule('同系列', 401, 200, '品牌乙')];
  const matrix = buildWorkspaceMatrix(source, [product('p', '同系列')]);
  assert.equal(matrix.rows.length, 1);
  assert.equal(matrix.rows[0].brand, '品牌甲 / 品牌乙');
  const results = buildSeriesProfitResults({rows: matrix.rows, rules: matrix.rules, product: product('other'), floor: .03});
  assert.equal(results.length, 1);
  assert.equal(results[0].hit.ahs, 200);
});

test('conflicting ties are unknown, exact duplicates remain traceable, invalid tiers cannot fall back to lower subsidies', () => {
  const source = [rule('冲突系列', 400, 100), rule('冲突系列', 400, 180), rule('重复系列', 400, 100), rule('重复系列', 400, 100), rule('无效系列', 400, 100), rule('无效系列', NaN, 200)];
  const matrix = buildWorkspaceMatrix(source, products);
  const results = buildSeriesProfitResults({rows: matrix.rows, rules: matrix.rules, product: products[0], floor: .03, invalidSeries: matrix.invalidSeries});
  assert.equal(results.find(r => r.row.series === '冲突系列').hit.status, 'conflict');
  assert.equal(results.find(r => r.row.series === '冲突系列').comparison, null);
  assert.equal(results.find(r => r.row.series === '重复系列').hit.rules.length, 2);
  assert.ok(results.find(r => r.row.series === '重复系列').comparison);
  assert.equal(results.find(r => r.row.series === '无效系列').hit.status, 'invalid');
  assert.equal(results.find(r => r.row.series === '无效系列').comparison, null);
  assert.equal(matrix.issues.length, 2);
});

test('saved baseline is read verbatim; target profit uses system costs and original raw thresholds', () => {
  const source = [rule('当前新机', 500, 150), rule('目标新机', 499, 180), rule('目标新机', 501, 300)];
  const p = {...products[0], recommendJdPrice: 500};
  const matrix = buildWorkspaceMatrix(source, [p]);
  const results = buildSeriesProfitResults({rows: matrix.rows, rules: matrix.rules, product: p, floor: .03});
  const current = results.find(r => r.current), target = results.find(r => r.row.series === '目标新机');
  assert.equal(current.comparison.rate, .07);
  assert.equal(current.comparison.delta, 0);
  assert.ok(Math.abs(current.comparison.profit - 105) < 1e-9);
  assert.equal(target.hit.ahs, 180, '501-tier in same merged display group is not reached');
  assert.equal(target.comparison.delta, 80, 'compare with saved 100, not imported baseline tier 150');
  assert.ok(Math.abs(target.comparison.profit - (105 - 80 * 1.0466)) < 1e-9);
  assert.equal(target.comparison.rate, target.comparison.profit / 1500);
  assert.equal(target.comparison.risk, '低利润风险');
});

test('risk floor is supplied by workspace, negative profit wins over negative floors, and unknown inputs stay unknown', () => {
  const matrix = buildWorkspaceMatrix(liveRules, products);
  const get = (p: CalculatedProduct, floor: number) => buildSeriesProfitResults({rows: matrix.rows, rules: matrix.rules, product: p, floor}).find(r => r.row.series === '目标新机');
  assert.equal(get(products[0], 0).comparison.risk, '正常');
  assert.equal(get(products[0], .03).comparison.risk, '低利润风险');
  assert.equal(get({...products[0], postMarginalProfit: 0}, -.03).comparison.risk, '亏损风险');
  assert.equal(get({...products[0], basePrice: 0}, .03).comparison, null);
  assert.equal(get({...products[0], postMarginalProfit: NaN}, .03).comparison, null);
});

test('an exactly-on-floor saved plan or zero subsidy change is not misclassified by floating point conversion', () => {
  const p = {...products[0], basePrice: 545, postMarginalProfit: .03};
  const matrix = buildWorkspaceMatrix([rule('当前新机', 500, 100), rule('目标新机', 500, 100)], [p]);
  const results = buildSeriesProfitResults({rows: matrix.rows, rules: matrix.rules, product: p, floor: .03});
  assert.equal(results.find(r => r.current).comparison.rate, .03);
  assert.ok(results.every(r => r.comparison.risk === '正常'));
});

test('default UI includes two perspectives, exact series filter, no risk mode or independent uploads', () => {
  const html = renderToStaticMarkup(<SubsidyMatrixPanel workspace={workspace} marginBottomLine={.03}/>);
  assert.ok(html.includes('本次工作台补贴.xlsx'));
  assert.ok(!html.includes('type="file"') && !html.includes('查看历史版本') && !html.includes('更新补贴表'));
  const matrixBody = html.split('class="sm-table"')[1].split('</table>')[0];
  assert.ok(matrixBody.includes('当前新机') && matrixBody.includes('缺规则系列'));
  assert.ok(matrixBody.includes('未用新机'));
  assert.ok(matrixBody.includes('data-in-use="true"') && matrixBody.includes('目标'));
  assert.ok(!html.includes('aria-label="系列使用范围"') && html.includes('aria-label="新机系列筛选"'));
  assert.ok(!html.includes('同档增亏风险'));
  assert.ok(html.includes('新机视角') && html.includes('旧机视角'));
  assert.ok(html.includes('工作台对应') && html.includes('不代表实际换新订单'));
  const selection = {view: 'old' as const, productId: products[0].id, targetSeries: '', onlyRisks: false};
  const matrix = buildWorkspaceMatrix(liveRules, products);
  const model = buildProfitView({selection, rows: matrix.rows, rules: matrix.rules, products, floor: .03});
  const profit = renderToStaticMarkup(<ProfitPerspectives workspace={workspace} model={model} selection={selection} onChange={() => {}} floor={.03} onDetail={() => {}}/>);
  assert.equal((profit.match(/<select/g) || []).length, 1);
  assert.ok(!profit.includes('type="number"'));
  assert.ok(profit.includes('当前换新系列') && profit.includes('当前承担补贴'));
  assert.ok(profit.includes('多 80 元') && profit.includes('低利润风险'));
  assert.ok(!html.includes('rounded') && !html.includes('slate-') && !html.includes('#172b3a'));
});

test('export contains only the filtered heatmap with workspace source and target markers', async () => {
  const matrix = buildWorkspaceMatrix(liveRules, products);
  const rows = matrix.rows.filter(row => row.activeCount > 0);
  const book = createMatrixWorkbook({workspace, rows, groups: matrix.groups, columnWidth: 110});
  const loaded = XLSX.read(await workbookToBytes(book), {type: 'array', cellStyles: true});
  assert.deepEqual(loaded.SheetNames, ['补贴承担热力图']);
  const sheet = loaded.Sheets[loaded.SheetNames[0]];
  assert.equal(sheet.A1.v, '所有新机系列—爱回收承担补贴热力图');
  assert.ok(sheet.A2.v.includes(workspace.fileName));
  const data = XLSX.utils.sheet_to_json(sheet, {header: 1}) as unknown[][];
  assert.ok(!data.some(row => row.some(cell => String(cell).includes('未用新机'))));
  assert.ok(data.some(row => row.some(cell => String(cell).includes('缺规则系列'))));
  assert.ok(data.some(row => row.some(cell => String(cell).includes('【目标】'))));
  assert.equal(sheet.B5.v, 150);
  assert.equal(sheet.B5.s.fgColor.rgb, 'B2DBF6');
  assert.equal(book.sheets.length, 1);
});

test('new and old perspectives agree and each quote keeps its own after-price and PPV/grade identity', () => {
  const source = [rule('目标新机', 141, 100), rule('目标新机', 146, 180), rule('其他新机', 100, 50)];
  const oldQuotes = [{...product('p1', '其他新机'), recommendJdPrice: 145}, {...product('p2', '其他新机'), recommendJdPrice: 146}, product('linked', '目标新机')];
  const matrix = buildWorkspaceMatrix(source, oldQuotes);
  const target = matrix.rows.find(row => row.series === '目标新机');
  const scenarios = buildNewSeriesScenarios({target, rules: matrix.rules, products: oldQuotes, floor: .03});
  assert.equal(scenarios.length, 3);
  assert.equal(scenarios.find(s => s.product.id === 'p1').result.hit.ahs, 100);
  assert.equal(scenarios.find(s => s.product.id === 'p2').result.hit.ahs, 180);
  assert.equal(scenarios.find(s => s.product.id === 'linked').relation, 'workspace');
  assert.equal(scenarios.find(s => s.product.id === 'p1').relation, 'scenario');
  for (const scenario of scenarios) {
    const oldView = buildSeriesProfitResults({rows: [target], rules: matrix.rules, product: scenario.product, floor: .03})[0];
    assert.deepEqual(scenario.result, oldView);
  }
  const all = buildProfitView({selection: {view: 'new', productId: '', targetSeries: target.series, onlyRisks: false}, rows: matrix.rows, rules: matrix.rules, products: oldQuotes, floor: .03});
  assert.equal(all.visibleScenarios.length, 3);
  assert.equal(all.riskResults.length, 3);
  assert.equal(all.visibleScenarios.find(s => s.product.id === 'p1').result.hit.ahs, 100);
  assert.equal(all.visibleScenarios.find(s => s.product.id === 'p2').result.hit.ahs, 180);
  assert.ok(all.visibleScenarios.every((scenario, index, list) => index === 0 || (list[index - 1].result.comparison?.profit ?? Infinity) <= (scenario.result.comparison?.profit ?? Infinity)));

});

test('click details show all series rules and box the entire selected group including duplicate rules', () => {
  const matrix = buildWorkspaceMatrix([rule('A', 141, 50), rule('A', 146, 180), rule('A', 146, 180), rule('A', 500, 300), rule('B', 199, 60)], []);
  const details = getSeriesRuleDetails(matrix.rules, matrix.groups, 'A', '141');
  assert.equal(details.rules.length, 4);
  assert.deepEqual(details.rules.map(r => r.threshold), [141, 146, 146, 500]);
  assert.equal(details.highlightedIds.length, 3);
  const html = renderToStaticMarkup(<RuleTable rules={details.rules} highlightedIds={details.highlightedIds}/>);
  assert.equal((html.match(/data-highlighted="true"/g) || []).length, 3);
  assert.equal((html.match(/sm-rule-first/g) || []).length, 1);
  assert.equal((html.match(/sm-rule-last/g) || []).length, 1);
  assert.ok(html.includes('500'));
});

test('exact series dropdown combines with target range, brand and search without changing subsidy thresholds', () => {
  const matrix = buildWorkspaceMatrix(liveRules, products);
  assert.deepEqual(filterMatrixRows(matrix.rows, {scope: 'active', brand: '新机品牌', series: '目标新机'}).map(r => r.series), ['目标新机']);
  assert.equal(filterMatrixRows(matrix.rows, {scope: 'active', brand: '', series: '未用新机'}).length, 0);
  assert.equal(filterMatrixRows(matrix.rows, {scope: 'all', brand: '', series: '未用新机'}).length, 1);
  assert.equal(filterMatrixRows(matrix.rows, {scope: 'all', brand: '其他品牌', series: '目标新机'}).length, 0);
});

test('saved Excel retains all six heat colors, amount ranges, missing values, dimensions and sorted order', async () => {
  const rules = [rule('zero', 500, 0), rule('blue', 500, 150), rule('yellow', 500, 250), rule('orange', 500, 400), rule('red', 500, 600), rule('dark', 500, 800), rule('multi', 500, 100), rule('multi', 501, 200), rule('missing', 1500, 20)];
  const matrix = buildWorkspaceMatrix(rules, []);
  const groups = matrix.groups.filter(g => g.min === 500);
  const rows = sortMatrixRows(matrix.rows, groups[0].key);
  const book = createMatrixWorkbook({workspace: {...workspace, subsidyRules: rules}, rows, groups, columnWidth: 120});
  const loaded = XLSX.read(await workbookToBytes(book), {type: 'array', cellStyles: true});
  const sheet = loaded.Sheets[loaded.SheetNames[0]];
  const expected = ['BB4E5A', 'EB927E', 'F8BD8E', 'FFE6A7', 'FFE6A7', 'B2DBF6', 'DCE8F4', 'F9F9F8'];
  assert.deepEqual(rows.map((_, i) => sheet[`B${i + 5}`].s.fgColor.rgb), expected);
  assert.ok(sheet.A5.v.includes('dark'));
  assert.equal(sheet.B9.v, '100–200 ◈');
  assert.equal(sheet.B11.v, 0);
  assert.equal(sheet.B12.v, '—');
  assert.equal(sheet['!rows'][4].hpt, 27.75);
  assert.equal(sheet['!rows'][3].hpt, 38.25);
  assert.ok(Math.abs(sheet['!cols'][1].width - (120 - 5) / 7) < .01);
});

test('no workspace quote gives an old-view empty state with no clickable invalid scenario', () => {
  const empty = {...workspace, products: []};
  const matrix = buildWorkspaceMatrix(liveRules, []);
  const selection = {view: 'old' as const, productId: '', targetSeries: '', onlyRisks: false};
  const model = buildProfitView({selection, rows: matrix.rows, rules: matrix.rules, products: [], floor: .03});
  assert.deepEqual(model.visibleResults, []);
  const html = renderToStaticMarkup(<ProfitPerspectives workspace={empty} model={model} selection={selection} onChange={() => {}} floor={.03} onDetail={() => {}}/>);
  assert.ok(html.includes('工作台暂无旧机报价'));
  assert.ok(!html.includes('查看原因'));
});

test('source updates invalidate unavailable brand/series filters consistently with displayed options', () => {
  const matrix = buildWorkspaceMatrix(liveRules, products);
  const filters = resolveMatrixFilters(matrix.rows, 'active', '已移除品牌', '已移除系列');
  assert.equal(filters.brand, ''); assert.equal(filters.series, '');
  assert.equal(filterMatrixRows(matrix.rows, {scope: 'active', ...filters}).length, 3);
  const hidden = resolveMatrixFilters(matrix.rows, 'active', '新机品牌', '未用新机');
  assert.equal(hidden.series, '');
});

test('threshold descending sort uses cell maximum, keeps zero before missing, and preserves ties and source order', () => {
  const matrix = buildWorkspaceMatrix([rule('multi', 500, 10), rule('multi', 501, 300), rule('single', 500, 200), rule('zero', 500, 0), rule('tie', 500, 200), rule('missing', 1500, 900)], []);
  const group = matrix.groups.find(g => g.min === 500)!;
  const rows = ['missing', 'single', 'multi', 'zero', 'tie'].map(name => matrix.rows.find(r => r.series === name)!);
  const sorted = sortMatrixRows(rows, group.key);
  assert.deepEqual(sorted.map(r => r.series), ['multi', 'single', 'tie', 'zero', 'missing']);
  assert.deepEqual(sortMatrixRows(rows, group.key, 'ascending').map(r => r.series), ['zero', 'single', 'tie', 'multi', 'missing']);
  assert.equal(rows[0].series, 'missing');
  assert.equal(sortMatrixRows(rows, ''), rows);
});

test('threshold clicks cycle descending, ascending, default; a different threshold starts descending', () => {
  const initial = {groupKey: '', direction: 'descending' as const};
  const first = cycleMatrixSort(initial, '500');
  const second = cycleMatrixSort(first, '500');
  const third = cycleMatrixSort(second, '500');
  assert.deepEqual(first, {groupKey: '500', direction: 'descending'});
  assert.deepEqual(second, {groupKey: '500', direction: 'ascending'});
  assert.deepEqual(third, initial);
  assert.deepEqual(cycleMatrixSort(second, '1000'), {groupKey: '1000', direction: 'descending'});
  assert.deepEqual(cycleMatrixSort(third, '500'), first);
});

test('target-only scope clears an unavailable selected series and retains target rows with missing rules', () => {
  const matrix = buildWorkspaceMatrix(liveRules, products);
  const selected = resolveMatrixFilters(matrix.rows, 'active', '', '未用新机');
  assert.equal(selected.series, '');
  const targets = filterMatrixRows(matrix.rows, {scope: 'active', brand: selected.brand, series: selected.series});
  assert.deepEqual(new Set(targets.map(row => row.series)), new Set(products.map(row => row.newSeries)));
  assert.ok(targets.every(row => row.activeCount > 0));
  assert.ok(targets.some(row => row.series === '缺规则系列'));
  assert.ok(filterMatrixRows(matrix.rows, {scope: 'all', brand: ''}).some(row => row.series === '未用新机'));
});

test('ratio heatmap preserves original threshold and subsidy pairing instead of dividing merged extremes', () => {
  const cell = heatmapCell([{ahs: 100, threshold: 141}, {ahs: 101, threshold: 146}], 'ratio');
  assert.equal(cell.min, 101 / 146);
  assert.equal(cell.max, 100 / 141);
  assert.equal(cell.text, '69.18%–70.92%');
  assert.equal(cell.background, '#BB4E5A');
  assert.equal(heatmapCell([{ahs: 0, threshold: 500}], 'ratio').text, '0.00%');
  assert.equal(heatmapCell([{ahs: 100, threshold: 0}], 'ratio').text, '待核验');
  assert.equal(heatmapCell([{ahs: 0, threshold: 0}, {ahs: 10, threshold: 1}], 'ratio').max, null);
  assert.equal(heatmapCell([], 'ratio').text, '—');
});

test('ratio sorting uses actual ratios in both directions and export keeps native percentages and colors', async () => {
  const rules = [rule('A', 500, 200), rule('B', 501, 200.1), rule('range', 500, 100), rule('range', 501, 180), rule('missing', 1500, 20)];
  const matrix = buildWorkspaceMatrix(rules, []);
  const groups = matrix.groups.filter(g => g.min === 500);
  const descending = sortMatrixRows(matrix.rows, groups[0].key, 'descending', 'ratio');
  assert.deepEqual(descending.map(r => r.series), ['A', 'B', 'range', 'missing']);
  assert.deepEqual(sortMatrixRows(matrix.rows, groups[0].key, 'ascending', 'ratio').map(r => r.series), ['range', 'B', 'A', 'missing']);
  assert.equal(ratioSpread(matrix.rows, groups[0].key), '20.00pp');
  const book = createMatrixWorkbook({workspace, rows: descending, groups, mode: 'ratio'});
  const loaded = XLSX.read(await workbookToBytes(book), {type: 'array', cellStyles: true});
  const sheet = loaded.Sheets[loaded.SheetNames[0]];
  assert.ok(sheet.A1.v.includes('承担比例'));
  assert.equal(sheet.B5.v, .4);
  assert.equal(sheet.B5.z, '0.00%');
  assert.equal(sheet.B5.s.fgColor.rgb, 'F8BD8E');
  assert.equal(sheet.B7.v, '20.00%–35.93% ◈');
  assert.equal(sheet.B8.v, '—');
  const details = renderToStaticMarkup(<RuleTable rules={matrix.rules.filter(r => r.series === 'range')} showRatio/>);
  assert.ok(details.includes('承担比例') && details.includes('20.00%') && details.includes('35.93%'));
});

test('column gap and Excel headers follow brand, target, series and search filters in both modes', async () => {
  const source = [rule('target A', 500, 100, 'brand A'), rule('target B', 501, 200, 'brand A'), rule('other', 500, 800, 'brand B')];
  const matrix = buildWorkspaceMatrix(source, [product('a', 'target A'), product('b', 'target B')]);
  const group = matrix.groups[0];
  assert.equal(heatmapSpread(matrix.rows, group.key, 'amount'), 700);
  for (const filters of [{scope: 'active', brand: ''}, {scope: 'all', brand: 'brand A'}, {scope: 'all', brand: '', search: 'target'}]) {
    const visible = filterMatrixRows(matrix.rows, filters);
    assert.equal(spreadText(visible, group.key, 'amount'), '100');
    assert.equal(spreadText(visible, group.key, 'ratio'), '19.92pp');
    for (const mode of ['amount', 'ratio'] as const) {
      const book = createMatrixWorkbook({workspace, rows: visible, groups: [group], mode});
      const loaded = XLSX.read(await workbookToBytes(book), {type: 'array'});
      assert.equal(loaded.Sheets[loaded.SheetNames[0]].B4.v, `500–501\n最大差额 Δ ${mode === 'amount' ? '100' : '19.92pp'}`);
    }
  }
  const one = filterMatrixRows(matrix.rows, {scope: 'all', brand: '', series: 'target A'});
  assert.equal(spreadText(one, group.key, 'amount'), '0');
  assert.equal(spreadText(one, group.key, 'ratio'), '0.00pp');
  assert.equal(spreadText([], group.key, 'amount'), '—');
});

test('TOP 10 reranks thresholds for filtered rows and current display mode', () => {
  const source = Array.from({length: 11}, (_, i) => [rule('target A', (i + 1) * 100, 0), rule('target B', (i + 1) * 100, i === 10 ? 400 : 100), rule('other', (i + 1) * 100, i === 10 ? 0 : 1000)]).flat();
  const matrix = buildWorkspaceMatrix(source, [product('a', 'target A'), product('b', 'target B')]);
  const targets = filterMatrixRows(matrix.rows, {scope: 'active', brand: ''});
  assert.ok(!selectHeatmapGroups(matrix.groups, matrix.rows, 'top', 'amount').some(g => g.min === 1100));
  assert.ok(selectHeatmapGroups(matrix.groups, targets, 'top', 'amount').some(g => g.min === 1100));
  assert.ok(!selectHeatmapGroups(matrix.groups, targets, 'top', 'amount').some(g => g.min === 1000));
  assert.ok(!selectHeatmapGroups(matrix.groups, targets, 'top', 'ratio').some(g => g.min === 1000));
  assert.deepEqual(selectHeatmapGroups(matrix.groups, [], 'top', 'amount'), []);
  assert.equal(selectHeatmapGroups(matrix.groups, targets, 'all', 'amount').length, 11);
});
