<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAiFeatureGateStore, type AiFeatureGate } from '@/stores/ai-feature-gate'
import { ToggleLeft, ToggleRight, Info, RotateCcw } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  workDir?: string
  scope?: 'local' | 'workspace'
}>(), {
  workDir: '',
  scope: 'local',
})

const featureGate = useAiFeatureGateStore()
const error = ref<string | null>(null)
const pendingKey = ref<string | null>(null)

interface GateDisplay {
  key: string
  label: string
  description: string
  category: 'core' | 'experimental' | 'diagnostics'
}

const GATE_META: GateDisplay[] = [
  {
    key: 'ai.compact.v2',
    label: 'Auto Compact v2',
    description: '接近上下文上限时自动压缩对话，避免长对话卡死。',
    category: 'core',
  },
  {
    key: 'ai.agent.runtime',
    label: 'Background Agent Runtime',
    description: '将压缩、后台任务等放入 Agent Runtime，减少 UI 阻塞。',
    category: 'core',
  },
  {
    key: 'ai.diagnostics.capture',
    label: 'Diagnostics Capture',
    description: '采集指标和 trace，便于排查卡顿、流式中断和工具异常。',
    category: 'diagnostics',
  },
  {
    key: 'ai.permission.strict',
    label: 'Strict Permission Mode',
    description: '对文件写入、Shell 等副作用操作采用更严格的确认策略。',
    category: 'core',
  },
  {
    key: 'ai.proactive.enabled',
    label: 'Proactive Agent',
    description: '允许 AI 根据上下文主动建议后续动作。',
    category: 'experimental',
  },
  {
    key: 'ai.tools.parallel',
    label: 'Parallel Tool Execution',
    description: '安全时并行执行互不依赖的工具调用。',
    category: 'core',
  },
  {
    key: 'ai.experimental.ui',
    label: 'Experimental UI',
    description: '启用实验性 AI UI 体验。',
    category: 'experimental',
  },
  {
    key: 'ai.experimental.virtual_scroll',
    label: 'Virtual Scroll',
    description: '大对话列表使用虚拟滚动优化渲染性能。',
    category: 'experimental',
  },
]

const scopeLabel = computed(() => props.scope === 'workspace' ? '项目覆盖' : '本地覆盖')
const canEditWorkspace = computed(() => props.scope !== 'workspace' || !!props.workDir)

const gates = computed(() => {
  return GATE_META.map(meta => {
    const gate = featureGate.getGate(meta.key)
    return {
      ...meta,
      enabled: gate.enabled,
      source: gate.source,
      isOverridden: gate.source !== 'default',
      hasWorkspaceOverride: featureGate.workspaceGates[meta.key] !== undefined,
      hasLocalOverride: featureGate.localGates[meta.key] !== undefined,
    }
  })
})

const categories = computed(() => {
  const map = new Map<string, typeof gates.value>()
  for (const g of gates.value) {
    const list = map.get(g.category) ?? []
    list.push(g)
    map.set(g.category, list)
  }
  return [
    { key: 'core', label: 'Core', items: map.get('core') ?? [] },
    { key: 'diagnostics', label: 'Diagnostics', items: map.get('diagnostics') ?? [] },
    { key: 'experimental', label: 'Experimental', items: map.get('experimental') ?? [] },
  ].filter(c => c.items.length > 0)
})

function sourceLabel(source: AiFeatureGate['source']): string {
  switch (source) {
    case 'workspace': return '项目'
    case 'local_settings': return '本地'
    default: return '默认'
  }
}

async function toggle(gate: GateDisplay & { enabled: boolean }) {
  if (!canEditWorkspace.value) return
  pendingKey.value = gate.key
  error.value = null
  try {
    if (props.scope === 'workspace') {
      await featureGate.setWorkspace(gate.key, !gate.enabled, props.workDir)
    } else {
      await featureGate.setLocal(gate.key, !gate.enabled)
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    pendingKey.value = null
  }
}

async function reset(gate: GateDisplay & { source: string }) {
  if (!canEditWorkspace.value) return
  pendingKey.value = gate.key
  error.value = null
  try {
    if (props.scope === 'workspace') {
      await featureGate.removeWorkspace(gate.key, props.workDir)
    } else {
      await featureGate.removeLocal(gate.key)
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    pendingKey.value = null
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-start justify-between gap-3">
      <div>
        <p class="text-xs text-muted-foreground">
          {{ scope === 'workspace' ? '写入当前 workspace 的 .devforge/config.json，优先级高于本地和默认配置。' : '仅影响当前机器的本地 AI 开关。' }}
        </p>
        <p v-if="scope === 'workspace' && !workDir" class="mt-1 text-xs text-amber-500">
          未选择工作目录，暂不能写入项目级开关。
        </p>
      </div>
      <span class="shrink-0 rounded bg-muted px-2 py-1 text-[10px] text-muted-foreground">{{ scopeLabel }}</span>
    </div>

    <div v-for="category in categories" :key="category.key">
      <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
        {{ category.label }}
      </h3>
      <div class="space-y-1">
        <div
          v-for="gate in category.items"
          :key="gate.key"
          class="flex items-start gap-3 rounded-lg px-3 py-2 hover:bg-muted/30"
        >
          <button
            class="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="pendingKey === gate.key || !canEditWorkspace"
            @click="toggle(gate)"
          >
            <ToggleRight v-if="gate.enabled" class="h-5 w-5 text-emerald-500" />
            <ToggleLeft v-else class="h-5 w-5 text-gray-400" />
          </button>

          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-sm font-medium text-foreground/85">{{ gate.label }}</span>
              <span class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {{ sourceLabel(gate.source) }}
              </span>
              <button
                v-if="(scope === 'workspace' && gate.hasWorkspaceOverride) || (scope === 'local' && gate.hasLocalOverride)"
                class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                :disabled="pendingKey === gate.key"
                @click="reset(gate)"
              >
                <RotateCcw class="h-3 w-3" /> 重置
              </button>
            </div>
            <p class="mt-0.5 text-xs text-muted-foreground/75">{{ gate.description }}</p>
          </div>

          <div class="shrink-0 pt-0.5" :title="`Key: ${gate.key}`">
            <Info class="h-3.5 w-3.5 text-muted-foreground/50" />
          </div>
        </div>
      </div>
    </div>

    <div v-if="scope === 'local' && featureGate.localGates && Object.keys(featureGate.localGates).length > 0" class="pt-2">
      <button
        class="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        @click="featureGate.resetLocal()"
      >
        重置全部本地覆盖
      </button>
    </div>

    <p v-if="error" class="text-xs text-destructive">{{ error }}</p>
  </div>
</template>
