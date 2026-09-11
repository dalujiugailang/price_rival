/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, ChevronLeft, ChevronRight, History, List, Search, Trash2, X } from 'lucide-react';
import { TrackingBatch } from '../types';
import { formatPercent, formatRMB } from '../utils/formulas';
import {
  compareSnapshotProducts, hasSnapshotDetails, isImportedSnapshot, selectSnapshot, snapshotRemark,
  snapshotStatus, snapshotTimeLabel, sortSnapshots
} from '../utils/snapshotHistory';
import { SnapshotTable } from './MainTable';

interface Props {
  historyBatches: TrackingBatch[];
  selectedBatchId?: string;
  onSelectBatch: (id: string) => void;
  onDeleteBatch?: (id: string) => void;
  channelName?: string;
}

const buttonClass = 'inline-flex items-center justify-center gap-1.5 border border-[#141414] bg-white px-3 py-1.5 text-xs font-bold hover:bg-[#E4E3E0] disabled:cursor-not-allowed disabled:opacity-40';
const scoreText = (value: number | null | undefined) => (
  value == null || !Number.isFinite(value) ? '—' : `${value.toFixed(2)}%`
);
const moneyText = (value: number | null) => value === null ? '—' : formatRMB(value);
const marginText = (value: number | null) => value === null ? '—' : formatPercent(value);
const listTimeLabel = (batch: TrackingBatch) => isImportedSnapshot(batch) ? batch.date : snapshotTimeLabel(batch);

