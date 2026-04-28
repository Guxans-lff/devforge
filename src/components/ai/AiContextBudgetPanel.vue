<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ContextBudgetReport, BudgetCategoryKey } from '@/composables/ai-agent/diagnostics/contextBudgetAnalyzer'
import {
  BarChart3,
  ChevronRight,
  Cpu,
  FileText,
  Lightbulb,
  MessageSquare,
  ShieldAlert,
  Sparkles,
  Wrench,
  Zap,
} from 'lucide-vue-next'

const props = defineProps<{
  report: ContextBudgetReport
}>()

const emit = defineEmits<{
  (e: 'compact'): void
  (e: 'clearAttachments'): void
  (e: 'clearToolResults'): void
}>()

const { t } = useI18n()
const expanded = ref(false)
const showDetails = ref<Record<BudgetCategoryKey, boolean>>({
  systemPrompt: false,
  memory: false,
  messages: false,
  toolResults: false,
  attachments: false,
  compactSummary: false,
  safetyContext: false,
})

const tone = computed(() => {
  if (props.report.usagePercent >= 90) return 'danger'
  if (props.report.usagePercent >= 75) return 'warn'
  return 'ok'
})

const toneClass = computed(() => {
  if (tone.value === 'danger') return 'border-rose-500/25 bg-rose-500/10'
  if (tone.value === 'warn') return 'border-amber-500/25 bg-amber-500/10'
  return 'border-emerald-500/20 bg-emerald-500/8'
})

const toneTextClass = computed(() => {
  if (tone.value === 'danger') return 'text-rose-500'
  if (tone.value === 'warn') return 'text-amber-500'
  return 'text-emerald-500'
})

const categoryIcons: Record<BudgetCategoryKey, typeof BarChart3> = {
  systemPrompt: Sparkles,
  memory: Lightbulb,
  messages: MessageSquare,
  toolResults: Wrench,
  attachments: FileText,
  compactSummary: Zap,
  safetyContext: ShieldAlert,
}

const categoryOrder: BudgetCategoryKey[] = [
  'systemPrompt',
  'memory',
  'messages',
  'toolResults',
  'attachments',
  'compactSummary',
  'safetyContext',
]

const sortedCategories = computed(() => {
  const map = new Map(props.report.categories.map(c => [c.key, c]))
  return categoryOrder.map(key => map.get(key)).filter(Boolean) as typeof props.report.categories
})

const largestCategory = computed(() => {
  if (!props.report.largestCategoryKey) return null
  return props.report.categories.find(c => c.key === props.report.largestCategoryKey) ?? null
})

function barWidth(tokens: number): string {
  if (props.report.totalTokens === 0) return '0%'
  const pct = (tokens / props.report.totalTokens) * 100
  return `${Math.min(100, Math.max(2, pct))}%`
}

function categoryPercent(tokens: number): number {
  if (props.report.totalTokens === 0) return 0
  return Math.round((tokens / props.report.totalTokens) * 100)
}

function toggleDetails(key: BudgetCategoryKey): void {
  showDetails.value = { ...showDetails.value, [key]: !showDetails.value[key] }
}

const hasActions = computed(() =>
  props.report.categories.some(c => c.key === 'messages' && c.tokens > 0)
  || props.report.categories.some(c => c.key === 'attachments' && c.tokens > 0)
  || props.report.categories.some(c => c.key === 'toolResults' && c.tokens > 0),
)
</script>

