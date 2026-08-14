import { makeBarSeries, makeChartSpace, makeLineChart } from '@office-kit/xlsx/chart';
import { addChartAt } from '@office-kit/xlsx/drawing';
import { workbookToBuffer } from '@office-kit/xlsx/node';
import {
  setBold,
  setCellBackgroundColor,
  setRangeAlignment,
  setRangeBorderBox,
  setRangeNumberFormat,
  setRangeWrapText
} from '@office-kit/xlsx/styles';
import { addWorksheet, createWorkbook } from '@office-kit/xlsx/workbook';
import { setCell, setColumnWidth, setFreezePanes, setRowHeight } from '@office-kit/xlsx/worksheet';

const DATA_HEADER_ROW = 23;
const DATA_START_ROW = DATA_HEADER_ROW + 1;
const INVALID_SHEET_CHARACTERS = /[\[\]:*?/\\]+/g;

const COLUMNS = [
  { header: '日期', width: 16 },
  { header: '批次', width: 30 },
  { header: '节点类型', width: 14 },
  { header: '天猫到手价竞争力', width: 20, key: 'tmDirectScore', color: 'C2873E', dash: true },
  { header: '天猫物品价竞争力', width: 20, key: 'tmItemScore', color: 'B43E2B' },
  { header: '物品价+AHS补贴 vs 转转到手价', width: 32, key: 'ahsVsZzDirectScore', color: '1E824C' },
  { header: '转转物品价竞争力', width: 22, key: 'zzItemScore', color: '1B6D87' }
];

const cleanWorksheetName = value => {
  const cleaned = String(value || '未命名品牌')
    .replace(INVALID_SHEET_CHARACTERS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^'+|'+$/g, '');
  return (cleaned || '未命名品牌').slice(0, 31);
};

export const normalizeWorksheetNames = names => {
  const used = new Set();
  return names.map(rawName => {
    const base = cleanWorksheetName(rawName);
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate.toLocaleLowerCase())) {
      const suffixText = ` (${suffix})`;
      candidate = `${base.slice(0, 31 - suffixText.length)}${suffixText}`;
      suffix += 1;
    }
    used.add(candidate.toLocaleLowerCase());
    return candidate;
  });
};

export const getCompetitivenessExportFileName = (date = new Date()) => {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `竞争力走势_总盘及品牌_${yyyy}-${mm}-${dd}.xlsx`;
};

const solidLine = (color, dashed = false) => ({
  ln: {
    w: 25400,
    fill: {
      kind: 'solidFill',
      color: { base: { kind: 'srgb', value: color }, mods: [] }
    },
    ...(dashed ? { dash: { kind: 'preset', val: 'dash' } } : {})
  }
});

const quoteSheetName = sheetName => `'${sheetName.replaceAll("'", "''")}'`;

const addTrendChart = (worksheet, sheetName, chartTitle, points) => {
  const quotedSheetName = quoteSheetName(sheetName);
  const endRow = DATA_START_ROW + points.length - 1;
  const categoryRef = `${quotedSheetName}!$A$${DATA_START_ROW}:$A$${endRow}`;
  const series = COLUMNS.slice(3).map((column, index) => {
    const columnLetter = String.fromCharCode('D'.charCodeAt(0) + index);
    const result = makeBarSeries({
      idx: index,
      order: index,
      tx: { kind: 'literal', value: column.header },
      cat: { ref: categoryRef, cacheKind: 'str', cache: points.map(point => point.date) },
      val: {
        ref: `${quotedSheetName}!$${columnLetter}$${DATA_START_ROW}:$${columnLetter}$${endRow}`,
        cache: points.map(point => Number(point[column.key]) / 100),
        formatCode: '0.0%'
      }
    });
    result.spPr = solidLine(column.color, column.dash);
    result.marker = { symbol: 'circle', size: 5, spPr: solidLine(column.color) };
    return result;
  });
  const categoryAxisId = 81234567;
  const valueAxisId = 81234568;
  const lineChart = makeLineChart({
    grouping: 'standard',
    series,
    axIds: [categoryAxisId, valueAxisId]
  });
  const space = makeChartSpace({
    title: chartTitle,
    legend: { position: 'b', overlay: false },
    style: 10,
    dispBlanksAs: 'gap',
    plotArea: {
      chart: lineChart,
      catAx: {
        axId: categoryAxisId,
        crossAx: valueAxisId,
        position: 'b',
        tickLblPos: 'nextTo',
        scaling: { orientation: 'minMax' }
      },
      valAx: {
        axId: valueAxisId,
        crossAx: categoryAxisId,
        position: 'l',
        tickLblPos: 'nextTo',
        scaling: { orientation: 'minMax', min: 0, max: 1 },
        numFmt: { formatCode: '0%', sourceLinked: false },
        majorUnit: 0.25,
        majorGridlines: true
      }
    }
  });
  addChartAt(worksheet, 'A1', { space }, { widthPx: 1120, heightPx: 380 });
};

