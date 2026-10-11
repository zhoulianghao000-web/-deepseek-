/**
 * 管理 API 客户端
 * 统一处理：可选管理令牌、JSON 序列化、错误归一化。
 */
import type {
  ChannelInfo,
  ConversationRow,
  DebugOverrides,
  LogRow,
  MessageRow,
  Overview,
  PlaygroundResult,
  ProviderInfo,
  ProviderTestResult,
  PublicSettings,
} from '../types';

const ADMIN_TOKEN_KEY = 'wx-agent-admin-token';

export function getAdminToken(): string {
  try {
    return localStorage.getItem(ADMIN_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function setAdminToken(token: string): void {
  try {
    if (token) localStorage.setItem(ADMIN_TOKEN_KEY, token);
    else localStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {
    /* 忽略存储异常 */
  }
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  if (init.body) headers['Content-Type'] = 'application/json';
  const token = getAdminToken();
  if (token) headers['x-admin-token'] = token;

  const response = await fetch(path, { ...init, headers });
  const text = await response.text();

  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const message =
      data && typeof data === 'object' && typeof data.error === 'string'
        ? data.error
        : `请求失败（HTTP ${response.status}）`;
    throw new ApiError(message, response.status);
  }

  return data as T;
}

export interface SettingsResponse {
  settings: PublicSettings;
  providers: ProviderInfo[];
  channels: ChannelInfo[];
}

export interface ConversationListResponse {
  total: number;
  items: ConversationRow[];
}

export interface ConversationDetailResponse {
  conversation: ConversationRow;
  messages: MessageRow[];
}

export interface LogListResponse {
  items: LogRow[];
  total: number;
}

export const api = {
  overview: () => request<Overview>('/api/admin/overview'),

  settings: () => request<SettingsResponse>('/api/admin/settings'),
  saveSettings: (patch: Record<string, unknown>) =>
    request<{ settings: PublicSettings; providers: ProviderInfo[] }>('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  testProvider: (provider: string) =>
    request<ProviderTestResult>('/api/admin/settings/test', {
      method: 'POST',
      body: JSON.stringify({ provider }),
    }),

  conversations: (params: { limit?: number; offset?: number; q?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.limit) query.set('limit', String(params.limit));
    if (params.offset) query.set('offset', String(params.offset));
    if (params.q) query.set('q', params.q);
    const suffix = query.toString();
    return request<ConversationListResponse>(`/api/admin/conversations${suffix ? `?${suffix}` : ''}`);
  },
  conversation: (id: string, limit = 300) =>
    request<ConversationDetailResponse>(`/api/admin/conversations/${encodeURIComponent(id)}?limit=${limit}`),
  resetConversation: (id: string) =>
    request<{ success: boolean }>(`/api/admin/conversations/${encodeURIComponent(id)}/reset`, { method: 'POST' }),
  deleteConversation: (id: string) =>
    request<{ success: boolean }>(`/api/admin/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  clearConversations: () => request<{ success: boolean; removed: number }>('/api/admin/conversations', { method: 'DELETE' }),

  logs: (params: { limit?: number; level?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.limit) query.set('limit', String(params.limit));
    if (params.level && params.level !== 'all') query.set('level', params.level);
    const suffix = query.toString();
    return request<LogListResponse>(`/api/admin/logs${suffix ? `?${suffix}` : ''}`);
  },
  clearLogs: () => request<{ success: boolean; removed: number }>('/api/admin/logs', { method: 'DELETE' }),

  playground: (body: { text: string; externalUserId?: string; channel?: string } & DebugOverrides) =>
    request<PlaygroundResult>('/api/admin/playground', { method: 'POST', body: JSON.stringify(body) }),
};

export default api;
