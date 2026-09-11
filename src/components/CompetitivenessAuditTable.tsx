/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Info } from 'lucide-react';
import { CalculatedProduct, CompetitivenessMetrics } from '../types';
import {
  buildCompetitivenessAudit,
  CompetitivenessAuditBrand,
  CompetitivenessAuditSeries,
  TM_SUBSIDY_CARRY_GAP_LABEL
} from '../utils/competitivenessAudit';

interface Props {
  products: CalculatedProduct[];
  isSummaryOnly?: boolean;
  revealIssueDetails?: boolean;
}

type AuditRow = CompetitivenessAuditBrand | CompetitivenessAuditSeries;

const volumeFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 });
const moneyFormatter = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
});

const SCORE_CELL_CLASS = 'border-l border-[#141414]/20 px-2 py-2.5 text-right align-middle font-mono text-[12px] whitespace-nowrap';

const formatScore = (value: number | null | undefined) => (
  value === null || value === undefined || !Number.isFinite(value) ? '—' : `${value.toFixed(1)}%`
);

const formatGap = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(1)}pp`;

const formatMoney = (value: number | null) => (
  value === null ? '—' : `¥${moneyFormatter.format(value)}`
);

const formatSignedMoney = (value: number | null) => {
  if (value === null) return '—';
  const absolute = moneyFormatter.format(Math.abs(value));
  if (value > 0) return `+¥${absolute}`;
  if (value < 0) return `-¥${absolute}`;
  return '¥0';
};

const formatVolume = (value: number | null) => (
  value === null ? '—' : volumeFormatter.format(value)
);

const gapTextClass = (value: number | null) => {
  if (value === null || value === 0) return 'text-stone-500';
  return value > 0 ? 'text-emerald-700' : 'text-rose-700';
};

function ScoreCell({ value, className = 'font-medium' }: { value: number | null | undefined; className?: string }) {
  return <td className={`${SCORE_CELL_CLASS} ${className}`}>{formatScore(value)}</td>;
}

function GapCell({ row }: { row: AuditRow }) {
  const value = row.tmSubsidyCarryGap;
  const emphasis = value >= 30
    ? 'font-black text-red-900'
    : value >= 10
      ? 'font-bold text-red-800'
      : value > 0
        ? 'font-semibold text-red-700'
        : 'font-medium text-stone-500';
  return (
    <td
      className={`${SCORE_CELL_CLASS} ${emphasis}`}
      title={`${TM_SUBSIDY_CARRY_GAP_LABEL} = 天猫物品价竞争力 - 天猫到手价竞争力`}
    >
      <span className="block">{formatGap(value)}</span>
      {row.hasTmCoverageMismatch ? (
        <span className="mt-1 inline-block border border-stone-400 bg-white px-1 py-0.5 font-sans text-[10px] font-normal leading-none text-stone-600">
          有效报价量不同
        </span>
      ) : null}
    </td>
  );
}

function ScopeLabel({ row, isSeries }: { row: AuditRow; isSeries: boolean }) {
  const label = isSeries ? (row as CompetitivenessAuditSeries).newSeries : (row as CompetitivenessAuditBrand).brand;
  return (
    <span className="min-w-0">
      <span className="block truncate text-left text-[13px] font-bold text-[#141414]" title={label}>{label}</span>
      <span className="mt-0.5 block truncate text-left text-[10px] font-normal text-stone-500" title={`${row.productCount} PPV · TM物品价有效报价量 ${volumeFormatter.format(row.tmItemEligibleQuoteVolume)}`}>
        {row.productCount} PPV · TM物品价有效报价量 {volumeFormatter.format(row.tmItemEligibleQuoteVolume)}
      </span>
    </span>
  );
}

function IssueSummary({ row, expanded, onToggle, isBrand = false }: {
  row: AuditRow;
  expanded?: boolean;
  onToggle?: () => void;
  isBrand?: boolean;
}) {
  if (row.issueProducts.length === 0) {
    return <td className={`${SCORE_CELL_CLASS} bg-[#F4F4F2] text-stone-400`}>—</td>;
  }

  const content = (
    <>
      <span className="block font-sans text-[13px] font-semibold leading-[1.25] text-stone-800">
        <span
          className={isBrand ? 'inline-block px-0.5' : undefined}
          style={isBrand ? {
            backgroundImage: 'linear-gradient(to bottom, transparent 48%, rgba(255, 235, 59, 0.58) 48%, rgba(255, 235, 59, 0.58) 90%, transparent 90%)'
          } : undefined}
        >
          {row.issueProducts.length}条 · 报价量{' '}
          <strong className="text-[14px] font-black text-stone-950">{volumeFormatter.format(row.issueQuoteVolume)}</strong>
        </span>
      </span>
      <span className="mt-1 block font-sans text-[11px] font-normal leading-[1.25] text-stone-500">
        占全品牌共同有效报价量 {row.issueQuoteVolumeShare.toFixed(1)}%
      </span>
      {!isBrand ? (
        <span className="mt-1 block font-sans text-[11px] font-semibold leading-[1.25] text-stone-700">
          点击查看详情 ›
        </span>
      ) : null}
    </>
  );

  return (
    <td className={`${SCORE_CELL_CLASS} bg-[#F4F4F2]`}>
      {onToggle ? (
        <button
          type="button"
          data-tour={isBrand ? undefined : 'audit-issues'} aria-expanded={expanded}
          onClick={onToggle}
          className="w-full text-right hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#141414]"
        >
          {content}
        </button>
      ) : content}
    </td>
  );
}

