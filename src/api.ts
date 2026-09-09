import { TrackingBatch } from './types';
import { CompetitivenessTrendExportPayload } from './utils/competitivenessTrendExport';

export interface AuthUser {
  openId: string;
  userId: string;
  name: string;
  avatarUrl: string;
  tenantKey: string;
  departmentIds: string[];
  role: 'admin' | 'editor' | 'viewer';
  scopes: string[];
  enabled: boolean;
  accessVersion: number;
  loginType: 'feishu' | 'development';
}

export interface AuditLog {
  id: number;
  action: string;
  outcome: string;
  actorOpenId?: string;
  actorName?: string;
  resourceType?: string;
  resourceId?: string;
  requestId?: string;
  ip?: string;
  userAgent?: string;
  details: Record<string, unknown>;
  createdAt: string;
}

const requestJson = async <T,>(url: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options?.body ? { 'content-type': 'application/json' } : {}),
      ...(options?.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !url.includes('/api/auth/')) {
      window.location.reload();
    }
    if (response.status === 403) window.dispatchEvent(new Event('auth:refresh'));
    throw Object.assign(new Error(payload.error || `请求失败 (${response.status})`), { status: response.status });
  }
  return payload as T;
};

const fileNameFromDisposition = (disposition: string | null) => {
  const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      // Fall through to the basic filename below.
    }
  }
  return disposition?.match(/filename="?([^";]+)"?/i)?.[1] || '竞争力走势_总盘及品牌.xlsx';
};

export const getAuthConfig = () => requestJson<{
  authConfigured: boolean;
  devLoginEnabled: boolean;
  loginUrl: string;
}>('/api/auth/config');

export const getCurrentUser = () => requestJson<{ success: true; user: AuthUser }>('/api/auth/me');

export const developmentLogin = () => requestJson<{ success: true; user: AuthUser }>('/api/auth/dev-login', {
  method: 'POST'
});

export const logout = () => requestJson<{ success: true }>('/api/auth/logout', { method: 'POST' });

export const listTrackingBatches = (channelId?: string) => {
  const query = channelId ? `?channelId=${encodeURIComponent(channelId)}` : '';
  return requestJson<{ success: true; batches: TrackingBatch[] }>(`/api/tracking-batches${query}`);
};

export const saveTrackingBatch = (batch: TrackingBatch) => requestJson<{ success: true; batch: TrackingBatch }>(
  '/api/tracking-batches',
  { method: 'POST', body: JSON.stringify({ batch }) }
);

export const importTrackingBatches = (batches: TrackingBatch[]) => requestJson<{
  success: true;
  requested: number;
  imported: number;
  skipped: number;
  invalid: Array<{ id: string; error: string }>;
}>('/api/tracking-batches/import', {
  method: 'POST',
  body: JSON.stringify({ batches })
});

export const deleteTrackingBatch = (id: string) => requestJson<{ success: true; batch: TrackingBatch }>(
  `/api/tracking-batches/${encodeURIComponent(id)}`,
  { method: 'DELETE' }
);

export interface BrandBackfillResult {
  updatedBatchCount: number;
  updatedProductCount: number;
}

export const backfillTrackingBatchBrands = (
  channelId: string,
  brandsByPpv: Record<string, string>
) => requestJson<{ success: true } & BrandBackfillResult>('/api/tracking-batches/brand-backfill', {
  method: 'POST',
  body: JSON.stringify({ channelId, brandsByPpv })
});

export const listAuditLogs = (limit = 300, channelId = 'tradeIn') => requestJson<{ success: true; logs: AuditLog[] }>(
  `/api/audit-logs?limit=${limit}&channelId=${encodeURIComponent(channelId)}`
);

export interface DirectoryMember { openId: string; name: string; department: string }
export interface AccessMember extends DirectoryMember {
  role: 'admin' | 'editor' | 'viewer'; scopes: string[]; enabled: boolean;
  version: number; source: string; createdAt: string; updatedAt: string; lastLoginAt: string | null;
}
export const listAccessMembers = () => requestJson<{ members: AccessMember[] }>('/api/access-members');
export const searchAccessDirectory = (query: string) => requestJson<{
  users: DirectoryMember[]; requiresLogin: boolean; message?: string;
}>(`/api/access-directory?q=${encodeURIComponent(query)}`);
export const updateAccessMember = (member: Pick<AccessMember, 'openId' | 'role' | 'scopes' | 'enabled'> & { version?: number }, create = false) => requestJson<{ member: AccessMember }>(
  create ? '/api/access-members' : `/api/access-members/${encodeURIComponent(member.openId)}`,
  { method: create ? 'POST' : 'PUT', body: JSON.stringify(member) }
);

export const exportCompetitivenessTrends = async (payload: CompetitivenessTrendExportPayload) => {
  const response = await fetch('/api/exports/competitiveness-trends', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({}));
    if (response.status === 401) window.location.reload();
    throw new Error(errorPayload.error || `导出失败 (${response.status})`);
  }
  return {
    blob: await response.blob(),
    fileName: fileNameFromDisposition(response.headers.get('content-disposition'))
  };
};
