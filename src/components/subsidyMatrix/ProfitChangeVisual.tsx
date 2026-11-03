import React from 'react';
import type {CalculatedProduct} from '../../types';
import type {SeriesProfitResult} from './types';
import {button, money, percent, riskClass} from './ui';

export default function ProfitChangeVisual({product, result, floor, onOldView}: {product: CalculatedProduct; result: SeriesProfitResult; floor: number; onOldView: () => void}) {
  const original = product.postMarginalProfit * product.basePrice;
  const comparison = result.comparison;
  const targetSubsidy = result.current ? product.ahsSubsidyAfter : result.hit.ahs;
  const maxSubsidy = Math.max(1, product.ahsSubsidyAfter, targetSubsidy || 0);
  const limit = Math.max(1, Math.abs(original), Math.abs(comparison?.profit || 0));
  return <div className="sm-change-visual space-y-3">
    <div className="border border-[#141414] p-3 text-xs"><strong>旧机：{product.oldModel}</strong><p className="mt-1 text-[#555]">{product.ppv}</p><p className="mt-1">京东物品价-追价后：{money(product.recommendJdPrice)} 元</p></div>
    <div className="sm-combination-grid">
      <div><small>原始新旧机组合</small><strong className="sm-pair-devices"><span><em>旧机</em><span>{product.oldModel}</span></span><span><em>新机</em><span>{product.newSeries}</span></span></strong><span>原承担 {money(product.ahsSubsidyAfter)} 元</span><strong className={riskClass(original < 0 ? '亏损风险' : product.postMarginalProfit < floor ? '低利润风险' : '正常')}>{money(original)} 元 / {percent(product.postMarginalProfit)}</strong><button className="sm-original-link text-xs underline" onClick={onOldView}>进入该报价的旧机视角 ↗</button></div>
      <span className="sm-change-arrow" aria-hidden="true">→</span>
      <div><small>换新后的组合</small><strong className="sm-pair-devices"><span><em>旧机</em><span>{product.oldModel}</span></span><span><em>新机</em><span>{result.row.series}</span></span></strong><span>新承担 {money(targetSubsidy)} 元</span><strong className={riskClass(comparison?.risk)}>{comparison ? `${money(comparison.profit)} 元 / ${percent(comparison.rate)}` : '待核验'}</strong></div>
    </div>
    {comparison && <>
      <div className="sm-change-chart" aria-label="补贴承担金额对比">
        <strong>承担补贴</strong>{[{name:'原组合',value:product.ahsSubsidyAfter},{name:'换新后',value:targetSubsidy}].map(row => <div className="sm-chart-row" key={row.name}><span>{row.name}</span><div className="sm-chart-track"><i style={{width:`${row.value/maxSubsidy*100}%`,background:row.name==='原组合'?'#777':'#141414'}}/></div><b>{money(row.value)} 元</b></div>)}
      </div>
      <div className="sm-change-chart" aria-label="原组合与换新后边际利润对比"><strong>边际利润（左亏损 / 右盈利）</strong>{[{name:'原组合',value:original},{name:'换新后',value:comparison.profit}].map(row => <div className="sm-chart-row" key={row.name}><span>{row.name}</span><div className="sm-profit-track"><i className={row.value<0?'sm-negative':'sm-positive'} style={{left:`${row.value<0?50-Math.abs(row.value)/limit*50:50}%`,width:`${Math.abs(row.value)/limit*50}%`}}/><em/></div><b className={row.value<0?'text-red-700':'text-green-700'}>{money(row.value)} 元</b></div>)}</div>
      <p className="sm-change-conclusion border-t border-[#141414] pt-3 text-sm">补贴{comparison.delta>=0?'增加':'减少'} <strong>{money(Math.abs(comparison.delta))} 元</strong> → 利润{comparison.delta>=0?'减少':'增加'} <strong>{money(Math.abs(comparison.delta)*1.0466)} 元</strong> <span className={`font-bold ${riskClass(comparison.risk)}`}>· {comparison.risk}</span></p>
    </>}
    {!comparison && <p className="text-xs text-[#555]">补贴规则或测算数据待核验，暂不绘制利润变化。</p>}
  </div>;
}
