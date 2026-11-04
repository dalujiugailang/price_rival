import {heatmapValues, type HeatmapMode} from './heatmapStyle';
import type {CalculatedProduct, SourceUploadRecord, SubsidyRule, TrackingBatch} from '../../types';
import {buildMatrix, compareSubsidyProfit, hitWorkspaceSeriesRules} from '../../../shared/subsidyMatrix.mjs';
import type {ExchangeScenario, MatrixGroup, MatrixRow, MatrixRule, MatrixWorkspace, ProfitViewSelection, SeriesProfitResult} from './types';

// Select products and rules together. A historical snapshot must never borrow today's rules.
export function resolveMatrixWorkspace({useSharedSnapshot, snapshot, products, subsidyRules, fileName, records = [], version}: {
  useSharedSnapshot: boolean;
  snapshot?: TrackingBatch;
  products: CalculatedProduct[];
  subsidyRules: SubsidyRule[];
  fileName: string;
  records?: SourceUploadRecord[];
  version: number;
}): MatrixWorkspace {
  if (useSharedSnapshot) {
    return {
      products: snapshot?.products || [],
      subsidyRules: snapshot?.restorePayload?.subsidyRules || [],
      fileName: snapshot?.restorePayload?.activeSubsidyFileName || snapshot?.subsidyFileName || '未记录补贴文件',
      label: snapshot ? `共享快照 ${snapshot.id}` : '等待工作台数据',
      uploadedAt: snapshot?.subsidyUploadTime,
      snapshotId: snapshot?.id
    };
  }
  return {
    products, subsidyRules, fileName,
    label: `当前工作台 · 竞争版本 V${version}`,
    uploadedAt: records.find(r => r.type === 'subsidy' && r.fileName === fileName)?.uploadedAt
  };
}

const rawValue = (raw: SubsidyRule['rawFields'], names: string[]) => Object.entries(raw || {}).find(([key]) => (
  names.includes(key.replace(/^[A-Z]+_/, '').replace(/\s+/g, '').toLowerCase())
))?.[1];

export function buildWorkspaceMatrix(subsidyRules: SubsidyRule[], products: CalculatedProduct[]) {
  const issues: string[] = [];
  const rules: MatrixRule[] = [];
  const invalidSeries = new Set<string>();
  const seen = new Map<string, number>();
  subsidyRules.forEach((rule, index) => {
    if (!rule.newSeries || ![rule.threshold, rule.ahsInput, rule.jdSubsidy].every(v => Number.isFinite(v) && v >= 0)) {
      issues.push(`工作台规则第 ${index + 1} 条缺少有效系列或金额，未用于矩阵和换新比较。`);
      if (rule.newSeries) invalidSeries.add(rule.newSeries);
      return;
    }
    const raw = rule.rawFields || {};
    const brand = String(rawValue(raw, ['品牌', '新机品牌', '品牌名称', 'brand']) || '未提供品牌').trim();
    const sourceRow = Number(rawValue(raw, ['原始行号', '源行号', 'sourcerownumber']));
    const normalized: MatrixRule = {
      id: `workspace-rule-${index}`, sourceIndex: index + 1,
      sourceRow: Number.isInteger(sourceRow) && sourceRow > 0 ? sourceRow : null,
      brand, series: rule.newSeries, threshold: rule.threshold, ahs: rule.ahsInput, jd: rule.jdSubsidy, raw
    };
    const key = JSON.stringify([rule.newSeries, rule.threshold, rule.ahsInput, rule.jdSubsidy, brand]);
    if (seen.has(key)) issues.push(`工作台规则第 ${index + 1} 条与第 ${seen.get(key)} 条重复，已保留全部明细。`);
    else seen.set(key, index + 1);
    rules.push(normalized);
  });
  const matrix = buildMatrix(rules) as {groups: MatrixGroup[]; rows: Omit<MatrixRow, 'activeCount' | 'hasRules'>[]; stats: Record<string, number>};
  const usage = new Map<string, number>();
  for (const product of products) {
    if (product.newSeries) usage.set(product.newSeries, (usage.get(product.newSeries) || 0) + 1);
  }
  const rows: MatrixRow[] = matrix.rows.map(row => ({...row, activeCount: usage.get(row.series) || 0, hasRules: true}));
  const missingSeries = [...usage.keys()].filter(series => !rows.some(row => row.series === series));
  rows.push(...missingSeries.map(series => ({key: series, series, brand: '未匹配补贴规则', cells: {}, activeCount: usage.get(series)!, hasRules: false})));
  rows.sort((a, b) => Number(b.activeCount > 0) - Number(a.activeCount > 0) || a.series.localeCompare(b.series, 'zh-CN', {numeric: true}));
  return {...matrix, rules, rows, usage, issues, missingSeries, invalidSeries};
}

