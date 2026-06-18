/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { DailyPriceRow, Product, SourceUploadRecord, SubsidyRule, TrackingBatch } from '../types';

type CellValue = string | number | boolean | null;
type ParsedSheet = {
  fileName: string;
  sheetName: string;
  headerRowIndex: number;
  headers: string[];
  rows: CellValue[][];
  records: Record<string, CellValue>[];
};

type PpvAggregationRow = {
  model: string;
  ppv: string;
  skuId: string;
  level: string;
  quoteVolume: number;
  soldVolume: number;
};

type PpvAggregationResult = {
  sourceRows: number;
  outputRows: PpvAggregationRow[];
};

interface Props {
  currentProducts: Product[];
  dailyPrices: DailyPriceRow[];
  subsidyRules: SubsidyRule[];
  uploadRecords: SourceUploadRecord[];
  onBaseProductsLoaded: (products: Product[], fileName: string) => void;
  onDailyPricesLoaded: (rows: DailyPriceRow[], fileName: string) => void;
  onSubsidyRulesLoaded: (rows: SubsidyRule[], fileName: string) => void;
  onCompetitivenessHistoryLoaded: (rows: TrackingBatch[], fileName: string) => void;
}

const normalize = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, '').toLowerCase();

const toNumber = (value: CellValue): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const cleaned = String(value ?? '').replace(/[¥,%\s,]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toText = (value: CellValue): string => String(value ?? '').trim();

const toDateText = (value: CellValue): string => {
  if (typeof value === 'number' && value > 30000) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    }
  }
  const text = toText(value);
  const matched = text.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (matched) {
    return `${matched[1]}-${matched[2].padStart(2, '0')}-${matched[3].padStart(2, '0')}`;
  }
  return text;
};

const toMetricPercent = (value: CellValue): number => {
  const numeric = toNumber(value);
  const percent = numeric > 0 && numeric <= 1 ? numeric * 100 : numeric;
  return Math.round(percent * 10) / 10;
};

const getField = (record: Record<string, CellValue>, aliases: string[]): CellValue => {
  const entries = Object.entries(record);
  const exact = entries.find(([key]) => aliases.some(alias => normalize(key) === normalize(alias)));
  if (exact) return exact[1];
  const fuzzy = entries.find(([key]) => aliases.some(alias => normalize(key).includes(normalize(alias))));
  return fuzzy ? fuzzy[1] : null;
};

const getExactField = (record: Record<string, CellValue>, aliases: string[]): CellValue => {
  const exact = Object.entries(record).find(([key]) => aliases.some(alias => normalize(key) === normalize(alias)));
  return exact ? exact[1] : null;
};

const getDailyPriceFinalQuote = (record: Record<string, CellValue>): CellValue => {
  return getExactField(record, ['最终报价']);
};

const hasExactField = (headers: string[], aliases: string[]) => {
  return headers.some(header => aliases.some(alias => normalize(header) === normalize(alias)));
};

const hasField = (headers: string[], aliases: string[]) => {
  return headers.some(header => aliases.some(alias => {
    const key = normalize(header);
    const target = normalize(alias);
    return key === target || key.includes(target);
  }));
};

const parseWorkbook = async (
  file: File,
  requiredHeaders: string[],
  preferredSheetName?: string
): Promise<ParsedSheet> => {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
  const sheetNames = preferredSheetName && workbook.Sheets[preferredSheetName]
    ? [preferredSheetName, ...workbook.SheetNames.filter(name => name !== preferredSheetName)]
    : workbook.SheetNames;

  for (const sheetName of sheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<CellValue[]>(sheet, { header: 1, defval: null, raw: true });
    const headerRowIndex = rows.findIndex(row => {
      const headers = row.map(cell => toText(cell));
      return requiredHeaders.every(header => hasField(headers, [header]));
    });

    if (headerRowIndex < 0) {
      continue;
    }

    const headers = rows[headerRowIndex].map((cell, index) => toText(cell) || `未命名${index + 1}`);
    const dataRows = rows.slice(headerRowIndex + 1).filter(row => row.some(cell => cell !== null && cell !== ''));
    const records = dataRows.map(row => {
      return headers.reduce<Record<string, CellValue>>((acc, header, index) => {
        acc[header] = row[index] ?? null;
        return acc;
      }, {});
    });

    return { fileName: file.name, sheetName, headerRowIndex, headers, rows: dataRows, records };
  }

  throw new Error(`没有识别到表头：${requiredHeaders.join('、')}。已检查sheet：${sheetNames.join('、')}`);
};

