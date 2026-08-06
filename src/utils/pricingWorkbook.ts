import * as XLSX from 'xlsx';
import {
  CalculatedProduct,
  ChannelId,
  SelfOperatedSubsidyRule,
  SubsidyRule
} from '../types';

const RULES_SHEET_NAME = '补贴规则';
const PRICE_FORMAT = '#,##0.00';
const PERCENT_FORMAT = '0.00%';
const FLAG_FORMAT = '0';

type WorkbookWithCalcProperties = XLSX.WorkBook & {
  Workbook?: XLSX.WorkBook['Workbook'] & {
    CalcPr?: {
      calcMode?: string;
      fullCalcOnLoad?: boolean;
      forceFullCalc?: boolean;
    };
  };
};

export interface DynamicPricingWorkbookOptions {
  workbook: XLSX.WorkBook;
  pricingSheet: XLSX.WorkSheet;
  pricingSheetName: string;
  products: CalculatedProduct[];
  channelId: ChannelId;
  subsidyRules: SubsidyRule[];
  selfSubsidyRules: SelfOperatedSubsidyRule[];
}

const unionRawFieldKeys = (
  rows: Array<{ rawFields: Record<string, string | number | boolean | null> }>
) => Array.from(rows.reduce((keys, row) => {
  Object.keys(row.rawFields || {}).forEach(key => keys.add(key));
  return keys;
}, new Set<string>()));

const createRulesSheet = (
  channelId: ChannelId,
  subsidyRules: SubsidyRule[],
  selfSubsidyRules: SelfOperatedSubsidyRule[]
) => {
  if (channelId === 'selfOperated') {
    const rows = [...selfSubsidyRules].sort((a, b) => a.threshold - b.threshold);
    const rawKeys = unionRawFieldKeys(rows);
    const sheet = XLSX.utils.aoa_to_sheet([
      ['价格门槛', 'AHS投入', ...rawKeys],
      ...rows.map(row => [
        row.threshold,
        row.ahsInput,
        ...rawKeys.map(key => row.rawFields[key] ?? '')
      ])
    ]);
    sheet['!cols'] = [
      { wch: 14 },
      { wch: 14 },
      ...rawKeys.map(() => ({ wch: 18 }))
    ];
    return { sheet, ruleCount: rows.length };
  }

  const rows = [...subsidyRules].sort((a, b) => (
    a.newSeries.localeCompare(b.newSeries, 'zh-CN') || a.threshold - b.threshold
  ));
  const rawKeys = unionRawFieldKeys(rows);
  const sheet = XLSX.utils.aoa_to_sheet([
    ['新机系列', '价格门槛', 'AHS投入', '京东补贴', ...rawKeys],
    ...rows.map(row => [
      row.newSeries,
      row.threshold,
      row.ahsInput,
      row.jdSubsidy,
      ...rawKeys.map(key => row.rawFields[key] ?? '')
    ])
  ]);
  sheet['!cols'] = [
    { wch: 20 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    ...rawKeys.map(() => ({ wch: 18 }))
  ];
  return { sheet, ruleCount: rows.length };
};

const getLabelColumns = (sheet: XLSX.WorkSheet) => {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  const columns = new Map<string, number>();
  for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: 1, c: columnIndex })];
    const label = String(cell?.v ?? '').trim();
    if (label && !columns.has(label)) columns.set(label, columnIndex);
  }
  return columns;
};

const cellRef = (columnIndex: number, rowNumber: number) => (
  `${XLSX.utils.encode_col(columnIndex)}${rowNumber}`
);

const requiredColumn = (columns: Map<string, number>, ...labels: string[]) => {
  for (const label of labels) {
    const column = columns.get(label);
    if (column !== undefined) return column;
  }
  throw new Error(`导出追价表缺少必要列：${labels.join(' / ')}`);
};

const optionalColumn = (columns: Map<string, number>, label: string) => columns.get(label);

const writeFormulaCell = (
  sheet: XLSX.WorkSheet,
  columnIndex: number,
  rowNumber: number,
  formula: string,
  cachedValue: number,
  numberFormat: string
) => {
  sheet[cellRef(columnIndex, rowNumber)] = {
    t: 'n',
    f: formula,
    v: cachedValue,
    z: numberFormat
  };
};

