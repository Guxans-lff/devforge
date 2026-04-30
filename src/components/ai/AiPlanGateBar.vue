<script setup lang="ts">
/**
 * Plan Gate 审批卡片。
 *
 * 展示 AI 生成的执行计划，用户确认后才允许继续执行工具。
 */
import { computed } from 'vue'
import { CheckCircle2, ClipboardList, RotateCcw, ShieldCheck } from 'lucide-vue-next'

const props = defineProps<{
  plan: string
}>()

const emit = defineEmits<{
  (e: 'approve'): void
  (e: 'reject'): void
}>()

const normalizedPlan = computed(() => props.plan.trim())
const planLines = computed(() =>
  normalizedPlan.value
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean),
)
const previewTitle = computed(() => {
  const firstStrongLine = planLines.value.find(line => /^#{1,3}\s+|^\*\*.+\*\*$/.test(line))
  return firstStrongLine
    ?.replace(/^#{1,3}\s+/, '')
    .replace(/^\*\*|\*\*$/g, '')
    .trim()
    || '执行计划待确认'
})
const stepCount = computed(() =>
  planLines.value.filter(line => /^(\d+[\).、]|[-*]\s+)/.test(line)).length,
)
</script>

<template>
  <section class="plan-gate-card" aria-label="执行计划确认">
    <div class="plan-gate-rail" />
    <div class="plan-gate-glow" />

    <header class="plan-gate-header">
      <div class="plan-gate-heading">
        <span class="plan-gate-icon">
          <ClipboardList class="h-4 w-4" />
        </span>
        <span class="plan-gate-kicker">PLAN GATE</span>
        <span class="plan-gate-dot" />
        <span class="plan-gate-note">确认后才会执行工具</span>
      </div>

      <div class="plan-gate-actions" aria-label="执行计划操作">
        <button
          type="button"
          class="plan-gate-button is-replan"
          @click="emit('reject')"
        >
          <RotateCcw class="h-4 w-4" />
          重新规划
        </button>
        <button
          type="button"
          class="plan-gate-button is-approve"
          @click="emit('approve')"
        >
          <CheckCircle2 class="h-4 w-4" />
          确认执行
        </button>
      </div>
    </header>

    <div class="plan-gate-body">
      <aside class="plan-gate-summary">
        <div class="plan-gate-seal">
          <ShieldCheck class="h-5 w-5" />
        </div>
        <div class="min-w-0">
          <p class="plan-gate-label">执行计划</p>
          <h3 class="plan-gate-title">{{ previewTitle }}</h3>
          <p class="plan-gate-meta">
            {{ stepCount > 0 ? `${stepCount} 个步骤等待确认` : '等待你确认执行边界' }}
          </p>
        </div>
      </aside>

      <div class="plan-gate-content-wrap">
        <div class="plan-gate-content-head">
          <span>计划正文</span>
          <span>只读预览</span>
        </div>
        <pre class="plan-gate-content">{{ normalizedPlan }}</pre>
      </div>
    </div>
  </section>
</template>

<style scoped>
.plan-gate-card {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  border: 1px solid rgb(245 158 11 / 0.24);
  border-radius: 24px;
  background:
    radial-gradient(circle at 8% 0%, rgb(245 158 11 / 0.16), transparent 34%),
    linear-gradient(135deg, rgb(39 39 42 / 0.96), rgb(12 12 14 / 0.98) 58%, rgb(4 4 5 / 0.98));
  box-shadow:
    0 22px 76px rgb(0 0 0 / 0.36),
    0 1px 0 rgb(255 255 255 / 0.06) inset;
}

.plan-gate-rail {
  position: absolute;
  inset: 0 auto 0 0;
  width: 4px;
  background: linear-gradient(180deg, rgb(251 191 36), rgb(16 185 129), rgb(245 158 11));
}

.plan-gate-glow {
  position: absolute;
  inset: -120px -80px auto auto;
  z-index: -1;
  width: 320px;
  height: 240px;
  border-radius: 999px;
  background: radial-gradient(circle, rgb(16 185 129 / 0.12), transparent 68%);
  filter: blur(6px);
}

.plan-gate-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid rgb(255 255 255 / 0.08);
  padding: 16px 18px 14px 22px;
}

