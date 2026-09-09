import * as XLSX from 'xlsx';
import { CalculatedProduct, TrackingBatch } from '../types';

export const hasSnapshotDetails = (batch: TrackingBatch) => (
  !batch.isSummaryOnly && batch.products.length > 0
);

export const isImportedSnapshot = (batch: TrackingBatch) => Boolean(batch.isSummaryOnly || batch.id.startsWith('RECOVERED-'));

const savedTimestamp = (batch: TrackingBatch) => {
  if (batch.serverCreatedAt) {
    const timestamp = Date.parse(batch.serverCreatedAt);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  const idTime = batch.id.match(/^TRACK-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-|$)/);
  const fallback = idTime
    ? `${idTime[1]}-${idTime[2]}-${idTime[3]}T${idTime[4]}:${idTime[5]}:${idTime[6]}+08:00`
    : `${batch.date}T00:00:00+08:00`;
  const timestamp = Date.parse(fallback);
  return Number.isFinite(timestamp) ? timestamp : 0;
};

export const sortSnapshots = (batches: TrackingBatch[]) => (
  [...batches].sort((a, b) => savedTimestamp(b) - savedTimestamp(a) || b.id.localeCompare(a.id))
);

export const selectSnapshot = (batches: TrackingBatch[], selectedId?: string) => (
  batches.find(batch => batch.id === selectedId)
  || batches.find(hasSnapshotDetails)
  || batches[0]
);

export const snapshotTimeLabel = (batch: TrackingBatch, short = false) => {
  if (short && isImportedSnapshot(batch) && batch.date) {
    return batch.date.slice(5).replace('-', '/');
  }
  const timestamp = savedTimestamp(batch);
  if (!timestamp) return batch.date || '日期未记录';
  const label = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(timestamp);
  return short ? label.slice(5).replaceAll('-', '/') : label;
};

export const snapshotRemark = (batch: TrackingBatch) => {
  const parts = (batch.remarks || '').split('；');
  if (parts.length >= 3
    && /^测算行\s+\d+\s+条$/.test(parts.at(-1)!.trim())
    && /^(边际底线|100%竞争力模式)/.test(parts.at(-3)!.trim())) {
    parts.splice(-3);
  }
  return parts.join('；').trim();
};

export const snapshotStatus = (batch: TrackingBatch) => (
  batch.isSummaryOnly ? '仅汇总' : batch.isCompetitivenessConfirmed ? '正式落数' : '测算快照'
);

export interface SnapshotColumn {
  code: string;
  label: string;
  width: number;
  numberFormat?: string;
  getValue: (product: CalculatedProduct) => string | number | boolean | null | undefined;
}

// Snapshot exports contain saved values only. Never install live pricing formulas
// or use today's subsidy tables to rebuild a historical workbook.
export const createSnapshotWorkbook = (
  batch: TrackingBatch,
  products: CalculatedProduct[],
  columns: SnapshotColumn[]
) => {
  const workbook = XLSX.utils.book_new();
  const cleanValue = (value: ReturnType<SnapshotColumn['getValue']>) => (
    value === undefined || (typeof value === 'number' && !Number.isFinite(value)) ? null : value
  );
  const sheet = XLSX.utils.aoa_to_sheet([
    columns.map(column => column.code),
    columns.map(column => column.label),
    ...products.map(product => columns.map(column => cleanValue(column.getValue(product))))
  ]);
  sheet['!cols'] = columns.map(column => ({ wch: Math.max(10, Math.round(column.width / 7)) }));
  columns.forEach((column, columnIndex) => {
    if (!column.numberFormat) return;
    products.forEach((_, rowIndex) => {
      const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex + 2, c: columnIndex })];
      if (cell?.t === 'n') cell.z = column.numberFormat;
    });
  });
  XLSX.utils.book_append_sheet(workbook, sheet, '快照明细');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(products.map(product => ({
    ...product.rawFields,
    '快照_批次编号': batch.id,
    '快照_PPV': product.ppv,
    '快照_商品SKUID': product.skuId,
    '快照_等级id': product.levelId,
    '快照_源工作表': product.sourceSheet,
    '快照_源行号': product.sourceRowNumber
  }))), '原始字段');
  const metrics = batch.competitivenessMetrics;
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['批次编号', batch.id], ['渠道', batch.channelName || '京东换新'],
    ['保存时间', snapshotTimeLabel(batch)], ['操作人', batch.operator],
    ['状态', snapshotStatus(batch)], ['落数日期', batch.competitivenessDate || null],
    ['追价时间', batch.pricingTimestamp || null], ['快照备注', batch.remarks || null],
    ['测算模式', batch.pricingMode === 'fullCompetition' ? '100%竞争力' : '边际底线'],
    ['边际底线', batch.marginBottomLine], ['快照总行数', batch.products.length],
    ['本次导出行数', products.length], ['补贴文件', batch.subsidyFileName || null],
    ['保存时天猫物品价竞争力(%)', metrics?.tmItemScore ?? null],
    ['保存时天猫到手价竞争力(%)', metrics?.tmDirectScore ?? null],
    ['保存时转转物品价竞争力(%)', metrics?.zzItemScore ?? null],
    ['保存时AHS补贴后 vs 转转到手价(%)', metrics?.ahsVsZzDirectScore ?? null],
    ['保存时AHS补贴后 vs TM回收商补贴后(%)', metrics?.ahsVsTmRecyclerScore ?? null],
    ['保存时京东到手价 vs 转转到手价(%)', metrics?.jdVsZzDirectScore ?? null],
    ['本次竞争调整预估投入', batch.investmentRateMetrics?.estimatedInvestmentAmount ?? null],
    ['手机安卓大盘竞争投入费率', batch.investmentRateMetrics?.androidOverallRate ?? null],
    ['手机安卓换新渠道竞争投入费率', batch.investmentRateMetrics?.androidJdTradeInRate ?? null],
    ['手机安卓近30天回收预估销售总额', batch.investmentRateInputs?.androidSalesAmount30d ?? null],
    ['手机安卓近30天京东换新渠道销售额', batch.investmentRateInputs?.androidJdTradeInSalesAmount30d ?? null]
  ]), '快照信息');
  return workbook;
};

// PPV alone can repeat across SKU/level rows; retain every occurrence on each side.
export const compareSnapshotProducts = (a: TrackingBatch, b: TrackingBatch) => {
  const indexRows = (products: CalculatedProduct[]) => {
    const occurrences = new Map<string, number>();
    return new Map(products.map(product => {
      const key = JSON.stringify([product.ppv, product.skuId ?? '', product.levelId ?? '']);
      const occurrence = occurrences.get(key) || 0;
      occurrences.set(key, occurrence + 1);
      return [`${key}:${occurrence}`, product];
    }));
  };
  const rowsA = indexRows(a.products);
  const rowsB = indexRows(b.products);
  return [...new Set([...rowsA.keys(), ...rowsB.keys()])].map(key => {
    const productA = rowsA.get(key);
    const productB = rowsB.get(key);
    const priceA = productA?.recommendJdPrice ?? null;
    const priceB = productB?.recommendJdPrice ?? null;
    const marginA = productA?.postMarginalProfit ?? null;
    const marginB = productB?.postMarginalProfit ?? null;
    return {
      key, product: (productB || productA)!, priceA, priceB, marginA, marginB,
      priceDiff: priceA !== null && priceB !== null ? priceB - priceA : null,
      marginDiff: marginA !== null && marginB !== null ? marginB - marginA : null,
      presence: !productA ? '本期新增' : !productB ? '本期未包含' : '两期均有'
    };
  });
};
