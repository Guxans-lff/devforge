<script setup lang="ts">
/**
 * AI 工具写操作审批卡片 — 对话内嵌式
 *
 * 作为消息流中的一个元素渲染（非浮层），挂在 AiMessageBubble 列表末尾。
 * - write_file / edit_file：优先展示并排 Diff（AiDiffViewer）
 * - bash / web_fetch：展示命令 / URL + 单块预览
 * - 按钮：拒绝 / 信任并允许 / 允许一次
 */
import { computed, ref, watch } from 'vue'
import { FileText, Terminal, Pencil, ShieldCheck, ShieldX, Shield, ChevronDown, ChevronUp } from 'lucide-vue-next'
import { Globe } from 'lucide-vue-next'
import { usePendingApproval, resolveApproval } from '@/composables/useToolApproval'
import { readTextFile } from '@/api/database'
import AiDiffViewer from './AiDiffViewer.vue'
import { computeSideBySideDiff } from '@/composables/useAiDiff'

const props = defineProps<{
  /**
   * 可选的匹配键（path / command / url）
   * - 传入时：仅当 pending.target === matchKey 才渲染
   *   用于 AiToolCallBlock 内嵌场景，把审批 UI 绑定到具体 tool call
   * - 不传时：fallback 全局渲染（兼容旧用法）
   */
  matchKey?: string
  /** 内嵌渲染：隐藏自身头部（外层 AiToolCallBlock 已显示工具名+路径+徽章） */
  embedded?: boolean
}>()

const pending = usePendingApproval()

/** 是否应当展示 */
const shouldShow = computed(() => {
  if (!pending.value) return false
  if (props.matchKey === undefined) return true
  return pending.value.target === props.matchKey
})

const toolLabel = computed(() => {
  switch (pending.value?.toolName) {
    case 'write_file': return '写入文件'
    case 'edit_file': return '编辑文件'
    case 'bash': return '执行命令'
    case 'web_fetch': return '抓取网页'
    default: return '工具调用'
  }
})

const ToolIcon = computed(() => {
  switch (pending.value?.toolName) {
    case 'bash': return Terminal
    case 'edit_file': return Pencil
    case 'web_fetch': return Globe
    default: return FileText
  }
})

const fileName = computed(() => {
  const t = pending.value?.target ?? ''
  return t.split(/[/\\]/).pop() ?? t
})

const previewLines = computed(() => {
  const txt = pending.value?.preview ?? ''
  const lines = txt.split('\n')
  if (lines.length > 5) {
    return lines.slice(0, 5).join('\n') + `\n… (共 ${lines.length} 行，已截断)`
  }
  return txt
})

/** 是否走 Diff 展示路径（write_file 或 edit_file 都走 diff；新文件 oldText="" 全绿） */
const showDiff = computed(() => {
  const t = pending.value?.toolName
  return t === 'edit_file' || t === 'write_file'
})

/** write_file 场景下尝试读的磁盘原文（null = 不存在/未读取） */
const diskOldContent = ref<string | null>(null)

watch(
  () => pending.value?.target,
  async (target) => {
    diskOldContent.value = null
    if (!target) return
    if (pending.value?.toolName !== 'write_file') return
    try {
      diskOldContent.value = await readTextFile(target)
    } catch {
      diskOldContent.value = null
    }
  },
  { immediate: true },
)

const oldTextForDiff = computed(() =>
  pending.value?.toolName === 'edit_file'
    ? (pending.value?.oldPreview ?? '')
    : (diskOldContent.value ?? ''),
)

const newTextForDiff = computed(() => pending.value?.preview ?? '')

/** diff 变更统计（仅 showDiff 时使用） */
const diffStats = computed(() => {
  if (!showDiff.value) return null
  return computeSideBySideDiff(oldTextForDiff.value, newTextForDiff.value).stats
})

/** 折叠 / 展开预览 — 默认折叠（约 5 行），用户点击展开 */
const expanded = ref(false)
watch(
  () => pending.value?.target,
  () => { expanded.value = false },
)

