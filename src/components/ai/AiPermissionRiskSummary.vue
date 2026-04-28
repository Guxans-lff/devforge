<script setup lang="ts">
import { computed } from 'vue'
import { AlertTriangle, Info, ShieldAlert } from 'lucide-vue-next'
import type { ApprovalRiskSummary } from '@/ai-gui/approvalRisk'

const props = defineProps<{
  summary: ApprovalRiskSummary
}>()

const toneClass = computed(() => {
  if (props.summary.tone === 'danger') return 'border-red-500/25 bg-red-500/8 text-red-500'
  if (props.summary.tone === 'warning') return 'border-amber-500/25 bg-amber-500/8 text-amber-500'
  return 'border-blue-500/25 bg-blue-500/8 text-blue-500'
})

const Icon = computed(() => {
  if (props.summary.tone === 'danger') return ShieldAlert
  if (props.summary.tone === 'warning') return AlertTriangle
  return Info
})
</script>

<template>
  <div class="mx-2 mt-2 rounded-md border px-3 py-2" :class="toneClass">
    <div class="flex items-start gap-2">
      <component :is="Icon" class="mt-0.5 h-4 w-4 shrink-0" />
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-[12px] font-semibold">{{ summary.label }}</span>
          <span class="text-[11px] text-current/75">{{ summary.description }}</span>
        </div>
        <div class="mt-2 grid gap-2 text-[11px] leading-relaxed text-current/80 md:grid-cols-2">
          <div>
            <div class="mb-1 font-medium text-current/90">可能影响</div>
            <ul class="list-disc space-y-0.5 pl-4">
              <li v-for="risk in summary.risks" :key="risk">{{ risk }}</li>
            </ul>
          </div>
          <div>
            <div class="mb-1 font-medium text-current/90">确认建议</div>
            <ul class="list-disc space-y-0.5 pl-4">
              <li v-for="recommendation in summary.recommendations" :key="recommendation">{{ recommendation }}</li>
            </ul>
          </div>
        </div>
        <div class="mt-2 rounded border border-current/15 bg-background/35 px-2 py-1 text-[10px] text-current/70">
          {{ summary.trustWarning }}
        </div>
      </div>
    </div>
  </div>
</template>
