import { mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { ElMessageBox } from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ResearchWorkspace from '@/components/ResearchWorkspace.vue';
import { MODULE_DEFINITIONS } from '@/data/moduleSchema';
import type { ResearchWorkspace as WorkspacePayload } from '@/types/domain';

const workspace: WorkspacePayload = {
  system: { id: 's1', versionId: 'v1', name: '营商环境评价', code: 'BUSINESS', year: 2026, version: 'V1.0', region: '全省', indicatorCount: 1, progress: 12, status: 'researching', updatedAt: '2026-08-21', access: { canView: true, canResearch: true, canManageCatalog: false, canReview: false, canPublish: false } },
  indicator: { id: 'i3', code: 'CREDIT-01', name: '信用修复办理时效', level1Name: '信用环境', level2Name: '信用监管', progress: 12, issues: 1 },
  summary: null,
  moduleDefinitions: MODULE_DEFINITIONS,
  modules: MODULE_DEFINITIONS.map((definition) => ({ id: `m-${definition.moduleKey}`, moduleKey: definition.moduleKey, status: 'not_started' as const, revisionNo: 0, completedFields: 0, totalFields: definition.fields.length, values: definition.fields.map((field) => ({ fieldKey: field.fieldId, value: null, evidence: [] })), updatedAt: '' })),
  recentRevisions: [],
};

const evidence = { id: 'evidence-1', moduleKey: 'portrait' as const, title: '省级评价办法', sourceType: '政策文件', sourceUrl: 'https://example.test/policy', status: 'pending_verification' as const, excerpt: '考核范围说明', fieldIds: ['assessment_scope'] };

async function flushUi() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function renderWorkspace() {
  return mount(ResearchWorkspace, {
    props: { workspace, selectedModuleKey: 'portrait', saveVersion: 0, revisions: [], revisionsLoading: false, readonly: false, canEditEvidence: true },
    attachTo: document.body,
    global: { plugins: [ElementPlus] },
  });
}

describe('桌面关闭状态', () => {
  it('打开摘要与依据编辑时即上报保护状态，取消后恢复干净状态', async () => {
    const wrapper = renderWorkspace();
    await wrapper.findAll('button').find(button => button.text() === '填写摘要')!.trigger('click');
    expect(wrapper.emitted('closeStateChange')?.at(-1)).toEqual([{ dirty: true, busy: false }]);
    const cancel = [...document.querySelectorAll<HTMLButtonElement>('.el-dialog button')].find(button => button.textContent?.trim() === '取消');
    cancel!.click(); await flushUi();
    expect(wrapper.emitted('closeStateChange')?.at(-1)).toEqual([{ dirty: false, busy: false }]);
    await wrapper.findAll('button').find(button => button.text() === '关联依据')!.trigger('click');
    expect(wrapper.emitted('closeStateChange')?.at(-1)).toEqual([{ dirty: true, busy: false }]);
    wrapper.unmount();
  });

  it('保存中的忙态和冲突保留稿也进入关闭保护', async () => {
    const wrapper = renderFieldWorkspace();
    await wrapper.get('[aria-label="编辑第一字段"]').trigger('click');
    await wrapper.get('textarea[aria-label="第一字段"]').setValue('不能静默丢弃');
    await wrapper.get('[aria-label="保存第一字段"]').trigger('click');
    expect(wrapper.emitted('closeStateChange')?.at(-1)).toEqual([{ dirty: true, busy: true }]);
    (wrapper.vm as unknown as { showConflict: (message: string) => void }).showConflict('版本冲突');
    await wrapper.get('[aria-label="取消编辑第一字段"]').trigger('click');
    expect(wrapper.emitted('closeStateChange')?.at(-1)).toEqual([{ dirty: true, busy: false }]);
    wrapper.unmount();
  });
});

function fieldWorkspace(): WorkspacePayload {
  return {
    ...workspace,
    templateRevision: 4,
    moduleDefinitions: [{ moduleKey: 'portrait', name: '指标内容', researchQuestion: '', displayOrder: 1, fields: [
      { fieldId: 'first', label: '第一字段', fieldType: 'long_text', requirement: 'optional', allowNotApplicable: true },
      { fieldId: 'second', label: '第二字段', fieldType: 'long_text', requirement: 'optional', allowNotApplicable: true },
    ] }],
    modules: [{ id: 'm-portrait', moduleKey: 'portrait', status: 'in_progress', revisionNo: 7, completedFields: 1, totalFields: 2, updatedAt: '', values: [
      { fieldKey: 'first', value: '第一字段原内容', evidence: [{ ...evidence, fieldIds: ['first'] }] },
      { fieldKey: 'second', value: null, notApplicableReason: '第二字段原不适用理由', evidence: [] },
    ] }],
  };
}

function renderFieldWorkspace(value = fieldWorkspace(), readonly = false) {
  return mount(ResearchWorkspace, {
    props: { workspace: value, selectedModuleKey: 'portrait', saveVersion: 0, revisions: [], revisionsLoading: false, readonly },
    attachTo: document.body,
    global: { plugins: [ElementPlus] },
  });
}

describe('ResearchWorkspace', () => {
  it('每个内容字段可单独编辑保存，仅提交当前字段，其他内容和依据保持不变', async () => {
    const value = fieldWorkspace();
    const wrapper = renderFieldWorkspace(value);
    expect(wrapper.findAll('.field-edit-button')).toHaveLength(2);
    await wrapper.get('[aria-label="编辑第一字段"]').trigger('click');
    expect(wrapper.find('.module-form').exists()).toBe(false);
    expect(wrapper.findAll('.field-inline-form')).toHaveLength(1);
    expect(wrapper.get('.field-inline-form').attributes('data-field-id')).toBe('first');
    expect(wrapper.text()).toContain('第二字段原不适用理由');
    expect(wrapper.find('.field-evidence-list').text()).toContain('省级评价办法');
    await wrapper.get('textarea[aria-label="第一字段"]').setValue('只更新第一字段');
    await wrapper.get('[aria-label="保存第一字段"]').trigger('click');
    expect(wrapper.emitted('save')?.[0]).toEqual(['portrait', { expectedRevisionNo: 7, expectedTemplateRevision: 4, values: [{ fieldKey: 'first', value: '只更新第一字段' }], notApplicableReasons: {} }]);
    expect(value.modules[0]!.values[0]!.value).toBe('第一字段原内容');
    expect(value.modules[0]!.values[1]!.notApplicableReason).toBe('第二字段原不适用理由');
    (wrapper.vm as unknown as { saveCurrent: () => void }).saveCurrent();
    expect(wrapper.emitted('save')).toHaveLength(1);
    expect(wrapper.get('[aria-label="取消编辑第一字段"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[aria-label="编辑第二字段"]').attributes('disabled')).toBeDefined();
    const updated = fieldWorkspace(); updated.modules[0]!.values[0]!.value = '只更新第一字段'; updated.modules[0]!.revisionNo = 8;
    await wrapper.setProps({ workspace: updated, saveVersion: 1 });
    expect(wrapper.find('.field-inline-form').exists()).toBe(false);
    expect(wrapper.text()).toContain('只更新第一字段');
    expect(wrapper.text()).toContain('第二字段原不适用理由');
    expect(wrapper.find('.field-evidence-list').text()).toContain('省级评价办法');
    wrapper.unmount();
  });

  it('取消单字段编辑不提交草稿，恢复原内容并清除离开页面保护状态', async () => {
    const wrapper = renderFieldWorkspace();
    await wrapper.get('[aria-label="编辑第一字段"]').trigger('click');
    await wrapper.get('textarea[aria-label="第一字段"]').setValue('需要丢弃的草稿');
    expect(wrapper.emitted('dirtyChange')?.at(-1)).toEqual([true]);
    await wrapper.get('[aria-label="取消编辑第一字段"]').trigger('click');
    expect(wrapper.find('.field-inline-form').exists()).toBe(false);
    expect(wrapper.text()).toContain('第一字段原内容');
    expect(wrapper.emitted('dirtyChange')?.at(-1)).toEqual([false]);
    (wrapper.vm as unknown as { saveCurrent: () => void }).saveCurrent();
    expect(wrapper.emitted('save')).toBeUndefined();
    wrapper.unmount();
  });

  it('单字段关闭不适用只清除自身理由，不提交其他字段的理由', async () => {
    const value = fieldWorkspace(); value.modules[0]!.values[0]!.notApplicableReason = '第一字段旧理由'; value.modules[0]!.values[0]!.value = null;
    const wrapper = renderFieldWorkspace(value);
    await wrapper.get('[aria-label="编辑第一字段"]').trigger('click');
    await wrapper.get('.field-inline-form input.el-checkbox__original').setValue(false);
    await wrapper.get('textarea[aria-label="第一字段"]').setValue('现在适用');
    await wrapper.get('[aria-label="保存第一字段"]').trigger('click');
    expect(wrapper.emitted('save')?.[0]?.[1]).toMatchObject({ values: [{ fieldKey: 'first', value: '现在适用' }], notApplicableReasons: {} });
    expect(value.modules[0]!.values[1]!.notApplicableReason).toBe('第二字段原不适用理由');
    wrapper.unmount();
  });

  it('单字段填写不适用必须提供理由，并仅提交自身理由', async () => {
    const wrapper = renderFieldWorkspace();
    const vm = wrapper.vm as unknown as { saveCurrent: () => boolean };
    expect(vm.saveCurrent()).toBe(false);
    await wrapper.get('[aria-label="编辑第一字段"]').trigger('click');
    await wrapper.get('.field-inline-form input.el-checkbox__original').setValue(true);
    expect(vm.saveCurrent()).toBe(false);
    expect(wrapper.emitted('save')).toBeUndefined();
    await wrapper.get('.field-inline-form input[placeholder="填写不适用理由"]').setValue('当前指标不涉及');
    expect(vm.saveCurrent()).toBe(true);
    expect(wrapper.emitted('save')?.[0]?.[1]).toMatchObject({ values: [{ fieldKey: 'first', value: null }], notApplicableReasons: { first: '当前指标不涉及' } });
    expect(vm.saveCurrent()).toBe(false);
    expect(wrapper.emitted('save')).toHaveLength(1);
    wrapper.unmount();
  });

  it('字段保存使用进入编辑时的内容及模板修订，冲突和网络失败均保留输入', async () => {
    const wrapper = renderFieldWorkspace();
    await wrapper.get('[aria-label="编辑第一字段"]').trigger('click');
    await wrapper.get('textarea[aria-label="第一字段"]').setValue('冲突时保留的草稿');
    const newer = fieldWorkspace(); newer.templateRevision = 5; newer.modules[0]!.revisionNo = 8; newer.modules[0]!.values[0]!.value = '其他人最新内容';
    await wrapper.setProps({ workspace: newer });
    await wrapper.get('[aria-label="保存第一字段"]').trigger('click');
    expect(wrapper.emitted('save')?.[0]?.[1]).toMatchObject({ expectedRevisionNo: 7, expectedTemplateRevision: 4 });
    const vm = wrapper.vm as unknown as { showConflict: (message: string) => void; saveFailed: () => void; isSaving: () => boolean };
    vm.showConflict('内容或模板已更新，请核对');
    await flushUi();
    expect(vm.isSaving()).toBe(false);
    expect(wrapper.get<HTMLTextAreaElement>('textarea[aria-label="第一字段"]').element.value).toBe('冲突时保留的草稿');
    const retained = wrapper.get('.el-alert textarea').element as HTMLTextAreaElement;
    expect(retained.value).toContain('冲突时保留的草稿');
    expect(retained.value).not.toContain('第二字段');
    await wrapper.get('[aria-label="保存第一字段"]').trigger('click');
    vm.saveFailed(); await flushUi();
    expect(vm.isSaving()).toBe(false);
    expect(wrapper.get<HTMLTextAreaElement>('textarea[aria-label="第一字段"]').element.value).toBe('冲突时保留的草稿');
    expect(wrapper.get('[aria-label="取消编辑第一字段"]').attributes('disabled')).toBeUndefined();
    expect(wrapper.emitted('save')?.[1]?.[1]).toMatchObject({ expectedRevisionNo: 7, expectedTemplateRevision: 4 });
    wrapper.unmount();
  });

  it('未保存输入切换字段时需要确认，关闭确认框保持原字段，放弃后再切换', async () => {
    const wrapper = renderFieldWorkspace();
    await wrapper.get('[aria-label="编辑第一字段"]').trigger('click');
    await wrapper.get('textarea[aria-label="第一字段"]').setValue('未保存输入');
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('close');
    await wrapper.get('[aria-label="编辑第二字段"]').trigger('click');
    expect(confirm).toHaveBeenCalledOnce();
    expect(wrapper.get('.field-inline-form').attributes('data-field-id')).toBe('first');
    expect(wrapper.get<HTMLTextAreaElement>('textarea[aria-label="第一字段"]').element.value).toBe('未保存输入');
    confirm.mockRejectedValueOnce('cancel');
    await wrapper.get('[aria-label="编辑第二字段"]').trigger('click');
    expect(wrapper.get('.field-inline-form').attributes('data-field-id')).toBe('second');
    expect(wrapper.text()).toContain('第一字段原内容');
    expect(wrapper.emitted('save')).toBeUndefined();
    wrapper.unmount();
  });

  it('字段保存成功后才切换编辑对象，下一字段使用新的内容修订', async () => {
    const wrapper = renderFieldWorkspace();
    await wrapper.get('[aria-label="编辑第一字段"]').trigger('click');
    await wrapper.get('textarea[aria-label="第一字段"]').setValue('先保存第一字段');
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValueOnce('confirm' as never);
    await wrapper.get('[aria-label="编辑第二字段"]').trigger('click');
    expect(wrapper.get('.field-inline-form').attributes('data-field-id')).toBe('first');
    expect(wrapper.emitted('save')).toHaveLength(1);
    const saved = fieldWorkspace(); saved.modules[0]!.revisionNo = 8; saved.modules[0]!.values[0]!.value = '先保存第一字段';
    await wrapper.setProps({ workspace: saved, saveVersion: 1 });
    expect(wrapper.get('.field-inline-form').attributes('data-field-id')).toBe('second');
    await wrapper.get('[aria-label="保存第二字段"]').trigger('click');
    expect(wrapper.emitted('save')?.[1]?.[1]).toEqual({ expectedRevisionNo: 8, expectedTemplateRevision: 4, values: [{ fieldKey: 'second', value: null }], notApplicableReasons: { second: '第二字段原不适用理由' } });
    wrapper.unmount();
  });

  it('只读用户没有字段或模块编辑入口，不能触发保存', () => {
    const wrapper = renderFieldWorkspace(fieldWorkspace(), true);
    expect(wrapper.find('.field-edit-button').exists()).toBe(false);
    expect(wrapper.find('.module-actions .el-button').exists()).toBe(false);
    (wrapper.vm as unknown as { saveCurrent: () => void }).saveCurrent();
    expect(wrapper.emitted('save')).toBeUndefined();
    wrapper.unmount();
  });

  it('默认处于查看状态，不渲染编辑表单', () => {
    const wrapper = renderWorkspace();
    expect(wrapper.find('.module-form').exists()).toBe(false);
    expect(wrapper.text()).toContain('编辑模块');
  });

  it('顶部只保留操作，不显示标题路径和模块导航', () => {
    const wrapper = renderWorkspace();
    expect(wrapper.find('.context-path').exists()).toBe(false);
    expect(wrapper.find('.detail-heading h1').exists()).toBe(false);
    expect(wrapper.find('.module-nav').exists()).toBe(false);
    expect(wrapper.findAll('.module-actions .el-button')).toHaveLength(8);
    wrapper.unmount();
  });

  it('内容字段使用单列布局', () => {
    const wrapper = renderWorkspace();
    for (const description of wrapper.findAllComponents({ name: 'ElDescriptions' })) {
      expect(description.props('column')).toBe(1);
    }
    wrapper.unmount();
  });

  it('只编辑当前模块', async () => {
    const wrapper = renderWorkspace();
    await wrapper.get('.module-actions .el-button').trigger('click');
    expect(wrapper.find('.module-form').exists()).toBe(true);
    expect(wrapper.findAll('.module-form').length).toBe(1);
    expect(wrapper.text()).toContain('保存');
  });

  it('取消编辑后恢复查看状态', async () => {
    const wrapper = renderWorkspace();
    await wrapper.get('.module-actions .el-button').trigger('click');
    await wrapper.get('.module-actions .el-button:not(.el-button--primary)').trigger('click');
    expect(wrapper.find('.module-form').exists()).toBe(false);
    expect(wrapper.text()).toContain('编辑模块');
  });

  it('草稿字段不完整时仍可保存，保存使用当前修订号', async () => {
    const wrapper = renderWorkspace();
    await wrapper.get('.module-actions .el-button').trigger('click');
    const input = wrapper.find('.module-form input');
    await input.setValue('草稿内容');
    (wrapper.vm as unknown as { saveCurrent: () => void }).saveCurrent();
    const saveEvent = wrapper.emitted('save')?.[0];
    expect(saveEvent?.[0]).toBe('portrait');
    expect(saveEvent?.[1]).toMatchObject({ expectedRevisionNo: 0 });
  });

  it('知识记录只提供保存，不显示审核发布操作或必填流程标签', async () => {
    const wrapper = renderWorkspace();
    await wrapper.get('.module-actions .el-button').trigger('click');
    expect(wrapper.text()).not.toContain('保存并提交确认');
    expect(wrapper.text()).not.toContain('发布必填');
    expect(wrapper.text()).not.toContain('确认必填');
    const save = wrapper.findAll('.module-actions .el-button').find(button => button.text() === '保存')!;
    await save.trigger('click');
    expect(wrapper.emitted('save')).toHaveLength(1);
  });

  it('有未保存修改时切换模块必须先确认，放弃后才切换', async () => {
    const wrapper = renderWorkspace();
    await wrapper.get('.module-actions .el-button').trigger('click');
    await wrapper.find('.module-form input').setValue('草稿内容');
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel');
    await wrapper.get('#module-policy .module-actions .el-button').trigger('click');
    expect(wrapper.emitted('selectModule')?.[0]).toEqual(['policy']);
  });

  it('允许为支持的字段填写不适用理由并随修订保存', async () => {
    const wrapper = mount(ResearchWorkspace, {
      props: { workspace, selectedModuleKey: 'governance', saveVersion: 0, revisions: [], revisionsLoading: false, readonly: false },
      attachTo: document.body,
      global: { plugins: [ElementPlus] },
    });
    const section = wrapper.find('#module-governance');
    await section.get('.module-actions .el-button').trigger('click');
    const controls = section.findAll('.na-control');
    await controls[0]!.get('input.el-checkbox__original').setValue(true);
    await controls[0]!.get('.el-input input').setValue('该指标不涉及垂直管理职责');
    (wrapper.vm as unknown as { saveCurrent: () => void }).saveCurrent();
    expect(wrapper.emitted('save')?.[0]?.[1]).toMatchObject({ notApplicableReasons: { vertical_responsibilities: '该指标不涉及垂直管理职责' } });
  });

  it('顶部不再显示研究授权和依据聚合入口', () => {
    const wrapper = mount(ResearchWorkspace, { props: { workspace, selectedModuleKey: 'portrait', saveVersion: 0, revisions: [], revisionsLoading: false, readonly: false, userRole: 'system_admin' }, global: { plugins: [ElementPlus] } });
    expect(wrapper.find('.heading-actions').text()).not.toContain('研究授权');
    expect(wrapper.find('.heading-actions').text()).not.toContain('依据材料');
  });

  it('依据材料支持新增、状态更新、编辑和删除事件', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never);
    const wrapper = mount(ResearchWorkspace, {
      props: { workspace: { ...workspace, modules: workspace.modules.map(m => ({ ...m, values: m.values.map(v => ({ ...v, evidence: v.fieldKey === 'assessment_scope' ? [evidence] : [] })) })) }, selectedModuleKey: 'portrait', saveVersion: 0, revisions: [], revisionsLoading: false, readonly: false, canEditEvidence: true, evidence: [evidence] },
      attachTo: document.body,
      global: { plugins: [ElementPlus] },
    });

    await wrapper.find('.field-actions .el-button').trigger('click');
    await flushUi();
    expect(document.body.textContent).toContain('新增依据材料');
    const vm = wrapper.vm as unknown as { evidenceForm: { title: string }; submitEvidence: () => void };
    vm.evidenceForm.title = '新增政策依据';
    vm.submitEvidence();
    await flushUi();
    expect(wrapper.emitted('addEvidence')?.[0]?.[0]).toBe('portrait');
    expect(wrapper.emitted('addEvidence')?.[0]?.[2]).toMatchObject({ title: '新增政策依据', fieldIds: ['indicator_nature'] });

    await wrapper.find('.field-evidence-list .evidence-summary').trigger('click');
    await flushUi();
    expect(wrapper.find('.field-evidence-list').text()).toContain('考核范围说明');
    const updateEvidenceStatus = wrapper.vm as unknown as { updateEvidenceStatus: (item: typeof evidence, status: 'verified') => void };
    updateEvidenceStatus.updateEvidenceStatus(evidence, 'verified');
    expect(wrapper.emitted('updateEvidence')?.some((event) => (event[0] as { id?: string }).id === evidence.id && (event[1] as { status?: string }).status === 'verified')).toBe(true);
    const editButton = [...document.body.querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === '编辑或替换依据');
    expect(editButton).toBeTruthy();
    (editButton as HTMLButtonElement).click();
    const evidenceVm = wrapper.vm as unknown as { openEvidenceEdit: (item: typeof evidence) => void; evidenceForm: { title: string }; submitEvidence: () => void; removeEvidence: (item: typeof evidence) => Promise<void> };
    evidenceVm.openEvidenceEdit(evidence);
    evidenceVm.evidenceForm.title = '省级评价办法（修订版）';
    evidenceVm.submitEvidence();
    await flushUi();
    expect(wrapper.emitted('updateEvidence')?.some((event) => (event[0] as { id?: string }).id === evidence.id && (event[1] as { title?: string }).title === '省级评价办法（修订版）')).toBe(true);
    const deleteButton = [...document.body.querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === '删除依据');
    expect(deleteButton).toBeTruthy();
    await evidenceVm.removeEvidence(evidence);
    expect(wrapper.emitted('deleteEvidence')?.[0]?.[0]).toEqual(evidence);
  });

  it('摘要保存必须携带来源修订并发出可追溯事件', async () => {
    const revision = { id: 'revision-1', revision: 1, moduleKey: 'portrait' as const, action: 'saved' as const, actorName: '研究员甲', createdAt: '2026-08-21T00:00:00.000Z' };
    const wrapper = mount(ResearchWorkspace, {
      props: { workspace: { ...workspace, summary: '旧摘要', summaryRevisionNo: 1 }, selectedModuleKey: 'portrait', saveVersion: 0, revisions: [revision], revisionsLoading: false, readonly: false },
      attachTo: document.body,
      global: { plugins: [ElementPlus] },
    });
    await wrapper.find('.summary-actions .el-button').trigger('click');
    const vm = wrapper.vm as unknown as { summaryDraft: string; summarySources: string[]; submitSummary: () => void };
    vm.summaryDraft = '新的研究结论';
    vm.summarySources = [revision.id];
    vm.submitSummary();
    expect(wrapper.emitted('saveSummary')?.[0]?.[0]).toEqual({ expectedRevisionNo: 1, summary: '新的研究结论', sourceRevisionIds: [revision.id] });
  });
});
