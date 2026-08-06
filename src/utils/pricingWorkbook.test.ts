import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { CalculatedProduct, SelfOperatedSubsidyRule, SubsidyRule } from '../types';
import { addDynamicPricingWorkbookSheets } from './pricingWorkbook';

const labels = [
  '新机系列',
  'jd裸机价',
  'jd总到手价',
  '对应新品型号ahs投入',
  '对应新品型号jd总投入',
  'tm裸机价',
  'tm总到手价',
  'zz裸机价',
  'zz券后价',
  '基准价',
  '追前tm物品价差',
  '追前tm到手价差',
  '系统推荐追后价',
  '试算追后价',
  '京东物品价-追价后调整金额',
  '追后AHS补贴',
  '追后京东总补贴',
  '追后含AHS补贴报价',
  '追后京东总到手价',
  '追后边际利润率',
  '追后tm物品价差',
  '追后tm到手价差',
  '京东物品价-追价后 vs 天猫',
  '京东到手价-追价后 vs 天猫',
  '京东物品价-追价后 vs 转转',
  '京东物品价+ahs补贴-追价后 vs 转转',
  '原始字段'
];

const product = {
  newSeries: 'iPhone 17',
  jdPrice: 1000,
  jdHandPrice: 1050,
  ahsInput: 100,
  jdSubsidy: 50,
  tmPrice: 1100,
  tmHandPrice: 1180,
  zzPrice: 1080,
  zzHandPrice: 1200,
  basePrice: 1600,
  recommendJdPrice: 1150,
  recommendAdjustment: 150,
  ahsSubsidyAfter: 120,
  postAhsPrice: 1270,
  postJdHandPrice: 1210,
  postMarginalProfit: 0.1,
  postTmItemWin: true,
  postTmHandWin: true,
  postZzItemWin: true,
  postAhsZzHandWin: true,
  totalSubsidy: 60
} as CalculatedProduct;

const subsidyRules: SubsidyRule[] = [
  {
    newSeries: 'iPhone 17',
    threshold: 1100,
    ahsInput: 120,
    jdSubsidy: 60,
    rawFields: { 'A_新机系列': 'iPhone 17', 'B_门槛': 1100 }
  },
  {
    newSeries: 'iPhone 17',
    threshold: 900,
    ahsInput: 100,
    jdSubsidy: 50,
    rawFields: { 'A_新机系列': 'iPhone 17', 'B_门槛': 900 }
  }
];

