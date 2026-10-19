// Retain row identities, never row values: edits must continue to show live results.
export interface RetainedFilterScope { scope: string; rowKeys: string[]; }

export const retainFilterScope = <Row>(scope: string, rows: Row[], key: (row: Row) => string): RetainedFilterScope => ({
  scope, rowKeys: rows.map(key)
});

export const resolveFilteredRows = <Row>(rows: Row[], matchingRows: Row[], retained: RetainedFilterScope | null,
  scope: string, key: (row: Row) => string): Row[] => {
  if (!retained || retained.scope !== scope) return matchingRows;
  const keys = new Set(retained.rowKeys);
  return rows.filter(row => keys.has(key(row)));
};
