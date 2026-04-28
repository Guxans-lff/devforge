<script setup lang="ts">
import { computed } from 'vue'
import { Badge } from '@/components/ui/badge'
import type { ProviderConfig } from '@/types/ai'
import { buildProviderCapabilityMatrix, capabilityStateLabel, type CapabilityState } from '@/ai-gui/providerCapabilityMatrix'

const props = defineProps<{
  providers: ProviderConfig[]
  strictPermission?: boolean
}>()

const rows = computed(() => buildProviderCapabilityMatrix(props.providers, {
  strictPermission: props.strictPermission,
}))

function stateClass(state: CapabilityState): string {
  if (state === 'full') return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
  if (state === 'partial') return 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
  return 'bg-muted text-muted-foreground'
}

function formatTokens(value: number): string {
  if (!value) return '-'
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`
  if (value >= 1000) return `${Math.round(value / 1000)}K`
  return String(value)
}
</script>

<template>
  <section class="space-y-4 rounded-xl border border-border/40 bg-card/40 p-5">
    <div class="flex items-start justify-between gap-4">
      <div class="space-y-1">
        <div class="flex items-center gap-2">
          <div class="h-1 w-1 rounded-full bg-sky-500" />
          <h3 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Provider 能力矩阵</h3>
        </div>
        <p class="text-xs text-muted-foreground">
          汇总 Provider 的模型能力、工具调用可用性和当前权限策略，方便判断哪个模型适合当前任务。
        </p>
      </div>
      <Badge variant="outline" class="shrink-0 text-[10px]">
        {{ strictPermission ? '严格权限' : '普通权限' }}
      </Badge>
    </div>

    <div v-if="rows.length === 0" class="rounded-lg border border-dashed border-border/50 px-4 py-6 text-center text-xs text-muted-foreground">
      暂无 Provider，请先添加模型服务商。
    </div>

    <div v-else class="overflow-x-auto">
      <table class="w-full min-w-[760px] text-left text-xs">
        <thead class="text-[10px] uppercase tracking-wider text-muted-foreground/70">
          <tr class="border-b border-border/30">
            <th class="py-2 pr-3 font-medium">Provider</th>
            <th class="px-2 py-2 font-medium">模型</th>
            <th class="px-2 py-2 font-medium">Streaming</th>
            <th class="px-2 py-2 font-medium">Vision</th>
            <th class="px-2 py-2 font-medium">Thinking</th>
            <th class="px-2 py-2 font-medium">Tools</th>
            <th class="px-2 py-2 font-medium">Context</th>
            <th class="px-2 py-2 font-medium">Output</th>
            <th class="py-2 pl-2 font-medium">提示</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.providerId" class="border-b border-border/20 last:border-0">
            <td class="py-3 pr-3 align-top">
              <div class="font-medium text-foreground/85">{{ row.providerName }}</div>
              <div class="mt-0.5 text-[10px] text-muted-foreground">{{ row.providerType }}</div>
            </td>
            <td class="px-2 py-3 align-top text-muted-foreground">{{ row.modelCount }}</td>
            <td class="px-2 py-3 align-top"><span class="rounded px-1.5 py-0.5 text-[10px]" :class="stateClass(row.streaming)">{{ capabilityStateLabel(row.streaming) }}</span></td>
            <td class="px-2 py-3 align-top"><span class="rounded px-1.5 py-0.5 text-[10px]" :class="stateClass(row.vision)">{{ capabilityStateLabel(row.vision) }}</span></td>
            <td class="px-2 py-3 align-top"><span class="rounded px-1.5 py-0.5 text-[10px]" :class="stateClass(row.thinking)">{{ capabilityStateLabel(row.thinking) }}</span></td>
            <td class="px-2 py-3 align-top"><span class="rounded px-1.5 py-0.5 text-[10px]" :class="stateClass(row.toolUse)">{{ capabilityStateLabel(row.toolUse) }}</span></td>
            <td class="px-2 py-3 align-top font-mono text-[11px] text-muted-foreground">{{ formatTokens(row.maxContext) }}</td>
            <td class="px-2 py-3 align-top font-mono text-[11px] text-muted-foreground">{{ formatTokens(row.maxOutput) }}</td>
            <td class="py-3 pl-2 align-top">
              <div v-if="row.notes.length" class="flex flex-wrap gap-1">
                <span v-for="note in row.notes" :key="note" class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {{ note }}
                </span>
              </div>
              <span v-else class="text-[10px] text-muted-foreground/60">能力完整</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
