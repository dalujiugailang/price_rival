import { TrackingBatch } from './types';

export interface AuthUser {
  openId: string;
  userId: string;
  name: string;
  avatarUrl: string;
  tenantKey: string;
  departmentIds: string[];
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
    throw new Error(payload.error || `请求失败 (${response.status})`);
  }
  return payload as T;
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

export const listAuditLogs = (limit = 300) => requestJson<{ success: true; logs: AuditLog[] }>(
  `/api/audit-logs?limit=${limit}`
);
