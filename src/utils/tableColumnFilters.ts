export const EMPTY_COLUMN_FILTER_VALUE = '__EMPTY_COLUMN_FILTER_VALUE__';

export type ColumnFilters = Record<string, string[]>;

export interface ColumnFilterOption {
  value: string;
  count: number;
}

export const normalizeColumnFilterValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') {
    return EMPTY_COLUMN_FILTER_VALUE;
  }
  return String(value);
};

export const matchesColumnFilters = <Row>(
  row: Row,
  filters: ColumnFilters,
  getValue: (row: Row, columnKey: string) => unknown,
  excludedColumnKey?: string
): boolean => Object.entries(filters).every(([columnKey, selectedValues]) => {
  if (columnKey === excludedColumnKey || selectedValues.length === 0) return true;
  return selectedValues.includes(normalizeColumnFilterValue(getValue(row, columnKey)));
});

export const matchesTableSearch = <Row>(
  row: Row,
  searchTerm: string,
  getValues: (row: Row) => unknown[]
): boolean => {
  const normalizedSearchTerm = searchTerm.trim().toLocaleLowerCase();
  if (!normalizedSearchTerm) return true;

  return getValues(row).some(value => (
    value !== null
    && value !== undefined
    && String(value).toLocaleLowerCase().includes(normalizedSearchTerm)
  ));
};

export const getColumnFilterOptions = <Row>(
  rows: Row[],
  columnKey: string,
  filters: ColumnFilters,
  getValue: (row: Row, columnKey: string) => unknown
): ColumnFilterOption[] => {
  const counts = new Map<string, number>();
  rows.forEach(row => {
    if (!matchesColumnFilters(row, filters, getValue, columnKey)) return;
    const value = normalizeColumnFilterValue(getValue(row, columnKey));
    counts.set(value, (counts.get(value) || 0) + 1);
  });

  (filters[columnKey] || []).forEach(value => {
    if (!counts.has(value)) counts.set(value, 0);
  });

  return Array.from(counts, ([value, count]) => ({ value, count })).sort((left, right) => {
    if (left.value === EMPTY_COLUMN_FILTER_VALUE) return 1;
    if (right.value === EMPTY_COLUMN_FILTER_VALUE) return -1;
    const leftNumber = Number(left.value);
    const rightNumber = Number(right.value);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      return leftNumber - rightNumber;
    }
    return left.value.localeCompare(right.value, 'zh-Hans-u-kn-true');
  });
};

export const setColumnFilter = (
  filters: ColumnFilters,
  columnKey: string,
  selectedValues: string[]
): ColumnFilters => {
  if (selectedValues.length === 0) {
    const next = { ...filters };
    delete next[columnKey];
    return next;
  }
  return { ...filters, [columnKey]: Array.from(new Set(selectedValues)) };
};
