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

export type NumericFilterOperator = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq' | 'between';
export interface NumericColumnFilter { operator: NumericFilterOperator; value: number; upper?: number; }
export type NumericColumnFilters = Record<string, NumericColumnFilter>;

export const matchesNumericColumnFilters = <Row>(row: Row, filters: NumericColumnFilters,
  getValue: (row: Row, columnKey: string) => unknown, excludedColumnKey?: string): boolean => (
  Object.entries(filters).every(([key, filter]) => {
    if (key === excludedColumnKey) return true;
    const raw = getValue(row, key);
    if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '') || typeof raw === 'boolean') return false;
    const value = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(value) || !Number.isFinite(filter.value)) return false;
    // Tolerate binary floating-point noise at an inclusive/equality boundary.
    const tolerance = Math.max(1, Math.abs(value), Math.abs(filter.value)) * Number.EPSILON * 8;
    const equal = Math.abs(value - filter.value) <= tolerance;
    switch (filter.operator) {
      case 'gt': return value > filter.value && !equal;
      case 'gte': return value > filter.value || equal;
      case 'lt': return value < filter.value && !equal;
      case 'lte': return value < filter.value || equal;
      case 'eq': return equal;
      case 'neq': return !equal;
      case 'between': return Number.isFinite(filter.upper) && filter.value <= filter.upper!
        && (value > filter.value || equal)
        && value <= filter.upper! + Math.max(1, Math.abs(filter.upper!)) * Number.EPSILON * 8;
      default: return false;
    }
  })
);
