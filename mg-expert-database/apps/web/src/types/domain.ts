import type {
  EvidenceStatus,
  CreateSystemRequest,
  IndicatorNodeRequest,
  UpdateModuleRequest,
  AiSuggestionView,
  AiSuggestionStreamRequest,
  AiStreamEvent,
  IndicatorSystemSummary as SharedIndicatorSystemSummary,
  IndicatorVersionDetail,
  IndicatorTreeNode,
  ModuleStatus,
  ResearchFieldDefinition,
  ResearchModuleDefinition,
  ResearchModuleKey,
  ResearchRevisionSummary,
  SystemPermissions,
} from '@mg-expert/contracts';

export type { EvidenceStatus, IndicatorTreeNode, IndicatorVersionDetail, ModuleStatus, ResearchFieldDefinition, ResearchModuleDefinition, ResearchModuleKey, ResearchRevisionSummary };
export type { AiSuggestionStreamRequest, AiStreamEvent };
export type { SystemPermissions };

export interface IndicatorSystemSummary extends SharedIndicatorSystemSummary {
  versionId: string;
}

export type SchemaFieldType =
  | 'short_text'
  | 'long_text'
  | 'rich_text'
  | 'number'
  | 'decimal'
  | 'percentage'
  | 'date'
  | 'enum'
  | 'reference_list'
  | 'object_list'
  | 'organization_contact_list';

export type FieldRequirement = 'confirm' | 'publish' | 'optional';

export type ModuleFieldDefinition = ResearchFieldDefinition;
export type ModuleDefinition = ResearchModuleDefinition;

export interface EvidenceItem {
  expectedTemplateRevision?: number;
  id: string;
  moduleKey?: ResearchModuleKey;
  title: string;
  sourceType: string;
  sourceUrl?: string;
  status: 'pending_verification' | 'verified' | 'invalid' | 'superseded' | EvidenceStatus;
  excerpt?: string;
  fieldIds?: string[];
}

export interface FieldValue {
  fieldKey: string;
  value: unknown;
  notApplicableReason?: string;
  evidenceStatus?: EvidenceStatus | 'pending_verification' | 'verified' | 'invalid';
  evidence: EvidenceItem[];
}

export type UiModuleStatus = 'not_started' | 'in_progress' | 'pending_review' | 'confirmed' | 'returned' | 'todo' | 'running' | 'warn' | 'done';

export interface ModuleRecord {
  id: string;
  moduleKey: ResearchModuleKey;
  status: UiModuleStatus;
  revisionNo: number;
  completedFields: number;
  totalFields: number;
  values: FieldValue[];
  notApplicableReasons?: Record<string, string>;
  updatedAt: string;
  returnReason?: string;
}

export interface WorkspaceIndicator {
  level?: number;
  id: string;
  code: string;
  name: string;
  level1Name: string;
  level2Name: string;
  progress: number;
  issues: number;
}

export interface ResearchWorkspace {
  templateRevision?: number;
  system: IndicatorSystemSummary;
  indicator: WorkspaceIndicator;
  summary: string | null;
  summaryRevisionNo?: number;
  summarySourceRevisionIds?: string[];
  moduleDefinitions: ModuleDefinition[];
  modules: ModuleRecord[];
  recentRevisions: ResearchRevisionSummary[];
}

export interface VersionActionResult {
  id: string;
  systemId: string;
  year: number;
  versionCode: string;
  status: string;
}

export type UpdateModuleInput = UpdateModuleRequest;

export type AiSuggestion = AiSuggestionView & { indicatorId?: string };

export type CreateSystemInput = CreateSystemRequest;

export type CreateNodeInput = IndicatorNodeRequest;

export interface ImportPreviewRow {
  row: number;
  level: number;
  code: string;
  name: string;
  parentCode?: string;
}

export interface ImportPreview {
  valid: boolean;
  rows?: ImportPreviewRow[];
  errors: Array<{ row: number; field: string; reason: string }>;
}

export type UserRole = 'system_admin' | 'catalog_manager' | 'researcher' | 'reviewer' | 'publisher' | 'reader';

export interface SessionUser {
  userId: string;
  username: string | null;
  name: string;
  departmentName: string | null;
  role: UserRole;
  authSource: 'local' | 'wecom' | string;
}

export interface WeComIdentity {
  id: string;
  corpId: string;
  externalUserId: string;
  boundAt: string;
  lastLoginAt: string | null;
}

export interface ManagedUser {
  id: string;
  username: string | null;
  displayName: string;
  departmentName: string | null;
  role: UserRole;
  status: 'active' | 'disabled';
  authSource: string;
  wecomBound: boolean;
  wecomIdentities: WeComIdentity[];
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WeComSyncResult {
  total: number;
  created: number;
  updated: number;
  bound: number;
  unchanged: number;
  conflicts: number;
  completedAt: string;
}

export interface WeComSyncStatus {
  enabled: boolean;
  running: boolean;
  intervalMinutes: number;
  lastResult: WeComSyncResult | null;
  lastError: string | null;
}

export interface ResearchAssignment {
  id: string;
  versionId: string;
  indicatorNodeId: string;
  userId: string;
  userName: string;
  username: string | null;
  assignedByUserId?: string | null;
  assignedByName?: string | null;
  createdAt: string;
}

export interface SystemAccessEntry {
  isCreator?: boolean;
  systemRole?: 'creator' | 'manager' | 'editor' | 'viewer' | null;
  userId: string;
  displayName: string;
  username: string | null;
  departmentName: string | null;
  role: UserRole;
  globalAdmin: boolean;
  platformRoleLabel: string;
  permissions: SystemPermissions;
}
