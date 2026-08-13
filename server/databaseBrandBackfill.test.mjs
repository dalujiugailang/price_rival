import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDatabase } from './database.mjs';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'price-rival-brand-'));
const db = createDatabase(path.join(tempDir, 'test.sqlite'));
const context = {
  actor: { openId: 'tester', name: '测试人' },
  requestId: 'brand-test',
  ip: '127.0.0.1',
  userAgent: 'node-test'
};

try {
  db.createBatch({
    id: 'BRAND-BATCH-1',
    channelId: 'tradeIn',
    date: '2026-08-13',
    operator: '测试人',
    marginBottomLine: 0.03,
    products: [
      { ppv: 'P1', brand: '旧品牌', jdPrice: 1000 },
      { ppv: 'P2', brand: '保留品牌', jdPrice: 800 }
    ],
    competitivenessMetrics: {
      tmItemScore: 50,
      tmDirectScore: 40,
      zzItemScore: 30,
      ahsVsZzDirectScore: 20
    }
  }, context);
  db.createBatch({
    id: 'BRAND-SUMMARY-1',
    channelId: 'tradeIn',
    date: '2026-08-12',
    operator: '测试人',
    marginBottomLine: 0.03,
    isSummaryOnly: true,
    products: [{ ppv: 'P1', brand: '纯汇总原值' }]
  }, context);

  const first = db.backfillBatchBrands('tradeIn', { P1: '小米' }, context);
  assert.deepEqual(first, { updatedBatchCount: 1, updatedProductCount: 1 });

  const updated = db.getBatch('BRAND-BATCH-1');
  assert.equal(updated.products[0].brand, '小米');
  assert.equal(updated.products[0].jdPrice, 1000);
  assert.equal(updated.products[1].brand, '保留品牌');
  assert.equal(updated.competitivenessMetrics.tmItemScore, 50);
  assert.equal(db.getBatch('BRAND-SUMMARY-1').products[0].brand, '纯汇总原值');

  const repeated = db.backfillBatchBrands('tradeIn', { P1: '小米' }, context);
  assert.deepEqual(repeated, { updatedBatchCount: 0, updatedProductCount: 0 });

  const audit = db.listAuditLogs(10).find(entry => entry.action === 'BATCH_BRAND_BACKFILL');
  assert.ok(audit);
  assert.equal(audit.details.updatedProductCount, 1);
} finally {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log('database brand backfill checks passed');
