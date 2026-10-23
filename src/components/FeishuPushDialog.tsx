import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Image as ImageIcon, Search, Send, UserRound, Users, X } from 'lucide-react';
import { TrackingBatch, ChannelId } from '../types';
import {
  FeishuTarget, FeishuDelivery, listTrackingBatches, feishuPushConfig, searchFeishuTargets,
  prepareFeishuPush, previewFeishuPush, sendFeishuPush, feishuPushHistory
} from '../api';
import { sortSnapshots, snapshotTimeLabel } from '../utils/snapshotHistory';
import { captureCompetitivenessTracker } from '../utils/captureCompetitivenessTracker';
import { listCompetitivenessBrands, listCompetitivenessSeries } from '../utils/brandCompetitiveness';
import FeishuIcon from './FeishuIcon';

const statusLabel = (status: string) => ({
  sent: '已发送', failed: '发送失败', unknown: '状态待核查，请勿重复发送', sending: '发送中／待核查'
}[status] || status);
const control = 'h-9 w-full min-w-0 border border-[#141414] bg-white px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#141414] disabled:cursor-not-allowed disabled:bg-[#F0EFEC] disabled:opacity-50';
const button = 'inline-flex items-center justify-center gap-1.5 border border-[#141414] bg-white px-3 py-2 text-xs font-bold hover:bg-[#E4E3E0] disabled:cursor-not-allowed disabled:opacity-40';
const label = 'flex min-w-0 flex-col gap-1.5 text-xs font-bold';

