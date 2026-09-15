import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import InvestmentRatePanel from './InvestmentRatePanel';

// Fictional values only; do not copy production revenue into public test fixtures.
const inputs = {
  androidSalesAmount30d: 30000.6,
  androidJdTradeInSalesAmount30d: 12000.6
};

test('trade-in fee panel presents Supabase denominators as read-only sourced values', () => {
  const html = renderToStaticMarkup(<InvestmentRatePanel
    products={[]}
    investmentRateInputs={inputs}
    onInvestmentRateInputsChange={() => undefined}
    automaticStatus="success"
    automaticSnapshot={{
      dataDate: '2000-01-30',
      periodStart: '2000-01-01',
      periodEnd: '2000-01-30',
      windowDays: 30,
      currency: 'CNY',
      androidSalesAmount30d: inputs.androidSalesAmount30d,
      androidJdTradeInSalesAmount30d: inputs.androidJdTradeInSalesAmount30d,
      brandSalesAmounts30d: [
        { brand: 'iQOO', displayName: 'iQOO', salesAmount30d: 1000.2 },
        { brand: '荣耀', displayName: '荣耀', salesAmount30d: 1100.4 }
      ],
      sourceName: 'synthetic_test_fixture',
      syncedAt: '2000-01-31T00:00:00+00:00'
    }}
    onAutomaticRefresh={() => undefined}
  />);
  assert.match(html, /Supabase 自动分母/);
  assert.match(html, /数据日 2000-01-30/);
  assert.match(html, /品牌费率/);
  assert.doesNotMatch(html, /placeholder="输入销售额"/);
});

test('non-Supabase channels retain the existing manual denominator inputs', () => {
  const html = renderToStaticMarkup(<InvestmentRatePanel
    products={[]}
    investmentRateInputs={inputs}
    onInvestmentRateInputsChange={() => undefined}
    channelSalesLabel="手机安卓近30天自营渠道销售额"
  />);
  assert.match(html, /手机安卓近30天自营渠道销售额/);
  assert.match(html, /placeholder="输入销售额"/);
});