export function buildSeriesProfitResults({rows, rules, product, floor, invalidSeries = new Set<string>()}: {
  rows: MatrixRow[];
  rules: MatrixRule[];
  product?: CalculatedProduct;
  floor: number;
  invalidSeries?: Set<string>;
}): SeriesProfitResult[] {
  return rows.map(row => {
    const current = Boolean(product && row.series === product.newSeries);
    let hit = hitWorkspaceSeriesRules(rules, row.series, product?.recommendJdPrice) as SeriesProfitResult['hit'];
    if (invalidSeries.has(row.series)) hit = {...hit, status: 'invalid', ahs: null};
    const validBase = product && [product.basePrice, product.recommendJdPrice, product.ahsSubsidyAfter, product.postMarginalProfit].every(Number.isFinite)
      && product.basePrice > 0 && product.recommendJdPrice >= 0 && product.ahsSubsidyAfter >= 0;
    const comparison = validBase && (current || hit.ahs !== null) ? compareSubsidyProfit({
      baseProfit: product.postMarginalProfit * product.basePrice,
      basePrice: product.basePrice,
      baselineSubsidy: product.ahsSubsidyAfter,
      // The current row is the actual saved plan, not a newly inferred baseline.
      subsidy: current ? product.ahsSubsidyAfter : hit.ahs,
      floor,
      mode: 'system'
    }) : null;
    if (current && comparison) comparison.rate = product.postMarginalProfit;
    return {row, hit, comparison, current};
  }).sort((a, b) => (a.comparison?.profit ?? Infinity) - (b.comparison?.profit ?? Infinity) || a.row.series.localeCompare(b.row.series, 'zh-CN', {numeric: true}));
}

export function buildNewSeriesScenarios({target, rules, products, floor, invalidSeries}: {
  target?: MatrixRow;
  rules: MatrixRule[];
  products: CalculatedProduct[];
  floor: number;
  invalidSeries?: Set<string>;
}): ExchangeScenario[] {
  if (!target) return [];
  return products.map(product => ({
    product,
    result: buildSeriesProfitResults({rows: [target], rules, product, floor, invalidSeries})[0],
    relation: product.newSeries === target.series ? 'workspace' as const : 'scenario' as const
  })).sort((a, b) => (a.result.comparison?.profit ?? Infinity) - (b.result.comparison?.profit ?? Infinity) || a.product.ppv.localeCompare(b.product.ppv));
}

export function getSeriesRuleDetails(rules: MatrixRule[], groups: MatrixGroup[], series: string, groupKey: string) {
  const allRules = rules.filter(rule => rule.series === series).sort((a, b) => a.threshold - b.threshold || a.sourceIndex - b.sourceIndex);
  const group = groups.find(item => item.key === groupKey);
  return {rules: allRules, highlightedIds: allRules.filter(rule => group?.values.includes(rule.threshold)).map(rule => rule.id)};
}

export function filterMatrixRows(rows: MatrixRow[], {scope, brand, series = '', search = ''}: {scope: string; brand: string; series?: string; search?: string}) {
  return rows.filter(row => (scope === 'all' || row.activeCount > 0)
    && (!brand || Object.values(row.cells).some(rules => rules.some(rule => rule.brand === brand)))
    && (!series || row.series === series)
    && `${row.brand} ${row.series}`.toLowerCase().includes(search.toLowerCase()));
}

export function resolveMatrixFilters(rows: MatrixRow[], scope: string, brand: string, series: string) {
  const effectiveBrand = rows.some(row => Object.values(row.cells).some(rules => rules.some(rule => rule.brand === brand))) ? brand : '';
  const availableRows = filterMatrixRows(rows, {scope, brand: effectiveBrand});
  const effectiveSeries = availableRows.some(row => row.series === series) ? series : '';
  return {brand: effectiveBrand, series: effectiveSeries, availableRows};
}

export function buildProfitView({selection, rows, rules, products, floor, invalidSeries}: {
  selection: ProfitViewSelection;
  rows: MatrixRow[];
  rules: MatrixRule[];
  products: CalculatedProduct[];
  floor: number;
  invalidSeries?: Set<string>;
}) {
  const product = products.find(row => row.id === selection.productId) || products[0];
  const target = rows.find(row => row.series === selection.targetSeries) || rows[0];
  const results = buildSeriesProfitResults({rows, rules, product, floor, invalidSeries});
  const scenarios = buildNewSeriesScenarios({target, rules, products, floor, invalidSeries});
  const isRisk = (result: SeriesProfitResult) => result.comparison && result.comparison.risk !== '正常';
  return {
    product, target, results, scenarios,
    visibleResults: product ? selection.onlyRisks ? results.filter(isRisk) : results : [],
    visibleScenarios: selection.onlyRisks ? scenarios.filter(row => isRisk(row.result)) : scenarios,
    linkedCount: scenarios.filter(row => row.relation === 'workspace').length,
    riskResults: selection.view === 'new' ? scenarios.map(row => row.result) : product ? results.filter(row => !row.current) : []
  };
}

export type MatrixSort = {groupKey: string; direction: 'descending' | 'ascending'};
export function cycleMatrixSort(current: MatrixSort, groupKey: string): MatrixSort {
  if (current.groupKey !== groupKey) return {groupKey, direction: 'descending'};
  return current.direction === 'descending' ? {groupKey, direction: 'ascending'} : {groupKey: '', direction: 'descending'};
}

// Use the displayed maximum; missing rules stay last in both directions.
export function sortMatrixRows(rows: MatrixRow[], groupKey: string, direction: MatrixSort['direction'] = 'descending', mode: HeatmapMode = 'amount') {
  if (!groupKey) return rows;
  const amount = (row: MatrixRow) => {const values = heatmapValues(row.cells[groupKey] || [], mode); return values ? Math.max(...values) : null;};
  return [...rows].sort((a, b) => {
    const av = amount(a), bv = amount(b);
    if (av === bv) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return direction === 'descending' ? bv - av : av - bv;
  });
}
