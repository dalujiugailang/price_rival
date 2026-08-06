import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { CalculatedProduct, SelfOperatedSubsidyRule, SubsidyRule } from '../types';
import { addDynamicPricingWorkbookSheets } from './pricingWorkbook';

const labels = [
  '新机系列',
  'jd裸机价',
  '对应新品型号ahs投入',
  '对应新品型号jd总投入',
  'tm裸机价',
  'tm总到手价',
  'zz裸机价',
  'zz券后价',
  '基准价',
  '系统推荐追后价',
  '试算追后价',
  '京东物品价-追价后调整金额',
  '追后AHS补贴',
  '追后京东总补贴',
  '追后含AHS补贴报价',
  '追后京东总到手价',
  '追后边际利润率',
  '京东物品价-追价后 vs 天猫',
  '京东到手价-追价后 vs 天猫',
  '京东物品价-追价后 vs 转转',
  '京东物品价+ahs补贴-追价后 vs 转转'
];

const product = {
  newSeries: 'iPhone 17',
  jdPrice: 1000,
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
      product.ahsInput,
      product.jdSubsidy,
      product.tmPrice,
      product.tmHandPrice,
      product.zzPrice,
      product.zzHandPrice,
      product.basePrice,
      product.recommendJdPrice,
      product.recommendJdPrice,
      product.recommendAdjustment,
      product.ahsSubsidyAfter,
      product.totalSubsidy,
      product.postAhsPrice,
      product.postJdHandPrice,
      product.postMarginalProfit,
      1,
      1,
      1,
      1
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
  const postTmWinCell = cellFor(pricingSheet, '京东物品价-追价后 vs 天猫');

  assert.match(postAhsCell.f || '', /_xlfn\.XLOOKUP/);
  assert.match(postAhsCell.f || '', /,-1\)/);
  assert.match(postJdSubsidyCell.f || '', /\$D\$2:\$D\$3/);
  assert.match(postMarginCell.f || '', /0\.0466/);
  assert.ok((postTmWinCell.f || '').includes('>'));
  assert.ok(!(postTmWinCell.f || '').includes('>='));
  assert.equal(postAhsCell.v, product.ahsSubsidyAfter);
  assert.equal(workbook.SheetNames[1], '补贴规则');
  assert.equal(workbook.Sheets['补贴规则'].A2.v, 'iPhone 17');
  assert.equal(workbook.Sheets['补贴规则'].B2.v, 900);
  const calcProperties = workbook.Workbook as typeof workbook.Workbook & {
    CalcPr?: { fullCalcOnLoad?: boolean };
  };
  assert.equal(calcProperties?.CalcPr?.fullCalcOnLoad, true);
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
  assert.equal(cellFor(noRuleWorkbook.pricingSheet, '追后AHS补贴').f, 'C3');
  assert.equal(cellFor(noRuleWorkbook.pricingSheet, '追后京东总补贴').f, 'D3');
};

testTradeInFormulas();
testSelfOperatedFormulaAndNoRuleFallback();
console.log('pricing workbook checks passed');
