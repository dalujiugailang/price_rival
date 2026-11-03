import React, {useEffect, useMemo, useRef, useState} from 'react';
import {buildProfitView, buildSeriesProfitResults, buildWorkspaceMatrix, filterMatrixRows, getSeriesRuleDetails, resolveMatrixFilters, sortMatrixRows, cycleMatrixSort} from './model';
import ProfitPerspectives from './ProfitPerspectives';
import ProfitChangeVisual from './ProfitChangeVisual';
import {DetailDialog, RuleTable, button, deltaLabel, input, money, percent, riskClass, ruleLabel} from './ui';
import {createMatrixWorkbook} from './workbook';
import type {MatrixGroup, MatrixRow, MatrixWorkspace, ProfitViewSelection, SeriesProfitResult} from './types';

import {amountColors, amountLabels, amountBand as band} from './heatmapStyle';

type DetailSelection = {kind: 'matrix'; series: string; groupKey: string} | {kind: 'profit'; series: string; productId: string};

export default function SubsidyMatrixPanel({workspace, marginBottomLine, onOpenSources}: {
  workspace: MatrixWorkspace;
  marginBottomLine: number;
  onOpenSources?: () => void;
}) {
  const scope = 'all';
  const scrollRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [sort, setSort] = useState({groupKey: '', direction: 'descending' as 'descending' | 'ascending'});
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  const [brand, setBrand] = useState('');
  const [range, setRange] = useState('top');
  const [search, setSearch] = useState('');
  const [seriesFilter, setSeriesFilter] = useState('');
  const [profitSelection, setProfitSelection] = useState<ProfitViewSelection>({view: 'new', productId: '', targetSeries: '', onlyRisks: false});
  const [detail, setDetail] = useState<DetailSelection | null>(null);
  const matrix: ReturnType<typeof buildWorkspaceMatrix> = useMemo(() => buildWorkspaceMatrix(workspace.subsidyRules, workspace.products), [workspace.subsidyRules, workspace.products]);
  const brands = useMemo(() => [...new Set(matrix.rules.map(rule => rule.brand))].sort(), [matrix]);
  const filters: ReturnType<typeof resolveMatrixFilters> = useMemo(() => resolveMatrixFilters(matrix.rows, scope, brand, seriesFilter), [matrix, scope, brand, seriesFilter]);
  const availableRows = filters.availableRows;
  const rows: MatrixRow[] = useMemo(() => filterMatrixRows(matrix.rows, {scope, brand: filters.brand, series: filters.series, search}), [matrix, scope, filters, search]);
  const groups: MatrixGroup[] = useMemo(() => {
    if (range === 'top') return [...matrix.groups].sort((a, b) => b.delta - a.delta || a.min - b.min).slice(0, 10).sort((a, b) => a.min - b.min);
    return matrix.groups.filter(group => range === 'all' || (range === 'low' ? group.min <= 1000 : range === 'mid' ? group.max >= 1100 && group.min <= 3001 : group.max >= 3500));
  }, [matrix, range]);
  const activeSort = groups.some(group => group.key === sort.groupKey) ? sort.groupKey : '';
  const displayRows = useMemo(() => sortMatrixRows(rows, activeSort, sort.direction), [rows, activeSort, sort.direction]);
  const columnWidth = range === 'all' || !groups.length ? 88 : Math.max(88, (containerWidth - 185) / groups.length);
  const profit: ReturnType<typeof buildProfitView> = useMemo(() => buildProfitView({selection: profitSelection, rows, rules: matrix.rules, products: workspace.products, floor: marginBottomLine, invalidSeries: matrix.invalidSeries}), [profitSelection, rows, matrix, workspace.products, marginBottomLine]);
  const selectedRow = detail && matrix.rows.find(row => row.series === detail.series);
  const selectedGroup = detail?.kind === 'matrix' && matrix.groups.find(group => group.key === detail.groupKey);
  const seriesDetails = detail?.kind === 'matrix' ? getSeriesRuleDetails(matrix.rules, matrix.groups, detail.series, detail.groupKey) : null;
  const highlightedRules = seriesDetails?.rules.filter(rule => seriesDetails.highlightedIds.includes(rule.id)) || [];
  const detailProduct = detail?.kind === 'profit' ? workspace.products.find(row => row.id === detail.productId) : profit.product;
  const selectedProfit = selectedRow && detailProduct ? buildSeriesProfitResults({rows: [selectedRow], rules: matrix.rules, product: detailProduct, floor: marginBottomLine, invalidSeries: matrix.invalidSeries})[0] : null;
  const baseProfit = detailProduct ? detailProduct.postMarginalProfit * detailProduct.basePrice : NaN;

  function showProfit(productId: string, series: string) {
    setDetail({kind: 'profit', series, productId});
  }

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  async function exportWorkbook() {
    setExporting(true);
    setExportError('');
    try {
      const {workbookToBytes} = await import('@office-kit/xlsx/io');
      const book = createMatrixWorkbook({workspace, rows: displayRows, groups, columnWidth});
      const bytes = await workbookToBytes(book);
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
      const link = document.createElement('a');
      link.href = url;
      link.download = `补贴承担热力图_${workspace.snapshotId || '当前工作台'}.xlsx`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setExportError(`导出失败：${error instanceof Error ? error.message : '请重试'}`);
    } finally {setExporting(false);}
  }

  function resultReason(result: SeriesProfitResult) {
    if (result.current) return '这是当前工作台方案，补贴和利润保持该行已算结果。';
    if (result.hit.status === 'conflict') return '最高已达门槛存在不同补贴金额，需核对适用条件，暂不估算利润。';
    if (result.hit.status === 'invalid') return '该系列包含无效的工作台补贴规则，需先核对数据源，暂不估算利润。';
    if (result.hit.status === 'missing') return '本次补贴表没有该新机系列的有效规则，暂不估算利润。';
    if (result.hit.status === 'below') return '这台旧机的追后价未达到该系列最低原始门槛，承担补贴为 0 元。';
    return `按旧机追后价 ${money(detailProduct?.recommendJdPrice)} 元，命中原始门槛 ${money(result.hit.rules[0]?.threshold)} 元。`;
  }

  return <section className="subsidy-matrix space-y-4 p-4" aria-label="补贴承担矩阵">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-lg font-black">所有新机系列—爱回收承担补贴热力图</h2>
      <button className={button} disabled={!workspace.subsidyRules.length || exporting} onClick={exportWorkbook}>{exporting ? '正在导出…' : '导出 Excel'}</button>
    </div>
    {exportError && <p role="alert" className="text-xs text-red-700">{exportError}</p>}
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#555]">
      <p>补贴来源：<strong className="text-[#141414]">{workspace.fileName}</strong> · {workspace.label}</p>
      <span>与本次工作台测算同步{workspace.uploadedAt ? ` · ${workspace.uploadedAt}` : ''}</span>
    </div>
    {!workspace.subsidyRules.length && <div className="border border-[#141414] bg-[#F0EFEC] p-3 text-xs" role="status">
      {workspace.snapshotId ? '此快照未保存补贴规则，无法展开矩阵和其他新机的利润比较。' : '本次工作台还没有补贴规则，矩阵会在工作台更新后自动同步。'}
      {onOpenSources && <button className="ml-2 font-bold underline" onClick={onOpenSources}>查看系统数据源</button>}
    </div>}
    <div className="sm-stats" aria-label="补贴统计">
      {[
        ['目标新机系列', `${matrix.usage.size} 个系列`], ['补贴表系列', matrix.stats.series], ['补贴规则', matrix.stats.rules],
        ['门槛：原始 / 合并', `${matrix.stats.rawThresholds} / ${matrix.stats.mergedThresholds}`], ['同档最大差额', `¥${money(matrix.stats.maxDelta)}`]
      ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
    </div>
    <div className="sm-filters" role="group" aria-label="矩阵筛选">
      <div className="sm-filter-heading">
        <strong className="sm-filter-tag">矩阵筛选</strong>
        <span className="text-xs text-[#555]">显示 <b className="sm-filter-count">{rows.length}</b> 个系列 · <b className="sm-filter-count">{groups.length}</b> 档门槛</span>
        <span className="text-xs text-[#555]">行：新机系列 ｜ 列：合并门槛 ｜ 金额单位：元</span>
      </div>
      <div className="sm-toolbar-row text-xs">
        <label>关键词<input className={`${input} sm-toolbar-search`} aria-label="型号搜索" placeholder="搜索品牌 / 型号" value={search} onChange={event => setSearch(event.target.value)}/></label>
        <label className="flex items-center gap-2">品牌 <select className={input} aria-label="新机品牌筛选" value={filters.brand} onChange={event => {setBrand(event.target.value); setSeriesFilter('');}}>
          <option value="">全部品牌</option>{brands.map(value => <option key={value}>{value}</option>)}
        </select></label>
        <label className="flex items-center gap-2">新机系列 <select className={input} aria-label="新机系列筛选" value={filters.series} onChange={event => {setSeriesFilter(event.target.value); if (event.target.value) setProfitSelection(old => ({...old, targetSeries: event.target.value}));}}>
          <option value="">全部新机系列</option>{availableRows.map(row => <option key={row.key} value={row.series}>{row.series}</option>)}
        </select></label>
        <label className="flex items-center gap-2">门槛 <select className={input} aria-label="门槛范围" value={range} onChange={event => {setRange(event.target.value); if (scrollRef.current) scrollRef.current.scrollLeft = 0;}}>
          <option value="top">风险差额 TOP 10</option><option value="all">全部门槛</option><option value="low">低门槛：≤1000 元</option>
          <option value="mid">中门槛：1100–3001 元</option><option value="high">高门槛：≥3500 元</option>
        </select></label>

      </div>
    </div>
    {matrix.missingSeries.length > 0 && <p className="text-xs text-amber-800">工作台有 {matrix.missingSeries.length} 个在用系列未匹配补贴规则：{matrix.missingSeries.join('、')}。已保留空行供核对。</p>}
    <div ref={scrollRef} className="sm-scroll" tabIndex={0} aria-label="可横向纵向滚动的补贴矩阵">
      <table className="sm-table" style={{width: 185 + groups.length * columnWidth}}>
        <colgroup><col style={{width: 185}}/>{groups.map(group => <col key={group.key} style={{width: columnWidth}}/>)}</colgroup>
        <thead><tr><th>品牌 / 新机系列{activeSort && <button className="sm-reset-sort" onClick={() => setSort({groupKey: '', direction: 'descending'})}>恢复默认顺序</button>}</th>{groups.map(group => <th key={group.key} aria-sort={activeSort === group.key ? sort.direction : 'none'}><button className="sm-sort-heading" title="点击依次切换：承担额降序 → 升序 → 默认；多规则取最大值，无规则排最后" onClick={() => setSort(current => cycleMatrixSort({...current, groupKey: activeSort}, group.key))}>{group.label}<span className="sm-sort-arrow" aria-hidden="true">{activeSort === group.key ? sort.direction === 'descending' ? ' ↓' : ' ↑' : ' ⇅'}</span><small>最大差额 Δ {money(group.delta)}</small></button></th>)}</tr></thead>
        <tbody key={range}>{displayRows.map(row => <tr key={row.key} data-in-use={row.activeCount > 0 ? 'true' : 'false'}>
          <th title={`${row.brand} · ${row.series}${row.activeCount ? ` · 对应 ${row.activeCount} 条工作台报价` : ' · 工作台未使用'}`}>
            <small>{row.brand}{row.activeCount > 0 ? ` · ${row.activeCount} 条报价` : ' · 未使用'}</small>
            <div className="sm-series-name">{row.activeCount > 0 && <span className="sm-in-use">目标</span>}<strong>{row.series}</strong></div>
          </th>
          {groups.map(group => {
            const rules = row.cells[group.key];
            if (!rules?.length) return <td key={group.key} className="sm-empty">—</td>;
            const values = rules.map(rule => rule.ahs);
            const min = Math.min(...values), max = Math.max(...values), index = band(max);
            const text = min === max ? money(max) : `${money(min)}–${money(max)}`;
            const title = `${row.brand} ${row.series}\n合并门槛 ${group.label}\n${rules.map(ruleLabel).join('\n')}\n同档最低 ${group.low}；最高 ${group.high}；最大风险差额 ${Math.max(...rules.map(rule => rule.ahs)) - group.low}`;
            return <td key={group.key}><button style={{background: amountColors[index], color: index === 5 ? 'white' : '#141414'}}
              title={title} aria-label={`${row.series} 门槛 ${group.label} ${text}元，查看原始规则`}
              onClick={() => setDetail({kind: 'matrix', series: row.series, groupKey: group.key})}>
              {text}{rules.length > 1 && <sup>◈</sup>}
            </button></td>;
          })}
        </tr>)}</tbody>
      </table>
      {!rows.length && <p className="p-5 text-xs text-[#555]">没有匹配的新机系列。</p>}
    </div>
    <div className="sm-legend">{amountColors.map((color, index) => <span key={color}><i style={{background: color}}/>{amountLabels[index]} 元</span>)}<span>◈ 多条原始规则，点击可展开</span></div>
    <p className="text-xs text-[#555]">合并门槛仅用于展示。实际追价利润测算必须以原始触发门槛和适用补贴规则为准。</p>
    {!!matrix.issues.length && <details className="border border-[#141414] p-3 text-xs"><summary className="cursor-pointer font-bold">本次补贴规则提示（{matrix.issues.length}）</summary><div className="mt-2 max-h-40 overflow-auto">{matrix.issues.map((issue, index) => <p key={index}>{issue}</p>)}</div></details>}

    <ProfitPerspectives workspace={workspace} model={profit} selection={profitSelection} onChange={patch => setProfitSelection(old => ({...old, ...patch}))} floor={marginBottomLine} onDetail={showProfit}/>

    {detail && selectedRow && <DetailDialog title={`${selectedRow.series} · ${detail.kind === 'matrix' ? '补贴规则' : '利润变化原因'}`} onClose={() => setDetail(null)}>
      <p className="text-xs text-[#555]">{workspace.fileName} · {workspace.label}</p>
      {detail.kind === 'matrix' && selectedGroup ? <>
        <p className="text-xs leading-relaxed">{selectedRow.brand} · 合并门槛 {selectedGroup.label} 元；同档最低承担 {money(selectedGroup.low)} 元，最高 {money(selectedGroup.high)} 元。<br/>全系列共 {seriesDetails.rules.length} 条原始规则；黑框标注刚点击的 {selectedGroup.label} 元档，共 {highlightedRules.length} 条。</p>
        <RuleTable rules={seriesDetails.rules} highlightedIds={seriesDetails.highlightedIds}/>
        <p className="text-xs text-[#555]">合并档最大值用于发现风险，实际换新承担按这台旧机达到的原始门槛重新命中。</p>
        <button className={button} onClick={() => {setProfitSelection(old => ({...old, view: 'new', targetSeries: selectedRow.series})); setDetail(null); document.querySelector('[aria-label="换新利润比较"]')?.scrollIntoView({behavior: 'smooth', block: 'start'});}}>查看这个新机对应的竞争机型</button>
      </> : selectedProfit ? <>
        <p className="text-sm leading-relaxed">{resultReason(selectedProfit)}</p>
        <ProfitChangeVisual product={detailProduct} result={selectedProfit} floor={marginBottomLine} onOldView={() => {setProfitSelection(old => ({...old, view: 'old', productId: detailProduct.id})); setDetail(null); document.querySelector('[aria-label="换新利润比较"]')?.scrollIntoView({behavior: 'smooth', block: 'start'});}}/>
        {selectedProfit.hit.rules.length > 0 && <RuleTable rules={selectedProfit.hit.rules}/>}
      </> : <p className="text-xs">该系列不在当前比较范围内，请调整上方筛选后查看。</p>}
    </DetailDialog>}
  </section>;
}