const makeWorkbook = (pricingSheetName = '询价表_京东换新追价') => {
  const pricingSheet = XLSX.utils.aoa_to_sheet([
    labels.map((_, index) => `C${index + 1}`),
    labels,
    [
      product.newSeries,
      product.jdPrice,
      product.jdHandPrice,
      product.ahsInput,
      product.jdSubsidy,
      product.tmPrice,
      product.tmHandPrice,
      product.zzPrice,
      product.zzHandPrice,
      product.basePrice,
      product.jdPrice - product.tmPrice,
      product.jdHandPrice - product.tmHandPrice,
      product.recommendJdPrice,
      product.recommendJdPrice,
      product.recommendAdjustment,
      product.ahsSubsidyAfter,
      product.totalSubsidy,
      product.postAhsPrice,
      product.postJdHandPrice,
      product.postMarginalProfit,
      product.recommendJdPrice - product.tmPrice,
      product.postJdHandPrice - product.tmHandPrice,
      1,
      1,
      1,
      1,
      '保留'
    ]
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, pricingSheet, pricingSheetName);
  return { workbook, pricingSheet };
};

const cellFor = (sheet: XLSX.WorkSheet, label: string) => {
  const index = labels.indexOf(label);
  assert.notEqual(index, -1, `missing test column: ${label}`);
  return sheet[`${XLSX.utils.encode_col(index)}3`] as XLSX.CellObject;
};

const testTradeInFormulas = () => {
  const { workbook, pricingSheet } = makeWorkbook();

  addDynamicPricingWorkbookSheets({
    workbook,
    pricingSheet,
    pricingSheetName: '询价表_京东换新追价',
    products: [product],
    channelId: 'tradeIn',
    subsidyRules,
    selfSubsidyRules: []
  });

  const postAhsCell = cellFor(pricingSheet, '追后AHS补贴');
  const postJdSubsidyCell = cellFor(pricingSheet, '追后京东总补贴');
  const postMarginCell = cellFor(pricingSheet, '追后边际利润率');
  const preItemGapCell = cellFor(pricingSheet, '追前tm物品价差');
  const preHandGapCell = cellFor(pricingSheet, '追前tm到手价差');
  const postItemGapCell = cellFor(pricingSheet, '追后tm物品价差');
  const postHandGapCell = cellFor(pricingSheet, '追后tm到手价差');

  assert.match(postAhsCell.f || '', /_xlfn\.XLOOKUP/);
  assert.match(postAhsCell.f || '', /,-1\)/);
  assert.match(postJdSubsidyCell.f || '', /\$D\$2:\$D\$3/);
  assert.match(postMarginCell.f || '', /0\.0466/);
  [preItemGapCell, preHandGapCell, postItemGapCell, postHandGapCell].forEach(cell => {
    assert.match(cell.f || '', /^IF\(.+>0,.+-.+,""\)$/);
  });
  assert.equal(preItemGapCell.v, product.jdPrice - product.tmPrice);
  assert.equal(postHandGapCell.v, product.postJdHandPrice - product.tmHandPrice);
  [
    '京东物品价-追价后 vs 天猫',
    '京东到手价-追价后 vs 天猫',
    '京东物品价-追价后 vs 转转',
    '京东物品价+ahs补贴-追价后 vs 转转'
  ].forEach(label => {
    const formula = cellFor(pricingSheet, label).f || '';
    assert.match(formula, />0,/);
    assert.match(formula, />=/);
  });
  assert.equal(postAhsCell.v, product.ahsSubsidyAfter);
  assert.equal(workbook.SheetNames[1], '补贴规则');
  assert.equal(workbook.Sheets['补贴规则'].A2.v, 'iPhone 17');
  assert.equal(workbook.Sheets['补贴规则'].B2.v, 900);
  const calcProperties = workbook.Workbook as typeof workbook.Workbook & {
    CalcPr?: { fullCalcOnLoad?: boolean };
  };
  assert.equal(calcProperties?.CalcPr?.fullCalcOnLoad, true);

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['渠道', '京东换新']
  ]), '测算设置');
  const serialized = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
  const reloaded = XLSX.read(serialized, { type: 'buffer', cellFormula: true, xlfn: true });
  const reloadedPricingSheet = reloaded.Sheets['询价表_京东换新追价'];
  assert.deepEqual(reloaded.SheetNames, ['询价表_京东换新追价', '补贴规则', '测算设置']);
  assert.match(cellFor(reloadedPricingSheet, '追后AHS补贴').f || '', /_xlfn\.XLOOKUP/);
  assert.equal(cellFor(reloadedPricingSheet, '追后AHS补贴').v, product.ahsSubsidyAfter);
  assert.equal(cellFor(reloadedPricingSheet, '原始字段').v, '保留');
  assert.equal(reloaded.Sheets['补贴规则'].E1.v, 'A_新机系列');
};

const testSelfOperatedFormulaAndNoRuleFallback = () => {
  const { workbook, pricingSheet } = makeWorkbook('询价表_自营追价');
  const selfRules: SelfOperatedSubsidyRule[] = [
    { threshold: 800, ahsInput: 40, sourceRowNumber: 2, rawFields: { 'A_门槛': 800 } }
  ];

  addDynamicPricingWorkbookSheets({
    workbook,
    pricingSheet,
    pricingSheetName: '询价表_自营追价',
    products: [product],
    channelId: 'selfOperated',
    subsidyRules: [],
    selfSubsidyRules: selfRules
  });

  const formula = cellFor(pricingSheet, '追后AHS补贴').f || '';
  assert.match(formula, /_xlfn\.XLOOKUP/);
  assert.ok(!formula.includes("'补贴规则'!$A$2:$A$2="));
  assert.equal(cellFor(pricingSheet, '追后京东总补贴').f, '0');

  const noRuleWorkbook = makeWorkbook();
  addDynamicPricingWorkbookSheets({
    workbook: noRuleWorkbook.workbook,
    pricingSheet: noRuleWorkbook.pricingSheet,
    pricingSheetName: '询价表_京东换新追价',
    products: [product],
    channelId: 'tradeIn',
    subsidyRules: [],
    selfSubsidyRules: []
  });
  assert.equal(cellFor(noRuleWorkbook.pricingSheet, '追后AHS补贴').f, 'D3');
  assert.equal(cellFor(noRuleWorkbook.pricingSheet, '追后京东总补贴').f, 'E3');
};

testTradeInFormulas();
testSelfOperatedFormulaAndNoRuleFallback();
console.log('pricing workbook checks passed');