.plan-gate-heading {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}

.plan-gate-icon {
  display: grid;
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid rgb(251 191 36 / 0.28);
  border-radius: 12px;
  background: rgb(251 191 36 / 0.1);
  color: rgb(252 211 77);
}

.plan-gate-kicker {
  color: rgb(254 243 199);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  font-weight: 850;
  letter-spacing: 0.14em;
}

.plan-gate-dot {
  width: 4px;
  height: 4px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: rgb(252 211 77 / 0.72);
}

.plan-gate-note {
  overflow: hidden;
  color: rgb(212 212 216 / 0.68);
  font-size: 12px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plan-gate-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
}

.plan-gate-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 34px;
  border: 1px solid transparent;
  border-radius: 12px;
  padding: 8px 13px;
  font-size: 12px;
  font-weight: 750;
  transition:
    transform 140ms ease,
    border-color 140ms ease,
    background 140ms ease,
    box-shadow 140ms ease;
}

.plan-gate-button:hover {
  transform: translateY(-1px);
}

.plan-gate-button:focus-visible {
  outline: 2px solid rgb(251 191 36 / 0.72);
  outline-offset: 2px;
}

.plan-gate-button.is-approve {
  border-color: rgb(16 185 129 / 0.42);
  background: linear-gradient(180deg, rgb(16 185 129 / 0.22), rgb(16 185 129 / 0.13));
  box-shadow: 0 10px 28px rgb(16 185 129 / 0.12);
  color: rgb(167 243 208);
}

.plan-gate-button.is-replan {
  border-color: rgb(255 255 255 / 0.1);
  background: rgb(255 255 255 / 0.055);
  color: rgb(228 228 231 / 0.86);
}

.plan-gate-button.is-replan:hover {
  border-color: rgb(251 191 36 / 0.28);
  background: rgb(251 191 36 / 0.08);
}

.plan-gate-body {
  display: grid;
  grid-template-columns: minmax(220px, 300px) minmax(0, 1fr);
  gap: 14px;
  padding: 16px 18px 18px 22px;
}

.plan-gate-summary {
  display: flex;
  min-width: 0;
  align-self: stretch;
  gap: 12px;
  border: 1px solid rgb(255 255 255 / 0.08);
  border-radius: 18px;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 0.055), rgb(255 255 255 / 0.026)),
    rgb(255 255 255 / 0.025);
  padding: 15px;
}

.plan-gate-seal {
  display: grid;
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid rgb(251 191 36 / 0.22);
  border-radius: 15px;
  background: rgb(251 191 36 / 0.1);
  color: rgb(252 211 77);
}

.plan-gate-label {
  margin: 0 0 7px;
  color: rgb(251 191 36 / 0.82);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.1em;
}

.plan-gate-title {
  margin: 0;
  color: rgb(250 250 250 / 0.96);
  font-size: 15px;
  font-weight: 800;
  line-height: 1.42;
}

.plan-gate-meta {
  margin: 9px 0 0;
  color: rgb(161 161 170 / 0.76);
  font-size: 12px;
  line-height: 1.45;
}

.plan-gate-content-wrap {
  min-width: 0;
  overflow: hidden;
  border: 1px solid rgb(255 255 255 / 0.08);
  border-radius: 18px;
  background: rgb(5 5 7 / 0.58);
}

.plan-gate-content-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgb(255 255 255 / 0.07);
  padding: 9px 13px;
  color: rgb(161 161 170 / 0.74);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.plan-gate-content {
  max-height: 360px;
  min-height: 132px;
  overflow: auto;
  margin: 0;
  background:
    linear-gradient(90deg, rgb(255 255 255 / 0.035) 1px, transparent 1px),
    linear-gradient(180deg, rgb(255 255 255 / 0.035) 1px, transparent 1px);
  background-size: 36px 36px;
  padding: 15px 16px 17px;
  color: rgb(254 243 199 / 0.92);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.72;
  white-space: pre-wrap;
}

@media (max-width: 980px) {
  .plan-gate-header,
  .plan-gate-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .plan-gate-heading {
    align-self: stretch;
  }

  .plan-gate-body {
    grid-template-columns: 1fr;
  }
}
</style>
