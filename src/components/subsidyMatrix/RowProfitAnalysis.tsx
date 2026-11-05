import React, {useMemo, useState} from 'react';
import type {CalculatedProduct} from '../../types';
import {buildProfitView, buildSeriesProfitResults, buildWorkspaceMatrix} from './model';
import ProfitChangeVisual from './ProfitChangeVisual';
import ProfitPerspectives from './ProfitPerspectives';
import type {MatrixWorkspace, ProfitViewSelection} from './types';
import {DetailDialog, RuleTable} from './ui';

export default function RowProfitAnalysis({quote, workspace, floor, onClose}: {
  quote: CalculatedProduct;
  workspace: MatrixWorkspace;
  floor: number;
  onClose: () => void;
}) {
  const [selection, setSelection] = useState<ProfitViewSelection>({
    view: 'new', productId: '', targetSeries: '', onlyRisks: true
  });
  const [detail, setDetail] = useState<{product: CalculatedProduct; series: string} | null>(null);
  const matrix = useMemo(() => buildWorkspaceMatrix(workspace.subsidyRules, workspace.products), [workspace]);
  const {rows, rules, invalidSeries} = matrix;
  const model = useMemo(() => buildProfitView({
    selection, rows, rules, products: workspace.products, floor, invalidSeries, focusedQuote: quote
  }), [selection, rows, rules, workspace.products, floor, invalidSeries, quote]);
  const detailResult = detail && buildSeriesProfitResults({
    rows: rows.filter(row => row.series === detail.series), rules, product: detail.product, floor, invalidSeries
  })[0];

  return <div className="subsidy-matrix space-y-3 border border-[#141414] bg-white p-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0 text-xs">
        <strong>{quote.newSeries || '未填写新机系列'} · {quote.oldModel}</strong>
        <p className="mt-1 break-words text-[#555]">{quote.ppv}</p>
      </div>
      <button type="button" className="border border-[#141414] px-2 py-1 text-xs" onClick={onClose}>收起分析</button>
    </div>
    {workspace.unavailableReason ? <p role="status" className="text-xs text-[#555]">{workspace.unavailableReason}</p> : <>
    {!rules.length && <p role="status" className="text-xs text-[#555]">当前工作台没有可用的补贴规则，跨系列方案暂无法测算。</p>}
    <ProfitPerspectives workspace={workspace} model={model} selection={selection}
      onChange={patch => setSelection(previous => ({...previous, ...patch}))}
      floor={floor} fixedQuote onDetail={(product, series) => setDetail({product, series})}/>
    {detail && detailResult && <DetailDialog title={`${detail.series} · 利润变化原因`} onClose={() => setDetail(null)}>
      <p className="text-xs text-[#555]">{workspace.fileName} · {workspace.label}</p>
      <ProfitChangeVisual product={detail.product} result={detailResult} floor={floor}/>
      {detailResult.hit.rules.length > 0 && <RuleTable rules={detailResult.hit.rules}/>}
    </DetailDialog>}
    </>}
  </div>;
}
