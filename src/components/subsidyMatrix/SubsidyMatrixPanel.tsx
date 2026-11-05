import React, {useEffect, useMemo, useRef, useState} from 'react';
import {buildProfitView, buildSeriesProfitResults, buildWorkspaceMatrix, filterMatrixRows, getSeriesRuleDetails, resolveMatrixFilters, sortMatrixRows, cycleMatrixSort, selectHeatmapGroups} from './model';
import ProfitPerspectives from './ProfitPerspectives';
import ProfitChangeVisual from './ProfitChangeVisual';
import {DetailDialog, RuleTable, button, deltaLabel, input, money, percent, riskClass, ruleLabel} from './ui';
import {createMatrixWorkbook} from './workbook';
import type {MatrixGroup, MatrixRow, MatrixWorkspace, ProfitViewSelection, SeriesProfitResult} from './types';

import {amountColors, amountLabels, ratioLabels, heatmapCell, heatmapSpread, spreadText, ratioText, metricAmount, subsidyLabel, valueLabel, type HeatmapMode, type SubsidyMetric} from './heatmapStyle';

type DetailSelection = {kind: 'matrix'; series: string; groupKey: string} | {kind: 'profit'; series: string; productId: string};

export default function SubsidyMatrixPanel({workspace, marginBottomLine, onOpenSources}: {
  workspace: MatrixWorkspace;
  marginBottomLine: number;
  onOpenSources?: () => void;
}) {
  const [metric, setMetric] = useState<SubsidyMetric>('ahs');
  const [heatmapMode, setHeatmapMode] = useState<HeatmapMode>('amount');
  const [onlyTargets, setOnlyTargets] = useState(false);
  const scope = onlyTargets ? 'active' : 'all';
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
  const groups: MatrixGroup[] = useMemo(() => selectHeatmapGroups(matrix.groups, rows, range, heatmapMode, metric), [matrix.groups, rows, range, heatmapMode, metric]);
  const maxFilteredSpread = useMemo(() => {
    const gaps = matrix.groups.map(group => heatmapSpread(rows, group.key, heatmapMode, metric)).filter(value => value !== null);
    return gaps.length ? Math.max(...gaps) : null;
  }, [matrix.groups, rows, heatmapMode, metric]);
  const activeSort = groups.some(group => group.key === sort.groupKey) ? sort.groupKey : '';
  const displayRows = useMemo(() => sortMatrixRows(rows, activeSort, sort.direction, heatmapMode, metric), [rows, activeSort, sort.direction, heatmapMode, metric]);
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
      const book = createMatrixWorkbook({workspace, rows: displayRows, groups, columnWidth, mode: heatmapMode, metric});
      const bytes = await workbookToBytes(book);
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${metric === 'total' ? '总补贴热力图' : '补贴承担热力图'}_${workspace.snapshotId || '当前工作台'}${heatmapMode === 'ratio' ? `_${valueLabel(metric, heatmapMode)}` : ''}.xlsx`;
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
      <div className="space-y-1">
        <h2 className="text-lg font-black">新机补贴承担矩阵</h2>
        <p className="text-xs text-[#777]">按新机系列 × 补贴门槛，分析 爱回收补贴承担金额/总补贴 及差异分布</p>
      </div>
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
        ['门槛：原始 / 合并', `${matrix.stats.rawThresholds} / ${matrix.stats.mergedThresholds}`], ['筛选内最大差额', maxFilteredSpread === null ? '—' : heatmapMode === 'ratio' ? `${(maxFilteredSpread * 100).toFixed(2)}pp` : `¥${money(maxFilteredSpread)}`]
      ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
    </div>
    <div className="sm-filters" role="group" aria-label="矩阵筛选">
      <div className="sm-filter-heading">
        <strong className="sm-filter-tag">矩阵筛选</strong>
        <span className="text-xs text-[#555]">显示 <b className="sm-filter-count">{rows.length}</b> 个系列 · <b className="sm-filter-count">{groups.length}</b> 档门槛</span>
        <span className="text-xs text-[#555]">行：新机系列 ｜ 列：合并门槛 ｜ {heatmapMode === 'ratio' ? `比例：${subsidyLabel(metric)} ÷ 原始门槛` : '金额单位：元'}</span>
      </div>
      <div className="sm-view-controls">
        <div className="sm-switch-field"><span className="sm-switch-label">补贴口径</span>
        <div className="sm-mode-switch" role="group" aria-label="补贴口径">
          <button type="button" className={`sm-target-filter ${metric === 'ahs' ? 'sm-selected' : ''}`} aria-pressed={metric === 'ahs'} onClick={() => setMetric('ahs')}>爱回收承担</button>
          <button type="button" className={`sm-target-filter ${metric === 'total' ? 'sm-selected' : ''}`} aria-pressed={metric === 'total'} onClick={() => setMetric('total')}>总补贴（含京东券）</button>
        </div>
        </div>
        <div className="sm-switch-field"><span className="sm-switch-label">显示方式</span>
        <div className="sm-mode-switch" role="group" aria-label="热力图显示方式">
          <button type="button" className={`sm-target-filter ${heatmapMode === 'amount' ? 'sm-selected' : ''}`} aria-pressed={heatmapMode === 'amount'} onClick={() => setHeatmapMode('amount')}>金额</button>
          <button type="button" className={`sm-target-filter ${heatmapMode === 'ratio' ? 'sm-selected' : ''}`} aria-pressed={heatmapMode === 'ratio'} onClick={() => setHeatmapMode('ratio')}>比例</button>
        </div>
        </div>
        <button type="button" className={`sm-target-filter ${onlyTargets ? 'sm-selected' : ''}`} aria-pressed={onlyTargets} onClick={() => setOnlyTargets(value => !value)} title="只显示当前工作台已设为目标的新机系列">{onlyTargets && <span aria-hidden="true">✓ </span>}只看目标新机系列</button>
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
          <option value="top">{metric === 'total' ? '补贴差额 TOP 10' : '风险差额 TOP 10'}</option><option value="all">全部门槛</option><option value="low">低门槛：≤1000 元</option>
          <option value="mid">中门槛：1100–3001 元</option><option value="high">高门槛：≥3500 元</option>
        </select></label>

      </div>
    </div>
    {matrix.missingSeries.length > 0 && <p className="text-xs text-amber-800">工作台有 {matrix.missingSeries.length} 个在用系列未匹配补贴规则：{matrix.missingSeries.join('、')}。已保留空行供核对。</p>}
    <div ref={scrollRef} className="sm-scroll" tabIndex={0} aria-label="可横向纵向滚动的补贴矩阵">
      <table className="sm-table" data-mode={heatmapMode} style={{width: 185 + groups.length * columnWidth}}>
        <colgroup><col style={{width: 185}}/>{groups.map(group => <col key={group.key} style={{width: columnWidth}}/>)}</colgroup>
        <thead><tr><th>品牌 / 新机系列{activeSort && <button className="sm-reset-sort" onClick={() => setSort({groupKey: '', direction: 'descending'})}>恢复默认顺序</button>}</th>{groups.map(group => <th key={group.key} aria-sort={activeSort === group.key ? sort.direction : 'none'}><button className="sm-sort-heading" title={`点击依次切换：${valueLabel(metric, heatmapMode)}降序 → 升序 → 默认；多规则取最大值，无规则或比例待核验排最后；Δ按当前筛选系列计算`} onClick={() => setSort(current => cycleMatrixSort({...current, groupKey: activeSort}, group.key))}>{group.label}<span className="sm-sort-arrow" aria-hidden="true">{activeSort === group.key ? sort.direction === 'descending' ? ' ↓' : ' ↑' : ' ⇅'}</span><small>最大差额 Δ {spreadText(rows, group.key, heatmapMode, metric)}</small></button></th>)}</tr></thead>
        <tbody key={range}>{displayRows.map(row => <tr key={row.key} data-in-use={row.activeCount > 0 ? 'true' : 'false'}>
          <th title={`${row.brand} · ${row.series}${row.activeCount ? ` · 对应 ${row.activeCount} 条工作台报价` : ' · 工作台未使用'}`}>
            <small>{row.brand}{row.activeCount > 0 ? ` · ${row.activeCount} 条报价` : ' · 未使用'}</small>
            <div className="sm-series-name">{row.activeCount > 0 && <span className="sm-in-use">目标</span>}<strong>{row.series}</strong></div>
          </th>
          {groups.map(group => {
            const rules = row.cells[group.key];
            if (!rules?.length) return <td key={group.key} className="sm-empty">—</td>;
            const cell = heatmapCell(rules, heatmapMode, metric);
            const text = cell.text;
            const title = `${row.brand} ${row.series}\n合并门槛 ${group.label}\n${rules.map(rule => `${ruleLabel(rule)}${heatmapMode === 'ratio' ? ` · ${valueLabel(metric, heatmapMode)} ${rule.threshold > 0 && metricAmount(rule, metric) !== null ? ratioText(metricAmount(rule, metric)! / rule.threshold) : '待核验'}` : ''}`).join('\n')}\n当前显示：${subsidyLabel(metric)} · ${valueLabel(metric, heatmapMode)}`;
            return <td key={group.key}><button style={{background: cell.background, color: cell.foreground}}
              title={title} aria-label={`${row.series} 门槛 ${group.label} ${text}${heatmapMode === 'amount' ? '元' : ''}，查看原始规则`}
              onClick={() => setDetail({kind: 'matrix', series: row.series, groupKey: group.key})}>
              {text}{rules.length > 1 && <sup>◈</sup>}
            </button></td>;
          })}
        </tr>)}</tbody>
      </table>
      {!rows.length && <p className="p-5 text-xs text-[#555]">没有匹配的新机系列。</p>}
    </div>
    <div className="sm-legend">{amountColors.map((color, index) => <span key={color}><i style={{background: color}}/>{heatmapMode === 'ratio' ? ratioLabels[index] : `${amountLabels[index]} 元`}</span>)}<span>◈ 多条原始规则，点击可展开</span></div>
    {heatmapMode === 'ratio' && <p className="text-xs text-[#555]">{valueLabel(metric, heatmapMode)}＝{subsidyLabel(metric)} ÷ 每条规则的原始门槛；多规则显示比例范围，颜色与排序取最高比例。Δ 的 pp 表示百分点；门槛为 0 时待核验。</p>}
    <details className="sm-metric-rules text-xs text-[#555]"><summary>补贴口径与展示规则</summary><div className="mt-2 space-y-1 leading-relaxed">
      <p>爱回收承担取本次补贴表的“爱回收承担总补贴”；总补贴直接取“京东总补贴（含京东券）”，不再加上爱回收承担。</p>
      <p>比例＝所选补贴金额 ÷ 每条规则原始门槛，可超过 100%；门槛为 0 时比例待核验。多规则保留范围，颜色和排序取最高值；Δ 和 TOP 10 按当前筛选范围、补贴口径及金额/比例重新计算。</p>
      <p>下方利润风险始终按爱回收实际承担成本测算；总补贴用于查询对比，不直接作为爱回收成本。</p>
    </div></details>
    <p className="text-xs text-[#555]">合并门槛仅用于展示。实际追价利润测算必须以原始触发门槛和适用补贴规则为准。</p>
    {!!matrix.issues.length && <details className="border border-[#141414] p-3 text-xs"><summary className="cursor-pointer font-bold">本次补贴规则提示（{matrix.issues.length}）</summary><div className="mt-2 max-h-40 overflow-auto">{matrix.issues.map((issue, index) => <p key={index}>{issue}</p>)}</div></details>}

    <ProfitPerspectives workspace={workspace} model={profit} selection={profitSelection} onChange={patch => setProfitSelection(old => ({...old, ...patch}))} floor={marginBottomLine} onDetail={(product, series) => showProfit(product.id, series)}/>

    {detail && selectedRow && <DetailDialog title={`${selectedRow.series} · ${detail.kind === 'matrix' ? '补贴规则' : '利润变化原因'}`} onClose={() => setDetail(null)}>
      <p className="text-xs text-[#555]">{workspace.fileName} · {workspace.label}</p>
      {detail.kind === 'matrix' && selectedGroup ? <>
        <p className="text-xs leading-relaxed">{selectedRow.brand} · 合并门槛 {selectedGroup.label} 元；当前筛选内{valueLabel(metric, heatmapMode)}最大差额 Δ {spreadText(rows, selectedGroup.key, heatmapMode, metric)}{heatmapMode === 'amount' ? ' 元' : ''}。<br/>全系列共 {seriesDetails.rules.length} 条原始规则；黑框标注刚点击的 {selectedGroup.label} 元档，共 {highlightedRules.length} 条。</p>
        <RuleTable rules={seriesDetails.rules} highlightedIds={seriesDetails.highlightedIds} showRatio={heatmapMode === 'ratio'} metric={metric}/>
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
