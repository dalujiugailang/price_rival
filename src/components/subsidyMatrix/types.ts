import type {CalculatedProduct, SubsidyRule} from '../../types';

export interface MatrixRule {
  id: string;
  sourceRow: number | null;
  sourceIndex: number;
  brand: string;
  series: string;
  threshold: number;
  jd: number;
  ahs: number;
  raw: Record<string, unknown>;
}

export interface MatrixGroup {
  key: string;
  label: string;
  min: number;
  max: number;
  low: number;
  high: number;
  delta: number;
  values: number[];
}

export interface MatrixRow {
  key: string;
  brand: string;
  series: string;
  cells: Record<string, MatrixRule[]>;
  activeCount: number;
  hasRules: boolean;
}

export interface MatrixWorkspace {
  products: CalculatedProduct[];
  subsidyRules: SubsidyRule[];
  fileName: string;
  label: string;
  uploadedAt?: string;
  snapshotId?: string;
  unavailableReason?: string;
}

export interface ProfitComparison {
  delta: number;
  profit: number;
  rate: number;
  risk: string;
}

export interface SeriesProfitResult {
  row: MatrixRow;
  hit: {
    status: string;
    rules: MatrixRule[];
    ahs: number | null;
  };
  comparison: ProfitComparison | null;
  current: boolean;
}

export interface ExchangeScenario {
  product: CalculatedProduct;
  result: SeriesProfitResult;
  relation: 'workspace' | 'scenario';
}

export interface ProfitViewSelection {
  view: 'new' | 'old';
  productId: string;
  targetSeries: string;
  onlyRisks: boolean;
  search?: string;
  oldSearch?: string;
  oldModel?: string;
  lossesOnly?: boolean;
  excludeCurrent?: boolean;
}
