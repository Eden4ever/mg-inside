import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RESEARCH_MODULE_KEYS, type ResearchModuleKey } from '@mg-expert/contracts';

export type Requirement = 'confirm' | 'publish' | 'optional';
export interface ContractField {
  active?: boolean;
  deleted?: boolean;
  inactiveEnumValues?: string[];
  fieldId: string;
  label: string;
  fieldType: string;
  requirement: Requirement;
  enumValues?: string[];
  requiresEvidence?: boolean;
  allowNotApplicable?: boolean;
  description?: string;
}
export interface ModuleDefinition {
  active?: boolean;
  deleted?: boolean;
  moduleKey: ResearchModuleKey;
  displayOrder: number;
  name: string;
  researchQuestion: string;
  fields: ContractField[];
}

function loadDefinitions(): ModuleDefinition[] {
  const source = [
    resolve(process.cwd(), 'docs/research-module-schema.json'),
    resolve(process.cwd(), '../../docs/research-module-schema.json'),
  ].find(existsSync);
  if (!source) throw new Error('无法定位 docs/research-module-schema.json，不能启动研究工作台。');
  const document = JSON.parse(readFileSync(source, 'utf8')) as { 'x-moduleDefinitions': ModuleDefinition[] };
  const definitions = document['x-moduleDefinitions'];
  if (!definitions || definitions.length !== RESEARCH_MODULE_KEYS.length) throw new Error('八模块契约不完整。');
  const keys = definitions.map((definition) => definition.moduleKey);
  if (new Set(keys).size !== RESEARCH_MODULE_KEYS.length || !RESEARCH_MODULE_KEYS.every((key) => keys.includes(key))) {
    throw new Error('八模块编码与共享接口契约不一致。');
  }
  return [...definitions].sort((a, b) => a.displayOrder - b.displayOrder);
}

export const MODULE_DEFINITIONS = loadDefinitions();
export const MODULE_KEYS = RESEARCH_MODULE_KEYS;

const field = (fieldId: string, label: string, fieldType: string = 'long_text', description?: string): ContractField => ({
  fieldId, label, fieldType, requirement: 'optional', description,
});

export const LEVEL_ONE_DEFINITIONS: ModuleDefinition[] = [
  { moduleKey: 'portrait', displayOrder: 1, name: '一级指标概述', researchQuestion: '这个一级指标覆盖什么范围？', fields: [
    field('level_definition', '指标定义'), field('scope_boundary', '覆盖范围'), field('overall_goal', '总体目标'), field('classification_logic', '下级分类逻辑'),
  ] },
  { moduleKey: 'policy', displayOrder: 2, name: '政策与依据', researchQuestion: '设立该一级指标的主要依据是什么？', fields: [
    field('policy_basis', '政策依据', 'reference_list'), field('strategic_requirements', '战略要求'), field('source_notes', '来源说明'),
  ] },
  { moduleKey: 'governance', displayOrder: 3, name: '管理说明', researchQuestion: '该一级指标如何管理和维护？', fields: [
    field('responsible_department', '责任部门', 'short_text'), field('management_mechanism', '管理机制'), field('update_cycle', '更新周期', 'short_text'),
  ] },
];

export const LEVEL_TWO_DEFINITIONS: ModuleDefinition[] = [
  { moduleKey: 'portrait', displayOrder: 1, name: '二级指标概述', researchQuestion: '这个二级指标如何承接上级指标？', fields: [
    field('category_definition', '分类定义'), field('parent_relationship', '与上级指标关系'), field('applicable_objects', '适用对象'), field('subindicator_scope', '下级指标范围'),
  ] },
  { moduleKey: 'data', displayOrder: 2, name: '评价口径', researchQuestion: '该二级指标按什么口径评价？', fields: [
    field('evaluation_focus', '评价重点'), field('measurement_method', '衡量方式'), field('data_scope', '数据范围'), field('calculation_notes', '口径说明'),
  ] },
  { moduleKey: 'governance', displayOrder: 3, name: '管理说明', researchQuestion: '该二级指标由谁维护？', fields: [
    field('responsible_department', '责任部门', 'short_text'), field('collaboration_departments', '协同部门'), field('update_cycle', '更新周期', 'short_text'),
  ] },
];

export function definitionsForLevel(level: number): ModuleDefinition[] {
  return level === 1 ? LEVEL_ONE_DEFINITIONS : level === 2 ? LEVEL_TWO_DEFINITIONS : MODULE_DEFINITIONS;
}

export function definitionFor(key: string, level = 3): ModuleDefinition | undefined {
  return definitionsForLevel(level).find((definition) => definition.moduleKey === key);
}