<template>
  <div class="my-2 rounded-xl border px-3 py-2" :class="toneClass">
    <button
      class="flex w-full items-center gap-2 text-left"
      @click="expanded = !expanded"
    >
      <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-background/70 text-primary">
        <BarChart3 class="h-4 w-4" />
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/75">
            {{ t('ai.contextBudget.title') }}
          </span>
          <span
            class="rounded-full bg-background/70 px-2 py-0.5 text-[10px] text-muted-foreground"
            :class="toneTextClass"
          >
            {{ t('ai.contextBudget.usage', { percent: report.usagePercent }) }}
          </span>
          <span
            v-if="largestCategory"
            class="rounded-full bg-background/70 px-2 py-0.5 text-[10px] text-muted-foreground"
          >
            {{ t('ai.contextBudget.largestCategory') }}: {{ t(`ai.contextBudget.${largestCategory.key}`) }}
          </span>
        </div>
        <p class="line-clamp-2 text-[11px] text-muted-foreground/75">
          {{ report.totalTokens.toLocaleString() }} / {{ report.maxContextTokens.toLocaleString() }} tokens
          <span v-if="report.recommendations.length > 0">
            · {{ report.recommendations[0] }}
          </span>
        </p>
      </div>
      <ChevronRight
        class="h-4 w-4 shrink-0 text-muted-foreground/55 transition-transform"
        :class="expanded ? 'rotate-90' : ''"
      />
    </button>

    <div v-if="expanded" class="mt-3 space-y-3">
      <!-- 总览进度条 -->
      <div class="rounded-lg border border-border/25 bg-background/70 px-3 py-2">
        <div class="mb-1.5 flex items-center justify-between text-[11px]">
          <span class="text-muted-foreground/70">{{ t('ai.contextBudget.total') }}</span>
          <span class="font-mono text-foreground/85">
            {{ report.totalTokens.toLocaleString() }}{{ t('ai.contextBudget.ofLimit', { limit: report.maxContextTokens.toLocaleString() }) }}
          </span>
        </div>
        <div class="h-2 w-full overflow-hidden rounded-full bg-muted/40">
          <div
            class="h-full rounded-full transition-all duration-500"
            :class="tone === 'danger' ? 'bg-rose-500' : tone === 'warn' ? 'bg-amber-500' : 'bg-emerald-500'"
            :style="{ width: `${report.usagePercent}%` }"
          />
        </div>
      </div>

      <!-- 分类明细 -->
      <div class="space-y-2">
        <div
          v-for="category in sortedCategories"
          :key="category.key"
          class="rounded-lg border border-border/20 bg-background/60 px-3 py-2"
        >
          <div class="flex items-center gap-2">
            <component :is="categoryIcons[category.key]" class="h-3.5 w-3.5 text-muted-foreground/60" />
            <span class="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/80">
              {{ t(`ai.contextBudget.${category.key}`) }}
            </span>
            <span class="shrink-0 text-[11px] font-mono text-foreground/80">
              {{ category.tokens.toLocaleString() }}
            </span>
            <span class="shrink-0 w-10 text-right text-[10px] text-muted-foreground/60">
              {{ categoryPercent(category.tokens) }}%
            </span>
            <button
              v-if="category.items && category.items.length > 0"
              class="shrink-0 text-[10px] text-primary/70 hover:text-primary"
              @click="toggleDetails(category.key)"
            >
              {{ showDetails[category.key] ? t('ai.contextBudget.hideDetails') : t('ai.contextBudget.showDetails') }}
            </button>
          </div>
          <div class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted/30">
            <div
              class="h-full rounded-full bg-primary/50 transition-all duration-500"
              :style="{ width: barWidth(category.tokens) }"
            />
          </div>
          <p class="mt-1 text-[10px] text-muted-foreground/50">
            {{ t(`ai.contextBudget.categoryDescription.${category.key}`) }}
            <span v-if="category.itemCount > 0">
              · {{ t('ai.contextBudget.itemCount', { count: category.itemCount }) }}
            </span>
          </p>

          <!-- 明细列表 -->
          <div v-if="showDetails[category.key] && category.items" class="mt-2 space-y-1 border-t border-border/15 pt-2">
            <div
              v-for="(item, idx) in category.items"
              :key="idx"
              class="flex items-center justify-between gap-2 text-[10px]"
            >
              <span class="min-w-0 flex-1 truncate text-muted-foreground/65">{{ item.label }}</span>
              <span v-if="item.detail" class="shrink-0 text-muted-foreground/40">{{ item.detail }}</span>
              <span class="shrink-0 font-mono text-muted-foreground/70">{{ item.tokens.toLocaleString() }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 优化建议 -->
      <div
        v-if="report.recommendations.length > 0"
        class="rounded-lg border border-border/25 bg-background/70 px-3 py-3"
      >
        <div class="mb-2 flex items-center gap-2 text-muted-foreground/70">
          <Cpu class="h-3.5 w-3.5" />
          <span class="text-[10px] uppercase tracking-[0.16em]">{{ t('ai.contextBudget.recommendations') }}</span>
        </div>
        <ul class="list-disc space-y-1 pl-4 text-[11px] text-muted-foreground/80">
          <li v-for="(rec, idx) in report.recommendations" :key="idx">{{ rec }}</li>
        </ul>
      </div>
      <div v-else class="rounded-lg border border-border/25 bg-background/70 px-3 py-2 text-[11px] text-muted-foreground/60">
        {{ t('ai.contextBudget.noRecommendations') }}
      </div>

      <!-- 快捷操作 -->
      <div v-if="hasActions" class="flex flex-wrap gap-2">
        <button
          v-if="report.categories.some(c => c.key === 'messages' && c.tokens > 0)"
          class="inline-flex items-center gap-1 rounded-md border border-border/30 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground"
          @click="emit('compact')"
        >
          <Zap class="h-3 w-3" />
          {{ t('ai.contextBudget.compactHistory') }}
        </button>
        <button
          v-if="report.categories.some(c => c.key === 'attachments' && c.tokens > 0)"
          class="inline-flex items-center gap-1 rounded-md border border-border/30 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground"
          @click="emit('clearAttachments')"
        >
          <FileText class="h-3 w-3" />
          {{ t('ai.contextBudget.clearAttachments') }}
        </button>
        <button
          v-if="report.categories.some(c => c.key === 'toolResults' && c.tokens > 0)"
          class="inline-flex items-center gap-1 rounded-md border border-border/30 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground"
          @click="emit('clearToolResults')"
        >
          <Wrench class="h-3 w-3" />
          {{ t('ai.contextBudget.clearToolResults') }}
        </button>
      </div>
    </div>
  </div>
</template>
