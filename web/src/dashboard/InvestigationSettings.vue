<script setup lang="ts">
interface Profiles {
  enabled: boolean;
  fast: {model: string; effort: string; maxTurns?: number};
  deep: {model: string; effort: string; timeoutMs: number};
}
const profiles = defineModel<Profiles>({required: true});
</script>

<template>
  <section aria-label="排查模式配置">
    <h3>排查模式</h3>
    <label class="check-label"><input v-model="profiles.enabled" type="checkbox" />启用自动／快速／深度</label>
    <p class="muted">请先用真实问题校准模型和快速轮数，再启用。关闭后使用原有排查配置。</p>
    <div class="field-grid">
      <label>快速模型<input v-model="profiles.fast.model" name="fastModel" placeholder="已验证的模型路由" /></label>
      <label>快速推理强度<select v-model="profiles.fast.effort"><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label>
      <label>快速最多轮数<input v-model.number="profiles.fast.maxTurns" name="fastMaxTurns" type="number" min="1" step="1" placeholder="填入评测结果" /></label>
    </div>
    <div class="field-grid">
      <label>深度模型<input v-model="profiles.deep.model" name="deepModel" placeholder="已验证的强模型路由" /></label>
      <label>深度推理强度<select v-model="profiles.deep.effort"><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label>
      <label>深度异常进程超时（毫秒）<input v-model.number="profiles.deep.timeoutMs" name="deepTimeoutMs" type="number" min="1" /></label>
    </div>
    <p class="muted">深度模式按证据进展继续排查；超时仅作为异常进程兜底。</p>
  </section>
</template>
