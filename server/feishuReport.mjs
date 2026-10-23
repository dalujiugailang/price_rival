import crypto from 'node:crypto';
import { calculateCompetitivenessMetrics } from '../shared/competitiveness.mjs';
import { ALL_BRANDS, ALL_SERIES, filterCompetitivenessProducts, resolveCompetitivenessBrand, resolveCompetitivenessSeries } from '../shared/competitivenessScope.mjs';

export const metricDefinitions = [
  ['tmItemScore', '天猫物品价竞争力', 'tmPrice'],
  ['tmDirectScore', '天猫到手价竞争力', 'tmHandPrice'],
  ['ahsVsTmRecyclerScore', 'AHS补贴后 vs TM回收商补贴后', 'tmRecyclerQuotedPrice'],
  ['zzItemScore', '转转物品价竞争力', 'zzPrice'],
  ['ahsVsZzDirectScore', '物品价+ahs补贴 vs 转转到手价', 'zzHandPrice'],
  ['jdVsZzDirectScore', '京东到手价 vs 转转到手价', 'zzHandPrice']
];
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const scoreText = value => value === null ? '暂无有效数据' : `${value.toFixed(1)}%`;
export const buildReport = (batch, scope = {}, appUrl) => {
  if (!batch || !batch.isCompetitivenessConfirmed || batch.isSummaryOnly || !batch.products?.length) throw new Error('请选择已保存且已确认竞争力的明细批次');
  const brand = scope.brand || ALL_BRANDS, newSeries = scope.newSeries || ALL_SERIES;
  if (typeof brand !== 'string' || typeof newSeries !== 'string' || brand.length > 100 || newSeries.length > 100) throw new Error('筛选范围无效');
  const products = filterCompetitivenessProducts(batch.products, brand, newSeries);
  if (!products.length) throw new Error('该批次在所选范围内没有明细');
  const channelId = batch.channelId || 'tradeIn';
  const channelName = channelId === 'selfOperated' ? '京东自营' : '京东换新';
  const calculated = calculateCompetitivenessMetrics(products, channelId);
  const saved = brand === ALL_BRANDS && newSeries === ALL_SERIES ? batch.competitivenessMetrics : null;
  const metrics = metricDefinitions.filter((_, i) => channelId !== 'selfOperated' || (i >= 3 && i < 5)).map(([key, label, price]) => {
    const weight = products.filter(p => Number(p[price]) > 0).reduce((sum,p) => sum + Math.max(0, Number(p.quoteVolume) || 0), 0);
    const value = saved ? saved[key] : calculated[key];
    return { key, label, value: weight > 0 && Number.isFinite(value) ? value : null, weight };
  });
  const url = new URL(appUrl);
  url.search = '';
  Object.entries({ tab:'competitiveness', channel:channelId, batchId:batch.id, brand, newSeries }).forEach(([key,value]) => url.searchParams.set(key,value));
  const typeLabel = batch.batchType === 'launch' ? '发新期' : batch.batchType === 'regular' ? '常规期' : '未分类';
  const report = { batchId:batch.id, channelId, channelName, date:batch.competitivenessDate || batch.date, typeLabel,
    title:`竞争追价结果｜${channelName}`, scope:{brand,newSeries}, scopeLabel:`${brand === ALL_BRANDS ? '全部品牌' : brand} / ${newSeries === ALL_SERIES ? '全部新机系列' : newSeries}`,
    count:products.length, metrics, url:url.toString(),
    weightLabel:channelId === 'selfOperated' ? '近30天报价访客数加权；仅有效竞品价进入分母' : '近30天报价量加权；仅有效竞品价进入分母',
    brands:[...new Set(batch.products.map(resolveCompetitivenessBrand).filter(Boolean))].sort(),
    series:[...new Set(batch.products.filter(p=>brand === ALL_BRANDS || resolveCompetitivenessBrand(p) === brand).map(resolveCompetitivenessSeries).filter(Boolean))].sort()
  };
  return {...report, digest:hash(report)};
};
export const prepareTracker = (db, batch, scope, appUrl) => {
  const report=buildReport(batch,scope,appUrl);
  const fields=['ppv','brand','newSeries','oldModel','quoteVolume','tmPrice','tmHandPrice','tmRecyclerQuotedPrice','zzPrice','zzHandPrice','postTmItemWin','postTmHandWin','postAhsTmRecyclerWin','postZzItemWin','postAhsZzHandWin','postJdZzHandWin'];
  const batches=db.listBatches(report.channelId).filter(b=>b.isCompetitivenessConfirmed && (b.batchType || 'unclassified')===(batch.batchType || 'unclassified') && (b.competitivenessDate || b.date)<=report.date).map(b=>({
    id:b.id,date:b.date,competitivenessDate:b.competitivenessDate,batchType:b.batchType,launchActivity:b.launchActivity,
    channelId:report.channelId,remarks:b.remarks,isCompetitivenessConfirmed:true,isSummaryOnly:b.isSummaryOnly,
    competitivenessMetrics:b.competitivenessMetrics,serverCreatedAt:b.serverCreatedAt,
    products:(b.products || []).map(p=>({...Object.fromEntries(fields.map(key=>[key,p[key]])),brand:resolveCompetitivenessBrand(p),rawFields:{'品牌名称':resolveCompetitivenessBrand(p)}}))
  }));
  return {report:{...report,digest:hash({digest:report.digest,batches})},batches};
};
const metricColumn = metric => {
  const color = metric.value === null ? 'grey' : metric.value >= 80 ? 'green' : metric.value >= 50 ? 'orange' : 'red';
  return {
    tag: 'column', width: 'weighted', weight: 1, vertical_align: 'top',
    elements: [{tag: 'div', text: {tag: 'lark_md', content: `${metric.label}\n<font color='${color}'>**${scoreText(metric.value)}**</font>`}}]
  };
};
const metricGroup = (report, title, keys) => {
  const metrics = keys.map(key => report.metrics.find(metric => metric.key === key)).filter(Boolean);
  if (!metrics.length) return [];
  const rows = [];
  for (let index = 0; index < metrics.length; index += 2) {
    rows.push({tag: 'column_set', flex_mode: 'none', background_style: 'grey', columns: metrics.slice(index, index + 2).map(metricColumn)});
  }
  return [{tag: 'div', text: {tag: 'lark_md', content: `**${title}**`}}, ...rows];
};
export const reportCard = (report, imageKey, actorName, sentAt) => ({
  config: {wide_screen_mode: true},
  header: {template: 'blue', title: {tag: 'plain_text', content: report.title}},
  elements: [
    {tag: 'div', text: {tag: 'plain_text', content: `${report.date} · ${report.typeLabel}\n批次：${report.batchId}\n范围：${report.scopeLabel} · ${report.count}条明细`}},
    {tag: 'hr'},
    ...metricGroup(report, '天猫竞争力', ['tmItemScore', 'tmDirectScore', 'ahsVsTmRecyclerScore']),
    ...metricGroup(report, '转转竞争力', ['zzItemScore', 'jdVsZzDirectScore', 'ahsVsZzDirectScore']),
    {tag: 'hr'},
    {tag: 'img', img_key: imageKey, alt: {tag: 'plain_text', content: '本批次竞争力追踪器'}, mode: 'fit_horizontal'},
    {tag: 'action', actions: [{tag: 'button', text: {tag: 'plain_text', content: '查看本批次详情'}, type: 'primary', url: report.url}]},
    {tag: 'note', elements: [{tag: 'plain_text', content: `${report.weightLabel}\n推送人：${actorName} · ${sentAt}`}]}]
});