export default function FeishuPushDialog({ batches, channelId, onClose }: {
  batches: TrackingBatch[]; channelId: ChannelId; onClose: () => void;
}) {
  const [serverBatches, setServerBatches] = useState(batches);
  const [loadingBatches, setLoadingBatches] = useState(true);
  const candidates = useMemo(() => sortSnapshots(serverBatches), [serverBatches]);
  const [batchId, setBatchId] = useState(() => candidates[0]?.id || '');
  const [brand, setBrand] = useState('ALL');
  const [newSeries, setSeries] = useState('ALL_SERIES');
  const [type, setType] = useState<'user' | 'chat'>('user');
  const [query, setQuery] = useState('陈誉钧');
  const [targets, setTargets] = useState<FeishuTarget[]>([]);
  const [selected, setSelected] = useState<FeishuTarget[]>([]);
  const [searched, setSearched] = useState(false);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewFeishuPush>> | null>(null);
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [requiresLogin, setRequiresLogin] = useState(false);
  const [results, setResults] = useState<FeishuDelivery[]>([]);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof feishuPushHistory>>['deliveries']>([]);
  const inFlight = useRef(false);
  const searchVersion = useRef(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !inFlight.current) closeRef.current();
      if (event.key !== 'Tab') return;
      const nodes = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],summary'
      ) || []) as HTMLElement[];
      const first = nodes[0], last = nodes.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, []);

  useEffect(() => {
    let live = true;
    Promise.all([feishuPushConfig(channelId), feishuPushHistory(channelId), listTrackingBatches(channelId)])
      .then(([config, records, saved]) => {
        if (!live) return;
        setConfigured(config.configured);
        setHistory(records.deliveries);
        setServerBatches(saved.batches);
        setBatchId(sortSnapshots(saved.batches)[0]?.id || '');
        if (config.defaultRecipient) {
          setSelected(current => current.length ? current : [config.defaultRecipient!]);
          setTargets([config.defaultRecipient]);
        }
      }).catch(reason => {
        if (live) { setError(reason.message); setServerBatches([]); setBatchId(''); }
      }).finally(() => { if (live) setLoadingBatches(false); });
    return () => { live = false; };
  }, [channelId]);

  const batch = candidates.find(item => item.id === batchId);
  const canPreview = !!batch?.isCompetitivenessConfirmed && !batch.isSummaryOnly && !!batch.products?.length;
  const invalidate = () => { setPreview(null); setResults([]); };
  const run = async (task: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try { await task(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const search = () => run(async () => {
    const version = ++searchVersion.current;
    const response = await searchFeishuTargets(channelId, type, query);
    if (version !== searchVersion.current) return;
    setTargets(response.targets); setRequiresLogin(!!response.requiresLogin); setSearched(true);
  });
  const generatePreview = () => run(async () => {
    invalidate();
    const prepared = await prepareFeishuPush(channelId, batchId, { brand, newSeries });
    const image = await captureCompetitivenessTracker(prepared.batches, prepared.report);
    setPreview(await previewFeishuPush(channelId, batchId, { brand, newSeries }, prepared.report.digest, image));
  });
  const send = () => run(async () => {
    if (!preview) return;
    const response = await sendFeishuPush(channelId, preview.previewId, selected);
    setResults(response.results);
    setHistory((await feishuPushHistory(channelId)).deliveries);
  });

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#141414]/45 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="feishu-push-title">
    <div ref={dialogRef} tabIndex={-1} className="flex max-h-[92vh] w-full max-w-5xl flex-col border-2 border-[#141414] bg-white text-[#141414] outline-none">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#141414] bg-[#F0EFEC] px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center border border-[#141414] bg-white"><FeishuIcon className="h-6 w-6" /></span>
          <div><h2 id="feishu-push-title" className="text-base font-black">推送飞书</h2><p className="mt-0.5 text-[11px] text-[#666]">竞争力总结追踪器 · {channelId === 'tradeIn' ? '京东换新' : '京东自营'}</p></div>
        </div>
        <button type="button" disabled={busy} onClick={onClose} aria-label="关闭推送" className={`${button} h-8 w-8 !p-0`}><X className="h-4 w-4" /></button>
      </header>

      <div className="overflow-y-auto p-4 sm:p-5">
        <p className="mb-5 border-l-2 border-[#141414] bg-[#F9F9F8] px-3 py-2 text-[11px] leading-5 text-[#555]">默认选择历史最新保存批次。当前工作台如有调整，请先保存并确认竞争力，再生成截图。</p>
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="min-w-0 space-y-5">
            <section className="border border-[#141414]" aria-labelledby="push-scope-title">
              <h3 id="push-scope-title" className="flex items-center gap-2 border-b border-[#141414] bg-[#F0EFEC] px-3 py-2 text-xs font-black"><span className="border border-[#141414] bg-[#141414] px-1.5 py-0.5 text-[10px] text-white">01</span>选择推送范围</h3>
              <fieldset disabled={busy || loadingBatches} className="space-y-3 p-3">
                <label className={label}>历史批次<select aria-label="推送批次" className={control} value={batchId} onChange={event => { setBatchId(event.target.value); setBrand('ALL'); setSeries('ALL_SERIES'); invalidate(); }}><option value="" disabled>{loadingBatches ? '正在读取历史…' : '暂无可推送批次'}</option>{candidates.map(item => <option key={item.id} value={item.id}>{item.id === candidates[0]?.id ? '【历史最新】' : ''}{snapshotTimeLabel(item)} · {item.id}{item.isCompetitivenessConfirmed ? '' : '（未确认）'} · {item.remarks}</option>)}</select></label>
                <div className="grid grid-cols-2 gap-3">
                  <label className={label}>品牌<select aria-label="推送品牌" className={control} value={brand} onChange={event => { setBrand(event.target.value); setSeries('ALL_SERIES'); invalidate(); }}><option value="ALL">全部品牌</option>{listCompetitivenessBrands(batch ? [batch] : [], []).map(value => <option key={value}>{value}</option>)}</select></label>
                  <label className={label}>新机系列<select aria-label="推送新机系列" className={control} value={newSeries} disabled={channelId === 'selfOperated'} onChange={event => { setSeries(event.target.value); invalidate(); }}><option value="ALL_SERIES">全部新机系列</option>{listCompetitivenessSeries(batch ? [batch] : [], [], brand).map(value => <option key={value}>{value}</option>)}</select></label>
                </div>
              </fieldset>
              {!loadingBatches && batch && !canPreview && <p role="status" className="border-t border-[#141414]/20 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-900">{batch.isSummaryOnly ? '选中批次仅有汇总，没有追踪器明细。' : '选中批次尚未确认竞争力，请在历史中确认后重新打开推送。'}不会自动改发更早批次。</p>}
            </section>

            <section className="border border-[#141414]" aria-labelledby="push-targets-title">
              <h3 id="push-targets-title" className="flex items-center gap-2 border-b border-[#141414] bg-[#F0EFEC] px-3 py-2 text-xs font-black"><span className="border border-[#141414] bg-[#141414] px-1.5 py-0.5 text-[10px] text-white">02</span>选择接收对象<span className="ml-auto text-[10px] font-normal text-[#666]">已选 {selected.length} / 20</span></h3>
              <div className="space-y-3 p-3">
                <div className="flex flex-wrap gap-2">
                  <select aria-label="接收对象类型" disabled={busy || loadingBatches} className={`${control} !w-24`} value={type} onChange={event => { setType(event.target.value as 'user' | 'chat'); setTargets([]); setRequiresLogin(false); setSearched(false); searchVersion.current++; }}><option value="user">人员</option><option value="chat">飞书群</option></select>
                  <input aria-label="搜索接收人" disabled={busy || loadingBatches || type === 'chat'} className={`${control} !w-0 flex-1`} value={query} onChange={event => setQuery(event.target.value)} placeholder="姓名或飞书账号 ID" />
                  <button type="button" disabled={busy || loadingBatches} className={button} onClick={() => void search()}><Search className="h-3.5 w-3.5" />{type === 'chat' ? '获取群' : '搜索'}</button>
                </div>
                {requiresLogin && <p className="text-[11px] leading-5 text-amber-800">搜索范围可能不完整，<a className="font-bold underline" href={`/api/auth/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`}>重新飞书登录</a>后重试。</p>}
                <div className="max-h-36 space-y-2 overflow-auto">
                  {targets.map(target => {
                    const added = selected.some(item => item.id === target.id && item.type === target.type);
                    return <button type="button" key={target.type + target.id} disabled={busy || added || selected.length >= 20} onClick={() => setSelected(current => [...current, target])} className="flex w-full items-start gap-2 border border-[#141414]/30 bg-[#F9F9F8] px-2.5 py-2 text-left hover:border-[#141414] disabled:cursor-default">
                      {added ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <span className="text-sm leading-4">＋</span>}
                      <span className="min-w-0"><span className="block text-xs font-bold">{target.name}<span className="ml-2 font-normal text-[#666]">{target.department}</span></span><span className="mt-1 block break-all font-mono text-[10px] text-[#777]">{target.id}</span></span>
                    </button>;
                  })}
                  {searched && !targets.length && <p className="border border-dashed border-[#141414]/30 px-3 py-4 text-center text-[11px] text-[#666]">{type === 'chat' ? '暂未找到机器人所在的群' : '未找到匹配的人员'}</p>}
                </div>
                <div className="border-t border-[#141414]/20 pt-3">
                  <p className="mb-2 text-[10px] font-bold text-[#666]">本次接收对象</p>
                  <div className="flex flex-wrap gap-2">{selected.map(target => <button type="button" disabled={busy} key={target.type + target.id} onClick={() => setSelected(current => current.filter(item => item !== target))} aria-label={`移除${target.name}`} className="inline-flex items-center gap-1.5 border border-[#141414] bg-[#141414] px-2 py-1.5 text-xs font-bold text-white disabled:opacity-50">{target.type === 'chat' ? <Users className="h-3 w-3" /> : <UserRound className="h-3 w-3" />}{target.name}<X className="h-3 w-3" /></button>)}</div>
                  {!selected.length && <p className="text-[11px] leading-5 text-[#777]">搜索并选择人员或群。默认接收人：陈誉钧。</p>}
                </div>
              </div>
            </section>
          </div>

          <section className="flex min-w-0 flex-col border border-[#141414]" aria-labelledby="push-preview-title">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#141414] bg-[#F0EFEC] px-3 py-2">
              <h3 id="push-preview-title" className="flex items-center gap-2 text-xs font-black"><span className="border border-[#141414] bg-[#141414] px-1.5 py-0.5 text-[10px] text-white">03</span>预览追踪器截图</h3>
              <button type="button" disabled={busy || loadingBatches || !canPreview} className={`${button} !px-2 !py-1`} onClick={() => void generatePreview()}><ImageIcon className="h-3.5 w-3.5" />{busy ? '处理中…' : preview ? '重新生成' : '生成预览'}</button>
            </div>
            {preview ? <div className="space-y-3 p-3"><div><h4 className="text-xs font-bold">{preview.report.title}</h4><p className="mt-1 text-[10px] leading-5 text-[#666]">{preview.report.date} · {preview.report.typeLabel} · {preview.report.scopeLabel}</p></div><img src={preview.imageUrl} alt="竞争力总结追踪器截图预览" className="w-full border border-[#141414]/20" /><a href={preview.report.url} target="_blank" rel="noreferrer" className={button}>查看本批次详情</a><p className="text-[10px] leading-5 text-[#666]">卡片附推送人和发送时间，链接绑定本次简报。</p></div> : <div className="flex min-h-72 flex-1 flex-col items-center justify-center gap-3 bg-[#F9F9F8] px-6 py-10 text-center"><span className="flex h-12 w-12 items-center justify-center border border-[#141414]/30 bg-white"><ImageIcon className="h-5 w-5 text-[#777]" /></span><div><p className="text-xs font-bold">先生成本批次截图</p><p className="mt-2 text-[11px] leading-5 text-[#777]">包含 Benchmark 指标与历史走势图<br />确认图片后，再发送给已选对象</p></div></div>}
          </section>
        </div>

        {!configured && !loadingBatches && <p className="mt-4 border border-amber-700 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">飞书应用待配置，可先预览截图。发送前需启用机器人及消息、图片权限。</p>}
        {error && <p role="alert" className="mt-4 border border-red-700 bg-red-50 px-3 py-2 text-xs leading-5 text-red-800">{error}</p>}
        {results.map((result, index) => <p key={index} className="mt-3 border border-[#141414]/30 bg-[#F9F9F8] px-3 py-2 text-xs leading-5">{result.target.name}：{statusLabel(result.status)}{result.target.nameVerified === false ? '（飞书未返回姓名，按系统已启用成员记录匹配账号）' : ''}{result.reused ? '（已有推送记录，本次未重复发送）' : ''} {result.error}</p>)}
        <details className="mt-5 border border-[#141414]/30"><summary className="cursor-pointer bg-[#F0EFEC] px-3 py-2 text-xs font-bold">最近推送记录<span className="ml-2 font-mono text-[#666]">{history.length}</span></summary><div className="px-3">{!history.length && <p className="py-4 text-xs text-[#777]">暂无记录</p>}{history.map(item => <div key={item.id} className="border-b border-[#141414]/20 py-3 text-[11px] leading-5 last:border-0"><p className="font-bold">{item.target.name} · {statusLabel(item.status)}</p><p className="text-[#666]">{item.createdAt} · {item.batchId} · {item.scopeLabel}</p>{item.error && <p className="text-red-800">{item.error}</p>}</div>)}</div></details>
      </div>

      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[#141414] bg-[#F0EFEC] px-5 py-3">
        <p className="text-[11px] text-[#666]">已选 <b className="text-[#141414]">{selected.length}</b> 个接收对象 · {preview ? '截图已生成' : '待生成截图'}</p>
        <div className="flex gap-2"><button type="button" disabled={busy} onClick={onClose} className={button}>取消</button><button type="button" disabled={busy || !configured || !preview || !selected.length || results.length > 0} onClick={() => void send()} className={`${button} !bg-[#141414] !text-white hover:!bg-[#333]`}><Send className="h-3.5 w-3.5" />{busy ? '处理中…' : `确认发送给 ${selected.length} 个对象`}</button></div>
      </footer>
    </div>
  </div>;
}
