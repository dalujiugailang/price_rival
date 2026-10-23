/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { ArrowBigDownDash } from 'lucide-react';
import { ChannelId, DailyPriceRow, Product, SelfOperatedSubsidyRule, SourceUploadRecord, SubsidyRule, TrackingBatch } from '../types';
import { saveSourceFile } from '../api';
import SourceFileDownloadLink from './SourceFileDownloadLink';
import { getDailyPriceLookupPpvs } from '../utils/dailyPriceLookup';
import { gradeSourceUrl, listGradeSources, uploadGradeSource } from '../gradeApi';
import { GradeSource } from '../gradeTypes';

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
  inquiryDescription: string;
  zzPriceValue: string | number;
};

type PpvAggregationResult = {
  sourceRows: number;
  fullRows: PpvAggregationRow[];
  audit: string;
  outputRows: PpvAggregationRow[];
  descriptionMatchedRows: number;
};

type PpvAggregationZzPriceResult = {
  rows: PpvAggregationRow[];
  apiMatchedRows: number;
};

type SelfSubsidyGridRow = {
  threshold: string;
  amount: string;
};

interface Props {
  channelId: ChannelId;
  currentProducts: Product[];
  dailyPrices: DailyPriceRow[];
  subsidyRules: SubsidyRule[];
  selfSubsidyRules: SelfOperatedSubsidyRule[];
  uploadRecords: SourceUploadRecord[];
  restoredSnapshotFiles: { batchId: string; uploadRecords: SourceUploadRecord[] } | null;
  onBaseProductsLoaded: (products: Product[], fileName: string, sourceFileId?: string) => void;
  onDailyPricesLoaded: (rows: DailyPriceRow[], fileName: string) => Promise<void>;
  onSubsidyRulesLoaded: (rows: SubsidyRule[], fileName: string, sourceFileId?: string) => void;
  onSelfSubsidyRulesLoaded: (rows: SelfOperatedSubsidyRule[], sourceName: string) => void;
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

const parseBaseProducts = async (file: File, channelId: ChannelId = 'tradeIn'): Promise<Product[]> => {
  const requiredHeaders = channelId === 'selfOperated'
    ? ['旧机型号', 'ppv', 'zz裸机价']
    : ['新机系列', '旧机型号', 'ppv', 'tm裸机价', 'tm总补贴-人工', 'zz裸机价'];
  const parsed = await parseWorkbook(file, requiredHeaders, '询价表0518');
  const products = parsed.records.map((record, index) => {
    const row = parsed.rows[index];
    const rawFields = rawFieldsFromRow(parsed.headers, row);
    const ppv = toText(getField(record, ['ppv']));
    const newSeries = toText(getField(record, ['新机系列']));
    const oldModel = toText(getField(record, ['旧机型号']));
    const level = toText(getExactField(record, ['商品LEVEL', '等级', 'level', '等级名称']));
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
      quoteVolume: toNumber(getField(record, channelId === 'selfOperated'
        ? ['ppv近30天报价访客数', '近30天报价访客数', 'ppv近30天报价量', '近30天报价量']
        : ['ppv近30天报价量', '近30天报价量'])),
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

  return products.filter(product => product.ppv && product.oldModel && (channelId === 'selfOperated' || product.newSeries));
};

const parseCompetitivenessHistory = async (file: File): Promise<TrackingBatch[]> => {
  const parsed = await parseWorkbook(file, ['日期']);
  const tmDirectAliases = ['天猫到手价竞争力', '天猫总到手价竞争力', 'tmDirectScore'];
  const tmItemAliases = ['天猫物品价竞争力', '天猫裸机价竞争力', 'tmItemScore'];
  const zzItemAliases = ['转转物品价竞争力', '转转裸机价竞争力', 'zzItemScore'];
  const ahsAliases = ['物品价+ahs补贴 vs 转转到手价', 'AHS补贴后 vs 转转到手价', 'AHS对转转到手竞争力', '追后AHS对转转到手竞争力', 'ahsVsZzDirectScore'];
  const tmRecyclerAliases = ['AHS补贴后 vs TM回收商补贴后', '京东物品价+ahs补贴-追价后 vs天猫', 'ahsVsTmRecyclerScore'];
  const jdZzDirectAliases = ['京东到手价 vs 转转到手价', '京东到手价-追价后vs转转', 'jdVsZzDirectScore'];

  return parsed.records
    .map((record, index): TrackingBatch | null => {
      const date = toDateText(getField(record, ['落数日期', '日期', '数据日期', '追价日期', 'date']));
      if (!date) return null;

      const metrics = {
        tmDirectScore: toMetricPercent(getField(record, tmDirectAliases)),
        tmItemScore: toMetricPercent(getField(record, tmItemAliases)),
        zzItemScore: toMetricPercent(getField(record, zzItemAliases)),
        ahsVsZzDirectScore: toMetricPercent(getField(record, ahsAliases)),
        ahsVsTmRecyclerScore: getField(record, tmRecyclerAliases) === null
          ? null
          : toMetricPercent(getField(record, tmRecyclerAliases)),
        jdVsZzDirectScore: getField(record, jdZzDirectAliases) === null
          ? null
          : toMetricPercent(getField(record, jdZzDirectAliases))
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

const parsePastedSelfSubsidyRules = (text: string): SelfOperatedSubsidyRule[] => {
  const rows = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  return rows
    .map((line, index): SelfOperatedSubsidyRule | null => {
      const parts = line.includes('\t')
        ? line.split('\t')
        : line.includes(',')
          ? line.split(',')
          : line.split(/\s+/);
      if (index === 0 && normalize(parts[0]).includes('门槛')) {
        return null;
      }
      const threshold = toNumber(parts[0] ?? null);
      const ahsInput = toNumber(parts[1] ?? null);
      return {
        threshold,
        ahsInput,
        sourceRowNumber: index + 1,
        rawFields: {
          门槛值: parts[0] ?? '',
          AHS补贴: parts[1] ?? '',
          原始行: line
        }
      };
    })
    .filter((row): row is SelfOperatedSubsidyRule => !!row)
    .filter(row => row.threshold > 0 && row.ahsInput >= 0);
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

export const selectTopPpvRows = (rows: PpvAggregationRow[]): PpvAggregationRow[] => {
  const eligibleRows = rows.filter(row => normalize(row.level) !== 's');
  const totalQuoteVolume = eligibleRows.reduce((sum, row) => sum + row.quoteVolume, 0);
  const totalSoldVolume = eligibleRows.reduce((sum, row) => sum + row.soldVolume, 0);
  const scoredRows = eligibleRows
    .filter(row => row.quoteVolume !== 0 || row.soldVolume !== 0)
    .map(row => {
      const quoteVolumeShare = totalQuoteVolume === 0 ? 0 : row.quoteVolume / totalQuoteVolume;
      const soldVolumeShare = totalSoldVolume === 0 ? 0 : row.soldVolume / totalSoldVolume;
      return {
        row,
        score: quoteVolumeShare * 0.75 + soldVolumeShare * 0.25
      };
    })
    .sort((left, right) => right.score - left.score || sortAggregationRows(left.row, right.row));

  if (scoredRows.length <= 2) {
    return scoredRows.map(item => item.row).sort(sortPivotLabelRows);
  }

  const secondPlaceScore = scoredRows[1].score;
  return scoredRows
    .filter(item => item.score >= secondPlaceScore)
    .map(item => item.row)
    .sort(sortPivotLabelRows);
};

const PPV_INQUIRY_DESCRIPTION_RULES: ReadonlyArray<readonly [string, string]> = [
  ['S', '全新机'],
  ['99-S', '全完好，电池原装且健康度95%-100%（如有）'],
  ['99-S1', '屏幕细微划痕'],
  ['99-A', '拍照有斑'],
  ['99-A1', '屏幕细微划痕+电池85-94'],
  ['99-B', '功能3选1-轻微显示/电池80-84'],
  ['95-S', '外壳有划痕，小磕碰'],
  ['95-A', '外壳有划痕，小磕碰+电池85-94/拍照有斑'],
  ['95-B', '外观轻微+屏幕显示-轻微偏色'],
  ['95-C', '8项功能/维修项任一：电池<80/彩点/小修/小功能异常'],
  ['90-A', '外壳有明显磨损/磕碰/掉漆'],
  ['90-B', '外壳有明显磨损/磕碰/掉漆+屏幕显示-轻微偏色'],
  ['90-C', '外壳有明显磨损/磕碰/掉漆+光线/距离感应不正常'],
  ['A+', '全完好'],
  ['A1', '边框背板-轻微划痕，其他全完好'],
  ['A', '屏幕有划痕'],
  ['A2', '屏幕外观-细微划痕+边框背板-细微划痕'],
  ['B+1', '色差/案例/ROOT/无膜/彩点/拆机'],
  ['B+2', '色差案例ROOT+屏幕划痕，或有两个'],
  ['B1', '边框背板-小磕碰'],
  ['B', '边框背板-明显磕碰+屏幕显示-显示发黄'],
  ['B2', '边框背板-磕碰+屏幕显示-轻微偏色']
];

const PPV_INQUIRY_DESCRIPTIONS = new Map(
  PPV_INQUIRY_DESCRIPTION_RULES.map(([level, description]) => [normalize(level), description])
);

const NO_CRAWL_REQUIRED_TEXT = '无需爬价';

const normalizePpvKey = (value: unknown) => normalize(value);

const fetchPpvsWithZzPrePrice = async (ppvs: string[], channelId: ChannelId): Promise<Set<string>> => {
  const uniquePpvs = Array.from(new Set(ppvs.map(ppv => ppv.trim()).filter(Boolean)));
  if (uniquePpvs.length === 0) return new Set();

  const response = await fetch('/api/daily-price/lookup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ppv: uniquePpvs, channelId })
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || 'daily price API 查询ZZ券前价失败');
  }

  const matchedPpvs = new Set<string>();
  (payload.rows || []).forEach((row: Record<string, CellValue>) => {
    const ppv = toText(row.ppv);
    const value = getField(row, ['ZZ券前价', 'zz券前价', '转转券前价']);
    if (!ppv || value === null || value === '') return;
    matchedPpvs.add(normalizePpvKey(ppv));
  });
  return matchedPpvs;
};

const applyZzPriceValues = async (rows: PpvAggregationRow[], channelId: ChannelId): Promise<PpvAggregationZzPriceResult> => {
  const ppvsWithZzPrePrice = await fetchPpvsWithZzPrePrice(rows.map(row => row.ppv), channelId);

  let apiMatchedRows = 0;
  const nextRows = rows.map(row => {
    const key = normalizePpvKey(row.ppv);
    if (ppvsWithZzPrePrice.has(key)) {
      apiMatchedRows += 1;
      return { ...row, zzPriceValue: NO_CRAWL_REQUIRED_TEXT };
    }

    return { ...row, zzPriceValue: '' };
  });

  return {
    rows: nextRows,
    apiMatchedRows
  };
};

const getPpvAggregationExportName = (channelId: ChannelId) => {
  const now = new Date();
  const dateText = `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const key = `ppv_aggregation_export_version_${dateText}`;
  const version = Number(localStorage.getItem(key) || '0') + 1;
  localStorage.setItem(key, String(version));
  return `${dateText}_竞争型号ppv${channelId === 'selfOperated' ? '报价访客数' : '报价量'}Top2筛选_v${version}.xlsx`;
};

export const buildPpvAggregation = async (
  file: File,
  soldFile: File,
  channelId: ChannelId,
  inquiryDescriptions: Map<string, string> = PPV_INQUIRY_DESCRIPTIONS
): Promise<PpvAggregationResult> => {
  const quoteFieldLabel = channelId === 'selfOperated' ? '报价访客数' : '报价量';
  const parsed = await parseWorkbook(file, ['商品型号', '商品SKUID', '商品SKU', '商品LEVEL', quoteFieldLabel]);
  const sold = await parseWorkbook(soldFile, ['质检SKUID', '质检LEVEL', '成交订单量']);
  for (const [sheet, fields] of [[parsed, ['商品型号', '商品SKUID', '商品SKU', '商品LEVEL', quoteFieldLabel]], [sold, ['质检SKUID', '质检LEVEL', '成交订单量']]] as const) {
    for (const field of fields) {
      if (!hasExactField(sheet.headers, [field])) throw new Error(`${sheet.fileName} 缺少精确字段：${field}`);
    }
  }
  const keyFor = (skuId: string, level: string) => JSON.stringify([skuId.trim(), normalize(level)]);
  const count = (value: CellValue, label: string) => {
    const text = String(value ?? '').trim().replace(/,/g, '');
    const number = Number(text);
    if (!text || !Number.isSafeInteger(number) || number < 0) throw new Error(`${label}必须是非负整数`);
    return number;
  };
  const soldByKey = new Map<string, number>();
  const soldIdentity = new Map<string, {model: string; sku: string; skuId: string; level: string}>();
  sold.records.forEach((record, index) => {
    const skuId = toText(getExactField(record, ['质检SKUID']));
    const level = toText(getExactField(record, ['质检LEVEL']));
    if (!skuId || !level) throw new Error(`成交表第 ${index + 2} 行缺少质检SKUID或质检LEVEL`);
    const key = keyFor(skuId, level);
    const model = toText(getExactField(record, ['质检型号']));
    const sku = toText(getExactField(record, ['质检SKU']));
    const previous = soldIdentity.get(key);
    if (previous && (previous.model !== model || previous.sku !== sku)) throw new Error(`成交表SKUID ${skuId} 同等级对应多个型号或SKU`);
    soldIdentity.set(key, {model, sku, skuId, level: level.replace(/\s+/g, '').toUpperCase()});
    soldByKey.set(key, (soldByKey.get(key) || 0) + count(getExactField(record, ['成交订单量']), `成交表第 ${index + 2} 行成交订单量`));
  });
  if (!sold.records.length) throw new Error('成交表没有有效数据行');
  if (!hasExactField(parsed.headers, ['商品SKU', '商品sku'])) {
    throw new Error('底表缺少精确字段：商品SKU。ppv 必须按 商品LEVEL&商品SKU 生成，不能使用商品SKUID。');
  }
  const grouped = new Map<string, PpvAggregationRow>();

  parsed.records.forEach((record, index) => {
    const model = toText(getField(record, ['商品型号']));
    const skuId = toText(getField(record, ['商品SKUID', '商品sku id', 'skuid']));
    const sku = toText(getExactField(record, ['商品SKU', '商品sku']));
    const level = toText(getExactField(record, ['商品LEVEL'])).replace(/\s+/g, '').toUpperCase();
    const quoteVolume = count(getExactField(record, [quoteFieldLabel]), `流量表第 ${index + 2} 行${quoteFieldLabel}`);
    const soldVolume = 0;
    const ppv = `${level}${sku}`;
    const inquiryDescription = inquiryDescriptions.get(normalize(level)) || '';

    if (!model || !skuId || !sku || !level) throw new Error(`流量表第 ${index + 2} 行缺少型号、SKUID、SKU或LEVEL`);

    const key = keyFor(skuId, level);
    const current = grouped.get(key);
    if (current) {
      if (current.model !== model || current.ppv !== ppv) throw new Error(`SKUID ${skuId} 的同一等级对应多个型号或SKU名称，请核对`);
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
      soldVolume,
      inquiryDescription,
      zzPriceValue: ''
    });
  });

  let matchedKeys = 0;
  let matchedSold = 0;
  grouped.forEach((row, key) => {
    row.soldVolume = soldByKey.get(key) || 0;
    if (soldByKey.has(key)) matchedKeys++;
    matchedSold += row.soldVolume;
  });
  const unmatched = [...soldByKey.entries()].filter(([key]) => !grouped.has(key));
  const totalSold = [...soldByKey.values()].reduce((a, b) => a + b, 0);
  const audit = `流量表 ${parsed.records.length} 行、${grouped.size} 个组合；成交表 ${sold.records.length} 行、${soldByKey.size} 个组合、成交量 ${totalSold}；匹配 ${matchedKeys} 个组合、成交量 ${matchedSold}；仅流量表 ${grouped.size - matchedKeys} 个组合成交量记0；仅成交表 ${unmatched.length} 个组合、成交量 ${totalSold - matchedSold}，已纳入完整汇总表，报价量记0，不进入Top2候选。` + (unmatched.length ? `未匹配SKUID+LEVEL：${unmatched.map(([key]) => JSON.parse(key).join(' + ')).join('、')}。` : '');
  const byModel = new Map<string, PpvAggregationRow[]>();
  grouped.forEach(row => {
    const rows = byModel.get(row.model) || [];
    rows.push(row);
    byModel.set(row.model, rows);
  });

  const outputRows = Array.from(byModel.entries())
    .sort(([left], [right]) => left.localeCompare(right, 'zh-Hans-u-kn-true'))
    .flatMap(([, rows]) => selectTopPpvRows(rows));

  const fullRows = [...grouped.values()];
  for (const [key, soldVolume] of unmatched) {
    const identity = soldIdentity.get(key)!;
    const existing = fullRows.find(row => row.skuId === identity.skuId);
    const model = identity.model || existing?.model || '';
    const sku = identity.sku || (existing ? existing.ppv.slice(existing.level.length) : '');
    if (!model || !sku) throw new Error(`成交表独有SKUID ${identity.skuId} 缺少质检型号或质检SKU，无法生成完整并集`);
    if (existing && (normalize(existing.model) !== normalize(model) || normalize(existing.ppv.slice(existing.level.length)) !== normalize(sku))) throw new Error(`成交表SKUID ${identity.skuId} 的型号或SKU与流量表不一致`);
    fullRows.push({model, skuId: identity.skuId, level: identity.level, ppv: `${identity.level}${sku}`, quoteVolume: 0, soldVolume, inquiryDescription: inquiryDescriptions.get(normalize(identity.level)) || '', zzPriceValue: ''});
  }
  return {
    sourceRows: parsed.records.length,
    fullRows,
    audit,
    outputRows,
    descriptionMatchedRows: outputRows.filter(row => row.inquiryDescription).length
  };
};

const exportPpvAggregationWorkbook = (rows: PpvAggregationRow[], channelId: ChannelId, fullRows: PpvAggregationRow[]) => {
  const headers = channelId === 'selfOperated'
    ? ['旧机型号', 'ppv', '商品SKUID', '商品LEVEL', 'ppv近30天报价访客数', 'ppv近30天成交量', '询价说明', 'zz裸机价']
    : ['新机系列', '旧机型号', 'ppv', '商品SKUID', '商品LEVEL', 'ppv近30天报价量', 'ppv近30天成交量', '询价说明', 'tm裸机价', 'tm总补贴-人工', 'zz裸机价'];
  const body = rows.map(row => (
    channelId === 'selfOperated'
      ? [
        row.model,
        row.ppv,
        row.skuId,
        row.level,
        row.quoteVolume,
        row.soldVolume,
        row.inquiryDescription,
        row.zzPriceValue
      ]
      : [
        '',
        row.model,
        row.ppv,
        row.skuId,
        row.level,
        row.quoteVolume,
        row.soldVolume,
        row.inquiryDescription,
        '',
        '',
        row.zzPriceValue
      ]
  ));
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...body]);
  worksheet['!cols'] = channelId === 'selfOperated'
    ? [
      { wch: 20 },
      { wch: 58 },
      { wch: 14 },
      { wch: 12 },
      { wch: 18 },
      { wch: 14 },
      { wch: 30 },
      { wch: 12 }
    ]
    : [
      { wch: 16 },
      { wch: 20 },
      { wch: 58 },
      { wch: 14 },
      { wch: 12 },
      { wch: 18 },
      { wch: 14 },
      { wch: 30 },
      { wch: 12 },
      { wch: 16 },
      { wch: 12 }
    ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['商品型号', '商品SKUID', '商品SKU', '商品LEVEL', channelId === 'selfOperated' ? '报价访客数' : '报价量', '成交量'],
    ...fullRows.map(row => [row.model, row.skuId, row.ppv.slice(row.level.length), row.level, row.quoteVolume, row.soldVolume])
  ]), '完整汇总表');
  XLSX.writeFile(workbook, getPpvAggregationExportName(channelId));
};

const recordTypeLabel = (type: SourceUploadRecord['type']) => {
  const labels: Record<SourceUploadRecord['type'], string> = {
    base: '基础竞争表',
    dailyPrice: 'daily price',
    subsidy: '补贴表',
    selfSubsidy: '自营普发券',
    manualPrice: '人工价格表',
    competitivenessHistory: '竞争力历史'
  };
  return labels[type];
};

const DEFAULT_SELF_SUBSIDY_GRID_ROWS: SelfSubsidyGridRow[] = [
  { threshold: '200', amount: '30' },
  { threshold: '400', amount: '60' },
  { threshold: '800', amount: '150' },
  { threshold: '1200', amount: '220' },
  { threshold: '2000', amount: '320' },
  { threshold: '3000', amount: '380' },
  { threshold: '4000', amount: '420' },
  { threshold: '4800', amount: '470' },
  { threshold: '6800', amount: '550' },
  { threshold: '', amount: '' }
];

export default function UploadSection({
  channelId,
  currentProducts,
  dailyPrices,
  subsidyRules,
  selfSubsidyRules,
  uploadRecords,
  restoredSnapshotFiles,
  onBaseProductsLoaded,
  onDailyPricesLoaded,
  onSubsidyRulesLoaded,
  onSelfSubsidyRulesLoaded,
  onCompetitivenessHistoryLoaded
}: Props) {
  const [busyType, setBusyType] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [dailyApiStatus, setDailyApiStatus] = useState('');
  const [ppvAggregationStatus, setPpvAggregationStatus] = useState('');
  const [ppvFlowFile, setPpvFlowFile] = useState<File | null>(null);
  const [ppvSoldFile, setPpvSoldFile] = useState<File | null>(null);
  useEffect(() => { setPpvFlowFile(null); setPpvSoldFile(null); setPpvAggregationStatus(''); }, [channelId]);
  const [ppvSources, setPpvSources] = useState<GradeSource[]>([]);
  const latestMergedPpvSource = ppvSources.find(source => /^(PPV流量成交汇总_|成交匹配_)/.test(source.fileName));
  const snapshotFiles = (['base', 'subsidy'] as const)
    .map(type => restoredSnapshotFiles?.uploadRecords.find(record => record.type === type))
    .filter((record): record is SourceUploadRecord => Boolean(record?.sourceFileId));
  useEffect(() => {
    let live = true;
    setPpvSources([]);
    if (channelId === 'tradeIn') void listGradeSources().then(result => {
      if (live) setPpvSources(result.sources.filter(source => source.kind === 'volume'));
    }).catch(() => undefined);
    return () => { live = false; };
  }, [channelId]);
  const [selfSubsidyGridRows, setSelfSubsidyGridRows] = useState<SelfSubsidyGridRow[]>(DEFAULT_SELF_SUBSIDY_GRID_ROWS);
  const [selfSubsidyStatus, setSelfSubsidyStatus] = useState('');

  const currentPpvs = useMemo(() => new Set(currentProducts.map(product => product.ppv)), [currentProducts]);
  const currentSeries = useMemo(() => new Set(currentProducts.map(product => product.newSeries)), [currentProducts]);
  const dailyMatched = dailyPrices.filter(row => currentPpvs.has(row.ppv)).length;
  const subsidySeriesMatched = new Set(subsidyRules.filter(rule => currentSeries.has(rule.newSeries)).map(rule => rule.newSeries)).size;
  const isSelfOperated = channelId === 'selfOperated';

  const handleUpload = async <T,>(
    file: File | undefined,
    type: string,
    parser: (file: File) => Promise<T[]>,
    callback: (rows: T[], fileName: string, sourceFileId?: string) => void
  ) => {
    if (!file) return;
    setBusyType(type);
    setError('');
    try {
      const rows = await parser(file);
      if (rows.length === 0) {
        throw new Error('没有解析到有效数据行。');
      }
      const sourceFileId = type === 'base' || type === 'subsidy'
        ? (await saveSourceFile(file, type, channelId)).id
        : undefined;
      callback(rows, file.name, sourceFileId);
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
      const ppvs = getDailyPriceLookupPpvs(currentProducts);
      const response = await fetch('/api/daily-price/lookup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ppv: ppvs, channelId })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || 'daily price API 查询失败');
      }

      const rows: DailyPriceRow[] = (payload.rows || [])
        .map((row: Record<string, CellValue>) => ({
          ppv: toText(row.ppv),
          brandName: toText(getField(row, ['品牌名称', '品牌', 'brandName', 'brand'])),
          matched: Boolean(row.matched),
          biBasePrice: toNumber(row['BI基准价']),
          costPrice: toNumber(getDailyPriceFinalQuote(row)),
          zzPrePrice: toNumber(getField(row, ['ZZ券前价', 'zz券前价', '转转券前价'])),
          levelId: toText(getField(row, ['等级id', '等级ID', 'levelid', 'level id'])),
          rawFields: {
            ...row
          }
        }))
        .filter(row => row.ppv && (
          row.brandName || row.costPrice > 0 || row.biBasePrice > 0 || row.zzPrePrice > 0
        ));

      await onDailyPricesLoaded(rows, `daily price API ${payload.dataDate || ''}`.trim());
      const priceMatchedCount = rows.filter(row => row.matched).length;
      const brandMatchedCount = rows.filter(row => row.brandName).length;
      const unmatchedPpvs = ppvs.filter(ppv => !rows.some(row => row.ppv === ppv && row.brandName));
      setDailyApiStatus(
        `已查询本次上传共 ${ppvs.length} 个PPV；价格匹配 ${priceMatchedCount} 个，品牌匹配 ${brandMatchedCount} 个。` +
        `品牌已写入当前工作台。` +
        `最终报价写入jd裸机价，BI基准价写入基准价，ZZ券前价写入zz裸机价，等级id写入等级id列。` +
        `数据日期 ${payload.dataDate || '未知'}` +
        (unmatchedPpvs.length > 0 ? `；未匹配品牌PPV：${unmatchedPpvs.join('、')}` : '')
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'daily price API 查询失败');
    } finally {
      setBusyType(null);
    }
  };

  const handlePpvAggregation = async () => {
    if (!ppvFlowFile || !ppvSoldFile) return;
    setBusyType('ppv聚合工具');
    setError('');
    setPpvAggregationStatus('');
    try {
      const result = await buildPpvAggregation(ppvFlowFile, ppvSoldFile, channelId);
      if (channelId === 'tradeIn' && result.fullRows.length) {
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
          ['商品型号', '商品SKUID', '商品SKU', '商品LEVEL', '报价量', '成交量'],
          ...result.fullRows.map(row => [row.model, row.skuId, row.ppv.slice(row.level.length), row.level, row.quoteVolume, row.soldVolume])
        ]), '完整底表');
        const mergedFile = new File([XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })], `PPV流量成交汇总_${new Date().toISOString().replace(/[:.]/g, '-')}.xlsx`);
        const stored = await uploadGradeSource(mergedFile, 'volume');
        setPpvSources(previous => [stored.source, ...previous.filter(source => source.id !== stored.source.id)]);
      }
      if (result.outputRows.length === 0) {
        throw new Error(`没有生成可导出的聚合结果，请检查商品型号、商品SKU、商品LEVEL、${isSelfOperated ? '报价访客数' : '报价量'}字段。`);
      }
      let zzPriceResult: PpvAggregationZzPriceResult;
      let lookupWarning = '';
      try { zzPriceResult = await applyZzPriceValues(result.outputRows, channelId); }
      catch (lookupError) {
        zzPriceResult = { rows: result.outputRows, apiMatchedRows: 0 };
        lookupWarning = `；ZZ券前价查询未完成：${lookupError instanceof Error ? lookupError.message : '请求失败'}，已导出Top2，可稍后补查`;
      }
      exportPpvAggregationWorkbook(zzPriceResult.rows, channelId, result.fullRows);
      setPpvAggregationStatus(`${result.audit}已读取 ${result.sourceRows} 行底表，剔除商品LEVEL为S的PPV后，按${isSelfOperated ? '报价访客数' : '报价量'}占比75%+成交量占比25%的综合得分Top2输出 ${result.outputRows.length} 行 Sheet1 聚合结果；匹配询价说明 ${result.descriptionMatchedRows} 行，API拉取到ZZ券前价并标记“无需爬价” ${zzPriceResult.apiMatchedRows} 行。${lookupWarning}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ppv聚合导出失败');
    } finally {
      setBusyType(null);
    }
  };

  const updateSelfSubsidyCell = (rowIndex: number, field: keyof SelfSubsidyGridRow, value: string) => {
    setSelfSubsidyGridRows(prev => {
      const next = [...prev];
      next[rowIndex] = { ...next[rowIndex], [field]: value };
      if (rowIndex === next.length - 1 && value.trim()) {
        next.push({ threshold: '', amount: '' });
      }
      return next;
    });
  };

  const handleSelfSubsidyCellPaste = (
    event: React.ClipboardEvent<HTMLInputElement>,
    rowIndex: number,
    field: keyof SelfSubsidyGridRow
  ) => {
    const text = event.clipboardData.getData('text');
    if (!text.includes('\n') && !text.includes('\t')) return;
    event.preventDefault();

    const parsedRows = text
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => (
        line.includes('\t')
          ? line.split('\t')
          : line.includes(',')
            ? line.split(',')
            : line.split(/\s+/)
      ));
    const rowsWithoutHeader = parsedRows[0] && normalize(parsedRows[0][0]).includes('门槛')
      ? parsedRows.slice(1)
      : parsedRows;
    const startColumn = field === 'threshold' ? 0 : 1;

    setSelfSubsidyGridRows(prev => {
      const next = [...prev];
      rowsWithoutHeader.forEach((parts, offset) => {
        const targetIndex = rowIndex + offset;
        while (next.length <= targetIndex) {
          next.push({ threshold: '', amount: '' });
        }
        const current = next[targetIndex] || { threshold: '', amount: '' };
        const nextRow = { ...current };
        if (startColumn === 0) {
          nextRow.threshold = String(parts[0] ?? '').trim();
          nextRow.amount = String(parts[1] ?? '').trim();
        } else {
          nextRow.amount = String(parts[0] ?? '').trim();
        }
        next[targetIndex] = nextRow;
      });
      if (next[next.length - 1]?.threshold || next[next.length - 1]?.amount) {
        next.push({ threshold: '', amount: '' });
      }
      return next;
    });
  };

  const handleSelfSubsidyPaste = () => {
    setError('');
    setSelfSubsidyStatus('');
    const rows = parsePastedSelfSubsidyRules(
      selfSubsidyGridRows
        .map(row => `${row.threshold}\t${row.amount}`)
        .join('\n')
    );
    if (rows.length === 0) {
      setError('没有解析到有效的自营普发券规则，请按“门槛值 AHS补贴”两列粘贴。');
      return;
    }
    onSelfSubsidyRulesLoaded(rows, '自营普发券粘贴');
    setSelfSubsidyStatus(`已导入 ${rows.length} 条自营普发券门槛规则。`);
  };

  const cardClass = 'border border-[#141414] bg-white p-4 space-y-3';
  const inputClass = 'block w-full text-xs file:mr-3 file:border file:border-[#141414] file:bg-[#F0EFEC] file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-[#141414]';
  const statClass = 'border border-[#141414]/20 bg-[#F0EFEC] px-3 py-2 text-xs';

  return (
    <div className="bg-[#F0EFEC]">
      <div className="p-4 border-b border-[#141414]">
        <h2 className="text-base font-bold">数据上传与自动匹配流程</h2>
        <p className="mt-1 text-xs text-[#141414]/70">
          当前竞争表 {currentProducts.length} 行。{isSelfOperated ? '自营渠道补贴采用普发券粘贴规则。' : '现在只需要上传本次竞争追价表和补贴表。'}daily price API 按 ppv 自动匹配品牌名称、最终报价、BI基准价、ZZ券前价和等级id。
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 p-4">
        <div className={cardClass} data-tour="base-upload">
          <div>
            <div className="text-sm font-bold">1. 本次竞争追价表</div>
            <div className="mt-1 text-[11px] text-[#141414]/70">
              {isSelfOperated
                ? '需要字段：旧机型号 / ppv / zz裸机价。自营只对标转转裸机价，上传后替换本次竞争数据，并保留所有源字段。'
                : '需要字段：新机系列 / 旧机型号 / ppv / tm裸机价 / tm总补贴-人工 / zz裸机价。上传后替换本次竞争数据，并保留所有源字段。'}
            </div>
          </div>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className={inputClass}
            onChange={(event) => handleUpload(event.target.files?.[0], 'base', (file) => parseBaseProducts(file, channelId), onBaseProductsLoaded)}
          />
          <div className={statClass}>当前基础行数：{currentProducts.length}</div>
          <div className="border-t border-[#141414]/20 pt-3">
            <div className="flex items-center gap-1.5">
              <div className="text-xs font-bold">竞争型号ppv{isSelfOperated ? '报价访客数' : '报价量'}Top2筛选工具</div>
              <details className="relative">
                <summary
                  className="flex size-4 cursor-pointer list-none items-center justify-center border border-[#141414] bg-[#F0EFEC] text-[10px] font-black leading-none hover:bg-[#141414] hover:text-white focus:outline-none focus:ring-2 focus:ring-[#141414]/30 [&::-webkit-details-marker]:hidden"
                  aria-label="查看Top2筛选与询价说明规则"
                  title="查看Top2筛选与询价说明规则"
                >
                  ?
                </summary>
                <div className="absolute left-0 top-6 z-30 max-h-[70vh] w-[520px] max-w-[calc(100vw-3rem)] overflow-y-auto border border-[#141414] bg-white shadow-[4px_4px_0_#141414]">
                  <div className="border-b border-[#141414] bg-[#F0EFEC] px-3 py-2 text-xs font-black">Top2筛选与询价说明规则</div>
                  <div className="space-y-4 border-b border-[#141414]/20 px-4 py-3 text-[11px] leading-relaxed text-[#141414]/75">
                    <section className="space-y-2">
                      <h4 className="font-bold text-[#141414]">01 · 上传与匹配</h4>
                      <div className="space-y-2 border border-[#141414]/10 bg-[#F7F7F5] p-2.5">
                        <p><strong className="text-[#141414]">流量表</strong><br />商品型号 / 商品SKUID / 商品SKU / 商品LEVEL / {isSelfOperated ? '报价访客数' : '报价量'}</p>
                        <p><strong className="text-[#141414]">成交表</strong><br />质检型号 / 质检SKUID / 质检SKU / 质检LEVEL / 成交订单量</p>
                      </div>
                      <ul className="list-disc space-y-1 pl-4">
                        <li>两表按 <strong className="text-[#141414]">SKUID + LEVEL</strong> 匹配，成交量取质检SKU和等级。</li>
                        <li>选好两份文件后，点击“生成”导出结果。</li>
                      </ul>
                    </section>
                    <section className="space-y-2">
                      <h4 className="font-bold text-[#141414]">02 · Top2筛选规则</h4>
                      <ul className="list-disc space-y-1 pl-4">
                        <li>先排除等级恰为 S 的PPV，保留 99-S、95-S 等等级。</li>
                        <li>同型号内评分：<strong className="text-[#141414]">75% × {isSelfOperated ? '报价访客数' : '报价量'}占比 + 25% × 成交量占比</strong>。</li>
                        <li>取前2名，第二名同分时全部保留。</li>
                      </ul>
                    </section>
                    <section className="space-y-2">
                      <h4 className="font-bold text-[#141414]">03 · 输出与统计口径</h4>
                      <ul className="list-disc space-y-1 pl-4">
                        <li>API匹配到ZZ券前价时，标记“无需爬价”。</li>
                        <li>完整汇总表保留两表组合的并集，缺少一侧的数量记0，供等级推算使用。</li>
                        <li>等级推算按所选表匹配SKU+LEVEL，缺少组合时依次补查两个更旧版本；已有0值不回退、不跨期累加，补用来源会注明。</li>
                        <li>两表须使用相同统计周期、渠道和业务范围；询价与质检等级须采用相同定义。</li>
                      </ul>
                    </section>
                  </div>
                  <div className="border-b border-[#141414]/20 bg-[#F0EFEC] px-4 py-2 text-xs font-bold">等级与询价说明</div>
                  <div>
                    <table className="w-full border-collapse text-[11px]">
                      <thead className="sticky top-0 bg-white">
                        <tr className="border-b border-[#141414] text-left">
                          <th className="w-20 border-r border-[#141414]/30 px-3 py-2 font-black">商品LEVEL</th>
                          <th className="px-3 py-2 font-black">询价说明</th>
                        </tr>
                      </thead>
                      <tbody>
                        {PPV_INQUIRY_DESCRIPTION_RULES.map(([level, description]) => (
                          <tr key={level} className="border-b border-[#141414]/15 last:border-b-0">
                            <td className="border-r border-[#141414]/20 px-3 py-1.5 font-mono font-bold">{level}</td>
                            <td className="px-3 py-1.5">{description}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="border-t border-[#141414] bg-[#F0EFEC] px-3 py-2 text-[10px] text-[#141414]/70">按商品LEVEL精确匹配，忽略大小写和空格；未配置等级的询价说明留空。</div>
                </div>
              </details>
            </div>

          </div>
          {!isSelfOperated && <div className="border border-[#141414]/20 bg-[#F0EFEC] p-2 text-[11px] leading-relaxed">
            {latestMergedPpvSource ? <>
              <div className="font-bold">最新完整汇总表 · {latestMergedPpvSource.rowCount} 个PPV</div>
              <div className="truncate" title={latestMergedPpvSource.fileName}>{latestMergedPpvSource.fileName}</div>
              <a className="underline" href={gradeSourceUrl(latestMergedPpvSource.id)}>下载汇总表</a>
              <span className="ml-2 text-[#555]">等级推算请选择此版本</span>
            </> : <span className="text-[#555]">尚未生成流量与成交汇总表，请上传两表后生成。</span>}
          </div>}
          <div className="flex items-center gap-2">
            <label className={`relative flex-1 cursor-pointer whitespace-nowrap border border-[#141414] px-2 py-2 text-center text-xs font-bold focus-within:ring-2 focus-within:ring-[#141414]/30 ${busyType ? 'opacity-40' : 'hover:bg-[#F0EFEC]'}`}>
              上传流量表
              <input type="file" accept=".xlsx,.xls,.csv" aria-label="上传流量表" disabled={!!busyType} className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                onChange={event => { setPpvFlowFile(event.target.files?.[0] || null); setPpvAggregationStatus(''); setError(''); }} />
            </label>
            <label className={`relative flex-1 cursor-pointer whitespace-nowrap border border-[#141414] px-2 py-2 text-center text-xs font-bold focus-within:ring-2 focus-within:ring-[#141414]/30 ${busyType ? 'opacity-40' : 'hover:bg-[#F0EFEC]'}`}>
              上传成交表
              <input type="file" accept=".xlsx,.xls,.csv" aria-label="上传成交表" disabled={!!busyType} className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                onChange={event => { setPpvSoldFile(event.target.files?.[0] || null); setPpvAggregationStatus(''); setError(''); }} />
            </label>
            <button type="button" disabled={!!busyType || !ppvFlowFile || !ppvSoldFile} onClick={handlePpvAggregation}
              className="flex-1 whitespace-nowrap border border-[#141414] bg-[#141414] px-2 py-2 text-xs font-bold text-white disabled:opacity-40">
              {busyType === 'ppv聚合工具' ? '生成中…' : '生成'}
            </button>
          </div>
          {(ppvFlowFile || ppvSoldFile) && <div className="space-y-1 text-[11px] text-[#555]">
            {ppvFlowFile && <div className="truncate" title={ppvFlowFile.name}>流量：{ppvFlowFile.name}</div>}
            {ppvSoldFile && <div className="truncate" title={ppvSoldFile.name}>成交：{ppvSoldFile.name}</div>}
          </div>}
          {ppvAggregationStatus && <div className="text-[11px] font-bold text-green-700">{ppvAggregationStatus}</div>}
        </div>

        <div className={cardClass} data-tour="daily-api">
          <div>
            <div className="text-sm font-bold">2. daily price API</div>
            <div className="mt-1 text-[11px] text-[#141414]/70">不需要上传表。系统调用 daily price 项目接口：品牌名称写入BK列，最终报价写入 jd裸机价，BI基准价写入基准价，ZZ券前价写入 zz裸机价，等级id写入等级id列。</div>
          </div>
          <button
            type="button"
            onClick={syncDailyPriceApi}
            className="w-full border border-[#141414] bg-[#141414] px-3 py-2 text-xs font-bold text-white hover:bg-[#2A2A2B]"
          >
            通过 API 匹配 品牌名称 / jd裸机价 / 基准价 / zz裸机价 / 等级id
          </button>
          <div className={statClass}>已导入 {dailyPrices.length} 行，当前匹配 {dailyMatched}/{currentProducts.length} 行</div>
          {dailyApiStatus && <div className="text-[11px] font-bold text-green-700">{dailyApiStatus}</div>}
        </div>

        {isSelfOperated ? (
          <div className={cardClass} data-tour="self-subsidy">
            <div>
              <div className="text-sm font-bold">3. 自营普发券</div>
              <div className="mt-1 text-[11px] text-[#141414]/70">直接粘贴两列：门槛 / 优惠金额-1组。不分新机系列，补贴全部按爱回收承担计算。</div>
            </div>
            <div className="max-h-72 overflow-auto border border-[#141414] bg-white">
              <table className="w-full table-fixed text-xs">
                <thead className="sticky top-0 bg-[#E4E3E0]">
                  <tr className="border-b border-[#141414]">
                    <th className="w-1/2 border-r border-[#141414] px-2 py-1.5 text-left font-black">门槛</th>
                    <th className="w-1/2 px-2 py-1.5 text-left font-black">优惠金额-1组</th>
                  </tr>
                </thead>
                <tbody>
                  {selfSubsidyGridRows.map((row, rowIndex) => (
                    <tr key={rowIndex} className="border-b border-[#141414]/20 last:border-b-0">
                      <td className="border-r border-[#141414]/20">
                        <input
                          value={row.threshold}
                          onChange={(event) => updateSelfSubsidyCell(rowIndex, 'threshold', event.target.value)}
                          onPaste={(event) => handleSelfSubsidyCellPaste(event, rowIndex, 'threshold')}
                          className="h-7 w-full bg-[#F9F9F8] px-2 font-mono focus:bg-white focus:outline-none"
                        />
                      </td>
                      <td>
                        <input
                          value={row.amount}
                          onChange={(event) => updateSelfSubsidyCell(rowIndex, 'amount', event.target.value)}
                          onPaste={(event) => handleSelfSubsidyCellPaste(event, rowIndex, 'amount')}
                          className="h-7 w-full bg-[#F9F9F8] px-2 font-mono focus:bg-white focus:outline-none"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={handleSelfSubsidyPaste}
              className="w-full border border-[#141414] bg-[#141414] px-3 py-2 text-xs font-bold text-white hover:bg-[#2A2A2B]"
            >
              应用自营普发券规则
            </button>
            <div className={statClass}>已导入 {selfSubsidyRules.length} 条自营普发券规则</div>
            {selfSubsidyStatus && <div className="text-[11px] font-bold text-green-700">{selfSubsidyStatus}</div>}
          </div>
        ) : (
          <div className={cardClass} data-tour="subsidy-upload">
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
        )}

      </div>

      {(busyType || error) && (
        <div className="mx-4 mb-4 border border-[#141414] bg-white p-3 text-xs font-bold">
          {busyType && <span>正在解析 {busyType} 数据源...</span>}
          {error && <span className="text-red-700">{error}</span>}
        </div>
      )}

      {restoredSnapshotFiles && <div className="p-4 border-t border-[#141414] text-xs">
        <h3 className="text-sm font-bold mb-2">已归档原文件</h3>
        <p className="mb-2 text-[#666]">本次回填快照 {restoredSnapshotFiles.batchId} 最后使用的原文件。</p>
        <div className="space-y-1">{snapshotFiles.map(file => <div key={file.id} className="flex items-center gap-2 border-b border-[#ddd] py-1">
          <span className="min-w-14 text-[#666]">{file.type === 'base' ? '竞争表' : '补贴表'}</span>
          <span className="min-w-0 flex-1 truncate" title={file.fileName}>{file.fileName}</span>
          <SourceFileDownloadLink sourceFileId={file.sourceFileId!} fileName={file.fileName} />
        </div>)}</div>
        {snapshotFiles.length === 0 && <p className="text-[#777]">这条快照没有保存可下载的竞争表或补贴表原文件。</p>}
      </div>}

      <div className="p-4 border-t border-[#141414]">
        <h3 className="text-sm font-bold mb-3">上传记录</h3>
        <div className="overflow-x-auto border border-[#141414] bg-white">
          <table className="w-full min-w-[1120px] table-fixed text-xs">
            <colgroup>
              <col className="w-[110px]" />
              <col className="w-[280px]" />
              <col className="w-[165px]" />
              <col className="w-[75px]" />
              <col className="w-[90px]" />
              <col />
              <col className="w-24" />
            </colgroup>
            <thead className="bg-[#E4E3E0] border-b border-[#141414]">
              <tr>
                <th className="p-2 text-left border-r border-[#141414]">数据源</th>
                <th className="p-2 text-left border-r border-[#141414]">文件名</th>
                <th className="p-2 text-left border-r border-[#141414]">上传时间</th>
                <th className="p-2 text-right border-r border-[#141414]">行数</th>
                <th className="p-2 text-right border-r border-[#141414]">匹配行数</th>
                <th className="p-2 text-left border-r border-[#141414]">匹配说明</th>
                <th className="p-2 text-center">操作</th>
              </tr>
            </thead>
            <tbody>
              {ppvSources.map(source => {
                const merged = /^(PPV流量成交汇总_|成交匹配_)/.test(source.fileName);
                return <tr key={`ppv-${source.id}`} className="border-b border-[#141414]/20">
                  <td className="p-2 border-r border-[#141414]/20 font-bold">{merged ? 'PPV完整汇总表' : '历史流量底表'}</td>
                  <td className="p-2 border-r border-[#141414]/20"><span className="block truncate" title={source.fileName}>{source.fileName}</span></td>
                  <td className="p-2 border-r border-[#141414]/20 font-mono">{new Date(source.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</td>
                  <td className="p-2 text-right border-r border-[#141414]/20 font-mono">{source.rowCount}</td>
                  <td className="p-2 text-right border-r border-[#141414]/20">—</td>
                  <td className="p-2 border-r border-[#141414]/20">{merged ? '流量表与质检成交表按SKUID+LEVEL汇总，供等级推算使用' : '旧版底表，成交量未经独立质检成交表匹配'}</td>
                  <td className="p-2 text-center align-middle"><a href={gradeSourceUrl(source.id)} aria-label={`下载 ${source.fileName}`} className="inline-flex h-7 items-center gap-1 px-2 underline"><ArrowBigDownDash className="h-4 w-4" aria-hidden="true" />下载</a></td>
                </tr>;
              })}
              {uploadRecords.map(record => (
                <tr key={record.id} className="border-b border-[#141414]/20">
                  <td className="p-2 border-r border-[#141414]/20 font-bold">{recordTypeLabel(record.type)}</td>
                  <td className="p-2 border-r border-[#141414]/20">
                    <span className="block truncate" title={record.fileName}>{record.fileName}</span>
                  </td>
                  <td className="p-2 border-r border-[#141414]/20 font-mono">{record.uploadedAt}</td>
                  <td className="p-2 text-right border-r border-[#141414]/20 font-mono">{record.rowCount}</td>
                  <td className="p-2 text-right border-r border-[#141414]/20 font-mono">{record.matchedCount ?? ''}</td>
                  <td className="p-2 border-r border-[#141414]/20">{record.remarks || ''}</td>
                  <td className="p-2 text-center align-middle">
                    {record.sourceFileId ? (
                      <SourceFileDownloadLink sourceFileId={record.sourceFileId} fileName={record.fileName} showLabel />
                    ) : (
                      <button type="button" disabled className="inline-flex h-7 cursor-not-allowed items-center justify-center gap-1 px-2 text-[#bbb]" title={record.type === 'base' || record.type === 'subsidy' ? '旧快照未保存原文件，无法下载' : '这条记录没有可下载的原文件'} aria-label={`${record.fileName} 无原文件可下载`}><ArrowBigDownDash className="h-4 w-4" aria-hidden="true" />下载</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
