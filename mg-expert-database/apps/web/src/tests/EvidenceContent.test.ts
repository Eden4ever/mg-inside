import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import EvidenceContent from '@/components/EvidenceContent.vue';

describe('EvidenceContent', () => {
  it('默认单行摘要，点击详情查看完整内容和原文，再次点击收起', async () => {
    const wrapper = mount(EvidenceContent, { props: { item: { title: '评价办法', excerpt: '第一条：考核范围\n第二条：办理要求', sourceUrl: 'https://example.test/document.pdf' } } });
    expect(wrapper.text()).toContain('评价办法');
    expect(wrapper.find('.evidence-details').exists()).toBe(false);
    expect(wrapper.get('button').attributes('aria-expanded')).toBe('false');
    await wrapper.get('button').trigger('click');
    expect(wrapper.get('button').attributes('aria-expanded')).toBe('true');
    expect(wrapper.get('.evidence-excerpt').text()).toContain('第二条：办理要求');
    expect(wrapper.get('a').attributes('href')).toBe('https://example.test/document.pdf');
    expect(wrapper.find('input').exists()).toBe(false);
    await wrapper.get('button').trigger('click');
    expect(wrapper.find('.evidence-details').exists()).toBe(false);
  });
  it('没有摘录时不生成内容，不允许危险链接', async () => {
    const wrapper = mount(EvidenceContent, { props: { item: { title: '材料', sourceUrl: 'javascript:alert(1)' } } });
    expect(wrapper.text()).toContain('暂无内容摘录');
    await wrapper.get('button').trigger('click');
    expect(wrapper.find('a').exists()).toBe(false);
  });
});
