import { mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { describe, expect, it } from 'vitest';
import AiExpertPanel from '@/components/AiExpertPanel.vue';
import { MODULE_DEFINITIONS } from '@/data/moduleSchema';
import type { AiSuggestion, ResearchWorkspace } from '@/types/domain';

const workspace: ResearchWorkspace = {
  system: { id: 's1', versionId: 'v1', name: '测试体系', code: 'TEST', year: 2026, version: 'V1', region: '测试区', indicatorCount: 1, progress: 0, status: 'researching', updatedAt: '', access: { canView: true, canResearch: true, canManageCatalog: false, canReview: false, canPublish: false } },
  indicator: { id: 'n3', code: 'TEST-3', name: '测试三级指标', level1Name: '一级', level2Name: '二级', progress: 0, issues: 0 },
  summary: null,
  moduleDefinitions: MODULE_DEFINITIONS,
  modules: [],
  recentRevisions: [],
};

const suggestion: AiSuggestion = {
  id: 'ai-1',
  targetType: 'module',
  moduleKey: 'portrait',
  fieldKey: 'assessment_scope',
  content: '建议补充分层考核范围。',
  rationale: '现有描述缺少责任层级。',
  confidence: 'needs_verification',
  status: 'pending',
  evidenceIds: [],
  verificationItems: [],
  sourceRevisionIds: [],
  modelId: 'test-model',
  promptVersion: 'test-v1',
  createdAt: '2026-08-21T00:00:00.000Z',
};

describe('AiExpertPanel', () => {
  it('展示候选建议并允许人工采纳或拒绝', async () => {
    const wrapper = mount(AiExpertPanel, {
      props: { workspace, selectedModuleKey: 'portrait', collapsed: false, unavailable: true, suggestions: [suggestion], loading: false },
      global: { plugins: [ElementPlus] },
    });

    expect(wrapper.text()).toContain('建议补充分层考核范围');
    expect(wrapper.text()).toContain('待核验');
    await wrapper.get('button.el-button--primary').trigger('click');
    expect(wrapper.emitted('accept')?.[0]?.[0]).toEqual(suggestion);
    const rejectButton = wrapper.findAll('button').find((button) => button.text().includes('拒绝'));
    await rejectButton?.trigger('click');
    expect(wrapper.emitted('reject')?.[0]?.[0]).toEqual(suggestion);
  });

  it('展示研究摘要候选并要求人工采纳后才发出采纳事件', async () => {
    const summarySuggestion: AiSuggestion = {
      ...suggestion,
      id: 'ai-summary-1',
      targetType: 'summary',
      moduleKey: undefined,
      fieldKey: undefined,
      content: '建议将八模块研究结论汇总为一段摘要。',
      evidenceIds: ['evidence-1'],
      sourceRevisionIds: ['revision-1'],
    };
    const wrapper = mount(AiExpertPanel, {
      props: { workspace, selectedModuleKey: 'portrait', collapsed: false, suggestions: [summarySuggestion], loading: false },
      global: { plugins: [ElementPlus] },
    });

    expect(wrapper.text()).toContain('研究摘要候选');
    expect(wrapper.text()).toContain('建议将八模块研究结论汇总为一段摘要');
    expect(wrapper.text()).toContain('1 条依据');
    const accept = wrapper.findAll('button').find((button) => button.text().includes('采纳为正式摘要'));
    expect(accept).toBeTruthy();
    await accept!.trigger('click');
    expect(wrapper.emitted('accept')?.[0]?.[0]).toEqual(summarySuggestion);
  });

  it('模型可用时提交研究问题，流式阶段禁止重复提交', async () => {
    const wrapper = mount(AiExpertPanel, {
      props: { workspace, selectedModuleKey: 'portrait', collapsed: false, suggestions: [], loading: false, unavailable: false, streaming: false, streamText: '' },
      global: { plugins: [ElementPlus] },
    });
    await wrapper.get('input').setValue('检查当前字段是否缺少依据');
    await wrapper.get('.model-confirmation input').setValue(true);
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('generate')?.[0]).toEqual(['检查当前字段是否缺少依据', true]);

    await wrapper.setProps({ streaming: true, streamText: '正在生成候选建议' });
    expect(wrapper.text()).toContain('正在生成候选建议');
    expect(wrapper.get('input').attributes('disabled')).toBeDefined();
  });
});
