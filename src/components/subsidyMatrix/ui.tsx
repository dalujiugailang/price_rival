import React, {useEffect, useRef} from 'react';
import {ratioText, metricAmount, valueLabel, type SubsidyMetric} from './heatmapStyle';
import type {MatrixRule} from './types';

export const money = (value: number) => Number.isFinite(value) ? value.toLocaleString('zh-CN', {maximumFractionDigits: 2}) : '—';
export const percent = (value: number) => Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : '待核验';
export const riskClass = (risk?: string) => risk === '亏损风险' ? 'text-red-700' : risk === '低利润风险' ? 'text-amber-800' : risk === '正常' ? 'text-green-700' : 'text-[#777]';
export const ruleLabel = (rule: MatrixRule) => `原门槛 ${money(rule.threshold)} · 京东 ${money(rule.jd)} · AHS ${money(rule.ahs)}（工作台规则 #${rule.sourceIndex}）`;
export const deltaLabel = (delta: number) => delta > 0 ? `多 ${money(delta)} 元` : delta < 0 ? `少 ${money(-delta)} 元` : '相同';
export const button = 'border border-[#141414] bg-white px-3 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40';
export const input = 'min-w-0 border border-[#141414] bg-white px-2 py-2 text-xs';

export function RuleTable({rules, highlightedIds = [], showRatio = false, metric = 'ahs'}: {rules: MatrixRule[]; highlightedIds?: string[]; showRatio?: boolean; metric?: SubsidyMetric}) {
  const ref = useRef<HTMLDivElement>(null);
  const highlighted = new Set(highlightedIds);
  useEffect(() => {
    const frame = requestAnimationFrame(() => ref.current?.querySelector('[data-highlighted="true"]')?.scrollIntoView({block: 'center'}));
    return () => cancelAnimationFrame(frame);
  }, [highlightedIds.join('|')]);
  return <div ref={ref} className="sm-detail-scroll"><table className="sm-detail-table" data-ratio={showRatio}>
    <thead><tr>{['新机系列', '原始门槛', '京东总补贴（含京东券）', '爱回收承担', ...(showRatio ? [valueLabel(metric, 'ratio')] : [])].map(title => <th key={title}>{title}</th>)}</tr></thead>
    <tbody>{rules.map((rule, index) => {
      const active = highlighted.has(rule.id);
      return <tr key={rule.id} data-highlighted={active ? 'true' : 'false'} className={active ? `sm-rule-highlight ${!highlighted.has(rules[index - 1]?.id) ? 'sm-rule-first' : ''} ${!highlighted.has(rules[index + 1]?.id) ? 'sm-rule-last' : ''}` : ''}>
        <td><strong className="sm-rule-series">{rule.series}</strong><small>工作台规则 #{rule.sourceIndex}</small>{rule.sourceRow !== null && <small>原表第 {rule.sourceRow} 行</small>}</td>
        <td>{money(rule.threshold)}{active && !highlighted.has(rules[index - 1]?.id) && <small className="font-bold">选中档位</small>}</td><td>{money(rule.jd)}</td><td>{money(rule.ahs)}</td>{showRatio && <td>{rule.threshold > 0 && metricAmount(rule, metric) !== null ? ratioText(metricAmount(rule, metric)! / rule.threshold) : '待核验'}</td>}
      </tr>;
    })}</tbody>
  </table></div>;
}

export function DetailDialog({title, children, onClose}: {title: string; children: React.ReactNode; onClose: () => void}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {const dialog = ref.current; if (!dialog?.open) dialog?.showModal(); return () => {if (dialog?.open) dialog.close();};}, []);
  return <dialog ref={ref} className="sm-dialog" aria-label={title} onCancel={onClose} onClick={event => {if (event.target === event.currentTarget) onClose();}}>
    <div className="sm-dialog-heading"><h3 className="text-sm font-black">{title}</h3><button autoFocus className={button} onClick={onClose} aria-label="关闭详情">关闭 ×</button></div>
    {children}
  </dialog>;
}
