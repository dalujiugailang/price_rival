import React, { useEffect, useState } from 'react';
import { AccessMember, DirectoryMember, listAccessMembers, searchAccessDirectory, updateAccessMember } from '../api';
import { ACCESS_CHANNELS, ACCESS_PAGES, DEFAULT_VIEWER_SCOPES, pagesForChannel } from '../../shared/accessPolicy.mjs';

const control = 'border border-[#141414] bg-white px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50';
const date = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN', {
  timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
}) : '暂无记录';
type Draft = { role: 'editor' | 'viewer'; scopes: string[]; enabled: boolean };
const initialDraft = (): Draft => ({ role: 'viewer', scopes: [...DEFAULT_VIEWER_SCOPES], enabled: true });

export default function PermissionPanel() {
  const [members, setMembers] = useState<AccessMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<AccessMember | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [selected, setSelected] = useState<DirectoryMember | null>(null);
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<DirectoryMember[]>([]);
  const [requiresLogin, setRequiresLogin] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const load = async () => {
    setLoading(true); setError('');
    try { setMembers((await listAccessMembers()).members); }
    catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const open = (member: AccessMember | 'new') => {
    setEditing(member); setFormError(''); setNotice(''); setQuery(''); setCandidates([]);
    setRequiresLogin(false); setSearched(false);
    setSelected(member === 'new' ? null : member);
    setDraft(member === 'new' ? initialDraft() : { role: member.role === 'viewer' ? 'viewer' : 'editor', scopes: [...member.scopes], enabled: member.enabled });
  };
  const search = async () => {
    setSearching(true); setFormError(''); setSelected(null);
    try {
      const result = await searchAccessDirectory(query.trim());
      setCandidates(result.users); setRequiresLogin(result.requiresLogin); setSearched(true);
      if (result.message) setFormError(result.message);
    } catch (err) { setFormError((err as Error).message); }
    finally { setSearching(false); }
  };
  const toggle = (scopes: string[], checked: boolean) => setDraft(current => ({ ...current,
    scopes: checked ? [...new Set([...current.scopes, ...scopes])] : current.scopes.filter(scope => !scopes.includes(scope))
  }));
  const save = async () => {
    if (!selected) { setFormError('请先搜索并选择飞书成员'); return; }
    if (draft.enabled && !draft.scopes.length) { setFormError('请至少勾选一个页面，或停用该成员'); return; }
    setSaving(true); setFormError('');
    try {
      const result = await updateAccessMember({ ...draft, openId: selected.openId,
        ...(editing && editing !== 'new' ? { version: editing.version } : {}) }, editing === 'new');
      setMembers(current => [...current.filter(member => member.openId !== result.member.openId), result.member]);
      setEditing(null); setNotice(`${result.member.name}的权限已保存，后续请求按新权限生效。`);
    } catch (err) { setFormError((err as Error).message); }
    finally { setSaving(false); }
  };
  const enabled = members.filter(member => member.enabled);
  const filtered = members.filter(member => `${member.name} ${member.department} ${member.openId}`.toLowerCase().includes(filter.toLowerCase()));
  return <section className="p-5 space-y-4" aria-label="权限管理">
    <div className="flex flex-wrap justify-between gap-3 items-center">
      <div><h2 className="font-black text-lg">权限管理</h2><div className="mt-2 flex gap-5 text-xs">
        <span>已启用 <b>{enabled.length}</b> 人</span><span>只读 <b>{enabled.filter(member => member.role === 'viewer').length}</b> 人</span>
        <span>可编辑 <b>{enabled.filter(member => member.role !== 'viewer').length}</b> 人（含管理员）</span>
      </div></div><button className={control} disabled={loading || saving} onClick={() => void load()}>刷新名单</button>
    </div>
    <div className="flex flex-wrap justify-between gap-3">
      <input aria-label="搜索已开通成员" className={`${control} w-64 max-w-full`} placeholder="搜索姓名或部门" value={filter} onChange={event => setFilter(event.target.value)} />
      <button className={`${control} font-bold`} disabled={saving || searching} onClick={() => open('new')}>＋ 新增成员</button>
    </div>
    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="text-xs text-green-800">{notice}</p>}
    {editing && <fieldset disabled={saving || searching} className="border border-[#141414] p-4 space-y-4">
      <legend className="px-2 font-bold text-sm">{editing === 'new' ? '新增成员' : `修改权限 · ${editing.name}`}</legend>
      {editing === 'new' ? <div className="space-y-2">
        <label className="text-xs font-bold" htmlFor="member-search">飞书成员</label>
        <div className="flex gap-2"><input id="member-search" className={`${control} flex-1 min-w-0`} placeholder="输入姓名或飞书账号 ID" maxLength={50} value={query}
          onChange={event => { setQuery(event.target.value); setSelected(null); setCandidates([]); setSearched(false); }}
          onKeyDown={event => { if (event.key === 'Enter' && query.trim()) { event.preventDefault(); void search(); } }} />
          <button className={control} disabled={!query.trim()} onClick={() => void search()}>{searching ? '搜索中…' : '搜索'}</button></div>
        {requiresLogin && <p className="text-xs text-[#555]">搜索更多飞书成员需重新授权登录。<a className="ml-2 underline" href="/api/auth/login">重新使用飞书登录</a></p>}
        {searched && candidates.length === 0 && <p className="text-xs text-[#555]">没有找到成员。也可让同事先登录本系统一次，再搜索姓名。</p>}
        {candidates.map(candidate => {
          const existing = members.some(member => member.openId === candidate.openId);
          return <label key={candidate.openId} className="flex items-center gap-2 border-b border-[#141414]/20 py-2 text-xs">
            <input type="radio" name="directory-member" disabled={existing} checked={selected?.openId === candidate.openId} onChange={() => setSelected(candidate)} />
            <span>{candidate.name} · {candidate.department || '飞书成员'}<span className="ml-2 text-[#666]">{candidate.openId.slice(-8)}{existing ? ' · 已开通' : ''}</span></span>
          </label>;
        })}
      </div> : <div className="text-xs">{editing.name} · {editing.department || '飞书成员'}</div>}
      <div className="flex flex-wrap gap-5 items-center">
        <label className="flex gap-2 items-center text-xs">操作权限<select className={control} value={draft.role} onChange={event => setDraft(current => ({ ...current, role: event.target.value as Draft['role'] }))}>
          <option value="viewer">只读</option><option value="editor">可编辑</option></select></label>
        <label className="flex gap-2 items-center text-xs"><input type="checkbox" checked={draft.enabled} onChange={event => setDraft(current => ({ ...current, enabled: event.target.checked }))} />启用访问</label>
      </div>
      <div className="text-xs font-bold">查看范围</div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {ACCESS_CHANNELS.map(channel => {
          const pages = pagesForChannel(channel.id);
          const scopes = pages.map(page => `${channel.id}.${page.id}`);
          const count = scopes.filter(scope => draft.scopes.includes(scope)).length;
          return <fieldset className="border border-[#141414]/30 px-3 pb-3" key={channel.id}>
            <legend className="px-1"><label className="inline-flex gap-2 items-center py-1 text-xs font-bold">
              <input aria-label={`${channel.name}全部页面`} type="checkbox" checked={count === scopes.length} ref={input => { if (input) input.indeterminate = count > 0 && count < scopes.length; }} onChange={event => toggle(scopes, event.target.checked)} />{channel.name}</label></legend>
            <div className="grid grid-cols-2 gap-2">{pages.map(page => <label className="flex items-center gap-2 text-xs min-h-8" key={page.id}>
              <input type="checkbox" aria-label={`${channel.name}：${channel.id === 'selfOperated' && page.selfName ? page.selfName : page.name}`} checked={draft.scopes.includes(`${channel.id}.${page.id}`)} onChange={event => toggle([`${channel.id}.${page.id}`], event.target.checked)} />
              {channel.id === 'selfOperated' && page.selfName ? page.selfName : page.name}
            </label>)}</div>
          </fieldset>;
        })}
      </div>
      <p className="text-xs text-[#555]">已选 {draft.scopes.length} 个页面。只读账号在已选页面仍不能上传、改价、保存或删除。</p>
      {formError && <p role="alert" className="text-xs text-red-800">{formError}</p>}
      <div className="flex justify-end gap-2"><button className={control} onClick={() => setEditing(null)}>取消</button>
        <button className={`${control} font-bold`} onClick={() => void save()}>{saving ? '保存中…' : '保存权限'}</button></div>
    </fieldset>}
    <div className="overflow-x-auto border border-[#141414]">
      <table className="w-full text-xs text-left"><thead className="bg-[#F0EFEC] border-b border-[#141414]"><tr>
        {['成员 / 部门', '操作权限', '查看范围', '状态', '最近登录', '操作'].map(label => <th className="p-3 whitespace-nowrap" key={label}>{label}</th>)}
      </tr></thead><tbody className="divide-y divide-[#141414]/20">
        {loading ? <tr><td colSpan={6} className="p-8 text-center">读取人员权限…</td></tr> : filtered.map(member => <tr key={member.openId}>
          <td className="p-3"><b>{member.name}</b><div className="text-[#666] mt-1">{member.department || '—'}</div></td>
          <td className="p-3 whitespace-nowrap">{member.role === 'admin' ? '管理员' : member.role === 'editor' ? '可编辑' : '只读'}</td>
          <td className="p-3"><details><summary className="cursor-pointer">{ACCESS_CHANNELS.map(channel => {
            const count = member.scopes.filter(scope => scope.startsWith(`${channel.id}.`)).length;
            return count ? `${channel.name} ${count} 页` : '';
          }).filter(Boolean).join(' · ') || '未选择页面'}</summary><div className="mt-2 space-y-1">
            {ACCESS_CHANNELS.map(channel => {
              const labels = ACCESS_PAGES.filter(page => member.scopes.includes(`${channel.id}.${page.id}`)).map(page => channel.id === 'selfOperated' && page.selfName ? page.selfName : page.name);
              return labels.length ? <div key={channel.id}><b>{channel.name}</b>：{labels.join('、')}</div> : null;
            })}</div></details>{member.role !== 'admin' && <button className="underline mt-1" disabled={saving || searching} onClick={() => open(member)}>配置范围</button>}</td>
          <td className="p-3 whitespace-nowrap">{member.enabled ? '启用' : '停用'}</td><td className="p-3 whitespace-nowrap">{date(member.lastLoginAt)}</td>
          <td className="p-3 whitespace-nowrap">{member.role === 'admin' ? '账号保护' : <button className={control} disabled={saving || searching} onClick={() => open(member)}>修改权限</button>}</td>
        </tr>)}
        {!loading && !filtered.length && <tr><td className="p-8 text-center" colSpan={6}>没有匹配的成员</td></tr>}
      </tbody></table>
    </div>
    <p className="text-xs text-[#666]">权限管理仅管理员可用。最近登录按北京时间显示；暂无记录不代表从未登录。</p>
  </section>;
}