export default function HistoryPanel({
  historyBatches, selectedBatchId, onSelectBatch, onDeleteBatch, channelName = '京东换新'
}: Props) {
  const batches = useMemo(() => sortSnapshots(historyBatches), [historyBatches]);
  const inspectedBatch = selectSnapshot(batches, selectedBatchId);
  const inspectedId = inspectedBatch?.id;
  const [showAllSnapshots, setShowAllSnapshots] = useState(false);
  const [search, setSearch] = useState('');
  const [showComparison, setShowComparison] = useState(false);
  const [comparisonBatchId, setComparisonBatchId] = useState('');
  const stripRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const detailBatches = batches.filter(hasSnapshotDetails);
  const comparisonBatch = detailBatches.find(batch => batch.id === comparisonBatchId && batch.id !== inspectedId)
    || detailBatches.find(batch => batch.id !== inspectedId);
  const canCompare = Boolean(inspectedBatch && hasSnapshotDetails(inspectedBatch) && comparisonBatch);
  const comparisonRows = useMemo(() => (
    showComparison && canCompare && inspectedBatch && comparisonBatch
      ? compareSnapshotProducts(comparisonBatch, inspectedBatch)
      : []
  ), [showComparison, canCompare, inspectedBatch, comparisonBatch]);
  const filteredBatches = batches.filter(batch => (
    [batch.id, batch.date, snapshotTimeLabel(batch), batch.operator, batch.remarks, snapshotStatus(batch)]
      .some(value => value?.toLowerCase().includes(search.trim().toLowerCase()))
  ));

  useEffect(() => {
    if (!inspectedId || !stripRef.current) return;
    const tab = tabRefs.current.get(inspectedId);
    if (!tab) return;
    const strip = stripRef.current;
    const left = tab.offsetLeft;
    if (left < strip.scrollLeft) strip.scrollLeft = left;
    else if (left + tab.offsetWidth > strip.scrollLeft + strip.clientWidth) {
      strip.scrollLeft = left + tab.offsetWidth - strip.clientWidth;
    }
  }, [inspectedId]);

  const inspect = (id: string) => {
    onSelectBatch(id);
    setShowAllSnapshots(false);
    setShowComparison(false);
  };

  const moveTab = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % batches.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + batches.length) % batches.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = batches.length - 1;
    else return;
    event.preventDefault();
    const batch = batches[nextIndex];
    inspect(batch.id);
    tabRefs.current.get(batch.id)?.focus();
  };

  return (
    <section className="min-w-0 space-y-4" data-tour="history-panel" id="history-panel-area" aria-label={`${channelName}历史快照`}>
      <div className="min-w-0 border border-[#141414] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#141414] bg-[#F0EFEC] px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <History className="h-4 w-4" /> {channelName}已保存快照
            <span className="border border-[#141414] bg-white px-1.5 text-xs">{batches.length}</span>
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={buttonClass} aria-expanded={showAllSnapshots} data-tour="history-library" aria-controls="snapshot-library" onClick={() => setShowAllSnapshots(value => !value)}>
              <List className="h-3.5 w-3.5" /> 全部快照
            </button>
            <button type="button" className={buttonClass} data-tour="history-compare" disabled={!canCompare} aria-pressed={showComparison && canCompare} onClick={() => setShowComparison(value => !value)}>
              <ArrowLeftRight className="h-3.5 w-3.5" /> 两期对比
            </button>
          </div>
        </div>

        {showAllSnapshots && (
          <div className="border-b border-[#141414] p-4" id="snapshot-library">
            <div className="mb-3 flex items-center gap-2">
              <label className="relative min-w-0 flex-1">
                <span className="sr-only">搜索已保存快照</span>
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[#555]" />
                <input autoFocus type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索日期、备注、操作人或批次编号" className="w-full border border-[#141414] bg-white py-2 pl-8 pr-3 text-xs" />
              </label>
              <button type="button" className={buttonClass} onClick={() => setShowAllSnapshots(false)} aria-label="关闭全部快照"><X className="h-4 w-4" /></button>
            </div>
            <div className="max-h-64 overflow-y-auto border border-[#141414]/30">
              {filteredBatches.map(batch => (
                <button key={batch.id} type="button" aria-pressed={batch.id === inspectedId} onClick={() => inspect(batch.id)} className={`flex w-full flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-[#141414]/15 px-3 py-2.5 text-left text-xs hover:bg-[#F0EFEC] ${batch.id === inspectedId ? 'bg-[#E4E3E0]' : 'bg-white'}`}>
                  <span><strong>{listTimeLabel(batch)}</strong><span className="ml-3">{snapshotRemark(batch) || '未填写备注'}</span></span>
                  <span className="text-[#555]">{batch.operator} · {snapshotStatus(batch)} · {batch.products.length} 行</span>
                </button>
              ))}
              {filteredBatches.length === 0 && <div className="p-6 text-center text-xs text-[#555]">没有找到匹配的快照。</div>}
            </div>
          </div>
        )}

        {batches.length > 0 ? (
          <div className="flex min-w-0 items-stretch bg-[#F0EFEC] px-2 pt-3">
            <button type="button" className="mb-2 shrink-0 px-1 text-[#555] hover:text-black" aria-label="向左滚动快照" onClick={() => stripRef.current?.scrollBy({ left: -(stripRef.current?.clientWidth || 400) * 0.7, behavior: 'smooth' })}><ChevronLeft className="h-4 w-4" /></button>
            <div ref={stripRef} data-tour="history-tabs" role="tablist" aria-label={`${channelName}快照 Sheet`} className="relative flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto">
              {batches.map((batch, index) => {
                const selected = batch.id === inspectedId;
                const title = snapshotRemark(batch) || '未填写备注';
                return (
                  <button
                    key={batch.id}
                    ref={element => { if (element) tabRefs.current.set(batch.id, element); else tabRefs.current.delete(batch.id); }}
                    type="button" role="tab" id={`snapshot-tab-${batch.id}`} aria-controls="snapshot-detail" aria-selected={selected} tabIndex={selected ? 0 : -1}
                    title={`${snapshotTimeLabel(batch)} · ${title}\n${batch.id}`}
                    onClick={() => inspect(batch.id)} onKeyDown={event => moveTab(event, index)}
                    className={`flex w-[212px] shrink-0 flex-col gap-1 border border-b-0 border-[#141414] px-3 py-2.5 text-left ${selected ? 'bg-[#141414] text-white' : 'bg-white text-[#141414] hover:bg-[#E4E3E0]'}`}
                  >
                    <span className="flex w-full items-center justify-between gap-3 text-xs"><strong className="font-mono">{snapshotTimeLabel(batch, true)}</strong><span className={selected ? 'text-white/80' : 'text-[#555]'}>{snapshotStatus(batch)}</span></span>
                    <span className={`w-full truncate text-[11px] ${selected ? 'text-white/80' : 'text-[#555]'}`}>{title}</span>
                  </button>
                );
              })}
            </div>
            <button type="button" className="mb-2 shrink-0 px-1 text-[#555] hover:text-black" aria-label="向右滚动快照" onClick={() => stripRef.current?.scrollBy({ left: (stripRef.current?.clientWidth || 400) * 0.7, behavior: 'smooth' })}><ChevronRight className="h-4 w-4" /></button>
          </div>
        ) : (
          <div className="p-12 text-center text-sm text-[#555]">暂无快照。保存测算快照后，明细会显示在这里。</div>
        )}
      </div>

      {inspectedBatch && (
        <div role="tabpanel" id="snapshot-detail" aria-labelledby={`snapshot-tab-${inspectedBatch.id}`} className="min-w-0 space-y-4">
          <div data-tour="history-meta" className="border border-[#141414] bg-white px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1.5">
                <h3 className="break-words text-sm font-bold">{snapshotRemark(inspectedBatch) || '历史测算快照'}</h3>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-[#555]" aria-live="polite">
                  {isImportedSnapshot(inspectedBatch) && <span>历史日期：{inspectedBatch.date}</span>}
                  <span>{isImportedSnapshot(inspectedBatch) ? '入库于' : '保存于'} {snapshotTimeLabel(inspectedBatch)}</span><span>操作人：{inspectedBatch.operator}</span>
                  <span>{snapshotStatus(inspectedBatch)} · {inspectedBatch.products.length} 行</span>
                  {inspectedBatch.isCompetitivenessConfirmed && <span>落数日期：{inspectedBatch.competitivenessDate || inspectedBatch.date}</span>}
                </div>
                <div className="break-all font-mono text-[11px] text-[#777]">{inspectedBatch.id}</div>
              </div>
              {onDeleteBatch && inspectedBatch.id !== 'TRACK-20260524-INIT' && (
                <button type="button" onClick={() => onDeleteBatch(inspectedBatch.id)} className="flex items-center gap-1 py-1 text-xs text-[#777] hover:text-red-700"><Trash2 className="h-3.5 w-3.5" /> 删除快照</button>
              )}
            </div>
            {(inspectedBatch.investmentRateMetrics || inspectedBatch.subsidyFileName) && (
              <details className="mt-3 border-t border-[#141414]/15 pt-2 text-xs">
                <summary data-tour="history-sources" className="w-fit cursor-pointer text-[#555]">保存时投入测算与来源</summary>
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
                  {inspectedBatch.investmentRateMetrics && <>
                    <span>预估投入 <strong>{formatRMB(inspectedBatch.investmentRateMetrics.estimatedInvestmentAmount)}</strong></span>
                    <span>安卓大盘投入费率 <strong>{formatPercent(inspectedBatch.investmentRateMetrics.androidOverallRate)}</strong></span>
                    <span>换新渠道投入费率 <strong>{formatPercent(inspectedBatch.investmentRateMetrics.androidJdTradeInRate)}</strong></span>
                  </>}
                  {inspectedBatch.subsidyFileName && <span className="break-all">补贴文件：{inspectedBatch.subsidyFileName}</span>}
                </div>
              </details>
            )}
          </div>

          {showComparison && canCompare && comparisonBatch ? (
            <div className="min-w-0 border border-[#141414] bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#141414] bg-[#F0EFEC] p-3">
                <label className="flex min-w-0 flex-wrap items-center gap-2 text-xs font-bold">对比基准
                  <select value={comparisonBatch.id} onChange={event => setComparisonBatchId(event.target.value)} className="max-w-full border border-[#141414] bg-white px-2 py-1.5 text-xs">
                    {detailBatches.filter(batch => batch.id !== inspectedId).map(batch => <option key={batch.id} value={batch.id}>{listTimeLabel(batch)} · {snapshotRemark(batch) || batch.id}</option>)}
                  </select>
                </label>
                <button type="button" className={buttonClass} onClick={() => setShowComparison(false)}>返回快照明细</button>
              </div>
              <div className="p-3 text-xs text-[#555]">差额 = 当前快照 − 对比基准；按 PPV、商品SKUID 和等级匹配。</div>
              <div className="max-h-[560px] overflow-auto">
                <table className="w-full min-w-[1050px] border-collapse text-xs">
                  <thead className="sticky top-0 bg-[#F0EFEC] text-left"><tr>{['旧机型号 / PPV', 'SKU / 等级', '匹配情况', '基准追后价', '当前追后价', '价格差额', '基准边际', '当前边际', '边际差(pp)'].map(label => <th key={label} className="border-y border-[#141414]/30 px-3 py-2">{label}</th>)}</tr></thead>
                  <tbody>{comparisonRows.map(row => (
                    <tr key={row.key} className="border-b border-[#141414]/15 hover:bg-[#F0EFEC]/60">
                      <td className="max-w-[300px] px-3 py-2"><strong>{row.product.oldModel || row.product.model}</strong><div className="mt-1 break-all font-mono text-[11px] text-[#555]">{row.product.ppv}</div></td>
                      <td className="px-3 py-2 font-mono">{row.product.skuId || '—'} / {row.product.levelId || '—'}</td>
                      <td className="px-3 py-2">{row.presence}</td>
                      <td className="px-3 py-2 text-right font-mono">{moneyText(row.priceA)}</td>
                      <td className="px-3 py-2 text-right font-mono font-bold">{moneyText(row.priceB)}</td>
                      <td className={`px-3 py-2 text-right font-mono ${(row.priceDiff || 0) > 0 ? 'text-green-700' : (row.priceDiff || 0) < 0 ? 'text-red-700' : ''}`}>{row.priceDiff !== null && row.priceDiff > 0 ? '+' : ''}{moneyText(row.priceDiff)}</td>
                      <td className="px-3 py-2 text-right font-mono">{marginText(row.marginA)}</td>
                      <td className="px-3 py-2 text-right font-mono">{marginText(row.marginB)}</td>
                      <td className="px-3 py-2 text-right font-mono">{row.marginDiff === null ? '—' : `${row.marginDiff > 0 ? '+' : ''}${(row.marginDiff * 100).toFixed(2)}`}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          ) : hasSnapshotDetails(inspectedBatch) ? (
            <div key={inspectedBatch.id}><SnapshotTable batch={inspectedBatch} /></div>
          ) : (
            <div className="border border-[#141414] bg-white p-6">
              <div className="mb-5 text-center">
                <h3 className="text-sm font-bold">{inspectedBatch.isSummaryOnly ? '本期仅保存了竞争力汇总' : '这份快照没有商品明细'}</h3>
                <p className="mt-2 text-xs text-[#555]">没有 PPV 明细，无法还原工作台表格。</p>
              </div>
              {inspectedBatch.competitivenessMetrics && (
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                  {[
                    ['天猫物品价竞争力', inspectedBatch.competitivenessMetrics.tmItemScore],
                    ['天猫到手价竞争力', inspectedBatch.competitivenessMetrics.tmDirectScore],
                    ['转转物品价竞争力', inspectedBatch.competitivenessMetrics.zzItemScore],
                    ['AHS补贴后 vs 转转到手价', inspectedBatch.competitivenessMetrics.ahsVsZzDirectScore],
                    ['AHS补贴后 vs TM回收商补贴后', inspectedBatch.competitivenessMetrics.ahsVsTmRecyclerScore],
                    ['京东到手价 vs 转转到手价', inspectedBatch.competitivenessMetrics.jdVsZzDirectScore]
                  ].map(([label, value]) => <div key={String(label)} className="border border-[#141414]/30 bg-[#F0EFEC] p-3"><div className="text-xs text-[#555]">{label}</div><div className="mt-1 font-mono text-lg font-bold">{scoreText(value as number | null | undefined)}</div></div>)}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