const rawFieldsFromRow = (headers: string[], row: CellValue[]) => {
  return headers.reduce<Record<string, CellValue>>((acc, header, index) => {
    const code = XLSX.utils.encode_col(index);
    acc[`${code}_${header || `未命名${index + 1}`}`] = row[index] ?? null;
    return acc;
  }, {});
};

const parseBaseProducts = async (file: File): Promise<Product[]> => {
  const parsed = await parseWorkbook(file, ['新机系列', '旧机型号', 'ppv', 'tm裸机价', 'tm总补贴-人工', 'zz裸机价'], '询价表0518');
  const products = parsed.records.map((record, index) => {
    const row = parsed.rows[index];
    const rawFields = rawFieldsFromRow(parsed.headers, row);
    const ppv = toText(getField(record, ['ppv']));
    const newSeries = toText(getField(record, ['新机系列']));
    const oldModel = toText(getField(record, ['旧机型号']));
    const level = toText(getField(record, ['等级']));
    const skuId = toNumber(getField(record, ['skuid', 'sku id']));
    const levelId = toText(getField(record, ['等级id', '等级ID', 'levelid', 'level id']));

    return {
      id: `upload-${Date.now()}-${index + 1}`,
      sourceSheet: parsed.sheetName,
      sourceRowNumber: parsed.headerRowIndex + index + 2,
      sourceFieldCount: parsed.headers.length,
      rawFields,
      newSeries,
      oldModel,
      ppv,
      brand: newSeries.split(/\s+/)[0] || oldModel.split(/\s+/)[0] || '',
      level,
      skuId,
      levelId,
      quoteVolume: toNumber(getField(record, ['ppv近30天报价量', '近30天报价量'])),
      soldVolume: toNumber(getField(record, ['ppv近30天成交量', '近30天成交量', 'ppv近14天成交量', '近14天成交量'])),
      description: toText(getField(record, ['询价说明'])),
      jdPrice: toNumber(getField(record, ['jd裸机价'])),
      ahsInput: toNumber(getField(record, ['对应新品型号ahs投入'])),
      jdSubsidy: toNumber(getField(record, ['京东总补贴'])),
      tmPrice: toNumber(getField(record, ['tm裸机价'])),
      tmSubsidyManual: toNumber(getField(record, ['tm总补贴-人工'])),
      tmSubsidySheet: toNumber(getField(record, ['tm总补贴-线下表'])),
      zzPrice: toNumber(getField(record, ['zz裸机价'])),
      basePrice: toNumber(getField(record, ['基准价']))
    };
  });

  return products.filter(product => product.ppv && product.newSeries && product.oldModel);
};

