import type { ResearchModuleKey } from './index.js';

export type WorkbookImportTarget =
  | { kind: 'catalog'; field: 'indicatorCode' | 'level1Name' | 'level2Name' | 'level3Name' }
  | { kind: 'module'; moduleKey: ResearchModuleKey; fieldId: string; strategy: 'direct' | 'merge' | 'manual_split' }
  | { kind: 'summary'; field: 'researchSummary' }
  | { kind: 'ai_context'; field: 'legacyExpertSuggestion' }
  | { kind: 'ignored'; reason: string };

export interface WorkbookColumnMapping {
  column: string;
  header: string;
  target: WorkbookImportTarget;
}

export const WORKBOOK_COLUMN_MAPPINGS: WorkbookColumnMapping[] = [
  { column: 'A', header: '指标编号', target: { kind: 'catalog', field: 'indicatorCode' } },
  { column: 'B', header: '一级指标', target: { kind: 'catalog', field: 'level1Name' } },
  { column: 'C', header: '二级指标', target: { kind: 'catalog', field: 'level2Name' } },
  { column: 'D', header: '三级指标', target: { kind: 'catalog', field: 'level3Name' } },
  { column: 'E', header: '四级指标/具体监测事项', target: { kind: 'module', moduleKey: 'portrait', fieldId: 'assessment_scope', strategy: 'merge' } },
  { column: 'F', header: '指标属性', target: { kind: 'module', moduleKey: 'portrait', fieldId: 'indicator_nature', strategy: 'direct' } },
  ...['G', 'H', 'I', 'J', 'K', 'L'].map<WorkbookColumnMapping>((column) => ({ column, header: '考核对象及数据提供单位', target: { kind: 'module', moduleKey: 'portrait', fieldId: 'assessment_scope', strategy: 'merge' } })),
  { column: 'M', header: '计量方式', target: { kind: 'module', moduleKey: 'portrait', fieldId: 'measurement_type', strategy: 'direct' } },
  { column: 'N', header: '考核周期', target: { kind: 'module', moduleKey: 'portrait', fieldId: 'assessment_cycle', strategy: 'direct' } },
  { column: 'O', header: '存量或增量考核', target: { kind: 'module', moduleKey: 'portrait', fieldId: 'time_dimension', strategy: 'direct' } },
  { column: 'P', header: '横向联系', target: { kind: 'module', moduleKey: 'portrait', fieldId: 'horizontal_relations', strategy: 'direct' } },
  { column: 'Q', header: '考核权重', target: { kind: 'module', moduleKey: 'portrait', fieldId: 'assessment_weight', strategy: 'manual_split' } },
  ...['R', 'S', 'T'].map<WorkbookColumnMapping>((column) => ({ column, header: '全国前沿值', target: { kind: 'module', moduleKey: 'portrait', fieldId: 'frontier_values', strategy: 'merge' } })),
  { column: 'U', header: '政策源头追溯', target: { kind: 'module', moduleKey: 'policy', fieldId: 'policy_sources', strategy: 'direct' } },
  { column: 'V', header: '政策意图解码', target: { kind: 'module', moduleKey: 'policy', fieldId: 'policy_intent', strategy: 'direct' } },
  { column: 'W', header: '时效性研判', target: { kind: 'module', moduleKey: 'policy', fieldId: 'validity_assessment', strategy: 'direct' } },
  { column: 'X', header: '最新动态跟踪', target: { kind: 'module', moduleKey: 'policy', fieldId: 'latest_updates', strategy: 'direct' } },
  { column: 'Y', header: '政策趋势预判', target: { kind: 'module', moduleKey: 'policy', fieldId: 'trend_forecast', strategy: 'direct' } },
  ...['Z', 'AA', 'AB'].map<WorkbookColumnMapping>((column) => ({ column, header: '标杆地区典型案例', target: { kind: 'module', moduleKey: 'policy', fieldId: 'benchmark_cases', strategy: 'merge' } })),
  { column: 'AC', header: '计算公式分解', target: { kind: 'module', moduleKey: 'data', fieldId: 'calculation_formula', strategy: 'manual_split' } },
  { column: 'AD', header: '计算数据来源', target: { kind: 'module', moduleKey: 'data', fieldId: 'data_sources', strategy: 'merge' } },
  { column: 'AE', header: '统计口径', target: { kind: 'module', moduleKey: 'data', fieldId: 'numerator_definition', strategy: 'manual_split' } },
  { column: 'AF', header: '排除项与调整项', target: { kind: 'module', moduleKey: 'data', fieldId: 'exceptions_adjustments', strategy: 'direct' } },
  { column: 'AG', header: '数据来源识别', target: { kind: 'module', moduleKey: 'data', fieldId: 'data_sources', strategy: 'merge' } },
  { column: 'AH', header: '采集方式判断', target: { kind: 'module', moduleKey: 'data', fieldId: 'collection_method', strategy: 'direct' } },
  { column: 'AI', header: '系统架构', target: { kind: 'module', moduleKey: 'data', fieldId: 'data_flow', strategy: 'merge' } },
  ...['AJ', 'AK'].map<WorkbookColumnMapping>((column) => ({ column, header: '统计时间节点', target: { kind: 'module', moduleKey: 'data', fieldId: 'statistical_node', strategy: 'merge' } })),
  { column: 'AL', header: '数据流转时效', target: { kind: 'module', moduleKey: 'data', fieldId: 'refresh_cycle', strategy: 'manual_split' } },
  { column: 'AM', header: '数据真实性核验', target: { kind: 'module', moduleKey: 'quality', fieldId: 'authenticity_risks', strategy: 'direct' } },
  { column: 'AN', header: '数据完整性评估', target: { kind: 'module', moduleKey: 'quality', fieldId: 'completeness_assessment', strategy: 'direct' } },
  { column: 'AO', header: '数据一致性检查', target: { kind: 'module', moduleKey: 'quality', fieldId: 'consistency_check', strategy: 'direct' } },
  { column: 'AP', header: '地方问题归类', target: { kind: 'module', moduleKey: 'quality', fieldId: 'local_problem_categories', strategy: 'manual_split' } },
  { column: 'AQ', header: '共性与个性区分', target: { kind: 'module', moduleKey: 'quality', fieldId: 'common_vs_specific', strategy: 'direct' } },
  ...['AR', 'AS', 'AT'].map<WorkbookColumnMapping>((column, index) => ({ column, header: '分层整改建议', target: { kind: 'module', moduleKey: 'rectify', fieldId: ['city_actions', 'county_actions', 'district_actions'][index]!, strategy: 'direct' } })),
  { column: 'AU', header: '行动要点分解', target: { kind: 'module', moduleKey: 'rectify', fieldId: 'action_plan', strategy: 'direct' } },
  { column: 'AV', header: '整改成效预判', target: { kind: 'module', moduleKey: 'rectify', fieldId: 'expected_outcomes', strategy: 'direct' } },
  { column: 'AW', header: '轻重缓急', target: { kind: 'module', moduleKey: 'rectify', fieldId: 'priority', strategy: 'direct' } },
  { column: 'AX', header: '指标必要性评估', target: { kind: 'module', moduleKey: 'optimize', fieldId: 'necessity_assessment', strategy: 'direct' } },
  { column: 'AY', header: '指标可考性判断', target: { kind: 'module', moduleKey: 'optimize', fieldId: 'evaluability_assessment', strategy: 'direct' } },
  { column: 'AZ', header: '指标导向合理性', target: { kind: 'module', moduleKey: 'optimize', fieldId: 'orientation_rationality', strategy: 'direct' } },
  { column: 'BA', header: '差异化调整', target: { kind: 'module', moduleKey: 'optimize', fieldId: 'differentiated_adjustment', strategy: 'direct' } },
  { column: 'BB', header: '指标替代方案', target: { kind: 'module', moduleKey: 'optimize', fieldId: 'alternative_proposal', strategy: 'direct' } },
  { column: 'BC', header: '基层减负考量', target: { kind: 'module', moduleKey: 'optimize', fieldId: 'grassroots_burden', strategy: 'direct' } },
  { column: 'BD', header: '条块关系梳理', target: { kind: 'module', moduleKey: 'governance', fieldId: 'governance_model', strategy: 'manual_split' } },
  { column: 'BE', header: '总结概述', target: { kind: 'summary', field: 'researchSummary' } },
  { column: 'BF', header: '专家库建议', target: { kind: 'ai_context', field: 'legacyExpertSuggestion' } },
  { column: 'BG', header: '专家姓名及联系方式', target: { kind: 'ignored', reason: '系统中的专家是AI能力，不维护现实专家人员；原值仅可脱敏后作为迁移审计附件。' } },
  { column: 'BH', header: '省级责任单位', target: { kind: 'module', moduleKey: 'contacts', fieldId: 'province_responsibility', strategy: 'direct' } },
  { column: 'BI', header: '市级责任单位', target: { kind: 'module', moduleKey: 'contacts', fieldId: 'city_responsibility', strategy: 'direct' } },
  { column: 'BJ', header: '县级责任单位', target: { kind: 'module', moduleKey: 'contacts', fieldId: 'county_responsibility', strategy: 'direct' } },
  { column: 'BK', header: '市辖区责任单位', target: { kind: 'module', moduleKey: 'contacts', fieldId: 'district_responsibility', strategy: 'direct' } },
  { column: 'BL', header: '备注', target: { kind: 'module', moduleKey: 'contacts', fieldId: 'communication_mechanism', strategy: 'merge' } },
];
