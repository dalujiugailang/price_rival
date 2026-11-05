import React, {useEffect, useMemo, useState} from 'react';
import {sourceFileUrl} from '../api';
import type {SubsidyRule, TrackingBatch} from '../types';
import {getSnapshotSourceFiles} from '../utils/snapshotSourceFiles';
import GradeSnapshotHistory from './GradeSnapshotHistory';
import {parseSubsidyRules} from './UploadSection';
import {SnapshotTable} from './MainTable';
import SubsidyMatrixPanel from './subsidyMatrix/SubsidyMatrixPanel';
import {resolveMatrixWorkspace} from './subsidyMatrix/model';

export default function TradeInSnapshotDetails({batch, focusPpv}: {batch: TrackingBatch; focusPpv?: string}) {
  const snapshotWorkspace = useMemo(() => resolveMatrixWorkspace({
    useSharedSnapshot: true, snapshot: batch, products: [], subsidyRules: [], fileName: '', version: 0
  }), [batch]);
  const declaredName = batch.restorePayload?.activeSubsidyFileName || batch.subsidyFileName;
  const source = getSnapshotSourceFiles(batch).find(record => record.type === 'subsidy');
  const sourceId = source?.sourceFileId && (batch.snapshotSourceFiles || source.fileName === declaredName)
    ? source.sourceFileId : undefined;
  const sourceName = source?.fileName;
  const hasFrozenRules = snapshotWorkspace.subsidyRules.length > 0;
  const [archive, setArchive] = useState<{id: string; rules?: SubsidyRule[]; error?: string}>();

  useEffect(() => {
    if (hasFrozenRules || !sourceId || !sourceName) return;
    const controller = new AbortController();
    const id = sourceId;
    const fileName = sourceName;
    async function load() {
      try {
        const response = await fetch(sourceFileUrl(id), {signal: controller.signal});
        if (!response.ok) throw new Error('无法读取原文件');
        const file = new File([await response.blob()], fileName);
        const rules = await parseSubsidyRules(file);
        if (!rules.length) throw new Error('补贴表没有可用规则');
        if (!controller.signal.aborted) setArchive({id, rules});
      } catch {
        if (!controller.signal.aborted) {
          setArchive({id, error: '已绑定补贴表，但归档文件无法读取或没有可用规则，暂无法测算。'});
        }
      }
    }
    void load();
    return () => controller.abort();
  }, [hasFrozenRules, sourceId, sourceName]);

  const loaded = sourceId && archive?.id === sourceId ? archive : undefined;
  const workspace = useMemo(() => {
    if (hasFrozenRules) return {...snapshotWorkspace, label: `历史快照 ${batch.id}`};
    if (loaded?.rules) return {...snapshotWorkspace, subsidyRules: loaded.rules, fileName: sourceName || snapshotWorkspace.fileName, uploadedAt: source?.uploadedAt};
    const unavailableReason = sourceId
      ? loaded?.error || '正在读取本快照绑定的补贴表…'
      : declaredName && declaredName !== '历史导出文件恢复'
        ? `本快照记录了补贴表“${declaredName}”，但没有保存补贴规则或可核验的原文件绑定，风险测算留空。`
        : '本快照未绑定补贴表，风险测算留空。';
    return {...snapshotWorkspace, unavailableReason};
  }, [hasFrozenRules, snapshotWorkspace, batch.id, loaded, sourceId, sourceName, source?.uploadedAt, declaredName]);

  const risk = workspace.unavailableReason
    ? <div className="border border-[#141414] bg-white p-4">
      <h2 className="text-sm font-bold">风险测算</h2>
      <p role="status" className="mt-2 text-xs text-[#555]">{workspace.unavailableReason}</p>
    </div>
    : <div className="border border-[#141414] bg-white">
      <SubsidyMatrixPanel workspace={workspace} marginBottomLine={batch.marginBottomLine}/>
    </div>;

  return <GradeSnapshotHistory batchId={batch.id} risk={risk}>
    <SnapshotTable batch={batch} focusPpv={focusPpv} riskWorkspace={workspace}/>
  </GradeSnapshotHistory>;
}
