<script setup lang="ts">
import { reactive, watch } from 'vue';
import type { SettingsActionState } from './use-settings';
import InvestigationSettings from './InvestigationSettings.vue';

const props = defineProps<{ settings: Record<string, any>; actions: Partial<Record<string, SettingsActionState>> }>();
const emit = defineEmits<{ saveModel: [value: Record<string, unknown>]; saveClaude: [value: Record<string, unknown>]; testModel: [value: Record<string, unknown>] }>();
const form = reactive<any>({ model: {}, claude: {} });
watch(() => props.settings, hydrate, { immediate: true, deep: true });
function hydrate(settings: Record<string, any>): void {
  const providerId = settings.agent?.modelProvider ?? Object.keys(settings.models?.providers ?? {})[0] ?? 'default';
  const model = settings.models?.providers?.[providerId] ?? settings.model ?? {};
  form.model = { providerId, model: model.model ?? '', baseUrl: model.baseUrl ?? '', api: model.api ?? 'openai-completions', apiKeyEnv: model.apiKeyEnv ?? '', apiKey: '', maxTokens: model.maxTokens ?? 1200, temperature: model.temperature ?? 0, contextWindowTokens: settings.agent?.contextWindowTokens ?? model.contextWindowTokens ?? 200000, useModelForRagAnswerability: settings.agent?.useModelForRagAnswerability ?? true };
  form.claude = { timeoutMs: settings.claude?.timeoutMs ?? 1200000, maxBudgetUsd: settings.claude?.maxBudgetUsd ?? '', sessionBusyMaxRetries: settings.claude?.sessionBusyMaxRetries ?? 3, sessionBusyRetryDelayMs: settings.claude?.sessionBusyRetryDelayMs ?? 3000 };
  form.claude.investigationProfiles = settings.claude?.investigationProfiles
    ? JSON.parse(JSON.stringify(settings.claude.investigationProfiles))
    : {enabled:false,fast:{effort:'low',maxTurns:5},deep:{effort:'high',timeoutMs:settings.claude?.timeoutMs || 1200000}};
}
function saveClaude(): void {
  const body = {...form.claude};
  if (!body.investigationProfiles.enabled && !props.settings.claude?.investigationProfiles) delete body.investigationProfiles;
  emit('saveClaude', body);
}
function clean(value: Record<string, any>): Record<string, unknown> { return Object.fromEntries(Object.entries(value).filter(([key, item]) => key !== 'apiKey' || String(item).trim())); }
function feedback(name: string, label: string): string { const state = props.actions[name]; return state?.running ? `正在${label}…` : state?.error || state?.status || ''; }
</script>

<template>
  <form class="settings-form" @submit.prevent>
    <p v-if="actions.load?.error" class="error-banner">{{ actions.load.error }}</p><p v-else-if="actions.load?.status" class="status-banner">{{ actions.load.status }}</p>
    <fieldset><legend>Agent 模型</legend>
      <div class="field-grid"><label>Provider ID<input v-model="form.model.providerId" name="providerId" /></label><label>模型<input v-model="form.model.model" name="model" /></label></div>
      <label>Base URL<input v-model="form.model.baseUrl" type="url" /></label>
      <div class="field-grid"><label>API 类型<select v-model="form.model.api"><option value="openai-completions">openai-completions</option><option value="openai-chat-completions">openai-chat-completions</option></select></label><label>API Key 环境变量<input v-model="form.model.apiKeyEnv" /></label></div>
      <label>API Key<input v-model="form.model.apiKey" type="password" autocomplete="off" placeholder="留空保持原值" /></label>
      <div class="field-grid"><label>Max Tokens<input v-model.number="form.model.maxTokens" type="number" /></label><label>Temperature<input v-model.number="form.model.temperature" type="number" step="0.1" /></label></div>
      <label>上下文窗口 Tokens<input v-model.number="form.model.contextWindowTokens" type="number" /></label>
      <p class="status-banner">{{ feedback('saveModel', '保存模型') || feedback('testModel', '测试模型') }}</p><div class="stack-actions"><button data-testid="test-model" type="button" :disabled="actions.testModel?.running" @click="emit('testModel', clean(form.model))">测试模型</button><button class="primary" type="button" :disabled="actions.saveModel?.running" @click="emit('saveModel', clean(form.model))">保存模型</button></div>
    </fieldset>
    <p class="muted">文档知识库已下线。后续经验将通过受治理的 Markdown 产物接入知识图谱。</p>
    <fieldset><legend>Claude</legend><div class="field-grid"><label>超时毫秒<input v-model.number="form.claude.timeoutMs" type="number" /></label><label>预算 USD<input v-model="form.claude.maxBudgetUsd" type="number" step="0.01" placeholder="不限制" /></label></div><div class="field-grid"><label>Session busy 重试次数<input v-model.number="form.claude.sessionBusyMaxRetries" type="number" /></label><label>重试间隔毫秒<input v-model.number="form.claude.sessionBusyRetryDelayMs" type="number" /></label></div><InvestigationSettings v-model="form.claude.investigationProfiles" /><p class="status-banner">{{ feedback('saveClaude', '保存 Claude') }}</p><button type="button" @click="saveClaude">保存 Claude</button></fieldset>
    <fieldset><legend>多 Agent</legend><article v-for="agent in settings.agents || []" :key="agent.id" class="agent-summary"><strong>{{ agent.name || agent.id }}</strong><span>{{ agent.role }}</span></article><p v-if="!settings.agents?.length" class="muted">暂无 Agent 配置摘要。</p></fieldset>
  </form>
</template>
