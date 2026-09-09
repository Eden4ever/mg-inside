import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { desktop, unifiedDesktop } from '../desktop';
import {serviceRequestUrl} from '@mg-inside/frontend/services/client';
import type {
  AiSuggestion,
  AiSuggestionStreamRequest,
  AiStreamEvent,
  CreateNodeInput,
  CreateSystemInput,
  EvidenceItem,
  ImportPreview,
  IndicatorSystemSummary,
  IndicatorVersionDetail,
  IndicatorTreeNode,
  ModuleRecord,
  ResearchModuleKey,
  ResearchWorkspace,
  UpdateModuleInput,
  ManagedUser,
  SessionUser,
  SystemAccessEntry,
  SystemPermissions,
  UserRole,
  WeComSyncResult,
  WeComSyncStatus,
  VersionActionResult,
} from '@/types/domain';

export interface MailSettings {
  enabled: boolean; host: string; port: number; security: 'tls' | 'starttls'; username: string;
  fromAddress: string; fromName: string; revision: number; hasPassword: boolean;
}
export interface AccountSecurityState {
  recentRecovery?: boolean;
  mfaEnabled: boolean; methods: string[]; email: string | null; totpBound: boolean;
  keys: Array<{ id: string; name: string; createdAt: string; lastUsedAt: string | null }>;
}

export function resolveApiBaseUrl(configuredBaseUrl: string | undefined, appBaseUrl: string): string {
  const normalizedAppBase = appBaseUrl === '/' ? '' : appBaseUrl.replace(/\/$/, '');
  return (configuredBaseUrl || `${normalizedAppBase}/api`).replace(/\/$/, '');
}

const baseUrl = unifiedDesktop ? desktop.apiBase : resolveApiBaseUrl(import.meta.env.VITE_API_BASE_URL, import.meta.env.BASE_URL);
let csrfToken = '';

export function setCsrfToken(value?: string | null) {
  csrfToken = value || '';
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  const end = init.method && !['GET', 'HEAD'].includes(init.method) ? desktop.beginRequest() : () => {};
  try {
    try {
      response = await fetch(unifiedDesktop ? serviceRequestUrl(desktop.origin,'expert-database',path,init.method) : `${baseUrl}${path}`, {
        ...init,
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
          ...(csrfToken && init.method && !['GET', 'HEAD', 'OPTIONS'].includes(init.method.toUpperCase()) ? { 'X-CSRF-Token': csrfToken } : {}),
          ...init.headers,
        },
      });
    } catch (error) {
      throw new ApiError('无法连接知识库服务，请确认前后端服务均已启动。', 0, 'NETWORK_ERROR', error);
    }

    const contentType = response.headers.get('content-type') || '';
    const payload: unknown = contentType.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) {
      if (response.status === 401 && unifiedDesktop) desktop.login();
      if (response.status === 401 && !['/auth/login', '/auth/me'].includes(path)) window.dispatchEvent(new Event('mg-auth-expired'));
      const body = payload as { message?: string; error?: string; code?: string; details?: unknown };
      throw new ApiError(body?.message || body?.error || `请求失败（${response.status}）`, response.status, body?.code, body?.details);
    }
    if (payload && typeof payload === 'object' && 'data' in payload) {
      return (payload as { data: T }).data;
    }
    return payload as T;
  } finally { end(); }
}

