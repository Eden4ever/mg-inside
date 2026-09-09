export const RESEARCH_MODULE_KEYS = [
  'portrait',
  'policy',
  'data',
  'quality',
  'governance',
  'rectify',
  'optimize',
  'contacts',
] as const;

export type ResearchModuleKey = string;
export type SystemStatus = 'draft' | 'researching' | 'review' | 'published' | 'archived';
export type ModuleStatus = 'not_started' | 'in_progress' | 'pending_review' | 'confirmed' | 'returned';
export type FieldType =
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
export type EvidenceStatus = 'confirmed' | 'pending';
export type SuggestionStatus = 'pending' | 'accepted' | 'rejected';

export type SystemRole = 'creator' | 'manager' | 'editor' | 'viewer';
export interface SystemPermissions {
  systemRole?: SystemRole | null;
  canManageAccess?: boolean;
  canView: boolean;
  canResearch: boolean;
  canManageCatalog: boolean;
  canReview: boolean;
  canPublish: boolean;
}

export interface ResearchFieldDefinition {
  active?: boolean;
  deleted?: boolean;
  inactiveEnumValues?: string[];
  fieldId: string;
  label: string;
  fieldType: FieldType;
  requirement: FieldRequirement;
  description?: string;
  enumValues?: string[];
  requiresEvidence?: boolean;
  allowNotApplicable?: boolean;
  sourceColumn?: string;
}

export interface ResearchModuleDefinition {
  active?: boolean;
  deleted?: boolean;
  moduleKey: ResearchModuleKey;
  displayOrder: number;
  name: string;
  researchQuestion: string;
  fields: ResearchFieldDefinition[];
}

export interface IndicatorSystemSummary {
  id: string;
  versionId: string;
  name: string;
  code: string;
  year: number;
  version: string;
  region: string;
  maxLevel?: number;
  indicatorCount: number;
  progress: number;
  status: SystemStatus;
  updatedAt: string;
  access: SystemPermissions;
}

export interface IndicatorVersionDetail extends IndicatorSystemSummary {
  createdAt: string;
  tree: IndicatorTreeNode[];
  counts: {
    level1: number;
    level2: number;
    level3: number;
    researchRecords: number;
    levels?: Record<string, number>;
  };
  moduleStatusCounts: Record<ModuleStatus, number>;
}

export interface IndicatorTreeNode {
  id: string;
  parentId: string | null;
  level: number;
  name: string;
  code: string;
  sortOrder: number;
  progress: number;
  issues: number;
  children: IndicatorTreeNode[];
}

export interface FieldEvidence {
  id: string;
  title: string;
  sourceType: string;
  sourceUrl?: string;
  status: EvidenceStatus;
  excerpt?: string;
}

export interface ResearchFieldValue {
  fieldKey: string;
  value: string | number | null;
  evidenceStatus: EvidenceStatus;
  evidence: FieldEvidence[];
}

export interface ResearchModuleRecord {
  id: string;
  moduleKey: ResearchModuleKey;
  status: ModuleStatus;
  revisionNo: number;
  completedFields: number;
  totalFields: number;
  values: ResearchFieldValue[];
  updatedAt: string;
}

export interface ResearchRevisionSummary {
  snapshot?: { templateRevision?: number; template?: ResearchModuleDefinition[]; values?: Record<string, unknown>; naReasons?: Record<string, string>; evidence?: Array<{ id: string; title: string; excerpt?: string; sourceUrl?: string }> };
  id: string;
  revision: number;
  moduleKey: ResearchModuleKey;
  action: 'created' | 'saved' | 'confirmed' | 'published';
  actorName: string;
  createdAt: string;
}

export interface ResearchWorkspace {
  templateRevision?: number;
  system: IndicatorSystemSummary;
  indicator: {
    id: string;
    code: string;
    name: string;
    level?: number;
    level1Name: string;
    level2Name: string;
    progress: number;
    issues: number;
  };
  summary: string;
  moduleDefinitions: ResearchModuleDefinition[];
  modules: ResearchModuleRecord[];
  recentRevisions: ResearchRevisionSummary[];
}

