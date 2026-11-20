import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import PriceAnalysis from './PriceAnalysis';
import {CalculatedProduct, TrackingBatch} from '../types';

let timestampReads=0;
let adviceReads=0;
const batches:TrackingBatch[]=Array.from({length:50},(_,period)=>({
  id:`PERF-${period}`,date:'2026-10-20',dataDate:'2026-10-20',operator:'性能回归样本',marginBottomLine:.02,
  get pricingTimestamp(){timestampReads++;return new Date(1760000000000+period*86400000).toISOString();},
  get restorePayload(){adviceReads++;return undefined;},
  products:Array.from({length:300},(_,i)=>({
    ppv:`PPV-${i}`,brand:`品牌${i%10}`,oldModel:`型号${i}`,quoteVolume:i+1,
    basePrice:2000,recommendJdPrice:1000+period,totalSubsidy:200,
    postJdHandPrice:1200+period,tmPrice:1200,tmSubsidyManual:100,tmHandPrice:1300,
    postMarginalProfit:.05,maxPriceByMargin:1100,pricingRemark:''
  } as CalculatedProduct))
}));
const start=performance.now();
const html=renderToStaticMarkup(<PriceAnalysis batches={batches}/>);
const elapsed=performance.now()-start;
assert.equal(adviceReads,0,'opening two-period comparison must not execute daily-advice calculations');
assert.ok(timestampReads<=batches.length,'format time once per snapshot, rather than once per PPV and sort comparison');
assert.ok(html.includes('固定样本 300'),'fixed weighted basket remains complete');
assert.ok(!html.includes('rounded-lg')&&!html.includes('rounded-xl')&&!html.includes('slate-'),'match the existing monochrome square-corner history UI');
assert.equal((html.match(/aria-label="价格(?:上涨|下降|持平)"/g)||[]).length,200,'only render the first 50 PPVs and four compact comparisons including base price');
assert.ok(!html.includes('min-w-[1800px]'),'comparison should fit a compact table rather than seven wide metric columns');
const readsBefore=timestampReads;
renderToStaticMarkup(<PriceAnalysis batches={batches}/>);
assert.equal(timestampReads,readsBefore,'reopening immutable saved snapshots reuses time labels');
console.log(`Price analysis render regression passed: 50 x 300 fixture, ${elapsed.toFixed(1)} ms; no inactive advice or repeated time formatting.`);

// The requested colors encode numeric direction, including zero and missing values.
const {ChangeNumber, PpvPriceChanges} = await import('./PriceComparisonPanels');
const rise=renderToStaticMarkup(<ChangeNumber delta={12}/>);
const fall=renderToStaticMarkup(<ChangeNumber delta={-12}/>);
const flat=renderToStaticMarkup(<ChangeNumber delta={0}/>);
const missing=renderToStaticMarkup(<ChangeNumber delta={null}/>);
assert.ok(rise.includes('text-green-700')&&rise.includes('+12'));
assert.ok(fall.includes('text-red-700')&&fall.includes('-12'));
assert.ok(!flat.includes('text-green-700')&&!flat.includes('text-red-700'));
assert.ok(!missing.includes('0 元'),'missing values must not be displayed as unchanged prices');
assert.ok(html.includes('aria-label="对比期"')&&html.includes('aria-label="基准期"'));
assert.ok(html.includes('aria-label="价格分析新机系列"')&&!html.includes('aria-label="搜索价格分析"'));
assert.ok(html.includes('差额＝对比期－基准期'));
const first=batches[0].products[0],last=batches[1].products[0];
const compact=renderToStaticMarkup(<PpvPriceChanges rows={[{ppv:first.ppv,a:first,b:last},{ppv:'NEW-ONLY',b:{...last,ppv:'NEW-ONLY'}}]} limit={50} onMore={()=>{}}/>);
assert.ok(compact.includes('京东到手价')&&compact.includes('天猫到手价'));
assert.ok(!compact.includes('NEW-ONLY'),'default view compares common PPVs; additions remain available through the match selector');
assert.ok(compact.includes('已显示全部'),'do not keep offering more rows when no rows remain');
console.log('Compact comparison: rise/fall colors, missing values and common-PPV default passed.');

assert.equal((html.match(/aria-label="价格分析统一筛选"/g)||[]).length,1,'all analysis filters share one panel');
assert.ok(html.indexOf('两期对比</button>')<html.indexOf('aria-label="价格分析统一筛选"')&&html.indexOf('aria-label="价格分析统一筛选"')<html.indexOf('全部已保存快照'),'shared filters sit directly below the three tabs');
assert.equal((html.match(/aria-label="PPV匹配范围"/g)||[]).length,1,'PPV range is not duplicated in the comparison table');
assert.ok(!html.includes('aria-label="时序PPV所属批次"'),'timeline-only batch filtering is absent in comparison');
assert.ok(!html.includes('aria-label="搜索时序PPV"'),'timeline-only search is absent in comparison');
const addedOnly=renderToStaticMarkup(<PpvPriceChanges rows={[{ppv:first.ppv,a:first,b:last},{ppv:'NEW-ONLY',b:{...last,ppv:'NEW-ONLY'}}]} presence="added" limit={50} onMore={()=>{}}/>);
assert.ok(addedOnly.includes('NEW-ONLY')&&!addedOnly.includes('title="PPV-0"'),'the shared PPV selector drives comparison rows');
console.log('Unified filters: position, view-specific controls, single PPV selector and controlled matching passed.');

const defaultPeriodBatches = [
  {...batches[0], id:'REG-OLD', batchType:'regular' as const, pricingTimestamp:'2026-11-16T10:00:00+08:00'},
  {...batches[0], id:'REG-NEW', batchType:'regular' as const, pricingTimestamp:'2026-11-17T10:00:00+08:00'},
  {...batches[0], id:'LAUNCH-NEWEST', batchType:'launch' as const, pricingTimestamp:'2026-11-18T10:00:00+08:00'}
];
const periodsHtml=renderToStaticMarkup(<PriceAnalysis batches={defaultPeriodBatches}/>);
const selectedPeriod=(label:string)=>periodsHtml.match(new RegExp(`aria-label="${label}"[^>]*>([\\s\\S]*?)</select>`))?.[1].match(/<option value="([^"]+)" selected=""/g)?.[0];
assert.ok(selectedPeriod('对比期')?.includes('REG-NEW'));
assert.ok(selectedPeriod('基准期')?.includes('REG-OLD'));
const singleRegularHtml=renderToStaticMarkup(<PriceAnalysis batches={defaultPeriodBatches.slice(1)}/>);
assert.equal((singleRegularHtml.match(/value="REG-NEW" selected=""/g)||[]).length,2);
console.log('Default periods: newest regular comparison, second-newest regular baseline; launch periods excluded.');
