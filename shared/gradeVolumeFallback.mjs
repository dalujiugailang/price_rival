const norm = v => String(v ?? '').trim().replace(/\s+/g, '').toLowerCase();
const key = row => JSON.stringify([String(row.skuId).trim(), norm(row.level)]);

// The selected source is authoritative, including explicit zero counts.
// At most two older sources fill absent combinations; never add counts across periods.
export function resolveGradeVolume(primary, older = []) {
  const rows = primary.data.rows.map(row => ({ ...row, activitySourceId: primary.id, activitySourceName: primary.fileName }));
  const keys = new Set(rows.map(key));
  const identity = new Map(rows.map(row => [String(row.skuId).trim(), [norm(row.model), norm(row.sku)]]));
  const used = [], conflicts = [];
  for (const source of older.slice(0, 2)) {
    let filled = 0;
    for (const row of source.data.rows) {
      if (keys.has(key(row))) continue;
      const id = String(row.skuId).trim(), known = identity.get(id);
      if (known && (known[0] !== norm(row.model) || known[1] !== norm(row.sku))) {
        conflicts.push({skuId:id,level:row.level,sourceId:source.id,message:'历史型号或SKU规格不一致，未回退'});
        continue;
      }
      identity.set(id, [norm(row.model), norm(row.sku)]);
      keys.add(key(row));
      rows.push({...row, activitySourceId:source.id, activitySourceName:source.fileName, activityFallback:true});
      filled++;
    }
    used.push({id:source.id,fileName:source.fileName,createdAt:source.createdAt,filled});
  }
  return {data:{...primary.data,rows},used,conflicts};
}
