import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import SettingsForm from './SettingsForm.vue';

const settings = {
  agent: { modelProvider: 'default', useModelForRagAnswerability: true },
  models: { providers: { default: { model: 'saved', baseUrl: 'https://example.test', api: 'openai-completions', maxTokens: 1200, temperature: 0 } } },
  embedding: { enabled: true, provider: 'siliconflow', model: 'embed', baseUrl: 'https://embed.test', dimensions: 1024 },
  rerank: { enabled: true, provider: 'siliconflow', model: 'rerank', baseUrl: 'https://rerank.test', topN: 8 },
  claude: { timeoutMs: 1200000, sessionBusyMaxRetries: 3, sessionBusyRetryDelayMs: 3000 },
  agents: [{ id: 'main', name: '主 Agent', role: 'main-coordinator' }],
};

describe('完整配置表单', () => {
  it('校准 profiles 从设置独立复制并完整保存，旧配置不引入空 profile', async () => {
    const wrapper = mount(SettingsForm, {props:{settings, actions:{}}});
    const save = () => wrapper.findAll('button').find(button => button.text() === '保存 Claude')!;
    await save().trigger('click');
    expect((wrapper.emitted('saveClaude')?.[0]?.[0] as any).investigationProfiles).toBeUndefined();
    const profiles={enabled:true,fast:{model:'fast',effort:'low',maxTurns:12},deep:{model:'deep',effort:'high',timeoutMs:1200000}};
    await wrapper.setProps({settings:{...settings,claude:{...settings.claude,investigationProfiles:profiles}}});
    await wrapper.get('[name="fastMaxTurns"]').setValue(15);
    await save().trigger('click');
    expect((wrapper.emitted('saveClaude')?.[1]?.[0] as any).investigationProfiles.fast.maxTurns).toBe(15);
    expect(profiles.fast.maxTurns).toBe(12);
  });
  it('保留所有配置分区并使用当前未保存模型值测试', async () => {
    const wrapper = mount(SettingsForm, { props: { settings, actions: {} } });
    expect(wrapper.text()).toContain('Embedding');
    expect(wrapper.text()).toContain('Rerank');
    expect(wrapper.text()).toContain('Claude');
    expect(wrapper.text()).toContain('多 Agent');
    await wrapper.get('input[name="model"]').setValue('unsaved-model');
    await wrapper.get('[data-testid="test-model"]').trigger('click');
    expect((wrapper.emitted('testModel')?.[0]?.[0] as any).model).toBe('unsaved-model');
  });

  it('检测进行时表单保持挂载并显示动作反馈', () => {
    const wrapper = mount(SettingsForm, { props: { settings, actions: { testModel: { running: true, status: '', error: '', elapsedMs: 1200 } } } });
    expect(wrapper.find('form').exists()).toBe(true);
    expect(wrapper.text()).toContain('正在测试模型');
    expect(wrapper.get('[data-testid="test-model"]').attributes('disabled')).toBeDefined();
  });
});
