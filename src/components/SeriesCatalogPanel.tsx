import React, {useEffect,useMemo,useRef,useState} from 'react';
import {Layers} from 'lucide-react';
import type {SeriesCatalogEntry} from '../types';
import {SERIES_POSITIONS,seriesCatalogKey} from '../../shared/seriesCatalog.mjs';

interface Props {
 triggerRef?: React.Ref<HTMLButtonElement>;
 entries: SeriesCatalogEntry[];
 missing: SeriesCatalogEntry[];
 loaded: boolean;
 error: string;
 onRetry: () => void;
 onSave: (entries: SeriesCatalogEntry[]) => Promise<void>;
}
export default function SeriesCatalogPanel({entries,missing,loaded,error,onRetry,onSave,triggerRef}:Props) {
 const [open,setOpen]=useState(false);
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{if(open && !dialog.current?.open)dialog.current?.showModal();},[open]);
 const [editing,setEditing]=useState<SeriesCatalogEntry[]|null>(null);
 const [query,setQuery]=useState('');
 const [saving,setSaving]=useState(false);
 const [message,setMessage]=useState('');
 const rows=editing ?? entries;
 const visible=useMemo(()=>rows.map((row,index)=>({row,index})).filter(({row})=>`${row.brand} ${row.newSeries} ${row.newSeriesPosition}`.toLowerCase().includes(query.toLowerCase())),[rows,query]);
 const update=(index:number,key:keyof SeriesCatalogEntry,value:string)=>setEditing(current=>(current ?? entries).map((row,i)=>i===index?{...row,[key]:value}:row));
 const begin=()=>{
  const keys=new Set(entries.map(row=>seriesCatalogKey(row.brand,row.newSeries)));
  setEditing([...entries,...missing.filter(row=>!keys.has(seriesCatalogKey(row.brand,row.newSeries)))]);
  setMessage('');
 };
 const save=async()=>{setSaving(true);setMessage('');try{await onSave(rows);setEditing(null);setMessage('商品库已保存，工作台定位已更新。');}catch(error){setMessage(error instanceof Error?error.message:'保存失败');}finally{setSaving(false);}};
 return <>
  <button ref={triggerRef} type="button" aria-haspopup="dialog" onClick={()=>{setOpen(true);if(loaded)begin();}} className="inline-flex shrink-0 items-center gap-1.5 border border-current bg-white px-3 py-1.5 text-xs font-bold"><Layers aria-hidden="true" className="size-4" strokeWidth={1.7}/>新机商品库{missing.length>0?` · 待补 ${missing.length}`:''}</button>
  <dialog ref={dialog} aria-labelledby="series-catalog-title" onCancel={event=>{if(saving)event.preventDefault();}} onClose={()=>{setOpen(false);setEditing(null);setMessage('');}} className="m-auto w-full max-w-3xl max-h-[85vh] overflow-auto border border-current bg-white p-4 text-left text-current shadow-xl backdrop:bg-black/30">
  <header className="flex items-center justify-between gap-3"><h2 id="series-catalog-title" className="text-sm font-bold">新机商品库 · 系列定位 <span className="text-xs font-normal">{loaded?`${entries.length} 条${missing.length?` · 待补充 ${missing.length} 组`:''}`:'未加载'}</span></h2><button type="button" disabled={saving} onClick={()=>dialog.current?.close()} aria-label="关闭商品库" className="border border-current px-2 py-1 text-xs disabled:opacity-50">关闭</button></header>
  <p className="mt-2 text-xs">按品牌＋新机系列匹配。历史仅回填本次升级时最近保存的 8 次有效明细快照，更早快照留空。</p>
  {error && <p role="alert" className="mt-2 text-xs text-red-700">{error} <button type="button" onClick={onRetry} className="underline">重新加载</button></p>}
  <div className="my-2 flex flex-wrap items-center gap-2 text-xs">
   <input aria-label="搜索商品库" value={query} onChange={event=>setQuery(event.target.value)} placeholder="搜索品牌 / 新机系列 / 定位" className="border border-current px-2 py-1" />
   {editing?<><button type="button" disabled={saving} onClick={()=>void save()} className="border border-current px-2 py-1 disabled:opacity-50">{saving?'保存中…':'保存商品库'}</button><button type="button" disabled={saving} onClick={()=>{setEditing(null);setMessage('');}} className="px-2 py-1">取消</button><button type="button" disabled={saving} onClick={()=>{setQuery('');setEditing(current=>[...(current ?? entries),{brand:'',newSeries:'',newSeriesPosition:''}]);}} className="border border-current px-2 py-1">新增一行</button></>:<button type="button" disabled={!loaded} onClick={begin} className="border border-current px-2 py-1 disabled:opacity-50">{missing.length?'维护 / 补充未匹配项':'维护商品库'}</button>}
  </div>
  {message && <p role="status" className="mb-2 text-xs">{message}</p>}
  <div className="max-h-[55vh] overflow-auto"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-white"><tr><th className="p-1">品牌</th><th className="p-1">新机系列</th><th className="p-1">新机系列定位</th></tr></thead><tbody>
   {visible.map(({row,index})=><tr key={index} className="border-t border-current/20">{(['brand','newSeries'] as const).map(key=><td key={key} className="p-1">{editing?<input aria-label={`第${index+1}行${key==='brand'?'品牌':'新机系列'}`} value={row[key]} disabled={saving} onChange={event=>update(index,key,event.target.value)} className="w-full border border-current/30 px-1 py-1"/>:row[key]}</td>)}<td className="p-1">{editing?<select aria-label={`第${index+1}行新机系列定位`} value={row.newSeriesPosition} disabled={saving} onChange={event=>update(index,'newSeriesPosition',event.target.value)} className="border border-current/30 px-1 py-1"><option value="">请选择</option>{SERIES_POSITIONS.map(position=><option key={position}>{position}</option>)}</select>:row.newSeriesPosition}</td></tr>)}
  </tbody></table></div>
 </dialog>
 </>;
}