const assertPayload = payload => {
  const sheets = payload?.sheets;
  if (!Array.isArray(sheets) || sheets.length === 0 || !sheets.some(sheet => Array.isArray(sheet.points) && sheet.points.length > 0)) {
    throw new Error('没有可导出的竞争力走势数据');
  }
  sheets.forEach(sheet => {
    if (!Array.isArray(sheet.points) || sheet.points.length === 0) {
      throw new Error(`工作表“${sheet.sheetName || '未命名'}”没有可导出的竞争力走势数据`);
    }
  });
};

export const createCompetitivenessTrendWorkbook = async payload => {
  assertPayload(payload);
  const workbook = createWorkbook();
  const names = normalizeWorksheetNames(payload.sheets.map(sheet => sheet.sheetName));

  payload.sheets.forEach((sheet, sheetIndex) => {
    const sheetName = names[sheetIndex];
    const worksheet = addWorksheet(workbook, sheetName);
    COLUMNS.forEach((column, columnIndex) => {
      setColumnWidth(worksheet, columnIndex + 1, column.width);
      const headerCell = setCell(worksheet, DATA_HEADER_ROW, columnIndex + 1, column.header);
      setBold(workbook, headerCell, true);
      setCellBackgroundColor(workbook, headerCell, 'FFE7E5E1');
    });
    setRowHeight(worksheet, DATA_HEADER_ROW, 30);

    sheet.points.forEach((point, pointIndex) => {
      const row = DATA_START_ROW + pointIndex;
      setCell(worksheet, row, 1, String(point.date || ''));
      setCell(worksheet, row, 2, String(point.batchName || ''));
      setCell(worksheet, row, 3, point.nodeType === '实时草稿' ? '实时草稿' : '历史正式');
      COLUMNS.slice(3).forEach((column, metricIndex) => {
        const score = Number(point[column.key]);
        setCell(worksheet, row, metricIndex + 4, Number.isFinite(score) ? score / 100 : 0);
      });
    });

    const endRow = DATA_START_ROW + sheet.points.length - 1;
    setRangeNumberFormat(workbook, worksheet, `D${DATA_START_ROW}:G${endRow}`, '0.0%');
    setRangeAlignment(workbook, worksheet, `A${DATA_HEADER_ROW}:G${endRow}`, { vertical: 'center' });
    setRangeWrapText(workbook, worksheet, `A${DATA_HEADER_ROW}:G${endRow}`, true);
    setRangeBorderBox(workbook, worksheet, `A${DATA_HEADER_ROW}:G${endRow}`, {
      style: 'thin',
      color: 'FF141414',
      inner: 'hair'
    });
    setFreezePanes(worksheet, `A${DATA_START_ROW}`);
    addTrendChart(worksheet, sheetName, sheet.chartTitle || `${sheetName} 竞争力波动走势`, sheet.points);
  });

  return workbookToBuffer(workbook);
};
