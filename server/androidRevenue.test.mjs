import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAndroidRevenueClient, normalizeAndroidRevenueSnapshot } from './androidRevenue.mjs';

// Fictional values only; do not copy production revenue into public test fixtures.
const row = {
  data_date: '2000-01-30',
  period_start: '2000-01-01',
  period_end: '2000-01-30',
  window_days: 30,
  currency: 'CNY',
  android_30d_revenue: '30000.60',
  jd_tradein_30d_revenue: 12000.6,
  jd_tradein_iqoo_30d_revenue: 1000.2,
  jd_tradein_honor_30d_revenue: 1100.4,
  jd_tradein_oppo_30d_revenue: 1200.6,
  jd_tradein_oneplus_30d_revenue: 1300.8,
  jd_tradein_realme_30d_revenue: 1400,
  jd_tradein_vivo_30d_revenue: 1500,
  jd_tradein_samsung_30d_revenue: 1600,
  jd_tradein_huawei_30d_revenue: 1700,
  jd_tradein_xiaomi_30d_revenue: 800,
  source_name: 'synthetic_test_fixture',
  synced_at: '2000-01-31T00:00:00+00:00'
};

test('normalizes the latest Supabase snapshot into the two fee denominators', () => {
  assert.deepEqual(normalizeAndroidRevenueSnapshot(row), {
    dataDate: '2000-01-30',
    periodStart: '2000-01-01',
    periodEnd: '2000-01-30',
    windowDays: 30,
    currency: 'CNY',
    androidSalesAmount30d: 30000.6,
    androidJdTradeInSalesAmount30d: 12000.6,
    brandSalesAmounts30d: [
      { brand: 'iQOO', displayName: 'iQOO', salesAmount30d: 1000.2 },
      { brand: '荣耀', displayName: '荣耀', salesAmount30d: 1100.4 },
      { brand: 'OPPO', displayName: 'OPPO', salesAmount30d: 1200.6 },
      { brand: '一加', displayName: '一加', salesAmount30d: 1300.8 },
      { brand: '真我', displayName: 'realme／真我', salesAmount30d: 1400 },
      { brand: 'vivo', displayName: 'vivo', salesAmount30d: 1500 },
      { brand: '三星', displayName: '三星', salesAmount30d: 1600 },
      { brand: '华为', displayName: '华为', salesAmount30d: 1700 },
      { brand: '小米', displayName: '小米／Redmi', salesAmount30d: 800 }
    ],
    sourceName: 'synthetic_test_fixture',
    syncedAt: '2000-01-31T00:00:00+00:00'
  });
});

test('requires configured server-side credentials and never falls back to public table reads', async () => {
  const missing = createAndroidRevenueClient({ env: {}, fetchImpl: async () => { throw new Error('must not run'); } });
  assert.equal(missing.configured, false);
  await assert.rejects(() => missing.getLatest(), /尚未配置服务端凭据/);

  let request;
  const client = createAndroidRevenueClient({
    env: {
      ANDROID_REVENUE_SUPABASE_URL: 'https://metrics.example',
      ANDROID_REVENUE_SUPABASE_PUBLISHABLE_KEY: 'publishable',
      ANDROID_REVENUE_METRICS_API_KEY: 'metrics'
    },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, json: async () => [row] };
    }
  });
  const snapshot = await client.getLatest();
  assert.equal(snapshot.dataDate, '2000-01-30');
  assert.equal(request.url, 'https://metrics.example/rest/v1/rpc/get_latest_android_revenue');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.apikey, 'publishable');
  assert.equal(request.options.headers['x-metrics-api-key'], 'metrics');
});

test('rejects incomplete, inconsistent and failed upstream responses', async () => {
  assert.throws(() => normalizeAndroidRevenueSnapshot({ ...row, window_days: 29 }), /近30天口径/);
  assert.throws(() => normalizeAndroidRevenueSnapshot({ ...row, period_end: '2000-01-29' }), /截止日不一致/);
  assert.throws(() => normalizeAndroidRevenueSnapshot({ ...row, period_start: '1999-12-31' }), /统计区间不是完整30天/);
  assert.throws(() => normalizeAndroidRevenueSnapshot({ ...row, currency: 'USD' }), /币种不是 CNY/);
  assert.throws(() => normalizeAndroidRevenueSnapshot({ ...row, android_30d_revenue: -1 }), /字段 android_30d_revenue 无效/);

  const client = createAndroidRevenueClient({
    env: {
      ANDROID_REVENUE_SUPABASE_PUBLISHABLE_KEY: 'publishable',
      ANDROID_REVENUE_METRICS_API_KEY: 'metrics'
    },
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) })
  });
  await assert.rejects(() => client.getLatest(), /返回 401/);
});