export interface SemanticBuild { id: string; status: string; total: number; completed: number; reused: number; tokens: number; error: string | null; createdAt: string; }
export interface SemanticLibrary { id: string; name: string; systemName: string; versionId: string; version: string; canManage: boolean; activeBuildId: string | null; build: SemanticBuild | null; }
export interface SemanticDetail { builds: SemanticBuild[]; active: SemanticBuild | null; pendingChanges: boolean; indicatorCount: number; chunkCount: number; preview: { path: string; label: string; text: string }[]; }
export interface SemanticMatch { id: string; nodeId: string; path: string; label: string; text: string; score: number; metadata: { sourceUrl?: string; verificationStatus?: string }; }
export const api = {
  modelConfig: () => request<{ enabled: boolean; configured: boolean; hasKey: boolean; revision: number; error?: string }>('/model-management'),
  accountSecurity: () => request<AccountSecurityState>('/account-security'),
  authorizeSecurity: (password: string, code?: unknown, method?: string) => request<{ token: string }>('/account-security/authorize', { method: 'POST', body: JSON.stringify({ password, code, method }) }),
  securityKeyOptions: () => request<PublicKeyCredentialRequestOptionsJSON>('/account-security/authorize/key', { method: 'POST', body: '{}' }),
  mfaKeyOptions: () => request<PublicKeyCredentialRequestOptionsJSON>('/auth/mfa/key', { method: 'POST', body: '{}' }),
  startKeyBinding: (token: string, name: string) => request<{ token: string; options: PublicKeyCredentialCreationOptionsJSON }>('/account-security/key/start', { method: 'POST', body: JSON.stringify({ token, name }) }),
  confirmKeyBinding: (token: string, response: unknown) => request<{ ok: boolean }>('/account-security/key/confirm', { method: 'POST', body: JSON.stringify({ token, response }) }),
  removeKeyBinding: (token: string, id: string) => request('/account-security/key/remove', { method: 'POST', body: JSON.stringify({ token, id }) }),
  sendSecurityEmail: () => request('/account-security/authorize/email', { method: 'POST', body: '{}' }),
  startEmailBinding: (token: string, address: string) => request<{ token: string }>('/account-security/email/start', { method: 'POST', body: JSON.stringify({ token, address }) }),
  confirmEmailBinding: (token: string, code: string) => request<{ ok: boolean }>('/account-security/email/confirm', { method: 'POST', body: JSON.stringify({ token, code }) }),
  removeEmailBinding: (token: string) => request('/account-security/email/remove', { method: 'POST', body: JSON.stringify({ token }) }),
  sendMfaEmail: () => request('/auth/mfa/email', { method: 'POST', body: '{}' }),
  startTotp: (token: string) => request<{ token: string; secret: string; uri: string }>('/account-security/totp/start', { method: 'POST', body: JSON.stringify({ token }) }),
  confirmTotp: (token: string, code: string) => request<{ ok: boolean }>('/account-security/totp/confirm', { method: 'POST', body: JSON.stringify({ token, code }) }),
  removeTotp: (token: string) => request('/account-security/totp/remove', { method: 'POST', body: JSON.stringify({ token }) }),
  setMfa: (token: string, enabled: boolean, methods: string[]) => request<{ enabled: boolean; recoveryCodes: string[] }>('/account-security/mfa', { method: 'POST', body: JSON.stringify({ token, enabled, methods }) }),
  mailSettings: () => request<MailSettings>('/mail-settings'),
  saveMailSettings: (input: Omit<MailSettings, 'hasPassword'> & { password?: string }) => request<MailSettings>('/mail-settings', { method: 'PUT', body: JSON.stringify(input) }),
  testMailSettings: (to: string) => request<{ ok: boolean; message: string }>('/mail-settings/test', { method: 'POST', body: JSON.stringify({ to }) }),
  saveModelConfig: (input: { enabled: boolean; revision: number; apiKey?: string }) => request('/model-management', { method: 'PUT', body: JSON.stringify(input) }),
  testModelConfig: () => request<{ dimensions: number; tokens: number; elapsedMs: number }>('/model-management/test', { method: 'POST', body: '{}' }),
  semanticList: () => request<{ configured: boolean; libraries: SemanticLibrary[] }>('/semantic-libraries'),
  semanticCreate: (input: { versionId: string; name?: string }) => request('/semantic-libraries', { method: 'POST', body: JSON.stringify(input) }),
  semanticDetail: (id: string) => request<SemanticDetail>(`/semantic-libraries/${encodeURIComponent(id)}`),
  semanticBuild: (id: string) => request(`/semantic-libraries/${encodeURIComponent(id)}/build`, { method: 'POST', body: JSON.stringify({ consent: true }) }),
  semanticSearch: (id: string, query: string) => request<{ matches: SemanticMatch[]; pendingChanges: boolean }>(`/semantic-libraries/${encodeURIComponent(id)}/search`, { method: 'POST', body: JSON.stringify({ query, consent: true }) }),
  semanticRemove: (id: string) => request(`/semantic-libraries/${encodeURIComponent(id)}`, { method: 'DELETE', body: '{}' }),
  getTemplates: (id: string) => request<import('@mg-expert/contracts').SystemTemplateSettings>(`/systems/${id}/templates`),
  saveTemplates: (id: string, input: import('@mg-expert/contracts').SaveSystemTemplatesRequest) => request<import('@mg-expert/contracts').SystemTemplateSettings>(`/systems/${id}/templates`, { method: 'PUT', body: JSON.stringify(input) }),
  login: async (username: string, password: string) => {
    const result = await request<{ user: SessionUser; csrfToken: string } | { state: 'setup_required' | 'mfa_required' }>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    if ('csrfToken' in result) setCsrfToken(result.csrfToken);
    return result;
  },
  pendingAuth: async () => {
    const result = await request<{ state: 'setup_required' | 'mfa_required'; username: string; csrfToken: string; methods: string[] }>('/auth/pending');
    setCsrfToken(result.csrfToken); return result;
  },
  verifyMfa: async (method: string, code: unknown) => {
    const result = await request<{ user: SessionUser; csrfToken: string } | { state: 'setup_required' | 'mfa_required' }>('/auth/mfa', { method: 'POST', body: JSON.stringify({ method, code }) });
    if ('csrfToken' in result) setCsrfToken(result.csrfToken); return result;
  },
  setupCredentials: async (username: string, password: string) => {
    const result = await request<{ user: SessionUser; csrfToken: string }>('/auth/setup', { method: 'POST', body: JSON.stringify({ username, password }) });
    setCsrfToken(result.csrfToken); return result;
  },
  me: async () => {
    const result = await request<{ user: SessionUser; csrfToken: string }>('/auth/me');
    setCsrfToken(result.csrfToken);
    return result;
  },
  logout: async () => {
    await request<void>('/auth/logout', { method: 'POST' });
    setCsrfToken('');
  },
  changePassword: (currentPassword: string, newPassword: string) => request<{ changed: boolean; revokedSessions: number }>('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
  wecomStatus: () => request<{ enabled: boolean; message: string }>('/auth/wecom/status'),
  aiStatus: () => request<{ configured: boolean; provider: string | null; model: string | null; streaming: boolean; promptVersion: string }>('/ai/status'),
  startWeCom: () => request<{ loginUrl: string }>('/auth/wecom/start', { method: 'POST', body: JSON.stringify({ returnTo: '/' }) }),
  listUsers: () => request<ManagedUser[]>('/users'),
  listResearchers: (systemId: string) => request<ManagedUser[]>(`/systems/${encodeURIComponent(systemId)}/access/researchers`),
  getWeComSyncStatus: () => request<WeComSyncStatus>('/users/wecom-sync/status'),
  syncWeComUsers: () => request<WeComSyncResult>('/users/wecom-sync', { method: 'POST', body: '{}' }),
  createUser: (input: { username: string; displayName: string; password: string; role: UserRole; departmentName?: string }) => request<ManagedUser>('/users', { method: 'POST', body: JSON.stringify(input) }),
  updateUser: (userId: string, input: { displayName?: string; role?: UserRole; status?: 'active' | 'disabled'; departmentName?: string }) => request<ManagedUser>(`/users/${encodeURIComponent(userId)}`, { method: 'PATCH', body: JSON.stringify(input) }),
  resetPassword: (userId: string, password: string) => request<{ reset: boolean }>(`/users/${encodeURIComponent(userId)}/reset-password`, { method: 'POST', body: JSON.stringify({ password }) }),
  bindWeCom: (userId: string, externalUserId: string) => request(`/users/${encodeURIComponent(userId)}/wecom-identities`, { method: 'POST', body: JSON.stringify({ externalUserId }) }),
  unbindWeCom: (userId: string, identityId: string) => request(`/users/${encodeURIComponent(userId)}/wecom-identities/${encodeURIComponent(identityId)}/unbind`, { method: 'POST', body: '{}' }),
  listSystems: () => request<IndicatorSystemSummary[]>('/systems'),
  updateSystem: (id: string, input: { name: string; region: string }) => request(`/systems/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteSystem: (id: string, confirmName: string) => request<void>(`/systems/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ confirmName }) }),
  getSystem: (systemId: string) => request<IndicatorSystemSummary>(`/systems/${encodeURIComponent(systemId)}`),
  getVersionDetail: (versionId: string) => request<IndicatorVersionDetail>(`/indicator-versions/${encodeURIComponent(versionId)}`),
  createSystem: (input: CreateSystemInput) => request<IndicatorSystemSummary>('/systems', { method: 'POST', body: JSON.stringify(input) }),
  listSystemAccess: (systemId: string) => request<SystemAccessEntry[]>(`/systems/${encodeURIComponent(systemId)}/access`),
  updateSystemAccess: (systemId: string, userId: string, permissions: Partial<SystemPermissions>) => request<{ userId: string; permissions: SystemPermissions }>(`/systems/${encodeURIComponent(systemId)}/access/${encodeURIComponent(userId)}`, { method: 'PUT', body: JSON.stringify(permissions) }),
  deleteSystemAccess: (systemId: string, userId: string) => request<{ userId: string; permissions: SystemPermissions }>(`/systems/${encodeURIComponent(systemId)}/access/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
  cloneVersion: (versionId: string, input: { year: number; versionCode: string }) => request<VersionActionResult>(`/indicator-versions/${encodeURIComponent(versionId)}/clone`, { method: 'POST', body: JSON.stringify(input) }),
  getTree: (versionId: string) => request<IndicatorTreeNode[]>(`/indicator-versions/${encodeURIComponent(versionId)}/tree`),
  createNode: (versionId: string, input: CreateNodeInput) => request<IndicatorTreeNode>(`/indicator-versions/${encodeURIComponent(versionId)}/nodes`, { method: 'POST', body: JSON.stringify(input) }),
  reorderNode: (versionId: string, input: { nodeId: string; targetId: string; position: 'before' | 'after' }) => request<{ nodeIds: string[] }>(`/indicator-versions/${encodeURIComponent(versionId)}/nodes/reorder`, { method: 'POST', body: JSON.stringify(input) }),
  updateNode: (versionId: string, nodeId: string, input: Partial<CreateNodeInput>) => request<IndicatorTreeNode>(`/indicator-versions/${encodeURIComponent(versionId)}/nodes/${encodeURIComponent(nodeId)}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteNode: (versionId: string, nodeId: string) => request<void>(`/indicator-versions/${encodeURIComponent(versionId)}/nodes/${encodeURIComponent(nodeId)}`, { method: 'DELETE' }),
  getWorkspace: (versionId: string, indicatorId: string) => request<ResearchWorkspace>(`/indicator-versions/${encodeURIComponent(versionId)}/indicators/${encodeURIComponent(indicatorId)}/workspace`),
  updateModule: (versionId: string, nodeId: string, moduleKey: ResearchModuleKey, input: UpdateModuleInput) => request<ModuleRecord>(`/indicator-versions/${encodeURIComponent(versionId)}/indicators/${encodeURIComponent(nodeId)}/modules/${moduleKey}`, { method: 'PATCH', body: JSON.stringify(input) }),
  saveSummary: (versionId: string, nodeId: string, input: { expectedTemplateRevision?: number; expectedRevisionNo: number; summary: string; sourceRevisionIds: string[] }) => request<{ summary: string; revisionNo: number; sourceRevisionIds: string[] }>(`/indicator-versions/${encodeURIComponent(versionId)}/indicators/${encodeURIComponent(nodeId)}/summary`, { method: 'PATCH', body: JSON.stringify(input) }),
  listEvidence: async (versionId: string, nodeId: string, moduleKey?: ResearchModuleKey) => {
    const items = await request<Array<{ id: string; moduleKey: ResearchModuleKey; type: string; title: string; sourceUrl?: string; excerpt?: string; verificationStatus: EvidenceItem['status']; fieldKeys: string[] }>>(`/indicator-versions/${encodeURIComponent(versionId)}/indicators/${encodeURIComponent(nodeId)}/evidence${moduleKey ? `?moduleKey=${moduleKey}` : ''}`);
    return items.map((item) => ({ id: item.id, moduleKey: item.moduleKey, sourceType: item.type, title: item.title, sourceUrl: item.sourceUrl, excerpt: item.excerpt, status: item.verificationStatus, fieldIds: item.fieldKeys } as EvidenceItem));
  },
  createEvidence: (versionId: string, nodeId: string, moduleKey: ResearchModuleKey, input: Omit<EvidenceItem, 'id'>) => request<EvidenceItem>(`/indicator-versions/${encodeURIComponent(versionId)}/indicators/${encodeURIComponent(nodeId)}/modules/${moduleKey}/evidence`, { method: 'POST', body: JSON.stringify({ expectedTemplateRevision: input.expectedTemplateRevision, type: input.sourceType, title: input.title, sourceUrl: input.sourceUrl, excerpt: input.excerpt, verificationStatus: input.status, fieldKeys: input.fieldIds || [] }) }),
  updateEvidence: (versionId: string, nodeId: string, evidenceId: string, input: Partial<EvidenceItem>) => request<EvidenceItem>(`/indicator-versions/${encodeURIComponent(versionId)}/indicators/${encodeURIComponent(nodeId)}/evidence/${encodeURIComponent(evidenceId)}`, { method: 'PUT', body: JSON.stringify({ expectedTemplateRevision: input.expectedTemplateRevision, type: input.sourceType, title: input.title, sourceUrl: input.sourceUrl, excerpt: input.excerpt, verificationStatus: input.status, fieldKeys: input.fieldIds }) }),
  deleteEvidence: (versionId: string, nodeId: string, evidenceId: string) => request<void>(`/indicator-versions/${encodeURIComponent(versionId)}/indicators/${encodeURIComponent(nodeId)}/evidence/${encodeURIComponent(evidenceId)}`, { method: 'DELETE' }),
  listRevisions: (versionId: string, nodeId: string) => request<ResearchWorkspace['recentRevisions']>(`/indicator-versions/${encodeURIComponent(versionId)}/indicators/${encodeURIComponent(nodeId)}/revisions`),
  createImportPreview: async (versionId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<ImportPreview>(`/indicator-versions/${encodeURIComponent(versionId)}/import/preflight`, { method: 'POST', body: form });
  },
  importTree: async (versionId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<{ imported: number }>(`/indicator-versions/${encodeURIComponent(versionId)}/import`, { method: 'POST', body: form });
  },
  listAiSuggestions: (versionId: string, nodeId: string) => request<AiSuggestion[]>(`/indicator-versions/${encodeURIComponent(versionId)}/indicators/${encodeURIComponent(nodeId)}/ai-suggestions`),
  streamAiSuggestion: async (versionId: string, nodeId: string, input: AiSuggestionStreamRequest, onEvent: (event: AiStreamEvent) => void, signal?: AbortSignal) => {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/indicator-versions/${encodeURIComponent(versionId)}/indicators/${encodeURIComponent(nodeId)}/ai-suggestions/stream`, {
        method: 'POST', credentials: 'include', signal,
        headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) },
        body: JSON.stringify(input),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new ApiError('无法连接知识库服务，请确认前后端服务均已启动。', 0, 'NETWORK_ERROR', error);
    }
    if (!response.ok || !response.body) {
      const text = await response.text();
      let message = `请求失败（${response.status}）`;
      try { const body = JSON.parse(text) as { message?: string }; message = body.message || message; } catch { /* keep status message */ }
      throw new ApiError(message, response.status);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/); buffer = blocks.pop() || '';
      for (const block of blocks) {
        const data = block.split(/\r?\n/).find((line) => line.startsWith('data:'))?.slice(5).trim();
        if (!data) continue;
        try { onEvent(JSON.parse(data) as AiStreamEvent); } catch { /* ignore malformed event */ }
      }
    }
  },
  decideAiSuggestion: (versionId: string, nodeId: string, suggestionId: string, input: { expectedTemplateRevision?: number; decision: 'accepted' | 'rejected'; expectedRevisionNo?: number; fieldKey?: string; value?: unknown; reason?: string }) => request<AiSuggestion>(`/indicator-versions/${encodeURIComponent(versionId)}/indicators/${encodeURIComponent(nodeId)}/ai-suggestions/${encodeURIComponent(suggestionId)}/decision`, { method: 'POST', body: JSON.stringify(input) }),
};

export const apiBaseUrl = baseUrl;
