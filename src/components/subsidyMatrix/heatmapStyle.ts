// Shared by the webpage and Excel export so amount bands cannot drift.
export const amountColors = ['#DCE8F4', '#B2DBF6', '#FFE6A7', '#F8BD8E', '#EB927E', '#BB4E5A'];
export const amountLabels = ['0–99', '100–199', '200–349', '350–499', '500–699', '≥700'];
export const amountBand = (value: number) => value < 100 ? 0 : value < 200 ? 1 : value < 350 ? 2 : value < 500 ? 3 : value < 700 ? 4 : 5;

export type HeatmapMode = 'amount' | 'ratio';
export type SubsidyMetric = 'ahs' | 'total';
export const subsidyLabel = (metric: SubsidyMetric) => metric === 'total' ? '总补贴（含京东券）' : '爱回收承担';
export const heatmapTitle = (metric: SubsidyMetric) => metric === 'total' ? '所有新机系列—总补贴热力图（含京东券）' : '所有新机系列—爱回收承担补贴热力图';
export const metricAmount = (rule: {ahs: number; jd?: number}, metric: SubsidyMetric): number | null => {
  const value = metric === 'total' ? rule.jd : rule.ahs;
  return Number.isFinite(value) && value >= 0 ? value : null;
};
export const valueLabel = (metric: SubsidyMetric, mode: HeatmapMode) => `${metric === 'total' ? '补贴' : '承担'}${mode === 'ratio' ? '比例' : '金额'}`;
export const ratioLabels = ['<10%', '10–<20%', '20–<30%', '30–<50%', '50–<70%', '≥70%'];
export const ratioBand = (value: number) => value < .1 ? 0 : value < .2 ? 1 : value < .3 ? 2 : value < .5 ? 3 : value < .7 ? 4 : 5;
export const ratioText = (value: number) => `${(value * 100).toFixed(2)}%`;
export function heatmapValues(rules: {ahs: number; threshold: number; jd?: number}[], mode: HeatmapMode, metric: SubsidyMetric = 'ahs'): number[] | null {
  if (!rules.length || rules.some(rule => metricAmount(rule, metric) === null)) return null;
  if (mode === 'ratio' && rules.some(rule => !Number.isFinite(rule.threshold) || rule.threshold <= 0)) return null;
  return rules.map(rule => mode === 'ratio' ? metricAmount(rule, metric)! / rule.threshold : metricAmount(rule, metric)!);
}
export function heatmapCell(rules: {ahs: number; threshold: number; jd?: number}[], mode: HeatmapMode, metric: SubsidyMetric = 'ahs') {
  const values = heatmapValues(rules, mode, metric);
  if (!values) return {min: null, max: null, text: rules.length ? '待核验' : '—', background: '#F9F9F8', foreground: '#999999'};
  const min = Math.min(...values), max = Math.max(...values);
  const format = mode === 'ratio' ? ratioText : (value: number) => value.toLocaleString('zh-CN', {maximumFractionDigits: 2});
  const index = mode === 'ratio' ? ratioBand(max) : amountBand(max);
  return {min, max, text: min === max ? format(max) : `${format(min)}–${format(max)}`, background: amountColors[index], foreground: index === 5 ? '#FFFFFF' : '#141414'};
}
type HeatmapRows = {cells: Record<string, {ahs: number; threshold: number; jd?: number}[]>}[];
export function heatmapSpread(rows: HeatmapRows, groupKey: string, mode: HeatmapMode, metric: SubsidyMetric = 'ahs') {
  const values = rows.flatMap(row => heatmapValues(row.cells[groupKey] || [], mode, metric) || []);
  return values.length ? Math.max(...values) - Math.min(...values) : null;
}
export function spreadText(rows: HeatmapRows, groupKey: string, mode: HeatmapMode, metric: SubsidyMetric = 'ahs') {
  const spread = heatmapSpread(rows, groupKey, mode, metric);
  return spread === null ? '—' : mode === 'ratio' ? `${(spread * 100).toFixed(2)}pp` : spread.toLocaleString('zh-CN', {maximumFractionDigits: 2});
}
export function ratioSpread(rows: HeatmapRows, groupKey: string) {
  return spreadText(rows, groupKey, 'ratio');
}
