const DEFAULT_SUPABASE_URL = 'https://effaryjuqgzeegkzxnij.supabase.co';
const RPC_PATH = '/rest/v1/rpc/get_latest_android_revenue';
const BRAND_REVENUE_FIELDS = Object.freeze([
  { brand: 'iQOO', displayName: 'iQOO', field: 'jd_tradein_iqoo_30d_revenue' },
  { brand: '荣耀', displayName: '荣耀', field: 'jd_tradein_honor_30d_revenue' },
  { brand: 'OPPO', displayName: 'OPPO', field: 'jd_tradein_oppo_30d_revenue' },
  { brand: '一加', displayName: '一加', field: 'jd_tradein_oneplus_30d_revenue' },
  { brand: '真我', displayName: 'realme／真我', field: 'jd_tradein_realme_30d_revenue' },
  { brand: 'vivo', displayName: 'vivo', field: 'jd_tradein_vivo_30d_revenue' },
  { brand: '三星', displayName: '三星', field: 'jd_tradein_samsung_30d_revenue' },
  { brand: '华为', displayName: '华为', field: 'jd_tradein_huawei_30d_revenue' },
  { brand: '小米', displayName: '小米／Redmi', field: 'jd_tradein_xiaomi_30d_revenue' }
]);

const money = (row, key) => {
  const value = Number(row?.[key]);
  if (!Number.isFinite(value) || value < 0) {
    throw Object.assign(new Error(`Supabase 安卓销售额字段 ${key} 无效`), { statusCode: 502 });
  }
  return value;
};

const requiredText = (row, key) => {
  const value = String(row?.[key] || '').trim();
  if (!value) {
    throw Object.assign(new Error(`Supabase 安卓销售额字段 ${key} 缺失`), { statusCode: 502 });
  }
  return value;
};

const isoDate = (row, key) => {
  const value = requiredText(row, key);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw Object.assign(new Error(`Supabase 安卓销售额字段 ${key} 不是有效日期`), { statusCode: 502 });
  }
  return value;
};

export const normalizeAndroidRevenueSnapshot = row => {
  const windowDays = Number(row?.window_days);
  if (windowDays !== 30) {
    throw Object.assign(new Error('Supabase 安卓销售额快照不是完整的近30天口径'), { statusCode: 502 });
  }
  const dataDate = isoDate(row, 'data_date');
  const periodStart = isoDate(row, 'period_start');
  const periodEnd = isoDate(row, 'period_end');
  if (dataDate !== periodEnd) {
    throw Object.assign(new Error('Supabase 安卓销售额快照的数据日与区间截止日不一致'), { statusCode: 502 });
  }
  const coveredDays = (Date.parse(`${periodEnd}T00:00:00Z`) - Date.parse(`${periodStart}T00:00:00Z`)) / 86400000 + 1;
  if (coveredDays !== windowDays) {
    throw Object.assign(new Error('Supabase 安卓销售额快照的统计区间不是完整30天'), { statusCode: 502 });
  }
  const currency = requiredText(row, 'currency');
  if (currency !== 'CNY') {
    throw Object.assign(new Error('Supabase 安卓销售额快照币种不是 CNY'), { statusCode: 502 });
  }

  return {
    dataDate,
    periodStart,
    periodEnd,
    windowDays,
    currency,
    androidSalesAmount30d: money(row, 'android_30d_revenue'),
    androidJdTradeInSalesAmount30d: money(row, 'jd_tradein_30d_revenue'),
    brandSalesAmounts30d: BRAND_REVENUE_FIELDS.map(item => ({
      brand: item.brand,
      displayName: item.displayName,
      salesAmount30d: money(row, item.field)
    })),
    sourceName: requiredText(row, 'source_name'),
    syncedAt: requiredText(row, 'synced_at')
  };
};

export const createAndroidRevenueClient = ({ env = process.env, fetchImpl = fetch, timeoutMs = 10000 } = {}) => {
  const supabaseUrl = String(env.ANDROID_REVENUE_SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, '');
  const publishableKey = String(env.ANDROID_REVENUE_SUPABASE_PUBLISHABLE_KEY || '').trim();
  const metricsApiKey = String(env.ANDROID_REVENUE_METRICS_API_KEY || '').trim();
  const configured = Boolean(supabaseUrl && publishableKey && metricsApiKey);

  return {
    configured,
    async getLatest() {
      if (!configured) {
        throw Object.assign(new Error('安卓销售额自动拉取尚未配置服务端凭据'), { statusCode: 503 });
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      timeout.unref?.();
      try {
        const response = await fetchImpl(`${supabaseUrl}${RPC_PATH}`, {
          method: 'POST',
          headers: {
            apikey: publishableKey,
            'x-metrics-api-key': metricsApiKey,
            'content-type': 'application/json'
          },
          body: '{}',
          signal: controller.signal
        });
        if (!response.ok) {
          throw Object.assign(new Error(`Supabase 安卓销售额接口返回 ${response.status}`), { statusCode: 502 });
        }
        const payload = await response.json();
        if (!Array.isArray(payload) || payload.length !== 1) {
          throw Object.assign(new Error('Supabase 安卓销售额接口没有返回唯一最新快照'), { statusCode: 502 });
        }
        return normalizeAndroidRevenueSnapshot(payload[0]);
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw Object.assign(new Error('Supabase 安卓销售额接口请求超时'), { statusCode: 504 });
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }
  };
};
