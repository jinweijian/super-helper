<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { progressView, type ChatProgressState } from './chat-progress';
const props = defineProps<{ progress: ChatProgressState }>();
const emit = defineEmits<{ retry: [] }>();
const stages = {locating: '定位候选', reading: '阅读代码', verifying: '验证假设', summarizing: '整理证据'};
const modes = {auto: '自动', fast: '快速', deep: '深度'};
const now = ref(Date.now());
const timer = setInterval(() => { now.value = Date.now(); }, 1_000);
onBeforeUnmount(() => clearInterval(timer));
const view = computed(() => progressView(props.progress, now.value));
const isRetryable = computed(() => props.progress.state === 'interrupted' && props.progress.session?.retryableTurn);
</script>

<template>
  <section class="progress-line" :class="{ interrupted: progress.state === 'interrupted', 'is-active': view.animated }" role="status" aria-live="polite">
    <span class="progress-dot" aria-hidden="true" />
    <span class="progress-title">{{ view.title }}</span>
    <span class="progress-meta">{{ view.elapsedLabel }} · {{ view.estimateLabel }}</span>
    <span v-if="view.stale && view.animated" class="progress-stale">等待服务返回中…</span>
    <span v-if="progress.state === 'interrupted'" class="progress-meta">{{ view.summary }}</span>
    <span v-if="progress.investigation" class="progress-meta">
      {{ modes[progress.investigation.requestedMode] }}<template v-if="progress.investigation.requestedMode === 'auto' && progress.investigation.resolvedProfile"> → {{ modes[progress.investigation.resolvedProfile] }}</template>
      · {{ stages[progress.investigation.stage] }} · 搜索 {{ progress.investigation.searchCount }} 次 · 已读 {{ progress.investigation.filesRead }} 个文件 · {{ view.heartbeatLabel }}
    </span>
    <button v-if="isRetryable" type="button" class="retry-button" @click="emit('retry')">一键重试</button>
  </section>
</template>
