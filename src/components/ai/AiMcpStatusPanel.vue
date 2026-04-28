<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Activity, AlertTriangle, CheckCircle2, RefreshCw, Server, Wrench, XCircle } from 'lucide-vue-next'
import { aiGetMcpStatus, aiGetTools } from '@/api/ai'
import type { McpStatusResult, ModelConfig, ToolDefinition } from '@/types/ai'
import { parseMcpConfig, summarizeMcpStatus, type McpConfigParseResult, type McpStatusLevel } from '@/ai-gui/mcpStatus'

const props = defineProps<{
  model?: ModelConfig | null
  workDir?: string
}>()

const tools = ref<ToolDefinition[]>([])
const mcpConfig = ref<McpConfigParseResult | null>(null)
const mcpRuntime = ref<McpStatusResult | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

const summary = computed(() => summarizeMcpStatus({
  tools: tools.value,
  model: props.model,
  workDir: props.workDir,
  loading: loading.value,
  error: error.value,
  mcpConfig: mcpConfig.value,
  mcpRuntime: mcpRuntime.value,
}))

function levelClass(level: McpStatusLevel): string {
  if (level === 'ready') return 'border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400'
  if (level === 'error') return 'border-destructive/25 bg-destructive/5 text-destructive'
  if (level === 'disabled') return 'border-muted bg-muted/10 text-muted-foreground'
  return 'border-amber-500/20 bg-amber-500/5 text-amber-600 dark:text-amber-400'
}

function serverStatusClass(status?: string): string {
  if (status === 'configured' || status === 'connected') return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
  if (status === 'error') return 'bg-destructive/10 text-destructive'
  if (status === 'disabled') return 'bg-muted text-muted-foreground'
  return 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
}

const StatusIcon = computed(() => {
  if (summary.value.level === 'ready') return CheckCircle2
  if (summary.value.level === 'error') return XCircle
  if (summary.value.level === 'disabled') return Wrench
  return AlertTriangle
})

async function refreshTools(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const [toolDefinitions, runtimeStatus] = await Promise.all([
      aiGetTools(),
      props.workDir
        ? aiGetMcpStatus(props.workDir).catch(() => null)
        : Promise.resolve(null),
    ])
    tools.value = toolDefinitions ?? []
    mcpRuntime.value = runtimeStatus
    mcpConfig.value = runtimeStatus ? null : parseMcpConfig(null)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void refreshTools()
})

watch(() => props.workDir, () => {
  void refreshTools()
})
</script>

<template>
  <section class="mx-auto max-w-4xl px-5">
    <div class="rounded-xl border p-3" :class="levelClass(summary.level)">
      <div class="flex flex-wrap items-center gap-3">
        <component :is="StatusIcon" class="h-4 w-4 shrink-0" />
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-xs font-semibold">{{ summary.title }}</span>
            <span class="rounded bg-background/45 px-1.5 py-0.5 text-[10px] text-current/70">
              {{ summary.toolCount }} tools
            </span>
            <span class="rounded bg-background/45 px-1.5 py-0.5 text-[10px] text-current/70">
              {{ summary.enabledServerCount }}/{{ summary.serverCount }} MCP servers
            </span>
          </div>
          <p class="mt-0.5 text-[11px] text-current/75">{{ summary.description }}</p>
        </div>
        <button
          class="inline-flex items-center gap-1 rounded-md border border-current/20 px-2 py-1 text-[11px] hover:bg-background/35 disabled:cursor-wait disabled:opacity-60"
          :disabled="loading"
          @click="refreshTools"
        >
          <RefreshCw class="h-3 w-3" :class="loading ? 'animate-spin' : ''" />
          刷新
        </button>
      </div>

      <div v-if="summary.configPath || summary.configExists === false" class="mt-2 flex flex-wrap gap-2 text-[10px] text-current/60">
        <span v-if="summary.configPath" class="truncate font-mono" :title="summary.configPath">
          {{ summary.configPath }}
        </span>
        <span v-if="summary.configExists === false" class="rounded bg-background/45 px-1.5 py-0.5">
          未发现 .mcp.json
        </span>
      </div>

      <div v-if="summary.categories.length" class="mt-3 flex flex-wrap gap-1.5">
        <span
          v-for="category in summary.categories"
          :key="category.key"
          class="inline-flex items-center gap-1 rounded bg-background/45 px-2 py-1 text-[10px] text-current/75"
        >
          <Activity class="h-3 w-3" /> {{ category.label }} 路 {{ category.count }}
        </span>
      </div>

      <div v-if="summary.servers.length" class="mt-3 grid gap-1.5 sm:grid-cols-2">
        <div
          v-for="serverItem in summary.servers"
          :key="serverItem.name"
          class="rounded-lg border border-current/15 bg-background/35 px-2.5 py-2 text-[11px] text-current/80"
        >
          <div class="flex items-center gap-2">
            <Server class="h-3.5 w-3.5 shrink-0" />
            <span class="min-w-0 flex-1 truncate font-medium">{{ serverItem.name }}</span>
            <span class="rounded bg-background/50 px-1.5 py-0.5 text-[9px] uppercase">{{ serverItem.transport }}</span>
            <span class="rounded px-1.5 py-0.5 text-[9px]" :class="serverStatusClass(serverItem.status)">
              {{ serverItem.disabled ? 'disabled' : (serverItem.status || 'unknown') }}
            </span>
          </div>
          <p class="mt-1 truncate font-mono text-[10px] text-current/60" :title="serverItem.command || serverItem.url">
            {{ serverItem.message || serverItem.command || serverItem.url || '未声明 command/url' }}
          </p>
        </div>
      </div>

      <ul v-if="summary.issues.length" class="mt-3 list-disc space-y-0.5 pl-5 text-[11px] text-current/80">
        <li v-for="issue in summary.issues" :key="issue">{{ issue }}</li>
      </ul>
    </div>
  </section>
</template>