const parseCompetitivenessHistory = async (file: File): Promise<TrackingBatch[]> => {
  const parsed = await parseWorkbook(file, ['日期']);
  const tmDirectAliases = ['天猫到手价竞争力', '天猫总到手价竞争力', 'tmDirectScore'];
  const tmItemAliases = ['天猫物品价竞争力', '天猫裸机价竞争力', 'tmItemScore'];
  const zzItemAliases = ['转转物品价竞争力', '转转裸机价竞争力', 'zzItemScore'];
  const ahsAliases = ['物品价+ahs补贴 vs 转转到手价', 'AHS补贴后 vs 转转到手价', 'AHS对转转到手竞争力', '追后AHS对转转到手竞争力', 'ahsVsZzDirectScore'];

  return parsed.records
    .map((record, index): TrackingBatch | null => {
      const date = toDateText(getField(record, ['落数日期', '日期', '数据日期', '追价日期', 'date']));
      if (!date) return null;

      const metrics = {
        tmDirectScore: toMetricPercent(getField(record, tmDirectAliases)),
        tmItemScore: toMetricPercent(getField(record, tmItemAliases)),
        zzItemScore: toMetricPercent(getField(record, zzItemAliases)),
        ahsVsZzDirectScore: toMetricPercent(getField(record, ahsAliases))
      };
      const hasAnyMetric = Object.values(metrics).some(value => value > 0);
      if (!hasAnyMetric) return null;

      const dateCode = date.replace(/\D/g, '') || String(Date.now());
      return {
        id: `COMP-${dateCode}-${String(index + 1).padStart(3, '0')}`,
        date,
        operator: toText(getField(record, ['操作人', 'operator'])) || '历史导入',
        dataDate: date,
        marginBottomLine: 0,
        products: [],
        remarks: toText(getField(record, ['备注', '说明', 'remarks'])) || `从 ${file.name} 导入的竞争力历史汇总`,
        subsidyFileName: file.name,
        isCompetitivenessConfirmed: true,
        competitivenessDate: date,
        pricingTimestamp: toText(getField(record, ['追价时间', '落数时间', '确认时间'])) || date,
        confirmedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
        competitivenessMetrics: metrics,
        isSummaryOnly: true
      };
    })
    .filter((batch): batch is TrackingBatch => batch !== null);
};

const parseSubsidyRules = async (file: File): Promise<SubsidyRule[]> => {
  const parsed = await parseWorkbook(file, ['新机系列']);
  const thresholdAliases = ['jd裸机价门槛', '价格门槛', '门槛', '价格下限', '起始价'];
  const ahsAliases = ['对应新品型号ahs投入', 'ahs投入', 'AHS投入', '爱回收承担总补贴'];
  const jdSubsidyAliases = ['京东总补贴（含京东券）', '京东总补贴(含京东券)', '京东总补贴含京东券', '京东总补贴'];
  if (!hasField(parsed.headers, thresholdAliases)) {
    throw new Error(`补贴表缺少价格门槛字段，可用字段名：${thresholdAliases.join('、')}`);
  }
  if (!hasField(parsed.headers, ahsAliases)) {
    throw new Error(`补贴表缺少AHS投入字段，可用字段名：${ahsAliases.join('、')}`);
  }
  if (!hasField(parsed.headers, jdSubsidyAliases)) {
    throw new Error(`补贴表缺少京东总补贴字段，可用字段名：${jdSubsidyAliases.join('、')}`);
  }

  return parsed.records
    .map(record => ({
      newSeries: toText(getField(record, ['新机系列'])),
      threshold: toNumber(getField(record, thresholdAliases)),
      ahsInput: toNumber(getField(record, ahsAliases)),
      jdSubsidy: toNumber(getField(record, jdSubsidyAliases)),
      rawFields: record
    }))
    .filter(row => row.newSeries && row.ahsInput >= 0 && row.jdSubsidy >= 0);
};

const sortAggregationRows = (left: PpvAggregationRow, right: PpvAggregationRow) => {
  return right.quoteVolume - left.quoteVolume
    || right.soldVolume - left.soldVolume
    || left.ppv.localeCompare(right.ppv, 'zh-Hans-u-kn-true')
    || left.skuId.localeCompare(right.skuId, 'zh-Hans-u-kn-true')
    || left.level.localeCompare(right.level, 'zh-Hans-u-kn-true');
};

const sortPivotLabelRows = (left: PpvAggregationRow, right: PpvAggregationRow) => {
  return left.ppv.localeCompare(right.ppv, 'zh-Hans-u-kn-true')
    || left.skuId.localeCompare(right.skuId, 'zh-Hans-u-kn-true')
    || left.level.localeCompare(right.level, 'zh-Hans-u-kn-true');
};

