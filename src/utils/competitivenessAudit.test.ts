import assert from 'node:assert/strict';
import { CalculatedProduct } from '../types';
import {
  buildCompetitivenessAudit,
  TM_SUBSIDY_CARRY_GAP_LABEL
} from './competitivenessAudit';

const product = ({
  id,
  brand,
  newSeries,
  quoteVolume,
  tmItemWin,
  tmHandWin,
  level = 'A+',
  sku = '',
  tmHandPrice = 130
}: {
  id: string;
  brand: string;
  newSeries: string;
  quoteVolume: number;
  tmItemWin: boolean;
  tmHandWin: boolean;
  level?: string;
  sku?: string;
  tmHandPrice?: number;
}) => ({
  id,
  brand,
  newSeries,
  oldModel: `${brand}旧机`,
  model: `${brand}旧机`,
  ppv: `${level}${sku || id}`,
  level,
  rawFields: sku ? { 'C_商品SKU': sku, 'D_商品LEVEL': level } : {},
  quoteVolume,
  soldVolume: Math.round(quoteVolume / 10),
  tmPrice: 100,
  tmHandPrice,
  tmSubsidyManual: tmHandPrice > 0 ? 30 : 0,
  tmRecyclerSubsidy: 180,
  tmRecyclerQuotedPrice: 120,
  zzPrice: 90,
  zzHandPrice: 110,
  recommendJdPrice: 110,
  recommendPrice: 110,
  postJdHandPrice: tmHandWin ? 135 : 120,
  totalSubsidy: tmHandWin ? 25 : 10,
  postTmItemWin: tmItemWin,
  postTmHandWin: tmHandWin,
  postAhsTmRecyclerWin: tmItemWin,
  postZzItemWin: tmItemWin,
  postAhsZzHandWin: tmHandWin,
  postJdZzHandWin: tmHandWin
} as CalculatedProduct);

const audit = buildCompetitivenessAudit([
  product({ id: 'a1', brand: '华为', newSeries: 'Mate 80', quoteVolume: 60, tmItemWin: true, tmHandWin: false, sku: 'Mate80 512G' }),
  product({ id: 'a2', brand: '华为', newSeries: 'Mate 80', quoteVolume: 40, tmItemWin: true, tmHandWin: true }),
  product({ id: 'a3', brand: '华为', newSeries: 'Pura 80', quoteVolume: 100, tmItemWin: false, tmHandWin: false }),
  product({ id: 'b1', brand: '小米', newSeries: '小米 15', quoteVolume: 100, tmItemWin: true, tmHandWin: true })
]);

assert.equal(TM_SUBSIDY_CARRY_GAP_LABEL, '天猫补贴承接缺口');
assert.deepEqual(audit.map(row => row.brand), ['小米', '华为']);

const huawei = audit[1];
assert.equal(huawei.metrics.tmItemScore, 50);
assert.equal(huawei.metrics.tmDirectScore, 20);
assert.equal(huawei.tmSubsidyCarryGap, 30);
assert.equal(huawei.issueQuoteVolume, 60);
assert.equal(huawei.allBrandsCommonEligibleQuoteVolume, 300);
assert.equal(huawei.issueQuoteVolumeShare, 20);
assert.equal(huawei.hasTmCoverageMismatch, false);
assert.deepEqual(huawei.series.map(row => row.newSeries), ['Mate 80', 'Pura 80']);

const mate = huawei.series[0];
assert.equal(mate.metrics.tmItemScore, 100);
assert.equal(mate.metrics.tmDirectScore, 40);
assert.equal(mate.tmSubsidyCarryGap, 60);
assert.equal(mate.allBrandsCommonEligibleQuoteVolume, 300);
assert.equal(mate.issueQuoteVolumeShare, 20);
assert.equal(mate.issueProducts.length, 1);
assert.equal(mate.issueProducts[0].ppv, 'A+Mate80 512G');
assert.equal(mate.issueProducts[0].quoteVolume, 60);
assert.equal(mate.issueProducts[0].soldVolume, 6);
assert.equal(mate.issueProducts[0].jdItemPrice, 110);
assert.equal(mate.issueProducts[0].tmItemPrice, 100);
assert.equal(mate.issueProducts[0].itemPriceGap, 10);
assert.equal(mate.issueProducts[0].jdInvestment, 10);
assert.equal(mate.issueProducts[0].tmManualSubsidy, 30);
assert.equal(mate.issueProducts[0].subsidyGap, -20);
assert.equal(mate.issueProducts[0].jdHandPrice, 120);
assert.equal(mate.issueProducts[0].tmHandPrice, 130);
assert.equal(mate.issueProducts[0].handPriceGap, -10);

const missingDetailAudit = buildCompetitivenessAudit([
  {
    ...product({ id: 'missing', brand: '荣耀', newSeries: 'Magic8', quoteVolume: 20, tmItemWin: true, tmHandWin: false }),
    soldVolume: undefined,
    totalSubsidy: undefined,
    tmSubsidyManual: undefined,
    postJdHandPrice: undefined
  } as unknown as CalculatedProduct
]);
const missingDetail = missingDetailAudit[0].issueProducts[0];
assert.equal(missingDetail.soldVolume, null);
assert.equal(missingDetail.jdInvestment, null);
assert.equal(missingDetail.tmManualSubsidy, null);
assert.equal(missingDetail.subsidyGap, null);
assert.equal(missingDetail.jdHandPrice, null);
assert.equal(missingDetail.handPriceGap, null);

const coverageAudit = buildCompetitivenessAudit([
  product({ id: 'c1', brand: 'OPPO', newSeries: 'Find X9', quoteVolume: 80, tmItemWin: true, tmHandWin: false, tmHandPrice: 0 })
]);
assert.equal(coverageAudit[0].hasTmCoverageMismatch, true);
assert.equal(coverageAudit[0].tmItemEligibleQuoteVolume, 80);
assert.equal(coverageAudit[0].tmHandEligibleQuoteVolume, 0);
assert.equal(coverageAudit[0].issueProducts.length, 0);

const equalVolumeDifferentCoverageAudit = buildCompetitivenessAudit([
  product({ id: 'd1', brand: 'vivo', newSeries: 'X300', quoteVolume: 50, tmItemWin: true, tmHandWin: false, tmHandPrice: 0 }),
  {
    ...product({ id: 'd2', brand: 'vivo', newSeries: 'X300', quoteVolume: 50, tmItemWin: false, tmHandWin: true }),
    tmPrice: 0
  }
]);
assert.equal(equalVolumeDifferentCoverageAudit[0].tmItemEligibleQuoteVolume, 50);
assert.equal(equalVolumeDifferentCoverageAudit[0].tmHandEligibleQuoteVolume, 50);
assert.equal(equalVolumeDifferentCoverageAudit[0].hasTmCoverageMismatch, true);

console.log('competitiveness audit checks passed');