function PrimaryAndGapCells({ row }: { row: AuditRow }) {
  const metrics: CompetitivenessMetrics = row.metrics;
  return (
    <>
      <ScoreCell value={metrics.tmItemScore} className="bg-white font-semibold text-stone-800" />
      <ScoreCell value={metrics.tmDirectScore} className="bg-white font-black text-stone-950" />
      <GapCell row={row} />
    </>
  );
}

function ReferenceMetricCells({ metrics }: { metrics: CompetitivenessMetrics }) {
  return (
    <>
      <ScoreCell value={metrics.zzItemScore} className="bg-[#FAFAF9] font-normal text-stone-700" />
      <ScoreCell value={metrics.ahsVsZzDirectScore} className="bg-[#FAFAF9] font-normal text-stone-700" />
      <ScoreCell value={metrics.jdVsZzDirectScore} className="bg-[#FAFAF9] text-stone-800" />
    </>
  );
}

export default function CompetitivenessAuditTable({ products, isSummaryOnly = false, revealIssueDetails = false }: Props) {
  const auditRows = useMemo(() => buildCompetitivenessAudit(products), [products]);
  const [showReferenceMetrics, setShowReferenceMetrics] = useState(false);
  const [expandedBrands, setExpandedBrands] = useState<Set<string>>(() => new Set());
  const [expandedSeries, setExpandedSeries] = useState<Set<string>>(() => new Set());
  const visibleColumnCount = showReferenceMetrics ? 8 : 5;
  // Keep a user's open issue in view, or reveal the first available issue for the tour.
  // Deriving this from the current scope also handles direct step selection and filtering.
  const revealedBrand = revealIssueDetails
    ? auditRows.find(brand => expandedBrands.has(brand.key)
      && brand.series.some(series => expandedSeries.has(series.key) && series.issueProducts.length > 0))
      ?? auditRows.find(brand => brand.issueProducts.length > 0)
    : undefined;
  const revealedSeries = revealedBrand?.series.find(series => expandedSeries.has(series.key) && series.issueProducts.length > 0)
    ?? revealedBrand?.series.find(series => series.issueProducts.length > 0);

  const toggleBrand = (brand: string) => {
    setExpandedBrands(current => {
      const next = new Set(current);
      if (next.has(brand)) next.delete(brand);
      else next.add(brand);
      return next;
    });
  };

  const toggleSeries = (seriesKey: string) => {
    setExpandedSeries(current => {
      const next = new Set(current);
      if (next.has(seriesKey)) next.delete(seriesKey);
      else next.add(seriesKey);
      return next;
    });
  };

  if (auditRows.length === 0) {
    return (
      <div className="p-8 text-center text-xs text-stone-400">
        {isSummaryOnly
          ? '该记录为历史竞争力纯落数，只保存汇总分数，无PPV明细，无法下钻品牌与新机系列。'
          : '本批次中尚未关联到任何有效商品。'}
      </div>
    );
  }

  return (
    <div>
      <div className="w-full overflow-hidden">
        <table className="w-full table-fixed border-collapse text-left text-[13px]">
          <colgroup>
            {showReferenceMetrics ? (
              <>
                <col className="w-[21%]" />
                <col className="w-[10%]" />
                <col className="w-[12%]" />
                <col className="w-[10%]" />
                <col className="w-[14%]" />
                <col className="w-[10%]" />
                <col className="w-[12%]" />
                <col className="w-[11%]" />
              </>
            ) : (
              <>
                <col className="w-[28%]" />
                <col className="w-[15%]" />
                <col className="w-[16%]" />
                <col className="w-[14%]" />
                <col className="w-[27%]" />
              </>
            )}
          </colgroup>
          <thead>
            <tr className="border-b border-[#141414] bg-[#D8D7D2] text-[11px] font-black tracking-wide text-[#141414]">
              <th rowSpan={2} className="border-r border-[#141414] bg-[#D8D7D2] px-2 py-2">品牌 / 新机系列</th>
              <th colSpan={2} className="border-r border-[#141414] px-2 py-2 text-center">主要指标</th>
              <th colSpan={2} className={`relative px-2 py-2 text-center ${showReferenceMetrics ? 'border-r border-[#141414]' : ''}`}>
                补贴归因
                {!showReferenceMetrics ? (
                  <button
                    type="button"
                    aria-expanded={false}
                    onClick={() => setShowReferenceMetrics(true)}
                    className="absolute right-1.5 top-1.5 border border-[#141414] bg-white px-1.5 py-0.5 text-[9px] font-bold tracking-normal text-stone-700 hover:bg-[#FFF7A8] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#141414]"
                    title="展开三项参考指标"
                  >
                    参考指标 3项 ›
                  </button>
                ) : null}
              </th>
              {showReferenceMetrics ? (
                <th colSpan={3} className="relative px-2 py-2 text-center">
                  参考指标
                  <button
                    type="button"
                    aria-expanded={true}
                    onClick={() => setShowReferenceMetrics(false)}
                    className="absolute right-1.5 top-1.5 border border-[#141414] bg-white px-1.5 py-0.5 text-[9px] font-bold tracking-normal text-stone-700 hover:bg-stone-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#141414]"
                    title="收起三项参考指标"
                  >
                    收起 ‹
                  </button>
                </th>
              ) : null}
            </tr>
            <tr className="border-b border-[#141414] bg-[#ECEBE8] text-[10px] font-bold leading-[1.2] text-stone-700">
              <th className="break-words border-r border-[#141414]/25 px-1.5 py-2 text-center">天猫物品价<br />竞争力</th>
              <th className="break-words border-r border-[#141414] px-1.5 py-2 text-center">天猫到手价<br />竞争力</th>
              <th className="break-words border-r border-[#141414]/25 px-1.5 py-2 text-center" title="天猫物品价竞争力 - 天猫到手价竞争力">{TM_SUBSIDY_CARRY_GAP_LABEL}</th>
              <th className="break-words border-r border-[#141414] px-1.5 py-2 text-center">补贴问题明细</th>
              {showReferenceMetrics ? (
                <>
                  <th className="break-words border-r border-[#141414]/25 px-1.5 py-2 text-center">转转物品价<br />竞争力</th>
                  <th className="break-words border-r border-[#141414]/25 px-1.5 py-2 text-center">物品价+AHS补贴<br />vs 转转到手价</th>
                  <th className="break-words px-1.5 py-2 text-center">京东到手价<br />vs 转转到手价</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {auditRows.map(brandRow => {
              const brandExpanded = expandedBrands.has(brandRow.key) || revealedBrand?.key === brandRow.key;
              return (
                <React.Fragment key={brandRow.key}>
                  <tr className="border-b border-[#141414]/40 bg-white hover:bg-stone-50" data-audit-level="brand">
                    <td className="border-r border-[#141414] bg-white px-2 py-2.5 align-middle">
                      <button
                        type="button"
                        data-tour="audit-brand" aria-expanded={brandExpanded}
                        onClick={() => toggleBrand(brandRow.key)}
                        className="flex w-full items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#141414]"
                      >
                        {brandExpanded
                          ? <ChevronDown className="h-4 w-4 shrink-0" />
                          : <ChevronRight className="h-4 w-4 shrink-0" />}
                        <ScopeLabel row={brandRow} isSeries={false} />
                        <span className="ml-auto shrink-0 border border-[#141414] bg-[#141414] px-1.5 py-0.5 text-[10px] font-bold text-white">
                          {brandRow.series.length}系列
                        </span>
                      </button>
                    </td>
                    <PrimaryAndGapCells row={brandRow} />
                    <IssueSummary
                      row={brandRow}
                      expanded={brandExpanded}
                      onToggle={() => toggleBrand(brandRow.key)}
                      isBrand
                    />
                    {showReferenceMetrics ? <ReferenceMetricCells metrics={brandRow.metrics} /> : null}
                  </tr>

                  {brandExpanded ? brandRow.series.map(seriesRow => {
                    const seriesExpanded = expandedSeries.has(seriesRow.key) || revealedSeries?.key === seriesRow.key;
                    return (
                      <React.Fragment key={seriesRow.key}>
                        <tr className="border-b border-[#141414]/20 bg-[#F9F9F8] hover:bg-stone-100" data-audit-level="series">
                          <td className="border-r border-[#141414] bg-[#F9F9F8] px-2 py-2.5 pl-6 align-middle">
                            <div className="flex items-center gap-2">
                              <span className="h-px w-3 shrink-0 bg-[#141414]/40" />
                              <ScopeLabel row={seriesRow} isSeries />
                            </div>
                          </td>
                          <PrimaryAndGapCells row={seriesRow} />
                          <IssueSummary
                            row={seriesRow}
                            expanded={seriesExpanded}
                            onToggle={seriesRow.issueProducts.length > 0 ? () => toggleSeries(seriesRow.key) : undefined}
                          />
                          {showReferenceMetrics ? <ReferenceMetricCells metrics={seriesRow.metrics} /> : null}
                        </tr>

                        {seriesExpanded && seriesRow.issueProducts.length > 0 ? (
                          <tr className="border-b border-[#141414] bg-[#F7F7F5]" data-audit-level="sku">
                            <td colSpan={visibleColumnCount} data-tour="audit-issue-details" className="scroll-mt-4 px-3 py-2.5">
                              <div className="border border-[#141414] bg-white">
                                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#141414] bg-[#E2E1DE] px-3 py-2">
                                  <div className="flex items-center gap-2 font-bold text-stone-900">
                                    <AlertTriangle className="h-4 w-4" />
                                    {brandRow.brand} / {seriesRow.newSeries} · 补贴问题明细
                                  </div>
                                  <span className="text-[11px] text-stone-600">仅列出：天猫物品价胜出，但天猫到手价未胜出</span>
                                </div>
                                <div className="w-full overflow-hidden">
                                  <table className="w-full table-fixed border-collapse text-[10px]">
                                    <colgroup>
                                      <col style={{ width: '22%' }} />
                                      <col style={{ width: '6%' }} />
                                      <col style={{ width: '6%' }} />
                                      <col style={{ width: '6.5%' }} />
                                      <col style={{ width: '6.5%' }} />
                                      <col style={{ width: '7%' }} />
                                      <col style={{ width: '7.5%' }} />
                                      <col style={{ width: '9.5%' }} />
                                      <col style={{ width: '7%' }} />
                                      <col style={{ width: '6.5%' }} />
                                      <col style={{ width: '6.5%' }} />
                                      <col style={{ width: '8%' }} />
                                    </colgroup>
                                    <thead className="border-b border-[#141414]/40 text-[10px] leading-tight text-stone-700">
                                      <tr className="bg-[#D8D7D2] font-bold text-stone-900">
                                        <th className="border-r border-[#141414] px-2 py-1.5 text-left">识别信息</th>
                                        <th colSpan={2} className="border-r border-[#141414] px-1 py-1.5 text-center">业务规模</th>
                                        <th colSpan={3} className="border-r border-[#141414] px-1 py-1.5 text-center">物品价对比</th>
                                        <th colSpan={3} className="border-r border-[#141414] px-1 py-1.5 text-center">补贴投入对比</th>
                                        <th colSpan={3} className="px-1 py-1.5 text-center">到手价对比</th>
                                      </tr>
                                      <tr className="bg-[#ECEBE8] text-[9px] font-semibold">
                                        <th className="border-r border-[#141414] px-2 py-1.5 text-left">PPV</th>
                                        <th className="px-1 py-1.5 text-right">近30天<br />报价量</th>
                                        <th className="border-r border-[#141414] px-1 py-1.5 text-right">近30天<br />成交量</th>
                                        <th className="px-1 py-1.5 text-right" title="追价后京东物品价">JD裸机价</th>
                                        <th className="px-1 py-1.5 text-right">TM裸机价</th>
                                        <th className="border-r border-[#141414] px-1 py-1.5 text-right">物品价差<br />JD−TM</th>
                                        <th className="px-1 py-1.5 text-right">对应新品型号<br />JD总投入</th>
                                        <th className="px-1 py-1.5 text-right">tm总补贴-人工</th>
                                        <th className="border-r border-[#141414] px-1 py-1.5 text-right">补贴差<br />JD−TM</th>
                                        <th className="px-1 py-1.5 text-right" title="追价后京东总到手价">JD总到手价</th>
                                        <th className="px-1 py-1.5 text-right">TM总到手价</th>
                                        <th className="px-1 py-1.5 text-right">到手价差<br />JD−TM</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-stone-200 bg-white">
                                      {seriesRow.issueProducts.map(issue => (
                                        <tr key={issue.key} className="group hover:bg-[#FAFAF9]">
                                          <td className="truncate border-r border-[#141414] px-2 py-1.5 font-mono font-semibold text-stone-900" title={issue.ppv}>{issue.ppv || '—'}</td>
                                          <td className="whitespace-nowrap px-1 py-1.5 text-right font-mono text-stone-700">{formatVolume(issue.quoteVolume)}</td>
                                          <td className="whitespace-nowrap border-r border-[#141414] px-1 py-1.5 text-right font-mono text-stone-700">{formatVolume(issue.soldVolume)}</td>
                                          <td className="whitespace-nowrap px-1 py-1.5 text-right font-mono text-stone-700">{formatMoney(issue.jdItemPrice)}</td>
                                          <td className="whitespace-nowrap px-1 py-1.5 text-right font-mono text-stone-700">{formatMoney(issue.tmItemPrice)}</td>
                                          <td className={`whitespace-nowrap border-r border-[#141414] px-1 py-1.5 text-right font-mono font-semibold ${gapTextClass(issue.itemPriceGap)}`}>
                                            {formatSignedMoney(issue.itemPriceGap)}
                                          </td>
                                          <td className="whitespace-nowrap px-1 py-1.5 text-right font-mono text-stone-700">{formatMoney(issue.jdInvestment)}</td>
                                          <td className="whitespace-nowrap px-1 py-1.5 text-right font-mono text-stone-700">{formatMoney(issue.tmManualSubsidy)}</td>
                                          <td className={`whitespace-nowrap border-r border-[#141414] px-1 py-1.5 text-right font-mono font-semibold ${gapTextClass(issue.subsidyGap)}`}>
                                            {formatSignedMoney(issue.subsidyGap)}
                                          </td>
                                          <td className="whitespace-nowrap px-1 py-1.5 text-right font-mono text-stone-700">{formatMoney(issue.jdHandPrice)}</td>
                                          <td className="whitespace-nowrap px-1 py-1.5 text-right font-mono text-stone-700">{formatMoney(issue.tmHandPrice)}</td>
                                          <td className={`whitespace-nowrap px-1 py-1.5 text-right font-mono font-semibold ${gapTextClass(issue.handPriceGap)}`}>
                                            {formatSignedMoney(issue.handPriceGap)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </React.Fragment>
                    );
                  }) : null}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2 border-t border-[#141414] bg-[#F9F9F8] p-3.5 text-[12px] text-[#141414]/80">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-stone-700" />
        <div>
          <span className="font-bold text-stone-900">口径：</span>
          品牌和新机系列均按天猫物品价竞争力从高到低排序；表内竞争力沿用原口径，按PPV近30天报价量加权。
          <strong className="mx-1">{TM_SUBSIDY_CARRY_GAP_LABEL}</strong>
          = 天猫物品价竞争力 − 天猫到手价竞争力，正值越大表示到手价竞争力越没有承接物品价优势；问题报价占比统一使用当前选定数据中全部品牌的TM共同有效报价量作为分母。
        </div>
      </div>
    </div>
  );
}
