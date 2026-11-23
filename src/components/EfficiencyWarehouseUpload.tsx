import React, { useEffect, useState } from 'react';

interface DaySummary { day: string; rowCount: number; quotes: number; submissions: number; fileName?: string; }
interface PreviewDay extends DaySummary { previous: DaySummary | null; }
interface Preview { revision: string; duplicate: boolean; days: PreviewDay[]; }
const count = (n: number) => n.toLocaleString('zh-CN');

export default function EfficiencyWarehouseUpload({ onImported }: { onImported: () => void }) {
  const [days, setDays] = useState<DaySummary[]>([]);
  const [file, setFile] = useState<{ fileName: string; fileBase64: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [complete, setComplete] = useState(false), [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const request = async (url: string, body?: object) => {
    const response = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || '请求失败');
    return result.data;
  };
  useEffect(() => { let active = true; request('/api/competition-efficiency/warehouse').then(data => { if (active) setDays(data.days); }).catch(e => { if (active) setMessage(e.message); }); return () => { active = false; }; }, []);
  const choose = async (selected?: File) => {
    setPreview(null); setFile(null); setComplete(false); setReplace(false); setMessage('');
    if (!selected) return;
    if (selected.size > 18 * 1024 * 1024) { setMessage('文件超过18MB，请按日期分批上传'); return; }
    setBusy(true);
    try {
      const fileBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('读取文件失败')); reader.readAsDataURL(selected);
      });
      const input = { fileName: selected.name, fileBase64 };
      const result = await request('/api/competition-efficiency/warehouse/preview', input);
      setFile(input); setPreview(result);
    } catch (e) { setMessage(e instanceof Error ? e.message : '文件读取失败'); }
    finally { setBusy(false); }
  };
  const importFile = async () => {
    if (!file || !preview) return;
    setBusy(true); setMessage('');
    try {
      const result = await request('/api/competition-efficiency/warehouse/import', { ...file, revision: preview.revision, completeDays: complete, replaceDates: replace });
      setDays(result.summary.days); setPreview(null); setFile(null);
      setMessage(result.duplicate ? '该文件已入仓，未重复累计。' : '已入仓，分析已按小时覆盖期重新计算。');
      onImported();
    } catch (e) { setMessage(e instanceof Error ? e.message : '入仓失败'); }
    finally { setBusy(false); }
  };
  const conflicts = preview?.days.some(d => d.previous);
  return <section className="mb-5 border border-[#141414] bg-white p-5 text-[#141414]">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-sm font-bold">京东换新 · 小时数据仓</h2><p className="mt-2 text-xs leading-6 text-black/65">快照保存时间向上取整到整点，含开始、不含结束；A等级价位段对应提交A等级价位段（统一）。</p><p className="text-xs leading-6 text-black/65">{days.length ? `已累计 ${days.length} 天 · ${days[0].day} — ${days.at(-1)!.day} · 报价 ${count(days.reduce((sum, d) => sum + d.quotes, 0))}` : '尚未上传小时数据；上传历史数据后自动生成完整覆盖期。'}</p></div>
      <label className="min-w-0 text-xs font-bold">上传历史数据（Excel，≤18MB）<input aria-label="上传京东换新小时数据" type="file" accept=".xlsx,.xls" disabled={busy} onChange={e => { void choose(e.target.files?.[0]); e.target.value = ''; }} className="mt-2 block max-w-full text-xs file:mr-3 file:border file:border-black file:bg-white file:px-3 file:py-3 file:text-xs disabled:opacity-50" /></label></div>
    {preview && <div className="mt-4 border-t border-black/25 pt-4"><p className="mb-3 break-all text-xs font-bold">待入仓：{file?.fileName}{preview.duplicate ? ' · 相同文件已入仓' : ''}</p><div className="max-h-64 overflow-auto"><table className="w-full min-w-[520px] text-left text-xs"><thead className="bg-[#F0EFEC]"><tr>{['日期', '行数', '报价量', '提交量', '入仓方式'].map(h => <th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{preview.days.map(d => <tr key={d.day} className="border-b border-black/15"><td className="p-2">{d.day}</td><td className="p-2">{count(d.rowCount)}</td><td className="p-2">{count(d.quotes)}</td><td className="p-2">{count(d.submissions)}</td><td className="p-2">{d.previous ? `整日替换（原报价 ${count(d.previous.quotes)} / 提交 ${count(d.previous.submissions)}）` : '新增日期'}</td></tr>)}</tbody></table></div>
      <label className="mt-3 flex min-h-11 items-center gap-2 text-xs"><input type="checkbox" checked={complete} onChange={e => setComplete(e.target.checked)} />确认所列日期均为全天完整导出，包含竞争与非竞争型号；日期已结束。</label>
      {conflicts && <label className="flex min-h-11 items-center gap-2 text-xs"><input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} />确认替换已有日期的全部数据；保留原文件及旧版本，不与旧数据叠加。</label>}
      <button type="button" disabled={busy || !complete || (!!conflicts && !replace)} onClick={() => void importFile()} className="mt-2 min-h-11 border border-black bg-black px-4 text-xs font-bold text-white hover:bg-[#333] disabled:cursor-not-allowed disabled:opacity-40">{busy ? '处理中…' : '确认入仓并重算'}</button></div>}
    <div role="status" aria-live="polite" className="mt-2 text-xs leading-6">{busy ? '正在校验数据，请稍候…' : message}</div>
    {days.length > 0 && <details className="mt-2 text-xs"><summary className="cursor-pointer py-2 font-bold">已入仓日期与来源</summary><div className="max-h-56 overflow-auto"><table className="w-full min-w-[480px] text-left"><thead><tr>{['日期', '报价 / 提交', '来源文件'].map(h => <th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{[...days].reverse().map(d => <tr key={d.day} className="border-t border-black/15"><td className="p-2">{d.day}</td><td className="p-2">{count(d.quotes)} / {count(d.submissions)}</td><td className="p-2">{d.fileName}</td></tr>)}</tbody></table></div></details>}
  </section>;
}
