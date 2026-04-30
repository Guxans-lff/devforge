<script setup lang="ts">
import { computed } from 'vue'
import { Activity, History } from 'lucide-vue-next'
import type { ToolActivitySummary } from '@/types/ai'
import { toToolDisplayName } from '@/composables/ai/toolActivitySummary'

const props = withDefaults(defineProps<{
  summary: ToolActivitySummary
  variant?: 'history' | 'runtime'
}>(), {
  variant: 'runtime',
})

const isHistory = computed(() => props.variant === 'history')

const title = computed(() => {
  const summary = props.summary
  if (isHistory.value) {
    if (summary.callCount <= 1) return '之前执行过 1 个操作'
    return `之前执行过 ${summary.callCount} 个操作`
  }
  if (summary.errorCount > 0) return `执行了 ${summary.callCount} 个操作，其中 ${summary.errorCount} 个失败`
  if (summary.pendingCount > 0) return `正在执行 ${summary.pendingCount} 个操作`
  return `本轮执行了 ${summary.callCount} 个操作`
})

const detail = computed(() => {
  const summary = props.summary
  if (isHistory.value) {
    const parts: string[] = []
    if (summary.resultCount > 0) parts.push(`${summary.resultCount} 个结果`)
    if (summary.successCount > 0) parts.push(`${summary.successCount} 个成功`)
    if (summary.errorCount > 0) parts.push(`${summary.errorCount} 个失败`)
    if (summary.pendingCount > 0) parts.push(`${summary.pendingCount} 个未完成`)
    const text = parts.length ? parts.join('，') : '完整记录保留在本地历史中'
    return `${text}。默认只显示摘要，避免恢复大会话时卡顿。`
  }

  const labels = summary.buckets
    .filter(bucket => bucket.count > 0)
    .map(bucket => `${bucket.label} ${bucket.count}`)
  if (!labels.length) return '工具详情已按类型折叠在下方，需要时再展开。'
  return `${labels.join('，')}。详情按类型折叠展示，避免大量工具结果占满对话。`
})

const toolNameLabels = computed(() =>
  props.summary.toolNames.map(toToolDisplayName),
)

const visibleBuckets = computed(() =>
  props.summary.buckets.filter(bucket => bucket.count > 0 || bucket.successCount > 0 || bucket.errorCount > 0),
)

const badgeText = computed(() => isHistory.value ? '历史记录' : '本轮操作')
const Icon = computed(() => isHistory.value ? History : Activity)
</script>

<template>
  <div
    class="tool-activity-summary-card"
    :class="isHistory ? 'is-history' : 'is-runtime'"
    :aria-label="isHistory ? '历史操作摘要' : '本轮工具活动摘要'"
  >
    <div class="tool-activity-summary-icon" aria-hidden="true">
      <component :is="Icon" class="h-3.5 w-3.5" />
    </div>
    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-center gap-2">
        <strong>{{ title }}</strong>
        <span class="tool-activity-summary-badge">{{ badgeText }}</span>
      </div>
      <p>{{ detail }}</p>
      <div v-if="toolNameLabels.length" class="tool-activity-tool-names">
        <span
          v-for="name in toolNameLabels"
          :key="name"
        >
          {{ name }}
        </span>
      </div>
      <div v-if="visibleBuckets.length" class="tool-activity-buckets">
        <span
          v-for="bucket in visibleBuckets"
          :key="bucket.category"
          :class="`is-${bucket.category}`"
        >
          {{ bucket.label }} {{ bucket.count }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tool-activity-summary-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: min(100%, 720px);
  padding: 10px 12px;
  border: 1px solid rgb(106 168 255 / 0.12);
  border-radius: 14px;
  background:
    linear-gradient(135deg, rgb(106 168 255 / 0.055), transparent 45%),
    rgb(255 255 255 / 0.024);
  color: rgb(244 244 245 / 0.78);
}

.tool-activity-summary-card.is-history {
  border-color: rgb(85 216 153 / 0.12);
  background:
    linear-gradient(135deg, rgb(85 216 153 / 0.055), transparent 42%),
    rgb(255 255 255 / 0.026);
}

.tool-activity-summary-icon {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  margin-top: 1px;
  border: 1px solid rgb(106 168 255 / 0.18);
  border-radius: 999px;
  background: rgb(106 168 255 / 0.08);
  color: rgb(147 197 253 / 0.78);
}

.is-history .tool-activity-summary-icon {
  border-color: rgb(85 216 153 / 0.18);
  background: rgb(85 216 153 / 0.08);
  color: rgb(134 239 172 / 0.78);
}

.tool-activity-summary-card strong {
  font-size: 12px;
  font-weight: 650;
  color: rgb(244 244 245 / 0.88);
}

.tool-activity-summary-card p {
  margin: 2px 0 0;
  font-size: 12px;
  line-height: 1.55;
  color: rgb(161 161 170 / 0.78);
}

.tool-activity-summary-badge {
  border-radius: 999px;
  background: rgb(106 168 255 / 0.09);
  padding: 2px 7px;
  font-size: 10px;
  color: rgb(147 197 253 / 0.82);
}

.is-history .tool-activity-summary-badge {
  background: rgb(255 255 255 / 0.055);
  color: rgb(161 161 170 / 0.72);
}

.tool-activity-tool-names,
.tool-activity-buckets {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 7px;
}

.tool-activity-tool-names span,
.tool-activity-buckets span {
  border: 1px solid rgb(255 255 255 / 0.07);
  border-radius: 999px;
  background: rgb(0 0 0 / 0.14);
  padding: 2px 7px;
  font-size: 11px;
  line-height: 1.45;
  color: rgb(212 212 216 / 0.72);
}

.tool-activity-buckets .is-write,
.tool-activity-buckets .is-command {
  border-color: rgb(251 191 36 / 0.16);
  background: rgb(251 191 36 / 0.055);
  color: rgb(252 211 77 / 0.76);
}

.tool-activity-buckets .is-read,
.tool-activity-buckets .is-search {
  border-color: rgb(96 165 250 / 0.14);
  background: rgb(96 165 250 / 0.045);
  color: rgb(147 197 253 / 0.76);
}

.tool-activity-buckets .is-todo,
.tool-activity-buckets .is-agent {
  border-color: rgb(168 85 247 / 0.14);
  background: rgb(168 85 247 / 0.045);
  color: rgb(216 180 254 / 0.76);
}

.tool-activity-buckets .is-database {
  border-color: rgb(45 212 191 / 0.14);
  background: rgb(45 212 191 / 0.045);
  color: rgb(94 234 212 / 0.74);
}
</style>

