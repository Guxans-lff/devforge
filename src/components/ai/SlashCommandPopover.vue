<script setup lang="ts">
/**
 * 斜杠命令浮层 — 浮在输入框上方，命令式精炼卡片
 *
 * 锚点语义：anchorPos 为 textarea 左上角屏幕坐标；浮层渲染时向上偏移自身高度 + 间距。
 */
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import {
  BookOpen, Wrench, FlaskConical, GitCompare, Trash2,
  Sparkles, Minimize2,
} from 'lucide-vue-next'

export interface SlashCommand {
  name: string
  desc: string
  template: string
  icon: typeof BookOpen
  /** Tailwind 色调类 */
  color: string
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

const COMMANDS: SlashCommand[] = [
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

const selectedIndex = ref(0)

const filtered = computed<SlashCommand[]>(() => {
  const q = props.query.trim().toLowerCase()
  if (!q) return COMMANDS
  return COMMANDS.filter(c => c.name.startsWith(q) || c.name.includes(q))
})

function confirmSelect() {
  const cmd = filtered.value[selectedIndex.value]
  if (cmd) emit('select', cmd)
}
function handleItemClick(cmd: SlashCommand) { emit('select', cmd) }

function onKeydown(e: KeyboardEvent) {
  if (!props.visible) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIndex.value = Math.min(selectedIndex.value + 1, filtered.value.length - 1)
    scrollToSelected()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
    scrollToSelected()
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault()
    confirmSelect()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  }
}

const popoverEl = ref<HTMLElement | null>(null)
const listEl = ref<HTMLElement | null>(null)

function scrollToSelected() {
  nextTick(() => {
    const items = listEl.value?.children
    if (!items) return
    const active = items[selectedIndex.value] as HTMLElement | undefined
    active?.scrollIntoView({ block: 'nearest' })
  })
}

function onDocumentClick(e: MouseEvent) {
  if (!props.visible) return
  if (popoverEl.value && !popoverEl.value.contains(e.target as Node)) {
    emit('close')
  }
}

watch(() => props.query, () => { selectedIndex.value = 0 })
watch(() => props.visible, (val) => {
  if (val) {
    document.addEventListener('keydown', onKeydown)
    document.addEventListener('mousedown', onDocumentClick)
    nextTick(adjustPosition)
  } else {
    document.removeEventListener('keydown', onKeydown)
    document.removeEventListener('mousedown', onDocumentClick)
  }
})

/** 悬浮坐标：浮层贴在输入框上方 8px，左对齐 */
const popoverStyle = ref<{ left: string; top: string }>({ left: '0px', top: '0px' })
function adjustPosition() {
  const el = popoverEl.value
  if (!el) return
  const h = el.offsetHeight
  popoverStyle.value = {
    left: `${props.anchorPos.x}px`,
    top: `${props.anchorPos.y - h - 8}px`,
  }
}
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
      class="fixed z-50 w-[360px] overflow-hidden rounded-xl border border-border/60 bg-popover/95 backdrop-blur-xl shadow-2xl shadow-black/40 text-popover-foreground animate-in fade-in slide-in-from-bottom-1 duration-150"
      :style="popoverStyle"
    >
      <!-- 标题栏 -->
      <div class="flex items-center gap-2 px-3 py-2 border-b border-border/40 bg-muted/30">
        <Sparkles class="h-3.5 w-3.5 text-primary/80" />
        <span class="text-[11px] font-medium text-foreground/90">斜杠命令</span>
        <span class="ml-auto text-[10px] text-muted-foreground/60 font-mono">{{ filtered.length }}/{{ COMMANDS.length }}</span>
      </div>

      <div
        v-if="filtered.length === 0"
        class="px-4 py-8 text-center text-[12px] text-muted-foreground"
      >
        无匹配命令
      </div>
      <ul v-else ref="listEl" class="py-1 max-h-[320px] overflow-y-auto">
        <li
          v-for="(cmd, index) in filtered"
          :key="cmd.name"
          class="group flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors"
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
          <div class="flex flex-col min-w-0 flex-1">
            <span class="font-mono text-[12.5px] leading-tight text-foreground">
              <span class="text-muted-foreground/60">/</span>{{ cmd.name }}
            </span>
            <span class="truncate text-[11px] text-muted-foreground/80 leading-tight mt-0.5">{{ cmd.desc }}</span>
          </div>
          <kbd
            v-if="index === selectedIndex"
            class="shrink-0 text-[9px] font-mono px-1.5 py-0.5 rounded border border-border/50 bg-background/60 text-muted-foreground"
          >↵</kbd>
        </li>
      </ul>

      <!-- 底部快捷键提示 -->
      <div class="flex items-center gap-3 px-3 py-1.5 border-t border-border/40 bg-muted/20 text-[10px] text-muted-foreground/60">
        <span><kbd class="font-mono">↑↓</kbd> 导航</span>
        <span><kbd class="font-mono">Enter</kbd> 选中</span>
        <span><kbd class="font-mono">Esc</kbd> 关闭</span>
      </div>
    </div>
  </Teleport>
</template>
