import React from 'react';
import type {CalculatedProduct} from '../../types';
import type {MatrixWorkspace, ProfitViewSelection, SeriesProfitResult} from './types';
import type {buildProfitView} from './model';
import {deltaLabel, input, money, percent, riskClass} from './ui';

const subsidyDeltaClass = (delta = 0) => delta > 0 ? 'text-red-700' : delta < 0 ? 'text-green-700' : '';

function RiskSummary({results}: {results: SeriesProfitResult[]}) {
  return <div className="sm-risk-counts" aria-label="换新风险概况">
    <span className="sm-risk-item"><span>亏损</span><strong className="text-red-700">{results.filter(r => r.comparison?.risk === '亏损风险').length}</strong></span>
    <span className="sm-risk-item"><span>低利润</span><strong className="text-amber-800">{results.filter(r => r.comparison?.risk === '低利润风险').length}</strong></span>
    <span className="sm-risk-item"><span>待核验</span><strong>{results.filter(r => !r.comparison).length}</strong></span>
  </div>;
}

export default function ProfitPerspectives({workspace, model, selection, onChange, floor, onDetail, fixedQuote = false}: {
  workspace: MatrixWorkspace;
  model: ReturnType<typeof buildProfitView>;
  selection: ProfitViewSelection;
  onChange: (patch: Partial<ProfitViewSelection>) => void;
  floor: number;
  onDetail: (product: CalculatedProduct, series: string) => void;
  fixedQuote?: boolean;
}) {
  const {product, target} = model;
  const baseProfit = product ? product.postMarginalProfit * product.basePrice : NaN;
  return <section className="sm-profit space-y-3" aria-label="换新利润比较">
    <div className="sm-analysis-panel">
      <div className="sm-analysis-heading">
        <strong className="sm-filter-tag">利润风险分析</strong>
        <span className="sm-margin-floor">工作台利润底线 <b>{percent(floor)}</b></span>
      </div>
      <div className="sm-analysis-view">
        <div className="sm-mode-switch" role="group" aria-label="换新分析视角">
          <button type="button" className={`sm-target-filter ${selection.view === 'new' ? 'sm-selected' : ''}`} aria-pressed={selection.view === 'new'} onClick={() => onChange({view: 'new'})}>新机视角</button>
          <button type="button" className={`sm-target-filter ${selection.view === 'old' ? 'sm-selected' : ''}`} aria-pressed={selection.view === 'old'} onClick={() => onChange({view: 'old'})}>旧机视角</button>
        </div>
      </div>
    {selection.view === 'new' ? <>
      <h3 className="sm-profit-question">这款新机下，目前现有哪些竞争型号来换会导致边际亏损？</h3>
      <div className="sm-profit-context">
        <label className="sm-profit-field"><strong>目标新机系列</strong><select className={input} aria-label="新机视角目标系列" value={target?.series || ''} disabled={fixedQuote} onChange={event => onChange({targetSeries: event.target.value})}>
          {!target && <option value="">{fixedQuote ? '该报价未填写新机系列' : '当前范围暂无新机系列'}</option>}
          {model.results.map(result => <option key={result.row.key} value={result.row.series}>{result.row.series}</option>)}
        </select></label>
        <label className="sm-profit-field"><strong>搜索竞争旧机 / PPV</strong>
          <input type="search" className={input} aria-label="搜索竞争旧机或PPV" placeholder="输入品牌、旧机型号或 PPV" value={selection.search || ''} onChange={event => onChange({search: event.target.value})}/>
        </label>
      </div>
    </> : <>
      <h3 className="sm-profit-question">按旧机追后价，换哪些新机会亏损？</h3>
      <label className="sm-profit-field sm-profit-field-wide"><strong>选择工作台旧机报价</strong>
        <select className={input} aria-label="选择工作台旧机报价" value={product?.id || ''} onChange={event => onChange({productId: event.target.value})} disabled={fixedQuote || !workspace.products.length}>
          {!workspace.products.length && <option value="">工作台暂无旧机报价</option>}
          {(fixedQuote && product ? [product] : workspace.products).map(item => <option key={item.id} value={item.id}>{item.oldModel} · {item.ppv} → {item.newSeries} · ¥{money(item.recommendJdPrice)}</option>)}
        </select>
      </label>
      <label className="sm-profit-field"><strong>搜索新机系列</strong>
        <input type="search" className={input} aria-label="搜索换新品牌或系列" placeholder="输入品牌或新机系列" value={selection.oldSearch || ''} onChange={event => onChange({oldSearch: event.target.value})}/>
      </label>
      {product && <div className="sm-baseline" aria-label="当前工作台方案">
        <div><span>京东物品价-追价后</span><strong>¥{money(product.recommendJdPrice)}</strong></div>
        <div><span>当前换新系列</span><strong>{product.newSeries || '未提供'}</strong></div>
        <div><span>当前承担补贴</span><strong>¥{money(product.ahsSubsidyAfter)}</strong></div>
        <div><span>当前利润</span><strong>¥{money(baseProfit)} <small> / {percent(product.postMarginalProfit)}</small></strong></div>
      </div>}
      {!product && <p className="border border-[#141414] bg-[#F0EFEC] p-3 text-xs">工作台暂无旧机报价，载入本次测算后再查看亏损组合。</p>}
    </>}
    <div className="sm-risk-toolbar">
      <RiskSummary results={model.riskResults}/>
      <label className="sm-risk-only"><input type="checkbox" checked={selection.onlyRisks} onChange={event => onChange({onlyRisks: event.target.checked})}/>只看亏损和低利润</label>
    </div>
    </div>
    <div className="sm-results" data-perspective={selection.view}><table>
      <thead><tr>{(selection.view === 'new' ? ['竞争旧机 / PPV', '京东物品价-追价后', '爱回收承担补贴比当前', '预计利润', '对应关系 / 结论', '操作'] : ['换成哪个新机系列', '爱回收承担补贴比当前', '换成该新机后预计边际利润', '结论', '操作']).map((title, index) => <th key={index}>{title}</th>)}</tr></thead>
      <tbody>{selection.view === 'new' ? model.visibleScenarios.map(scenario => {
        const {product: old, result, relation} = scenario;
        return <tr key={old.id}>
          <td><strong>{old.oldModel}</strong><small className="sm-ppv" title={old.ppv}>{old.ppv}</small></td>
          <td>{money(old.recommendJdPrice)} 元</td>
          <td className={subsidyDeltaClass(result.comparison?.delta)}>{result.comparison ? deltaLabel(result.comparison.delta) : '待核验'}<small>{result.hit.rules[0] ? `原门槛 ${money(result.hit.rules[0].threshold)}` : result.hit.status === 'below' ? '未到最低门槛' : '规则待核验'}</small></td>
          <td><strong className={riskClass(result.comparison?.risk)}>{result.comparison ? `${money(result.comparison.profit)} 元` : '—'}</strong><small>{result.comparison ? percent(result.comparison.rate) : '待核验'}</small></td>
          <td><span className={riskClass(result.comparison?.risk)}>{result.comparison?.risk || '待核验'}</span><small>{relation === 'workspace' ? '工作台对应' : `跨系列测算 · 原方案 ${old.newSeries}`}</small></td>
          <td><button className="whitespace-nowrap underline" aria-label={`查看${old.ppv}换到${target?.series}的利润变化原因`} onClick={() => onDetail(old, result.row.series)}>查看原因</button></td>
        </tr>;
      }) : model.visibleResults.map(result => <tr key={result.row.key}>
        <td><div className="flex items-center gap-2"><strong>{result.row.series}</strong>{result.current ? <span className="sm-current">当前方案</span> : result.row.activeCount > 0 ? <span className="sm-in-use">目标</span> : null}</div><small>{result.row.brand}</small></td>
        <td className={subsidyDeltaClass(result.comparison?.delta)}>{result.comparison ? deltaLabel(result.comparison.delta) : '待核验'}</td>
        <td><strong className={riskClass(result.comparison?.risk)}>{result.comparison ? `${money(result.comparison.profit)} 元` : '—'}</strong><small>{result.comparison ? percent(result.comparison.rate) : '规则或测算数据待核验'}</small></td>
        <td className={`font-bold ${riskClass(result.comparison?.risk)}`}>{result.comparison?.risk || '待核验'}</td>
        <td><button className="whitespace-nowrap underline" aria-label={`查看${result.row.series}的利润变化原因`} onClick={() => product && onDetail(product, result.row.series)}>查看原因</button></td>
      </tr>)}</tbody>
    </table>
      {(selection.view === 'new' ? !model.visibleScenarios.length : !model.visibleResults.length) && <p className="p-4 text-xs text-[#555]">{selection.view === 'old' && selection.oldSearch?.trim() ? '没有匹配当前搜索及风险筛选的新机系列。' : selection.view === 'new' && selection.search?.trim() ? '没有匹配当前搜索及风险筛选的竞争旧机 / PPV。' : fixedQuote && selection.view === 'new' && !target ? '该报价缺少新机系列，无法进行新机视角测算。' : selection.onlyRisks ? '当前范围内没有已识别的亏损或低利润组合。' : selection.view === 'new' ? '工作台暂无可测算的 PPV 报价。' : '当前筛选范围没有可比较的新机系列。'}</p>}
    </div>
    <details className="text-xs text-[#555]"><summary className="cursor-pointer">怎么算的？</summary><div className="mt-2 space-y-1 leading-relaxed">
      <p>两种视角都逐条使用工作台的“京东物品价-追价后”命中最高已达原始门槛，不用合并档最大值，也不叠加补贴。</p>
      <p>预计利润＝该条工作台原利润 − 补贴增量 × 1.0466；利润率分母仍为该旧机基准价。每多承担 100 元补贴，利润减少 104.66 元。当前方案保留工作台已算结果。</p>
      <p>同门槛金额冲突、规则或基准数据缺失显示待核验。不同 PPV、等级或来源方案保留为不同报价；此处为换新风险测算，不代表实际换新订单，不据此预测换新订单量。</p>
      <p>系列范围跟随上方筛选；门槛范围只控制矩阵展示，不限制实际命中。列表按预计亏损额从高到低排列。</p>
    </div></details>
  </section>;
}