/** API 请求 DTO：前端调用和后端控制器共用，避免请求字段在两侧漂移。 */
export interface CreateSystemRequest {
  name: string;
  code?: string;
  region?: string;
  year?: number;
  versionCode?: string;
  maxLevel?: number;
}

export interface IndicatorNodeRequest {
  parentId?: string | null;
  level: number;
  code?: string;
  name: string;
  sortOrder?: number;
}

export interface CloneVersionRequest {
  year: number;
  versionCode: string;
}

export interface UpdateModuleRequest {
  expectedTemplateRevision?: number;
  expectedRevisionNo: number;
  values: Array<{ fieldKey: string; value: unknown }>;
  notApplicableReasons?: Record<string, string>;
  confirm?: boolean;
}

export interface SaveSummaryRequest {
  expectedTemplateRevision?: number;
  expectedRevisionNo: number;
  summary: string;
  sourceRevisionIds: string[];
}

export interface CreateAiSuggestionRequest {
  expectedTemplateRevision?: number;
  targetType: 'module' | 'summary';
  moduleKey?: ResearchModuleKey;
  fieldKey?: string;
  content: string;
  rationale: string;
  confidence?: 'supported' | 'inference' | 'needs_verification';
  evidenceIds?: string[];
  verificationItems?: string[];
  sourceRevisionIds?: string[];
  modelId?: string;
  promptVersion?: string;
}

export interface DecideAiSuggestionRequest {
  expectedTemplateRevision?: number;
  decision: 'accepted' | 'rejected';
  expectedRevisionNo?: number;
  fieldKey?: string;
  value?: unknown;
  reason?: string;
}

export interface AiSuggestionStreamRequest {
  prompt: string;
  moduleKey: ResearchModuleKey;
  modelProcessingConfirmed: boolean;
}

export interface AiStreamEvent {
  type: 'meta' | 'delta' | 'usage' | 'completed' | 'error';
  suggestionId?: string;
  text?: string;
  model?: string;
  status?: string;
  inputTokens?: number;
  outputTokens?: number;
  code?: string;
  message?: string;
}

export interface AiSuggestionView {
  id: string;
  targetType: 'module' | 'summary';
  moduleKey?: ResearchModuleKey;
  fieldKey?: string;
  content: string;
  rationale: string;
  confidence: 'supported' | 'inference' | 'needs_verification';
  evidenceIds: string[];
  verificationItems: string[];
  sourceRevisionIds: string[];
  modelId: string;
  promptVersion: string;
  status: 'pending' | 'accepted' | 'rejected' | 'superseded';
  decisionReason?: string;
  decidedAt?: string;
  decidedByUserId?: string;
  resultRevisionId?: string;
  createdAt: string;
}

export interface EvidenceRequest {
  expectedTemplateRevision?: number;
  type: string;
  title: string;
  sourceUrl?: string;
  excerpt?: string;
  verificationStatus: 'pending_verification' | 'verified' | 'invalid' | 'superseded';
  fieldKeys: string[];
}

export interface UpdateResearchModuleInput {
  expectedTemplateRevision?: number;
  expectedRevisionNo: number;
  values: Array<{ fieldKey: string; value: string | number | null }>;
  confirm?: boolean;
}

export interface AiSuggestion {
  id: string;
  indicatorId: string;
  moduleKey: ResearchModuleKey;
  fieldKey?: string;
  content: string;
  rationale: string;
  status: SuggestionStatus;
  createdAt: string;
}

export * from './workbook-mapping.js';
export interface SystemTemplateSettings {
  systemId: string;
  maxLevel: number;
  revisionNo: number;
  levels: Array<{ level: number; revisionNo: number; affectedCount: number; modules: ResearchModuleDefinition[] }>;
}
export interface SaveSystemTemplatesRequest {
  expectedRevisionNo: number;
  maxLevel: number;
  levels: Array<{ level: number; modules: ResearchModuleDefinition[] }>;
}
