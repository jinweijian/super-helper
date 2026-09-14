<script setup lang="ts">
interface Profiles {
  enabled: boolean;
  fast: {model?: string; effort: string; maxTurns?: number};
  deep: {model?: string; effort: string; timeoutMs: number};
}
const profiles = defineModel<Profiles>({required: true});
</script>

<template>
  <section aria-label="排查模式配置">
    <label class="check-label"><input v-model="profiles.enabled" type="checkbox" />启用自动升级</label>
    <div v-if="profiles.enabled" class="field-grid">
      <label>快速排查最多轮数<input v-model.number="profiles.fast.maxTurns" name="fastMaxTurns" type="number" min="1" step="1" /></label>
    </div>
    <p class="muted">快速和深度始终可手动选择，并继承当前 Claude 模型；自动模式会在证据不足时升级为深度排查。</p>
  </section>
</template>
