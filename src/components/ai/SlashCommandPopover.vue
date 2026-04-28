<script setup lang="ts">
/**
 * 斜杠命令浮层
 *
 * 锚点语义：anchorPos 为 textarea 左上角屏幕坐标；浮层向上偏移自身高度和间距。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  BookOpen,
  FlaskConical,
  GitCompare,
  Minimize2,
  Sparkles,
  Trash2,
  Workflow,
  Wrench,
} from 'lucide-vue-next'
import { getWorkflowFirstPrompt, loadBuiltinWorkflows } from '@/composables/useWorkflowScripts'
import type { AiWorkflowScript } from '@/types/ai'

export interface SlashCommand {
  name: string
  desc: string
  template: string
  icon: typeof BookOpen
  color: string
  isWorkflow?: boolean
  workflow?: AiWorkflowScript
}

const props = defineProps<{
  query: string
  anchorPos: { x: number; y: number }
  visible: boolean
}>()

const emit = defineEmits<{
  select: [cmd: SlashCommand]
  close: []
}>()

const workflows = loadBuiltinWorkflows()

const BUILTIN_COMMANDS: SlashCommand[] = [
  {
    name: 'explain',
    desc: '解释选中代码或当前文件',
    template: '请解释下面这段代码的作用、关键逻辑与潜在问题：\n\n',
    icon: BookOpen,
    color: 'text-blue-400',
  },
  {
    name: 'refactor',
    desc: '重构代码（改进建议 + 完整新版）',
    template: '请重构下面的代码，目标：可读性 / 复用性 / 性能。给出重构思路 + 完整新版代码 + 关键改动点说明。\n\n',
    icon: Wrench,
    color: 'text-violet-400',
  },
  {
    name: 'test',
    desc: '为代码补充单元测试',
    template: '请为以下代码补充单元测试，覆盖正常路径与边界错误。使用项目既有测试框架。\n\n',
    icon: FlaskConical,
    color: 'text-emerald-400',
  },
  {
    name: 'diff',
    desc: '对比两段内容的差异',
    template: '请对比下面两段内容的差异，按新增 / 删除 / 修改分类列出：\n\nA:\n\n\n\nB:\n\n',
    icon: GitCompare,
    color: 'text-amber-400',
  },
  {
    name: 'clear',
    desc: '清空当前会话',
    template: '__CLEAR_SESSION__',
    icon: Trash2,
    color: 'text-rose-400',
  },
  {
    name: 'compact',
    desc: '压缩对话历史，释放上下文空间',
    template: '__COMPACT__',
    icon: Minimize2,
    color: 'text-sky-400',
  },
]

const WORKFLOW_COMMANDS: SlashCommand[] = workflows.map(workflow => ({
  name: workflow.id,
  desc: workflow.description,
  template: getWorkflowFirstPrompt(workflow),
  icon: Workflow,
  color: 'text-orange-400',
  isWorkflow: true,
  workflow,
}))

const COMMANDS: SlashCommand[] = [...BUILTIN_COMMANDS, ...WORKFLOW_COMMANDS]
const selectedIndex = ref(0)

const filtered = computed<SlashCommand[]>(() => {
  const q = props.query.trim().toLowerCase()
  if (!q) return COMMANDS
  return COMMANDS.filter(command => command.name.startsWith(q) || command.name.includes(q))
})

function confirmSelect() {
  const cmd = filtered.value[selectedIndex.value]
  if (cmd) emit('select', cmd)
}

function handleItemClick(cmd: SlashCommand) {
  emit('select', cmd)
}

function onKeydown(event: KeyboardEvent) {
  if (!props.visible) return
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    selectedIndex.value = Math.min(selectedIndex.value + 1, filtered.value.length - 1)
    scrollToSelected()
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
    scrollToSelected()
  } else if (event.key === 'Enter' || event.key === 'Tab') {
    event.preventDefault()
    confirmSelect()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
  }
}

defineExpose({ onKeydown })

const popoverEl = ref<HTMLElement | null>(null)
const listEl = ref<HTMLElement | null>(null)
const popoverStyle = ref<{ left: string; top: string }>({ left: '0px', top: '0px' })

function scrollToSelected() {
  nextTick(() => {
    const items = listEl.value?.children
    if (!items) return
    const active = items[selectedIndex.value] as HTMLElement | undefined
    active?.scrollIntoView({ block: 'nearest' })
  })
}

function onDocumentClick(event: MouseEvent) {
  if (!props.visible) return
  if (popoverEl.value && !popoverEl.value.contains(event.target as Node)) {
    emit('close')
  }
}

function adjustPosition() {
  const el = popoverEl.value
  if (!el) return
  popoverStyle.value = {
    left: `${props.anchorPos.x}px`,
    top: `${props.anchorPos.y - el.offsetHeight - 8}px`,
  }
}

watch(() => props.query, () => { selectedIndex.value = 0 })
watch(() => props.visible, (visible) => {
  if (visible) {
    document.addEventListener('keydown', onKeydown)
    document.addEventListener('mousedown', onDocumentClick)
    nextTick(adjustPosition)
  } else {
    document.removeEventListener('keydown', onKeydown)
    document.removeEventListener('mousedown', onDocumentClick)
  }
})
watch(() => props.anchorPos, () => { if (props.visible) nextTick(adjustPosition) })
watch(filtered, () => { if (props.visible) nextTick(adjustPosition) })

onMounted(() => {
  if (props.visible) {
    document.addEventListener('keydown', onKeydown)
    document.addEventListener('mousedown', onDocumentClick)
    nextTick(adjustPosition)
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  document.removeEventListener('mousedown', onDocumentClick)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="popoverEl"
      class="fixed z-50 w-[360px] overflow-hidden rounded-xl border border-border/60 bg-popover/95 text-popover-foreground shadow-2xl shadow-black/40 backdrop-blur-xl animate-in fade-in slide-in-from-bottom-1 duration-150"
      :style="popoverStyle"
    >
      <div class="flex items-center gap-2 border-b border-border/40 bg-muted/30 px-3 py-2">
        <Sparkles class="h-3.5 w-3.5 text-primary/80" />
        <span class="text-[11px] font-medium text-foreground/90">斜杠命令</span>
        <span class="ml-auto font-mono text-[10px] text-muted-foreground/60">{{ filtered.length }}/{{ COMMANDS.length }}</span>
      </div>

      <div v-if="filtered.length === 0" class="px-4 py-8 text-center text-[12px] text-muted-foreground">
        无匹配命令
      </div>

      <ul v-else ref="listEl" class="max-h-[320px] overflow-y-auto py-1">
        <li
          v-for="(cmd, index) in filtered"
          :key="cmd.name"
          class="group flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors"
          :class="index === selectedIndex ? 'bg-accent/70' : 'hover:bg-accent/30'"
          @mousedown.prevent="handleItemClick(cmd)"
          @mouseenter="selectedIndex = index"
        >
          <div
            class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/40 bg-muted/40"
            :class="index === selectedIndex ? 'border-primary/40 bg-primary/10' : ''"
          >
            <component :is="cmd.icon" class="h-3.5 w-3.5" :class="cmd.color" />
          </div>
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="font-mono text-[12.5px] leading-tight text-foreground">
              <span class="text-muted-foreground/60">/</span>{{ cmd.name }}
            </span>
            <span class="mt-0.5 truncate text-[11px] leading-tight text-muted-foreground/80">{{ cmd.desc }}</span>
          </div>
          <kbd
            v-if="index === selectedIndex"
            class="shrink-0 rounded border border-border/50 bg-background/60 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground"
          >Enter</kbd>
        </li>
      </ul>

      <div class="flex items-center gap-3 border-t border-border/40 bg-muted/20 px-3 py-1.5 text-[10px] text-muted-foreground/60">
        <span><kbd class="font-mono">↑↓</kbd> 导航</span>
        <span><kbd class="font-mono">Enter</kbd> 选中</span>
        <span><kbd class="font-mono">Esc</kbd> 关闭</span>
      </div>
    </div>
  </Teleport>
</template>