const getPpvAggregationExportName = () => {
  const now = new Date();
  const dateText = `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const key = `ppv_aggregation_export_version_${dateText}`;
  const version = Number(localStorage.getItem(key) || '0') + 1;
  localStorage.setItem(key, String(version));
  return `${dateText}_竞争型号ppv报价量Top2筛选_v${version}.xlsx`;
};

const buildPpvAggregation = async (file: File): Promise<PpvAggregationResult> => {
  const parsed = await parseWorkbook(file, ['商品型号', '商品SKUID', '商品SKU', '商品LEVEL', '报价量', '成交量']);
  if (!hasExactField(parsed.headers, ['商品SKU', '商品sku'])) {
    throw new Error('底表缺少精确字段：商品SKU。ppv 必须按 商品LEVEL&商品SKU 生成，不能使用商品SKUID。');
  }
  const grouped = new Map<string, PpvAggregationRow>();

  parsed.records.forEach(record => {
    const model = toText(getField(record, ['商品型号']));
    const skuId = toText(getField(record, ['商品SKUID', '商品sku id', 'skuid']));
    const sku = toText(getExactField(record, ['商品SKU', '商品sku']));
    const level = toText(getField(record, ['商品LEVEL', '商品level', 'level']));
    const quoteVolume = toNumber(getField(record, ['报价量']));
    const soldVolume = toNumber(getField(record, ['成交量']));
    const ppv = `${level}${sku}`;

    if (!model || !sku || !level || !ppv) return;

    const key = [model, ppv, skuId, level].join('\u0001');
    const current = grouped.get(key);
    if (current) {
      current.quoteVolume += quoteVolume;
      current.soldVolume += soldVolume;
      return;
    }

    grouped.set(key, {
      model,
      ppv,
      skuId,
      level,
      quoteVolume,
      soldVolume
    });
  });

  const byModel = new Map<string, PpvAggregationRow[]>();
  grouped.forEach(row => {
    const rows = byModel.get(row.model) || [];
    rows.push(row);
    byModel.set(row.model, rows);
  });

  const outputRows = Array.from(byModel.entries())
    .sort(([left], [right]) => left.localeCompare(right, 'zh-Hans-u-kn-true'))
    .flatMap(([, rows]) => {
      const sortedRows = [...rows].sort(sortAggregationRows);
      const threshold = sortedRows[Math.min(1, sortedRows.length - 1)]?.quoteVolume ?? 0;
      return sortedRows
        .filter(row => row.quoteVolume >= threshold)
        .sort(sortPivotLabelRows);
    });

  return {
    sourceRows: parsed.records.length,
    outputRows
  };
};

const exportPpvAggregationWorkbook = (rows: PpvAggregationRow[]) => {
  const headers = ['新机系列', '旧机型号', 'ppv', '商品SKUID', '商品LEVEL', 'ppv近30天报价量', 'ppv近30天成交量', 'tm裸机价', 'tm总补贴-人工', 'zz裸机价'];
  const body = rows.map(row => [
    '',
    row.model,
    row.ppv,
    row.skuId,
    row.level,
    row.quoteVolume,
    row.soldVolume,
    '',
    '',
    ''
  ]);
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...body]);
  worksheet['!cols'] = [
    { wch: 16 },
    { wch: 20 },
    { wch: 58 },
    { wch: 14 },
    { wch: 12 },
    { wch: 14 },
    { wch: 14 },
    { wch: 12 },
    { wch: 16 },
    { wch: 12 }
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  XLSX.writeFile(workbook, getPpvAggregationExportName());
};

const recordTypeLabel = (type: SourceUploadRecord['type']) => {
  const labels: Record<SourceUploadRecord['type'], string> = {
    base: '基础竞争表',
    dailyPrice: 'daily price',
    subsidy: '补贴表',
    manualPrice: '人工价格表',
    competitivenessHistory: '竞争力历史'
  };
  return labels[type];
};

export default function UploadSection({
  currentProducts,
  dailyPrices,
  subsidyRules,
  uploadRecords,
  onBaseProductsLoaded,
  onDailyPricesLoaded,
  onSubsidyRulesLoaded,
  onCompetitivenessHistoryLoaded
}: Props) {
  const [busyType, setBusyType] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [dailyApiStatus, setDailyApiStatus] = useState('');
  const [ppvAggregationStatus, setPpvAggregationStatus] = useState('');

  const currentPpvs = useMemo(() => new Set(currentProducts.map(product => product.ppv)), [currentProducts]);
  const currentSeries = useMemo(() => new Set(currentProducts.map(product => product.newSeries)), [currentProducts]);
  const dailyMatched = dailyPrices.filter(row => currentPpvs.has(row.ppv)).length;
  const subsidySeriesMatched = new Set(subsidyRules.filter(rule => currentSeries.has(rule.newSeries)).map(rule => rule.newSeries)).size;

  const handleUpload = async <T,>(
    file: File | undefined,
    type: string,
    parser: (file: File) => Promise<T[]>,
    callback: (rows: T[], fileName: string) => void
  ) => {
    if (!file) return;
    setBusyType(type);
    setError('');
    try {
      const rows = await parser(file);
      if (rows.length === 0) {
        throw new Error('没有解析到有效数据行。');
      }
      callback(rows, file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : '文件解析失败');
    } finally {
      setBusyType(null);
    }
  };

  const syncDailyPriceApi = async () => {
    setBusyType('daily price API');
    setError('');
    setDailyApiStatus('');
    try {
      const ppvs = currentProducts.map(product => product.ppv).filter(Boolean);
      const response = await fetch('/api/daily-price/lookup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ppv: ppvs })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || 'daily price API 查询失败');
      }

      const rows: DailyPriceRow[] = (payload.rows || [])
        .filter((row: Record<string, CellValue>) => row.matched)
        .map((row: Record<string, CellValue>) => ({
          ppv: toText(row.ppv),
          biBasePrice: toNumber(row['BI基准价']),
          costPrice: toNumber(getDailyPriceFinalQuote(row)),
          levelId: toText(getField(row, ['等级id', '等级ID', 'levelid', 'level id'])),
          rawFields: {
            ...row
          }
        }))
        .filter(row => row.ppv && (row.costPrice > 0 || row.biBasePrice > 0));

      onDailyPricesLoaded(rows, `daily price API ${payload.dataDate || ''}`.trim());
      setDailyApiStatus(`已从 daily price API 取回 ${rows.length}/${currentProducts.length} 条价格：最终报价写入jd裸机价，BI基准价写入基准价，等级id写入等级id列。数据日期 ${payload.dataDate || '未知'}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'daily price API 查询失败');
    } finally {
      setBusyType(null);
    }
  };

  const handlePpvAggregation = async (file: File | undefined) => {
    if (!file) return;
    setBusyType('ppv聚合工具');
    setError('');
    setPpvAggregationStatus('');
    try {
      const result = await buildPpvAggregation(file);
      if (result.outputRows.length === 0) {
        throw new Error('没有生成可导出的聚合结果，请检查商品型号、商品SKU、商品LEVEL、报价量、成交量字段。');
      }
      exportPpvAggregationWorkbook(result.outputRows);
      setPpvAggregationStatus(`已读取 ${result.sourceRows} 行底表，输出 ${result.outputRows.length} 行 Sheet1 聚合结果。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ppv聚合导出失败');
    } finally {
      setBusyType(null);
    }
  };

  const cardClass = 'border border-[#141414] bg-white p-4 space-y-3';
  const inputClass = 'block w-full text-xs file:mr-3 file:border file:border-[#141414] file:bg-[#F0EFEC] file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-[#141414]';
  const statClass = 'border border-[#141414]/20 bg-[#F0EFEC] px-3 py-2 text-xs';

  return (
    <div className="bg-[#F0EFEC]">
      <div className="p-4 border-b border-[#141414]">
        <h2 className="text-base font-bold">数据上传与自动匹配流程</h2>
        <p className="mt-1 text-xs text-[#141414]/70">
          当前竞争表 {currentProducts.length} 行。现在只需要上传本次竞争追价表和补贴表；daily price API 按 ppv 自动匹配最终报价、BI基准价和等级id。
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 p-4">
        <div className={cardClass}>
          <div>
            <div className="text-sm font-bold">1. 本次竞争追价表</div>
            <div className="mt-1 text-[11px] text-[#141414]/70">需要字段：新机系列 / 旧机型号 / ppv / tm裸机价 / tm总补贴-人工 / zz裸机价。上传后替换本次竞争数据，并保留所有源字段。</div>
          </div>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className={inputClass}
            onChange={(event) => handleUpload(event.target.files?.[0], 'base', parseBaseProducts, onBaseProductsLoaded)}
          />
          <div className={statClass}>当前基础行数：{currentProducts.length}</div>
          <div className="border-t border-[#141414]/20 pt-3">
            <div className="text-xs font-bold">竞争型号ppv报价量Top2筛选工具</div>
            <div className="mt-1 text-[11px] text-[#141414]/70">上传底表后按商品LEVEL+商品SKU生成ppv，按商品型号取ppv报价量前2名，并导出仅含Sheet1的结果；新机系列和竞品价格列留空。</div>
          </div>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className={inputClass}
            onChange={(event) => {
              handlePpvAggregation(event.target.files?.[0]);
              event.currentTarget.value = '';
            }}
          />
          {ppvAggregationStatus && <div className="text-[11px] font-bold text-green-700">{ppvAggregationStatus}</div>}
        </div>

        <div className={cardClass}>
          <div>
            <div className="text-sm font-bold">2. daily price API</div>
            <div className="mt-1 text-[11px] text-[#141414]/70">不需要上传表。系统调用 daily price 项目接口：最终报价写入 jd裸机价，BI基准价写入基准价，等级id写入等级id列。</div>
          </div>
          <button
            type="button"
            onClick={syncDailyPriceApi}
            className="w-full border border-[#141414] bg-[#141414] px-3 py-2 text-xs font-bold text-white hover:bg-[#2A2A2B]"
          >
            通过 API 匹配 jd裸机价 / 基准价 / 等级id
          </button>
          <div className={statClass}>已导入 {dailyPrices.length} 行，当前匹配 {dailyMatched}/{currentProducts.length} 行</div>
          {dailyApiStatus && <div className="text-[11px] font-bold text-green-700">{dailyApiStatus}</div>}
        </div>

        <div className={cardClass}>
          <div>
            <div className="text-sm font-bold">3. 补贴表</div>
            <div className="mt-1 text-[11px] text-[#141414]/70">按新机系列找到规则，再用 jd裸机价落入价格门槛，返回对应新品型号ahs投入。</div>
          </div>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className={inputClass}
            onChange={(event) => handleUpload(event.target.files?.[0], 'subsidy', parseSubsidyRules, onSubsidyRulesLoaded)}
          />
          <div className={statClass}>已导入 {subsidyRules.length} 条规则，覆盖 {subsidySeriesMatched}/{currentSeries.size} 个新机系列</div>
        </div>

      </div>

      {(busyType || error) && (
        <div className="mx-4 mb-4 border border-[#141414] bg-white p-3 text-xs font-bold">
          {busyType && <span>正在解析 {busyType} 数据源...</span>}
          {error && <span className="text-red-700">{error}</span>}
        </div>
      )}

      <div className="p-4 border-t border-[#141414]">
        <h3 className="text-sm font-bold mb-3">上传记录</h3>
        <div className="overflow-x-auto border border-[#141414] bg-white">
          <table className="w-full min-w-[880px] text-xs">
            <thead className="bg-[#E4E3E0] border-b border-[#141414]">
              <tr>
                <th className="p-2 text-left border-r border-[#141414]">数据源</th>
                <th className="p-2 text-left border-r border-[#141414]">文件名</th>
                <th className="p-2 text-left border-r border-[#141414]">上传时间</th>
                <th className="p-2 text-right border-r border-[#141414]">行数</th>
                <th className="p-2 text-right border-r border-[#141414]">匹配行数</th>
                <th className="p-2 text-left">匹配说明</th>
              </tr>
            </thead>
            <tbody>
              {uploadRecords.map(record => (
                <tr key={record.id} className="border-b border-[#141414]/20">
                  <td className="p-2 border-r border-[#141414]/20 font-bold">{recordTypeLabel(record.type)}</td>
                  <td className="p-2 border-r border-[#141414]/20">{record.fileName}</td>
                  <td className="p-2 border-r border-[#141414]/20 font-mono">{record.uploadedAt}</td>
                  <td className="p-2 text-right border-r border-[#141414]/20 font-mono">{record.rowCount}</td>
                  <td className="p-2 text-right border-r border-[#141414]/20 font-mono">{record.matchedCount ?? ''}</td>
                  <td className="p-2">{record.remarks || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
