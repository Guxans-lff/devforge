<script setup lang="ts">
import { computed } from 'vue'
import { AlertTriangle, Info } from 'lucide-vue-next'
import { Badge } from '@/components/ui/badge'
import type { WorkspaceConfig } from '@/types/ai'
import { buildWorkspaceConfigSummaryResult } from '@/ai-gui/workspaceConfigSummary'

const props = defineProps<{
  workDir?: string
  config?: WorkspaceConfig | null
}>()

const summary = computed(() => buildWorkspaceConfigSummaryResult(props.config))
const items = computed(() => summary.value.items)
const warnings = computed(() => summary.value.warnings)

function itemClass(tone: 'active' | 'muted' | 'warning'): string {
  if (tone === 'warning') return 'border-amber-500/25 bg-amber-500/5'
  if (tone === 'active') return 'border-primary/20 bg-primary/[0.03]'
  return 'border-border/35 bg-muted/10'
}

function warningClass(severity: 'info' | 'warning' | 'danger'): string {
  if (severity === 'danger') return 'border-destructive/25 bg-destructive/5 text-destructive'
  if (severity === 'warning') return 'border-amber-500/25 bg-amber-500/5 text-amber-600 dark:text-amber-400'
  return 'border-sky-500/20 bg-sky-500/5 text-sky-600 dark:text-sky-400'
}
</script>

<template>
  <section class="space-y-4 rounded-xl border border-border/40 bg-card/40 p-5">
    <div class="flex items-start justify-between gap-4">
      <div class="space-y-1">
        <div class="flex items-center gap-2">
          <div class="h-1 w-1 rounded-full bg-violet-500" />
          <h3 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">项目配置来源</h3>
        </div>
        <p class="text-xs text-muted-foreground">
          汇总当前 workspace 对 Prompt、Skill、模型、任务调度和 Feature Gate 的覆盖，避免不知道配置从哪里生效。
        </p>
        <p class="max-w-[560px] truncate text-[11px] text-muted-foreground/70">
          {{ workDir || '未选择工作目录，当前仅展示默认策略' }}
        </p>
      </div>
      <Badge variant="outline" class="shrink-0 text-[10px]">
        {{ config ? '.devforge/config.json' : '默认配置' }}
      </Badge>
    </div>

    <div v-if="warnings.length" class="space-y-2">
      <div
        v-for="warning in warnings"
        :key="warning.key"
        class="flex gap-2 rounded-lg border px-3 py-2 text-[11px]"
        :class="warningClass(warning.severity)"
      >
        <AlertTriangle v-if="warning.severity !== 'info'" class="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <Info v-else class="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div class="min-w-0">
          <div class="font-medium">{{ warning.title }}</div>
          <p class="mt-0.5 text-current/75">{{ warning.description }}</p>
        </div>
      </div>
    </div>

    <div class="grid gap-2 md:grid-cols-3">
      <div
        v-for="item in items"
        :key="item.key"
        class="rounded-lg border px-3 py-2"
        :class="itemClass(item.tone)"
      >
        <div class="flex items-center justify-between gap-2">
          <span class="text-[11px] font-medium text-foreground/75">{{ item.label }}</span>
          <span
            class="rounded px-1.5 py-0.5 text-[9px]"
            :class="item.source === 'workspace' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'"
          >
            {{ item.source === 'workspace' ? '项目覆盖' : '默认' }}
          </span>
        </div>
        <p class="mt-1 truncate text-[11px] text-muted-foreground" :title="item.value">
          {{ item.value }}
        </p>
      </div>
    </div>
  </section>
</template>
