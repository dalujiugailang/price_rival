import React, { useEffect, useState } from 'react';
import { AuditLog, listAuditLogs } from '../api';

const ACTION_LABELS: Record<string, string> = {
  AUTH_LOGIN_SUCCESS: '登录成功',
  AUTH_LOGIN_FAILED: '登录失败',
  AUTH_LOGIN_DENIED: '登录拒绝',
  AUTH_LOGOUT: '退出登录',
  BATCH_CREATE: '保存快照',
  BATCH_CONFIRM: '确认落数',
  BATCH_IMPORT: '迁移历史',
  BATCH_DELETE: '删除快照',
  BATCH_WRITE_FAILED: '保存失败',
  BATCH_IMPORT_FAILED: '迁移失败',
  BATCH_DELETE_FAILED: '删除失败'
};

export default function AuditLogPanel() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await listAuditLogs();
      setLogs(result.logs);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="border border-[#141414] bg-white">
      <div className="flex items-center justify-between border-b border-[#141414] bg-[#F0EFEC] p-4">
        <div>
          <h3 className="font-black">完整操作日志</h3>
          <p className="mt-1 text-xs text-[#141414]/60">登录、历史迁移、快照保存、正式落数及删除均有服务端留痕。</p>
        </div>
        <button onClick={load} className="border border-[#141414] bg-white px-3 py-1.5 text-xs font-bold">刷新</button>
      </div>
      {error && <div className="m-4 border border-red-700 bg-red-50 p-3 text-xs text-red-800">{error}</div>}
      <div className="max-h-[650px] overflow-auto">
        <table className="min-w-full text-xs">
          <thead className="sticky top-0 bg-[#141414] text-white">
            <tr><th className="p-3 text-left">时间</th><th className="p-3 text-left">操作</th><th className="p-3 text-left">结果</th><th className="p-3 text-left">操作人</th><th className="p-3 text-left">对象</th><th className="p-3 text-left">详情</th></tr>
          </thead>
          <tbody className="divide-y divide-[#141414]/20">
            {loading ? (
              <tr><td colSpan={6} className="p-8 text-center">正在读取日志…</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={6} className="p-8 text-center">暂无操作日志</td></tr>
            ) : logs.map(log => (
              <tr key={log.id} className="align-top hover:bg-[#F0EFEC]">
                <td className="whitespace-nowrap p-3 font-mono">{log.createdAt.replace('T', ' ').slice(0, 19)}</td>
                <td className="p-3 font-bold">{ACTION_LABELS[log.action] || log.action}</td>
                <td className="p-3"><span className={`border px-1.5 py-0.5 font-mono ${log.outcome === 'SUCCESS' ? 'border-green-700 text-green-800' : 'border-red-700 text-red-800'}`}>{log.outcome}</span></td>
                <td className="p-3">{log.actorName || '未识别'}<div className="mt-1 max-w-[160px] truncate font-mono text-[9px] text-[#141414]/50">{log.actorOpenId || ''}</div></td>
                <td className="p-3 font-mono">{log.resourceId || '-'}</td>
                <td className="max-w-[360px] break-all p-3 font-mono text-[10px] text-[#141414]/70">{JSON.stringify(log.details)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
