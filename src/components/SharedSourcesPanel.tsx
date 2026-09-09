import React from 'react';
import { TrackingBatch } from '../types';

export default function SharedSourcesPanel({ batch }: { batch?: TrackingBatch }) {
  const sources = new Map<string, number>();
  for (const product of batch?.products || []) {
    const name = product.sourceSheet || '共享快照';
    sources.set(name, (sources.get(name) || 0) + 1);
  }
  return <section className="p-5 space-y-4">
    <h3 className="font-bold">数据源 · 只读</h3>
    <p className="text-xs text-[#555]">{batch ? `共享快照：${batch.id}` : '暂无共享快照'}</p>
    <table className="w-full text-left text-xs"><thead className="bg-[#F0EFEC]"><tr><th className="p-3">源工作表</th><th className="p-3">明细行数</th></tr></thead><tbody>
      {[...sources].map(([name, count]) => <tr className="border-b border-[#141414]/20" key={name}><td className="p-3">{name}</td><td className="p-3">{count}</td></tr>)}
    </tbody></table>
    {!!batch?.sourceUploadRecords?.length && <div className="text-xs space-y-2">{batch.sourceUploadRecords.map(record => <div key={record.id}>{record.fileName} · {record.rowCount} 行 · {record.uploadedAt}</div>)}</div>}
    <p className="text-xs text-[#555]">显示已共享快照的来源；上传操作仅对具备编辑权限的成员开放。</p>
  </section>;
}
