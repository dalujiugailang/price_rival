import assert from 'node:assert/strict';
import { listTrackingBatches, feishuPushHistory } from './api';
const originalFetch=globalThis.fetch;
try {
  globalThis.fetch=async()=>new Response('<!doctype html><html>frontend shell</html>',{status:200,headers:{'content-type':'text/html'}});
  await assert.rejects(listTrackingBatches('tradeIn'),/服务接口返回了页面/);
  await assert.rejects(feishuPushHistory('tradeIn'),/服务接口返回了页面/);
  globalThis.fetch=async()=>Response.json({success:false,error:'当前服务未提供此接口'},{status:404});
  await assert.rejects(feishuPushHistory('tradeIn'),/当前服务未提供此接口/);
  globalThis.fetch=async()=>Response.json({success:true,batches:[]});
  assert.deepEqual((await listTrackingBatches('tradeIn')).batches,[]);
} finally {globalThis.fetch=originalFetch;}
console.log('API response regression: HTML fallback rejected, JSON errors surfaced, valid history accepted.');