/** 预览区域限高（折叠时 ~5 行；展开时放高让其滚动） */
const previewMaxHeight = computed(() => (expanded.value ? '70vh' : '100px'))
</script>

<template>
  <div
    v-if="shouldShow"
    class="my-1 overflow-hidden rounded-md"
    :class="embedded ? '' : 'border border-border/40 bg-muted/10'"
  >
    <!-- 头（与 AiToolCallBlock 同风格：小字 + 低调底色） -->
    <div v-if="!embedded" class="flex items-center gap-2 px-3 py-1.5">
      <component :is="ToolIcon" class="h-3.5 w-3.5 text-amber-500/80 shrink-0" />
      <span class="text-[11px] font-medium text-amber-500/90">{{ toolLabel }}</span>
      <span class="text-[11px] text-muted-foreground/50 truncate flex-1" :title="pending.target">
        {{ pending.target }}
      </span>
      <span class="text-[10px] text-amber-500/60 shrink-0">需要确认</span>
    </div>

    <!-- 内容 -->
    <div :class="embedded ? '' : 'border-t border-border/20'">
      <!-- 折叠容器：限高 + 内部滚动；渐变遮罩暗示可展开 -->
      <div class="relative">
        <div
          class="overflow-auto transition-[max-height] duration-200"
          :style="{ maxHeight: previewMaxHeight }"
        >
          <!-- Diff 视图 -->
          <div v-if="showDiff" class="p-1">
            <AiDiffViewer
              :old-text="oldTextForDiff"
              :new-text="newTextForDiff"
              :file-name="fileName"
              hide-actions
            />
          </div>

          <!-- 非 diff：命令 / URL / 新文件预览 -->
          <div v-else class="px-3 py-2">
            <div class="text-[10px] font-medium text-muted-foreground/40 mb-0.5">
              {{ pending.toolName === 'bash' ? '命令' : pending.toolName === 'web_fetch' ? 'URL' : '新文件内容' }}
            </div>
            <pre class="text-[11px] font-mono whitespace-pre-wrap overflow-x-auto text-foreground/60">{{ previewLines }}</pre>
          </div>
        </div>

        <!-- 折叠态底部渐变遮罩 -->
        <div
          v-if="!expanded"
          class="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-background via-background/60 to-transparent"
        />
      </div>

      <!-- 展开/折叠 + 按钮条（合并一行，减少层次） -->
      <div class="flex items-center gap-2 border-t border-border/20 px-2 py-1">
        <button
          class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/40 transition-colors"
          @click="expanded = !expanded"
        >
          <component :is="expanded ? ChevronUp : ChevronDown" class="h-3 w-3" />
          {{ expanded ? '收起' : '展开' }}
        </button>
        <!-- diff 变更统计 -->
        <template v-if="diffStats">
          <span class="text-[10px] px-1.5 py-0.5 rounded" style="background: rgba(74,222,128,0.08); color: #4ade80;">
            +{{ diffStats.added }}
          </span>
          <span class="text-[10px] px-1.5 py-0.5 rounded" style="background: rgba(248,113,113,0.08); color: #f87171;">
            −{{ diffStats.removed }}
          </span>
        </template>
        <div class="flex-1" />
        <button
          class="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-muted-foreground/70 hover:text-foreground hover:bg-muted/40 transition-colors"
          @click="resolveApproval('deny')"
        >
          <ShieldX class="h-3 w-3" /> 拒绝
        </button>
        <button
          class="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-muted-foreground/70 hover:text-foreground hover:bg-muted/40 transition-colors"
          @click="resolveApproval('trust')"
        >
          <Shield class="h-3 w-3" /> 信任并允许
        </button>
        <button
          class="flex items-center gap-1 rounded bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/25 transition-colors"
          @click="resolveApproval('allow')"
        >
          <ShieldCheck class="h-3 w-3" /> 允许一次
        </button>
      </div>
    </div>
  </div>
</template>
