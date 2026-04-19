<script setup lang="ts">
/**
 * AI 上下文胶囊（Context Pill）
 *
 * 只读工具调用（read_file / list_directory / search_files / web_*）的极简展示。
 * - 圆角药丸 + 图标 + 主参数（文件名/查询词/URL）
 * - Hover 弹出 Popover 预览前 N 行结果
 * - 点击展开完整 AiToolCallBlock 详情（通过 emit 通知父组件）
 */
import { computed, ref } from 'vue'
import type { ToolCallInfo } from '@/types/ai'
import {
  FileText, Folder, Search, Globe, Loader2, CheckCircle2, XCircle, Wrench,
} from 'lucide-vue-next'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

const props = defineProps<{
  toolCall: ToolCallInfo
  /** 聚合数量（>1 时显示 ×N 徽章） */
  count?: number
}>()

const emit = defineEmits<{
  open: []
}>()

const ToolIcon = computed(() => {
  switch (props.toolCall.name) {
    case 'read_file': return FileText
    case 'list_directory': return Folder
    case 'search_files': return Search
    case 'web_fetch':
    case 'web_search': return Globe
    default: return Wrench
  }
})

/** 主参数：read_file 取文件名，search 取关键词，web 取 URL/query */
const primaryLabel = computed(() => {
  const args = props.toolCall.parsedArgs
    ?? (() => {
      try { return JSON.parse(props.toolCall.arguments || '{}') as Record<string, unknown> }
      catch { return {} }
    })()
  switch (props.toolCall.name) {
    case 'read_file':
    case 'list_directory': {
      const p = String(args.path ?? '')
      return p.split(/[/\\]/).pop() || p || '…'
    }
    case 'search_files':
      return String(args.pattern ?? '') || '…'
    case 'web_fetch': {
      const u = String(args.url ?? '')
      try { return new URL(u).hostname }
      catch { return u.slice(0, 40) || '…' }
    }
    case 'web_search':
      return String(args.query ?? '').slice(0, 40) || '…'
    default:
      return props.toolCall.name
  }
})

/** 状态颜色与边框 */
const pillStateClass = computed(() => {
  switch (props.toolCall.status) {
    case 'streaming':
    case 'running':
    case 'pending':
      return 'border-blue-500/25 bg-blue-500/5 text-blue-500/85'
    case 'success':
      return 'border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400'
    case 'error':
      return 'border-rose-500/25 bg-rose-500/5 text-rose-500'
    default:
      return 'border-border/40 bg-muted/20 text-muted-foreground'
  }
})

/** Hover 预览：取结果前 12 行 */
const previewText = computed(() => {
  const raw = props.toolCall.result ?? props.toolCall.error ?? ''
  if (!raw) return ''
  // read_file 结果首行通常是 [文件: ... | N 行 | X KB]，跳过它
  let body = raw
  if (props.toolCall.name === 'read_file' && raw.startsWith('[文件:')) {
    const nl = raw.indexOf('\n')
    if (nl > 0) body = raw.slice(nl + 1)
  }
  const lines = body.split('\n')
  const head = lines.slice(0, 12).join('\n')
  return lines.length > 12 ? `${head}\n…（共 ${lines.length} 行）` : head
})

const hasPreview = computed(() => !!previewText.value)

const open = ref(false)
let closeTimer: number | undefined
function onEnter() {
  if (closeTimer) { window.clearTimeout(closeTimer); closeTimer = undefined }
  if (hasPreview.value) open.value = true
}
function onLeave() {
  closeTimer = window.setTimeout(() => { open.value = false }, 120)
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <button
        class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors hover:opacity-90"
        :class="pillStateClass"
        :title="primaryLabel"
        @mouseenter="onEnter"
        @mouseleave="onLeave"
        @click="emit('open')"
      >
        <Loader2
          v-if="toolCall.status === 'streaming' || toolCall.status === 'running' || toolCall.status === 'pending'"
          class="h-3 w-3 animate-spin"
        />
        <CheckCircle2 v-else-if="toolCall.status === 'success'" class="h-3 w-3" />
        <XCircle v-else-if="toolCall.status === 'error'" class="h-3 w-3" />
        <component :is="ToolIcon" v-else class="h-3 w-3" />
        <span class="max-w-[160px] truncate">{{ primaryLabel }}</span>
        <span v-if="props.count && props.count > 1" class="opacity-60">×{{ props.count }}</span>
      </button>
    </PopoverTrigger>
    <PopoverContent
      v-if="hasPreview"
      side="top"
      align="start"
      :side-offset="6"
      class="w-[480px] max-w-[80vw] p-2"
      @mouseenter="onEnter"
      @mouseleave="onLeave"
    >
      <div class="text-[10px] font-medium text-muted-foreground mb-1 flex items-center gap-1">
        <component :is="ToolIcon" class="h-3 w-3" />
        <span>{{ toolCall.name }} · {{ primaryLabel }}</span>
      </div>
      <pre
        class="max-h-[220px] overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2 text-[11px] font-mono text-foreground/80"
      >{{ previewText }}</pre>
      <div class="mt-1 text-[10px] text-muted-foreground/60">点击胶囊查看完整结果</div>
    </PopoverContent>
  </Popover>
</template>