const formatNumericColumn = (
  sheet: XLSX.WorkSheet,
  columns: Map<string, number>,
  labels: string[],
  rowCount: number,
  numberFormat: string
) => {
  labels.forEach(label => {
    const column = optionalColumn(columns, label);
    if (column === undefined) return;
    for (let dataIndex = 0; dataIndex < rowCount; dataIndex += 1) {
      const cell = sheet[cellRef(column, dataIndex + 3)];
      if (cell) cell.z = numberFormat;
    }
  });
};

export const addDynamicPricingWorkbookSheets = ({
  workbook,
  pricingSheet,
  pricingSheetName,
  products,
  channelId,
  subsidyRules,
  selfSubsidyRules
}: DynamicPricingWorkbookOptions): void => {
  if (workbook.Sheets[pricingSheetName] !== pricingSheet) {
    throw new Error(`工作簿中未找到追价工作表：${pricingSheetName}`);
  }

  const { sheet: rulesSheet, ruleCount } = createRulesSheet(channelId, subsidyRules, selfSubsidyRules);
  XLSX.utils.book_append_sheet(workbook, rulesSheet, RULES_SHEET_NAME);

  const columns = getLabelColumns(pricingSheet);
  const currentJdColumn = requiredColumn(columns, 'jd裸机价');
  const currentAhsColumn = requiredColumn(columns, '对应新品型号ahs投入', '自营普发券AHS补贴');
  const basePriceColumn = requiredColumn(columns, '基准价');
  const trialPriceColumn = requiredColumn(columns, '试算追后价');
  const adjustmentColumn = requiredColumn(columns, '京东物品价-追价后调整金额');
  const postAhsColumn = requiredColumn(columns, '追后AHS补贴');
  const postJdSubsidyColumn = requiredColumn(columns, '追后京东总补贴');
  const postAhsPriceColumn = requiredColumn(columns, '追后含AHS补贴报价');
  const postJdHandPriceColumn = requiredColumn(columns, '追后京东总到手价');
  const postMarginColumn = requiredColumn(columns, '追后边际利润率');
  const currentJdSubsidyColumn = channelId === 'tradeIn'
    ? requiredColumn(columns, '对应新品型号jd总投入')
    : undefined;
  const seriesColumn = channelId === 'tradeIn'
    ? requiredColumn(columns, '新机系列')
    : undefined;

  const lastRuleRow = ruleCount + 1;
  products.forEach((product, dataIndex) => {
    const rowNumber = dataIndex + 3;
    const currentJdCell = cellRef(currentJdColumn, rowNumber);
    const currentAhsCell = cellRef(currentAhsColumn, rowNumber);
    const basePriceCell = cellRef(basePriceColumn, rowNumber);
    const trialPriceCell = cellRef(trialPriceColumn, rowNumber);
    const adjustmentCell = cellRef(adjustmentColumn, rowNumber);
    const postAhsCell = cellRef(postAhsColumn, rowNumber);
    const postJdSubsidyCell = cellRef(postJdSubsidyColumn, rowNumber);
    const postAhsPriceCell = cellRef(postAhsPriceColumn, rowNumber);
    const postJdHandPriceCell = cellRef(postJdHandPriceColumn, rowNumber);

    let postAhsFormula: string;
    let postJdSubsidyFormula: string;

    if (channelId === 'selfOperated') {
      postAhsFormula = ruleCount === 0
        ? '0'
        : `IFERROR(_xlfn.XLOOKUP(1,--('${RULES_SHEET_NAME}'!$A$2:$A$${lastRuleRow}<=${trialPriceCell}),'${RULES_SHEET_NAME}'!$B$2:$B$${lastRuleRow},0,0,-1),0)`;
      postJdSubsidyFormula = '0';
    } else {
      const matchingSeriesRuleCount = subsidyRules.filter(rule => rule.newSeries === product.newSeries).length;
      const currentJdSubsidyCell = cellRef(currentJdSubsidyColumn as number, rowNumber);
      if (matchingSeriesRuleCount === 0) {
        postAhsFormula = currentAhsCell;
        postJdSubsidyFormula = currentJdSubsidyCell;
      } else {
        const seriesCell = cellRef(seriesColumn as number, rowNumber);
        const lookupArray = `('${RULES_SHEET_NAME}'!$A$2:$A$${lastRuleRow}=${seriesCell})*('${RULES_SHEET_NAME}'!$B$2:$B$${lastRuleRow}<=${trialPriceCell})`;
        postAhsFormula = `IFERROR(_xlfn.XLOOKUP(1,${lookupArray},'${RULES_SHEET_NAME}'!$C$2:$C$${lastRuleRow},0,0,-1),0)`;
        postJdSubsidyFormula = `IFERROR(_xlfn.XLOOKUP(1,${lookupArray},'${RULES_SHEET_NAME}'!$D$2:$D$${lastRuleRow},0,0,-1),0)`;
      }
    }

    writeFormulaCell(pricingSheet, postAhsColumn, rowNumber, postAhsFormula, product.ahsSubsidyAfter, PRICE_FORMAT);
    writeFormulaCell(pricingSheet, postJdSubsidyColumn, rowNumber, postJdSubsidyFormula, product.totalSubsidy, PRICE_FORMAT);
    writeFormulaCell(
      pricingSheet,
      adjustmentColumn,
      rowNumber,
      `${trialPriceCell}-${currentJdCell}`,
      product.recommendAdjustment,
      PRICE_FORMAT
    );
    writeFormulaCell(
      pricingSheet,
      postAhsPriceColumn,
      rowNumber,
      `${trialPriceCell}+${postAhsCell}`,
      product.postAhsPrice,
      PRICE_FORMAT
    );
    writeFormulaCell(
      pricingSheet,
      postJdHandPriceColumn,
      rowNumber,
      `${trialPriceCell}+${postJdSubsidyCell}`,
      product.postJdHandPrice,
      PRICE_FORMAT
    );

    const linearCostFormula = channelId === 'selfOperated'
      ? `(${basePriceCell}*0.0218+63)`
      : `((${trialPriceCell}+${postAhsCell})*0.0466+${basePriceCell}*0.0218+81)`;
    writeFormulaCell(
      pricingSheet,
      postMarginColumn,
      rowNumber,
      `IF(${basePriceCell}<=0,0,1-(${trialPriceCell}+${postAhsCell}+${linearCostFormula})/${basePriceCell})`,
      product.postMarginalProfit,
      PERCENT_FORMAT
    );

    const formulaFlags: Array<[string, string, boolean]> = [
      ['京东物品价-追价后 vs 天猫', 'tm裸机价', product.postTmItemWin],
      ['京东到手价-追价后 vs 天猫', 'tm总到手价', product.postTmHandWin],
      ['京东物品价-追价后 vs 转转', 'zz裸机价', product.postZzItemWin],
      ['京东物品价+ahs补贴-追价后 vs 转转', 'zz券后价', product.postAhsZzHandWin]
    ];

    formulaFlags.forEach(([resultLabel, competitorLabel, cachedWin]) => {
      const resultColumn = optionalColumn(columns, resultLabel);
      const competitorColumn = optionalColumn(columns, competitorLabel);
      if (resultColumn === undefined || competitorColumn === undefined) return;
      const competitorCell = cellRef(competitorColumn, rowNumber);
      const comparedCell = resultLabel === '京东到手价-追价后 vs 天猫'
        ? postJdHandPriceCell
        : resultLabel === '京东物品价+ahs补贴-追价后 vs 转转'
          ? postAhsPriceCell
          : trialPriceCell;
      writeFormulaCell(
        pricingSheet,
        resultColumn,
        rowNumber,
        `--AND(${competitorCell}>0,${comparedCell}>=${competitorCell})`,
        cachedWin ? 1 : 0,
        FLAG_FORMAT
      );
    });
  });

  formatNumericColumn(pricingSheet, columns, [
    'jd裸机价',
    '对应新品型号ahs投入',
    '自营普发券AHS补贴',
    '对应新品型号jd总投入',
    'tm裸机价',
    'tm总补贴-人工',
    'tm总到手价',
    'zz裸机价',
    'zz券后价',
    '基准价',
    '系统推荐追后价',
    '试算追后价'
  ], products.length, PRICE_FORMAT);
  formatNumericColumn(pricingSheet, columns, ['追前边际利润率'], products.length, PERCENT_FORMAT);

  const workbookWithCalcProperties = workbook as WorkbookWithCalcProperties;
  workbookWithCalcProperties.Workbook = {
    ...(workbookWithCalcProperties.Workbook || {}),
    CalcPr: {
      ...(workbookWithCalcProperties.Workbook?.CalcPr || {}),
      calcMode: 'auto',
      fullCalcOnLoad: true,
      forceFullCalc: true
    }
  };
};
