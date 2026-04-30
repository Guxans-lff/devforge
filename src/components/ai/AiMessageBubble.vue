<script setup lang="ts">
/**
 * AI 消息气泡组件
 *
 * 参照 Claude Code VSCode 插件风格：
 * - 用户消息：带深色背景的条块，一眼可见提问内容
 * - 助手消息：文档式平铺，紧凑排版
 * - 错误消息：红色警告条
 */
import { computed, ref, watch } from 'vue'
import type { AiMessage, FileOperation } from '@/types/ai'
import { parseFileMarkers } from '@/utils/file-markers'
import { ChevronRight, Copy, Check, AlertCircle, AlertTriangle, Info, Download, RotateCw, GitFork, History } from 'lucide-vue-next'
import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@/api/database'
import DOMPurify from 'dompurify'
import AiCodeBlock from './AiCodeBlock.vue'
import AiFileCard from './AiFileCard.vue'
import AiToolCallBlock from './AiToolCallBlock.vue'
import AiFileOpsGroup from './AiFileOpsGroup.vue'
import AiToolActivitySummaryCard from './AiToolActivitySummaryCard.vue'
import AiTodoPanel from './AiTodoPanel.vue'
import { createLogger } from '@/utils/logger'
import AiContextPill from './AiContextPill.vue'
import {
  classifyToolActivity,
  summarizeToolActivity,
  toToolDisplayName,
} from '@/composables/ai/toolActivitySummary'

const log = createLogger('ai.message.bubble')
const LONG_MARKDOWN_CHAR_LIMIT = 16_000
const LONG_MARKDOWN_PREVIEW_CHARS = 8_000
const STREAMING_TEXT_WINDOW_CHARS = 8_000
const STREAMING_TEXT_HEAD_CHARS = 1_200
const STREAMING_TEXT_TAIL_CHARS = 6_800
const RENDER_TEXT_SEGMENT_LIMIT = 10
const VISIBLE_FULL_TOOL_CALL_LIMIT = 6
const VISIBLE_PROMOTED_TOOL_CALL_LIMIT = 6
const VISIBLE_FILE_OPERATION_LIMIT = 8
const TOOL_DETAIL_BATCH_SIZE = 6

const props = defineProps<{
  message: AiMessage
  sessionId?: string
  /** 组内非首条时隐藏头像/名字行 */
  hideHeader?: boolean
  /** 是否是组内最后一条（最后一条不画时间线竖线） */
  isGroupEnd?: boolean
  /** 是否处于连续 assistant 组内（控制时间线样式） */
  inGroup?: boolean
  /** 最新 user 消息吸顶极简模式：单行省略 + 展开按钮 */
  stickyCompact?: boolean
}>()

const emit = defineEmits<{
  (e: 'continue'): void
  (e: 'bumpMaxOutput', value: number): void
  (e: 'fork', messageId: string): void
  (e: 'rewind', messageId: string): void
}>()

/** 识别 [输出被 max_tokens 截断] 错误 → 显示一键调大按钮 */
const isMaxTokensTruncated = computed(() => {
  if (props.message.role !== 'error') return false
  return /\[输出被 max_tokens 截断\]/.test(props.message.content ?? '')
})

const copied = ref(false)
const contentExpanded = ref(false)
const fullToolCallLimit = ref(VISIBLE_FULL_TOOL_CALL_LIMIT)
const promotedPillCallLimit = ref(VISIBLE_PROMOTED_TOOL_CALL_LIMIT)
const fileOperationLimit = ref(VISIBLE_FILE_OPERATION_LIMIT)

const INTERNAL_MESSAGE_TRANSLATIONS: Array<[RegExp, string]> = [
  [
    /^\[The user approved the execution plan\. Continue with the approved steps and use tools when needed\.\]$/i,
    '【用户已确认执行计划】请继续按已批准的步骤执行，必要时可以调用工具。',
  ],
  [
    /^\[user_rejected\]\s*User rejected\s+(.+?)\.$/i,
    '【用户已拒绝】用户拒绝执行 $1。',
  ],
  [
    /^\[Post-compact context restoration\]/i,
    '【压缩后上下文恢复】',
  ],
  [
    /^Pending plan awaiting approval:/i,
    '待确认的执行计划：',
  ],
  [
    /^Plan was approved and is being executed\.$/i,
    '执行计划已批准，正在执行。',
  ],
]

function translateInternalMessageContent(content: string): string {
  return INTERNAL_MESSAGE_TRANSLATIONS.reduce(
    (next, [pattern, replacement]) => next.replace(pattern, replacement),
    content,
  )
}

const displayContent = computed(() => translateInternalMessageContent(props.message.content ?? ''))

const hasHistoryToolSummary = computed(() => !!props.message.historyToolSummary)

function confirmFork() {
  const ok = window.confirm(
    '确定从这条消息创建分支会话吗？\n\n会基于当前消息之前的上下文创建一个新会话，当前会话不会被修改。',
  )
  if (!ok) return
  emit('fork', props.message.id)
}

function confirmRewind() {
  const ok = window.confirm(
    '确定回退到这条消息继续吗？\n\n这会在当前会话中隐藏该消息之后的后续内容，并从这里继续。',
  )
  if (!ok) return
  emit('rewind', props.message.id)
}

function stripProtocolArtifacts(text: string | undefined): string {
  if (!text) return ''
  const normalized = text.replace(/\r\n/g, '\n')

  // Drop leaked internal DSML tool-call protocol blocks from reasoning display.
  const withoutDsmlBlocks = normalized.replace(
    /<\|DSML\|tool_calls\>[\s\S]*?<\|DSML\|tool_calls\>/g,
    '',
  )
  const withoutInvokeLines = withoutDsmlBlocks
    .split('\n')
    .filter(line => !line.includes('<|DSML|'))
    .join('\n')

  return withoutInvokeLines.trim()
}

const sanitizedThinking = computed(() => stripProtocolArtifacts(props.message.thinking))
const hasThinking = computed(() => !!sanitizedThinking.value)
const isUser = computed(() => props.message.role === 'user')
const isError = computed(() => props.message.role === 'error')
const hasToolCalls = computed(() => (props.message.toolCalls?.length ?? 0) > 0)
const messageContentLength = computed(() => displayContent.value.length)
const isLongMarkdown = computed(() =>
  !isUser.value
  && messageContentLength.value > LONG_MARKDOWN_CHAR_LIMIT,
)
const shouldRenderFullContent = computed(() => !isLongMarkdown.value || contentExpanded.value)
const displayedContent = computed(() => {
  const content = displayContent.value
  if (shouldRenderFullContent.value || content.length <= LONG_MARKDOWN_PREVIEW_CHARS) return content
  return `${content.slice(0, LONG_MARKDOWN_PREVIEW_CHARS)}\n\n……内容过长，已先展示预览，点击下方按钮渲染完整内容。`
})
const shouldRenderStreamingTextWindow = computed(() =>
  !isUser.value
  && !isError.value
  && props.message.isStreaming
  && messageContentLength.value > STREAMING_TEXT_WINDOW_CHARS,
)
const streamingTextWindow = computed(() => {
  const content = displayContent.value
  if (content.length <= STREAMING_TEXT_WINDOW_CHARS) return content
  return [
    content.slice(0, STREAMING_TEXT_HEAD_CHARS),
    '……流式回复较长，中间内容已临时省略，完成后会恢复为可交互预览……',
    content.slice(-STREAMING_TEXT_TAIL_CHARS),
  ].join('\n\n')
})
const rootSpacingClass = computed(() => props.stickyCompact ? 'my-0' : props.inGroup ? 'my-0' : 'my-3')
const timelineDotClass = computed(() => {
  if (isError.value) return 'bg-red-400 shadow-[0_0_0_5px_#09090b,0_0_18px_rgba(248,113,113,0.2)]'
  if (isUser.value) return 'bg-[#74757d] shadow-[0_0_0_5px_#09090b]'
  if (props.message.isStreaming) return 'bg-[#55d899] shadow-[0_0_0_5px_#09090b,0_0_18px_rgba(85,216,153,0.38)] animate-pulse'
  return 'bg-[#55d899] shadow-[0_0_0_5px_#09090b,0_0_14px_rgba(85,216,153,0.16)]'
})
const timelineLineClass = computed(() => props.inGroup ? 'bg-white/[0.055]' : 'bg-white/[0.11]')
const turnRoleLabel = computed(() => {
  if (isUser.value) return '你'
  if (isError.value) return '错误'
  return 'DevForge AI'
})
const turnMetaLabel = computed(() => {
  if (isError.value) return '需要处理'
  if (isUser.value) return props.message.isStreaming ? '发送中' : '提问'
  if (hasHistoryToolSummary.value) return '历史'
  if (props.message.isStreaming) return '生成中'
  if (props.message.tokens) return `${props.message.tokens} tokens`
  if (hasToolCalls.value) return '工具活动'
  return '回答'
})

/** 用户消息折叠：超过 3 行时默认收起（展示 2 行） */
const USER_COLLAPSE_LINES = 3
const userExpanded = ref(false)
const userLineCount = computed(() => displayContent.value.split('\n').length)
const userNeedsCollapse = computed(() => isUser.value && userLineCount.value > USER_COLLAPSE_LINES)
const effectiveExpanded = computed(() => userExpanded.value)

/** 可恢复的错误消息（流式超时/中断/未完成） */
const canContinue = computed(() => {
  if (!isError.value) return false
  const c = displayContent.value
  return /\[超时中断\]|\[已中断\]|\[模型 thinking 后 stop 空回\]|\[模型未生成回答\]|上一轮回复未完成或已中断/.test(c)
})

/** 提取 write_file 成功态工具调用，转为 FileOperation 列表供 AiFileOpsGroup 渲染 */
const fileOperations = computed<FileOperation[]>(() => {
  if (!props.message.toolCalls) return []
  return props.message.toolCalls
    .filter(tc => tc.name === 'write_file' && tc.status === 'success')
    .map(tc => {
      const args = tc.parsedArgs ?? {}
      const path = (args.path as string) ?? ''
      return {
        op: 'modify' as const,
        path,
        fileName: path.split(/[/\\]/).pop() ?? '',
        newContent: (args.content as string) ?? '',
        status: 'pending' as const,
        toolCallId: tc.id,
      }
    })
})
const visibleFileOperations = computed(() =>
  fileOperations.value.slice(0, fileOperationLimit.value),
)
const hiddenFileOperationCount = computed(() =>
  Math.max(0, fileOperations.value.length - visibleFileOperations.value.length),
)

/** 非文件写入的其他工具调用（含 awaiting 态的 write_file，让审批条可见） */
const otherToolCalls = computed(() =>
  (props.message.toolCalls ?? []).filter(
    tc => tc.name !== 'write_file' || tc.status !== 'success',
  )
)

const todoToolCalls = computed(() =>
  otherToolCalls.value.filter(tc => tc.name === 'todo_write' && Array.isArray(tc.parsedArgs?.todos)),
)
const latestTodoToolCall = computed(() => todoToolCalls.value[todoToolCalls.value.length - 1])
const latestTodos = computed(() =>
  (latestTodoToolCall.value?.parsedArgs?.todos ?? []) as Array<{
    id: string
    content: string
    activeForm: string
    status: 'pending' | 'in_progress' | 'completed'
  }>,
)
const hasTodoSummary = computed(() => latestTodos.value.length > 0)

/** 只读 / 信息类工具：以 Context Pill 形式紧凑展示 */
const READONLY_TOOLS = new Set(['read_file', 'list_directory', 'search_files', 'web_fetch', 'web_search'])
const contextPills = computed(() =>
  otherToolCalls.value.filter(tc => READONLY_TOOLS.has(tc.name) && tc.approvalState !== 'awaiting'),
)
/** 其余工具（含审批等待的 write_file / bash 等）走完整卡片；todo_write 已提升为任务摘要 */
const fullToolCalls = computed(() =>
  otherToolCalls.value.filter(tc =>
    tc.name !== 'todo_write'
    && (!READONLY_TOOLS.has(tc.name) || tc.approvalState === 'awaiting'),
  ),
)
const visibleFullToolCalls = computed(() =>
  fullToolCalls.value.slice(0, fullToolCallLimit.value),
)
const hiddenFullToolCallCount = computed(() =>
  Math.max(0, fullToolCalls.value.length - visibleFullToolCalls.value.length),
)

/** Pill 点击 → 展开为完整卡片：把对应 toolCall id 加到强制展开集合 */
type ActivityStepState = 'done' | 'active' | 'idle'
type ActivityStepVisual = 'check' | 'dot' | 'bars' | 'pen' | 'spark'

interface AssistantActivityStep {
  key: string
  label: string
  detail?: string
  state: ActivityStepState
  visual: ActivityStepVisual
}

const toolCallRenderSignature = computed(() =>
  (props.message.toolCalls ?? [])
    .map(tc => `${tc.id}:${tc.name}:${tc.status}:${tc.approvalState ?? ''}:${tc.streamingChars ?? ''}`)
    .join('|'),
)

function isToolRunning(status: string | undefined): boolean {
  return status === 'pending' || status === 'running' || status === 'streaming'
}

function isEditingTool(name: string): boolean {
  const category = classifyToolActivity(name)
  return category === 'write' || category === 'command'
}

function formatToolName(name: string): string {
  return toToolDisplayName(name)
}

const runtimeToolSummary = computed(() =>
  summarizeToolActivity({
    toolCalls: props.message.toolCalls,
    toolResults: props.message.toolResults,
  }),
)
const shouldShowRuntimeToolSummary = computed(() =>
  hasToolCalls.value && (runtimeToolSummary.value.callCount >= 2 || runtimeToolSummary.value.hasWrite || runtimeToolSummary.value.hasCommand || runtimeToolSummary.value.hasFailure),
)

const runningToolCalls = computed(() =>
  (props.message.toolCalls ?? []).filter(tc => isToolRunning(tc.status) || tc.approvalState === 'awaiting'),
)
const readonlyToolCalls = computed(() =>
  (props.message.toolCalls ?? []).filter(tc => READONLY_TOOLS.has(tc.name)),
)
const editingToolCalls = computed(() =>
  (props.message.toolCalls ?? []).filter(tc => isEditingTool(tc.name)),
)
const hasEditingDone = computed(() => editingToolCalls.value.some(tc => tc.status === 'success'))
const hasReadonlyActive = computed(() => readonlyToolCalls.value.some(tc => isToolRunning(tc.status)))
const hasEditingActive = computed(() => editingToolCalls.value.some(tc => isToolRunning(tc.status) || tc.approvalState === 'awaiting'))
const hasToolFailure = computed(() => (props.message.toolCalls ?? []).some(tc => tc.status === 'error'))
const activeToolCall = computed(() => runningToolCalls.value[0])
const assistantWorkActive = computed(() => props.message.isStreaming || runningToolCalls.value.length > 0)
const isBoundaryMessage = computed(() =>
  props.message.type === 'divider'
  || props.message.type === 'compact-boundary'
  || props.message.type === 'rewind-boundary',
)

const assistantActivityDetail = computed(() => {
  const activeTool = activeToolCall.value
  if (activeTool?.approvalState === 'awaiting') return '等待确认'
  if (activeTool) return formatToolName(activeTool.name)
  if (hasEditingDone.value) return '已完成修改'
  if (hasToolCalls.value) {
    const done = (props.message.toolCalls ?? []).filter(tc => tc.status === 'success').length
    return `${done}/${props.message.toolCalls?.length ?? 0} 个工具`
  }
  if (props.message.isStreaming) return '正在生成回答'
  return undefined
})

const showAssistantActivity = computed(() =>
  !isUser.value
  && !isError.value
  && !isBoundaryMessage.value
  && (props.message.isStreaming || runningToolCalls.value.length > 0),
)

const assistantActivityStep = computed<AssistantActivityStep | null>(() => {
  const contextDone = hasThinking.value || hasToolCalls.value || !!props.message.promptTokens

  if (hasEditingActive.value) {
    return {
      key: 'editing',
      label: '正在修改',
      detail: assistantActivityDetail.value,
      state: 'active',
      visual: 'pen',
    }
  }

  if (hasReadonlyActive.value) {
    return {
      key: 'reading',
      label: '正在读取',
      detail: assistantActivityDetail.value,
      state: 'active',
      visual: 'bars',
    }
  }

  if (props.message.isStreaming && hasEditingDone.value && !hasToolFailure.value && !!props.message.content) {
    return {
      key: 'celebrating',
      label: '正在整理',
      state: 'active',
      visual: 'spark',
    }
  }

  if (props.message.isStreaming && !contextDone) {
    return {
      key: 'context',
      label: '准备上下文',
      detail: assistantActivityDetail.value,
      state: 'active',
      visual: 'dot',
    }
  }

  if (assistantWorkActive.value) {
    return {
      key: 'processing',
      label: '处理中...',
      detail: assistantActivityDetail.value,
      state: 'active',
      visual: 'dot',
    }
  }

  return null
})

const expandedPillIds = ref<Set<string>>(new Set())
function expandPill(id: string) {
  const next = new Set(expandedPillIds.value)
  next.add(id)
  expandedPillIds.value = next
}
function expandPillGroup(ids: string[]) {
  const next = new Set(expandedPillIds.value)
  ids
    .filter(id => !next.has(id))
    .slice(0, TOOL_DETAIL_BATCH_SIZE)
    .forEach(id => next.add(id))
  expandedPillIds.value = next
}
const remainingPills = computed(() =>
  contextPills.value.filter(tc => !expandedPillIds.value.has(tc.id)),
)
const promotedPillCalls = computed(() =>
  contextPills.value.filter(tc => expandedPillIds.value.has(tc.id)),
)
const visiblePromotedPillCalls = computed(() =>
  promotedPillCalls.value.slice(0, promotedPillCallLimit.value),
)
const hiddenPromotedPillCallCount = computed(() =>
  Math.max(0, promotedPillCalls.value.length - visiblePromotedPillCalls.value.length),
)
const hiddenToolCallCount = computed(() =>
  hiddenFileOperationCount.value + hiddenPromotedPillCallCount.value + hiddenFullToolCallCount.value,
)
const shouldShowToolExpandButton = computed(() => hiddenToolCallCount.value > 0)

function revealMoreToolDetails() {
  fileOperationLimit.value += TOOL_DETAIL_BATCH_SIZE
  promotedPillCallLimit.value += TOOL_DETAIL_BATCH_SIZE
  fullToolCallLimit.value += TOOL_DETAIL_BATCH_SIZE
}

watch(
  () => props.message.id,
  () => {
    contentExpanded.value = false
    fileOperationLimit.value = VISIBLE_FILE_OPERATION_LIMIT
    promotedPillCallLimit.value = VISIBLE_PROMOTED_TOOL_CALL_LIMIT
    fullToolCallLimit.value = VISIBLE_FULL_TOOL_CALL_LIMIT
    expandedPillIds.value = new Set()
  },
)

/** 将连续同名工具调用聚合为 group，减少垂直空间 */
interface PillGroup {
  name: string
  calls: typeof contextPills.value
}
const pillGroups = computed<PillGroup[]>(() => {
  const groups: PillGroup[] = []
  for (const tc of remainingPills.value) {
    const last = groups[groups.length - 1]
    if (last && last.name === tc.name) last.calls.push(tc)
    else groups.push({ name: tc.name, calls: [tc] })
  }
  return groups
})

async function copyContent() {
  try {
    await navigator.clipboard.writeText(displayContent.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch { /* 静默失败 */ }
}

/** 导出消息为 .md 文件 */
async function exportMarkdown() {
  const filePath = await save({
    defaultPath: `ai-reply-${Date.now()}.md`,
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  })
  if (!filePath) return
  try {
    await writeTextFile(filePath, displayContent.value)
  } catch (e) {
    log.error('export_markdown_failed', undefined, e)
  }
}

/** 解析消息文本为段落列表（文本 / 代码块 / 文件卡片） */
const contentSegments = computed(() => {
  const text = displayedContent.value
  if (!text) return []
  return parseFileMarkers(text)
})

/** 用户消息也走 markdown 渲染（列表、加粗、行内代码） */
const userRenderedSegments = computed(() =>
  contentSegments.value.map(seg => ({
    ...seg,
    html: seg.type === 'text' ? renderBlock(seg.content) : '',
  }))
)

/** 缓存 Markdown 渲染结果，避免每帧重算 */
const renderedSegments = computed(() =>
  contentSegments.value.map((seg, index) => ({
    ...seg,
    html: seg.type === 'text'
      ? renderBlockSegment(seg.content, {
        sanitize: index < RENDER_TEXT_SEGMENT_LIMIT || shouldRenderFullContent.value,
        preview: index >= RENDER_TEXT_SEGMENT_LIMIT && !shouldRenderFullContent.value,
      })
      : '',
  }))
)

/** 转义 HTML */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 行内 Markdown 渲染 */
function renderInline(text: string): string {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-foreground">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code class="px-1 py-px rounded bg-muted/80 text-[0.9em] font-mono">$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" class="text-primary hover:underline">$1</a>')
}

/** 块级 Markdown 渲染 — 紧凑排版 */
function renderBlock(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]!

    // 空行跳过
    if (!line.trim()) { i++; continue }

    // 标题
    const h1 = line.match(/^# (.+)$/)
    if (h1) { out.push(`<h2 class="text-[14px] font-bold mt-3 mb-1 text-foreground">${renderInline(h1[1]!)}</h2>`); i++; continue }
    const h2 = line.match(/^## (.+)$/)
    if (h2) { out.push(`<h3 class="text-[13px] font-bold mt-2.5 mb-0.5 text-foreground">${renderInline(h2[1]!)}</h3>`); i++; continue }
    const h3 = line.match(/^### (.+)$/)
    if (h3) { out.push(`<h4 class="text-[13px] font-semibold mt-2 mb-0.5 text-foreground">${renderInline(h3[1]!)}</h4>`); i++; continue }

    // 无序列表
    if (line.match(/^[-*] /)) {
      const items: string[] = []
      while (i < lines.length && lines[i]!.match(/^[-*] /)) {
        items.push(renderInline(lines[i]!.replace(/^[-*] /, '')))
        i++
      }
      out.push(`<ul class="my-1 ml-4 list-disc space-y-px">${items.map(it => `<li class="text-foreground/85 pl-0.5">${it}</li>`).join('')}</ul>`)
      continue
    }

    // 有序列表
    if (line.match(/^\d+\. /)) {
      const items: string[] = []
      while (i < lines.length && lines[i]!.match(/^\d+\. /)) {
        items.push(renderInline(lines[i]!.replace(/^\d+\. /, '')))
        i++
      }
      out.push(`<ol class="my-1 ml-4 list-decimal space-y-px">${items.map(it => `<li class="text-foreground/85 pl-0.5">${it}</li>`).join('')}</ol>`)
      continue
    }

    // 普通段落
    const pLines: string[] = []
    while (i < lines.length && lines[i]!.trim() !== '' && !lines[i]!.match(/^#{1,3} /) && !lines[i]!.match(/^[-*] /) && !lines[i]!.match(/^\d+\. /)) {
      pLines.push(renderInline(lines[i]!))
      i++
    }
    if (pLines.length > 0) {
      out.push(`<p class="my-0.5 leading-relaxed">${pLines.join('<br/>')}</p>`)
    }
  }

  return DOMPurify.sanitize(out.join(''), { ADD_ATTR: ['target'] })
}

function renderBlockSegment(
  text: string,
  options: { sanitize: boolean; preview: boolean },
): string {
  if (options.preview) {
    return `<p class="my-0.5 leading-relaxed text-muted-foreground/70">${esc(text.slice(0, 800))}……</p>`
  }
  if (options.sanitize) return renderBlock(text)
  return esc(text)
}
</script>

<template>
  <!-- ==================== 用户消息 ==================== -->
  <div v-if="isUser" class="ai-turn ai-turn-user" :class="rootSpacingClass">
    <div class="group relative flex gap-4">
      <!-- Timeline -->
      <div class="relative flex w-[22px] shrink-0 flex-col items-center pt-2">
        <div class="h-[9px] w-[9px] rounded-full" :class="timelineDotClass" />
        <div v-if="!isGroupEnd" class="mt-2 w-px flex-1" :class="timelineLineClass" />
      </div>

      <!-- Content -->
      <div class="flex-1 min-w-0 pr-1">
        <!-- Turn Header -->
        <div v-if="!hideHeader && !stickyCompact" class="mb-2 flex items-center gap-2 text-[12px] text-muted-foreground/70">
          <strong class="text-[13px] font-semibold text-foreground/95">{{ turnRoleLabel }}</strong>
          <span class="h-1 w-1 rounded-full bg-muted-foreground/35" />
          <span class="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/45">{{ turnMetaLabel }}</span>
        </div>

        <!-- User content card -->
        <div
          class="ai-user-card max-w-[860px] rounded-2xl border border-white/[0.09] bg-[#141419] px-4 py-3 text-[14px] leading-[1.7] shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]"
          :class="stickyCompact ? 'shadow-sm' : 'shadow-[0_18px_42px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.025)]'"
        >
          <!-- 吸顶极简态：单行省略 + 展开按钮 -->
          <div v-if="stickyCompact" class="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
            <span class="line-clamp-2 min-w-0 whitespace-pre-wrap break-words text-[12px] leading-[1.45] text-foreground/82">{{ displayContent }}</span>
            <div class="flex shrink-0 items-center gap-1">
              <button
                class="flex h-6 w-6 items-center justify-center rounded-md border border-border/30 bg-background/70 text-muted-foreground/45 transition-colors hover:bg-muted/60 hover:text-foreground/80"
                :title="copied ? '已复制' : '快捷复制'"
                @click.stop="copyContent"
              >
                <component :is="copied ? Check : Copy" class="h-3 w-3" />
              </button>
              <button
                class="flex h-6 w-6 items-center justify-center rounded-md border border-border/30 bg-background/70 text-muted-foreground/45 transition-colors hover:bg-muted/60 hover:text-foreground/80"
                title="从这里创建分支会话"
                @click.stop="confirmFork"
              >
                <GitFork class="h-3 w-3" />
              </button>
              <button
                class="flex h-6 w-6 items-center justify-center rounded-md border border-border/30 bg-background/70 text-muted-foreground/45 transition-colors hover:bg-muted/60 hover:text-foreground/80"
                title="回退到这里继续"
                @click.stop="confirmRewind"
              >
                <History class="h-3 w-3" />
              </button>
              <button
                class="flex h-6 w-6 items-center justify-center rounded-md border border-border/30 bg-background/70 text-muted-foreground/45 transition-colors hover:bg-muted/60 hover:text-foreground/80"
                title="展开完整提问"
                @click.stop="userExpanded = !userExpanded"
              >
                <ChevronRight class="h-3 w-3" :class="userExpanded ? 'rotate-90' : 'rotate-0'" />
              </button>
            </div>
          </div>

          <!-- 吸顶展开态（点击展开按钮后） -->
          <div
            v-if="stickyCompact && userExpanded"
            class="mt-2 text-[13px] text-foreground/85 leading-[1.65] select-text border-t border-border/10 pt-2"
          >
            <template v-for="(seg, i) in userRenderedSegments" :key="i">
              <div v-if="seg.type === 'text'" v-html="seg.html" />
            </template>
          </div>

          <!-- 普通态 -->
          <template v-else-if="!stickyCompact">
            <!-- 用户消息：走 markdown 渲染（解析列表、加粗、行内代码） -->
            <div
              class="text-[14px] text-foreground/92 leading-[1.7] select-text transition-[max-height] duration-200"
              :style="userNeedsCollapse && !effectiveExpanded ? { maxHeight: '3.5em', overflow: 'hidden' } : { maxHeight: 'none' }"
            >
              <template v-for="(seg, i) in userRenderedSegments" :key="i">
                <div v-if="seg.type === 'text'" v-html="seg.html" />
                <AiFileCard
                  v-else-if="seg.type === 'file'"
                  :name="seg.name"
                  :path="seg.path"
                  :size="seg.size"
                  :lines="seg.lines"
                  :content="seg.content"
                  class="my-1.5"
                />
              </template>
            </div>
            <!-- 展开 / 收起按钮（右对齐，独立行，无负边距遮挡） -->
            <div v-if="userNeedsCollapse" class="relative z-[1] flex justify-end mt-1.5">
              <button
                class="cursor-pointer flex items-center gap-1 text-[11px] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors"
                @click.stop="userExpanded = !userExpanded"
              >
                <ChevronRight class="h-3 w-3 transition-transform duration-150" :class="effectiveExpanded ? '-rotate-90' : 'rotate-90'" />
                {{ effectiveExpanded ? '收起' : `展开全部（${userLineCount} 行）` }}
              </button>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>

  <!-- ==================== 错误消息 ==================== -->
  <div v-else-if="isError" class="ai-turn my-3">
    <div class="group relative flex gap-4">
      <!-- Timeline -->
      <div class="relative flex w-[22px] shrink-0 flex-col items-center pt-2">
        <div class="h-[9px] w-[9px] rounded-full" :class="timelineDotClass" />
        <div v-if="!isGroupEnd" class="mt-2 w-px flex-1" :class="timelineLineClass" />
      </div>

      <!-- Content -->
      <div class="flex-1 min-w-0 pr-1">
        <!-- Turn Header -->
        <div v-if="!hideHeader" class="mb-2 flex items-center gap-2 text-[12px] text-red-300/70">
          <strong class="text-[13px] font-semibold text-red-200">{{ turnRoleLabel }}</strong>
          <span class="h-1 w-1 rounded-full bg-red-300/35" />
          <span class="font-mono text-[10px] uppercase tracking-[0.12em] text-red-300/55">{{ turnMetaLabel }}</span>
        </div>

        <div class="flex items-start gap-2 rounded-xl border border-red-400/20 bg-red-500/[0.045] px-3 py-2.5">
          <AlertCircle class="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div class="flex-1 text-[13px] text-destructive leading-relaxed select-text">
            <div>{{ displayContent }}</div>
            <!-- max_tokens 截断一键修复 -->
            <div v-if="isMaxTokensTruncated" class="mt-2 flex items-center gap-1.5 flex-wrap">
              <span class="text-[11px] text-destructive/70">一键调大：</span>
              <button
                v-for="v in [16384, 32768, 65536, 131072]"
                :key="v"
                class="rounded-md border border-destructive/25 bg-background/60 px-2 py-0.5 text-[11px] text-destructive hover:bg-destructive/10 transition-colors font-mono"
                :title="`把当前模型 maxOutput 调到 ${v.toLocaleString()} token 并重新生成`"
                @click="emit('bumpMaxOutput', v)"
              >
                {{ v >= 1024 ? (v / 1024) + 'K' : v }}
              </button>
            </div>
          </div>
          <button
            v-if="canContinue"
            class="shrink-0 flex items-center gap-1 rounded-md border border-destructive/25 bg-background/60 px-2 py-1 text-[11px] text-destructive hover:bg-destructive/10 transition-colors"
            title="基于上一次的用户输入重新生成"
            @click="emit('continue')"
          >
            <RotateCw class="h-3 w-3" />
            继续生成
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- ==================== 助手消息 ==================== -->
  <div
    v-else
    class="ai-turn ai-turn-assistant group relative flex gap-4"
    :class="rootSpacingClass"
    v-memo="[message.id, message.isStreaming, toolCallRenderSignature, message.toolResults, message.content?.length, message.notice?.text, message.historyToolSummary?.callCount, hideHeader, isGroupEnd, contentExpanded, fileOperationLimit, promotedPillCallLimit, fullToolCallLimit]"
  >
    <!-- Timeline -->
    <div class="relative flex w-[22px] shrink-0 flex-col items-center pt-2">
      <div class="h-[9px] w-[9px] rounded-full" :class="timelineDotClass" />
      <div v-if="!isGroupEnd" class="mt-2 w-px flex-1" :class="timelineLineClass" />
    </div>

    <!-- Content -->
    <div class="flex-1 min-w-0 pr-1">
      <div
        v-if="message.saveStatus === 'error'"
        class="mb-2 text-[10px] text-destructive/50"
        title="消息持久化失败"
      >
        消息持久化失败
      </div>

      <!-- 操作按钮（hover 才显，右上角） -->
      <div class="absolute right-0 top-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          v-if="!message.isStreaming && message.content"
          class="rounded-md border border-transparent p-1 text-muted-foreground/30 transition-colors hover:border-white/[0.08] hover:bg-white/[0.04] hover:text-muted-foreground"
          title="导出 .md"
          @click="exportMarkdown"
        >
          <Download class="h-3.5 w-3.5" />
        </button>
        <button
          v-if="!message.isStreaming && message.content"
          class="rounded-md border border-transparent p-1 text-muted-foreground/30 transition-colors hover:border-white/[0.08] hover:bg-white/[0.04] hover:text-muted-foreground"
          :title="copied ? '已复制' : '复制'"
          @click="copyContent"
        >
          <component :is="copied ? Check : Copy" class="h-3.5 w-3.5" />
        </button>
        <button
          v-if="!message.isStreaming && message.type !== 'divider' && message.type !== 'compact-boundary' && message.type !== 'rewind-boundary'"
          class="rounded-md border border-transparent p-1 text-muted-foreground/30 transition-colors hover:border-white/[0.08] hover:bg-white/[0.04] hover:text-muted-foreground"
          title="回退到这里继续"
          @click="confirmRewind"
        >
          <History class="h-3.5 w-3.5" />
        </button>
      </div>

      <!-- 历史工具摘要：结构化展示，不把工具协议渲染成正文 -->
      <AiToolActivitySummaryCard
        v-if="hasHistoryToolSummary && message.historyToolSummary"
        class="mb-2"
        variant="history"
        :summary="message.historyToolSummary"
      />

      <!-- 思考过程（原生 <details> 无 JS 开销） -->
      <details v-if="hasThinking" class="mb-2 group/thinking">
        <summary class="flex items-center gap-1.5 text-[11px] text-muted-foreground/42 hover:text-muted-foreground/70 transition-colors cursor-pointer list-none select-none italic">
          <ChevronRight class="h-3 w-3 transition-transform duration-200 group-open/thinking:rotate-90 not-italic" />
          <span>思考过程</span>
        </summary>
        <div class="mt-1 pl-3 border-l border-white/[0.08] text-[11px] text-muted-foreground/42 italic leading-relaxed whitespace-pre-wrap max-h-[180px] overflow-y-auto">
          {{ sanitizedThinking }}
        </div>
      </details>

      <!-- 流式光标 -->
      <div v-if="message.isStreaming && !message.content && !assistantActivityStep" class="flex items-center gap-2 py-1.5">
        <span class="flex gap-[4px] items-end">
          <span class="thinking-dot" style="animation-delay: 0ms" />
          <span class="thinking-dot" style="animation-delay: 160ms" />
          <span class="thinking-dot" style="animation-delay: 320ms" />
        </span>
        <span class="text-[11px] text-muted-foreground/55 tracking-wide">思考中</span>
      </div>

      <!-- 消息内容（普通文本无大框，文档流） -->
      <div
        v-if="showAssistantActivity && assistantActivityStep"
        class="assistant-activity-strip"
        aria-label="Assistant activity"
      >
        <div
          :key="assistantActivityStep.key"
          class="assistant-activity-item"
          :class="[`is-${assistantActivityStep.state}`, `is-${assistantActivityStep.key}`]"
        >
          <i class="assistant-activity-icon" :class="`is-${assistantActivityStep.visual}`" aria-hidden="true">
            <template v-if="assistantActivityStep.visual === 'bars'">
              <i />
              <i />
              <i />
            </template>
          </i>
          <strong>{{ assistantActivityStep.label }}</strong>
          <span v-if="assistantActivityStep.detail">{{ assistantActivityStep.detail }}</span>
        </div>
      </div>

      <div
        v-if="displayContent"
        class="answer-flow text-[14px] leading-[1.8] select-text"
        :class="hideHeader ? 'text-muted-foreground/62' : 'text-foreground/86'"
      >
        <div v-if="shouldRenderStreamingTextWindow" class="streaming-text-window whitespace-pre-wrap break-words">
          {{ streamingTextWindow }}
        </div>
        <template v-else>
          <template v-for="(seg, i) in renderedSegments" :key="i">
            <div v-if="seg.type === 'text'" v-html="seg.html" />
            <AiCodeBlock v-else-if="seg.type === 'code'" :language="seg.language" :code="seg.content" :is-streaming="message.isStreaming" class="my-1.5" />
            <AiFileCard
              v-else-if="seg.type === 'file'"
              :name="seg.name"
              :path="seg.path"
              :size="seg.size"
              :lines="seg.lines"
              :content="seg.content"
              class="my-1.5"
            />
          </template>
        </template>
        <div
          v-if="isLongMarkdown"
          class="mt-2 flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 py-2 text-[12px] text-muted-foreground/75"
        >
          <span>
            {{ contentExpanded ? '已渲染完整长回复' : `长回复已预览 ${Math.round(LONG_MARKDOWN_PREVIEW_CHARS / 1000)}K / ${Math.round(messageContentLength / 1000)}K 字符，避免页面卡顿。` }}
          </span>
          <button
            class="shrink-0 rounded-lg border border-white/[0.1] bg-background/60 px-2.5 py-1 text-[11px] text-foreground/80 transition-colors hover:bg-muted/40"
            @click="contentExpanded = !contentExpanded"
          >
            {{ contentExpanded ? '收起预览' : '渲染完整内容' }}
          </button>
        </div>
      </div>

      <!-- 工具调用块 -->
      <div v-if="hasToolCalls" class="mt-3 space-y-2">
        <AiToolActivitySummaryCard
          v-if="shouldShowRuntimeToolSummary"
          :summary="runtimeToolSummary"
          variant="runtime"
        />

        <!-- 任务计划提升展示：todo_write 不再作为普通工具卡占用对话空间 -->
        <AiTodoPanel
          v-if="hasTodoSummary"
          :todos="latestTodos"
        />

        <!-- 文件操作组（聚合 write_file 为毛玻璃卡片组） -->
        <AiFileOpsGroup
          v-if="visibleFileOperations.length > 0"
          :operations="visibleFileOperations"
          :session-id="sessionId"
        />

        <!-- 只读工具胶囊条（聚合连续同名调用） -->
        <div v-if="pillGroups.length" class="activity-strip mt-0.5 flex flex-wrap gap-2">
          <template v-for="group in pillGroups" :key="group.name + group.calls[0]?.id">
            <!-- 多个同名：显示"工具 ×N"的第一个胶囊 + 数量徽章 -->
            <div v-if="group.calls.length > 1" class="flex items-center gap-0.5">
              <AiContextPill
                :tool-call="group.calls[0]!"
                :count="group.calls.length"
                @open="expandPillGroup(group.calls.map(c => c.id))"
              />
            </div>
            <!-- 单个正常渲染 -->
            <AiContextPill
              v-else
              :tool-call="group.calls[0]!"
              @open="expandPill(group.calls[0]!.id)"
            />
          </template>
        </div>

        <!-- 被点开的胶囊 → 完整卡片 -->
        <div v-if="visiblePromotedPillCalls.length" class="space-y-1.5">
          <AiToolCallBlock
            v-for="tc in visiblePromotedPillCalls"
            :key="tc.id"
            :tool-call="tc"
            :session-id="sessionId"
          />
        </div>

        <!-- 其他工具调用（审批等待 / bash 等，始终完整卡片） -->
        <div v-if="visibleFullToolCalls.length" class="space-y-1.5">
          <AiToolCallBlock
            v-for="tc in visibleFullToolCalls"
            :key="tc.id"
            :tool-call="tc"
            :session-id="sessionId"
          />
        </div>

        <div
          v-if="shouldShowToolExpandButton"
          class="flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[12px] text-muted-foreground/75"
        >
          <span>还有 {{ hiddenToolCallCount }} 个工具详情未挂载，已先折叠以降低大会话渲染压力。</span>
          <button
            class="shrink-0 rounded-lg border border-white/[0.1] bg-background/60 px-2.5 py-1 text-[11px] text-foreground/80 transition-colors hover:bg-muted/40"
            @click="revealMoreToolDetails"
          >
            继续加载详情
          </button>
        </div>
      </div>

      <!-- 系统提示横幅（工具超限 / 流被中断等） -->
      <div
        v-if="message.notice"
        class="mt-3 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[12px] leading-relaxed"
        :class="{
          'border-amber-500/25 bg-amber-500/[0.04] text-amber-700 dark:text-amber-300': message.notice.kind === 'warn',
          'border-destructive/25 bg-destructive/[0.04] text-destructive': message.notice.kind === 'error',
          'border-sky-500/25 bg-sky-500/[0.04] text-sky-700 dark:text-sky-300': message.notice.kind === 'info',
        }"
      >
        <component
          :is="message.notice.kind === 'warn' ? AlertTriangle : message.notice.kind === 'error' ? AlertCircle : Info"
          class="h-3.5 w-3.5 shrink-0 mt-0.5"
        />
        <span class="min-w-0 flex-1 select-text">
          <strong v-if="message.notice.title" class="block text-[12px] font-semibold">{{ message.notice.title }}</strong>
          <span class="block">{{ message.notice.text }}</span>
          <span
            v-if="message.notice.actionHint"
            class="block pt-1 text-[11px] opacity-80"
          >{{ message.notice.actionHint }}</span>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ai-turn {
  position: relative;
}

.ai-turn::before {
  position: absolute;
  left: 4px;
  top: 8px;
  width: 1px;
  height: calc(100% - 12px);
  pointer-events: none;
  background: linear-gradient(to bottom, rgb(255 255 255 / 0.1), transparent);
  content: '';
  opacity: 0;
  transition: opacity 160ms ease;
}

.ai-turn:hover::before {
  opacity: 1;
}

.ai-user-card {
  background:
    radial-gradient(circle at 0% 0%, rgb(96 165 250 / 0.08), transparent 42%),
    linear-gradient(180deg, #17171d, #121217);
}

.ai-turn-assistant {
  border-radius: 18px;
}

.answer-flow {
  padding: 2px 0 14px;
  border-bottom: 1px solid rgb(244 244 245 / 0.09);
  text-wrap: pretty;
}

.answer-flow :deep(p) {
  margin: 0 0 0.35rem;
}

.answer-flow :deep(p:last-child) {
  margin-bottom: 0;
}

.answer-flow :deep(strong) {
  color: rgb(244 244 245 / 0.96);
}

.answer-flow :deep(code) {
  border: 1px solid rgb(244 244 245 / 0.08);
  background: rgb(21 21 27 / 0.9);
  color: rgb(223 230 255 / 0.94);
  border-radius: 6px;
  padding: 0.08rem 0.28rem;
}

.answer-flow :deep(a) {
  color: #6aa8ff;
}

.activity-strip {
  padding: 8px 0 2px;
}

.streaming-text-window {
  contain: content;
  border-left: 1px solid rgb(85 216 153 / 0.18);
  padding-left: 12px;
  color: rgb(244 244 245 / 0.78);
}

/* 流式看门狗圆点跳动 */
.assistant-activity-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 11px 0 8px;
  color: rgb(161 161 170 / 0.72);
}

.assistant-activity-item {
  position: relative;
  display: inline-flex;
  height: 28px;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  border: 1px solid transparent;
  border-radius: 999px;
  padding: 0 9px;
  color: rgb(161 161 170 / 0.72);
  font-size: 12px;
  isolation: isolate;
  transition:
    border-color 180ms ease,
    background 180ms ease,
    color 180ms ease,
    transform 180ms ease,
    opacity 180ms ease;
}

.assistant-activity-item::before,
.assistant-activity-item::after {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  content: "";
}

.assistant-activity-item::before {
  z-index: -1;
  background:
    linear-gradient(115deg, transparent 0%, rgb(255 255 255 / 0.18) 34%, transparent 58%),
    radial-gradient(circle at 20% 50%, rgb(106 168 255 / 0.18), transparent 44%);
  opacity: 0;
  transform: translateX(-120%);
}

.assistant-activity-item::after {
  z-index: -2;
  border: 1px solid rgb(106 168 255 / 0);
  opacity: 0;
}

.assistant-activity-item strong,
.assistant-activity-item span,
.assistant-activity-icon {
  position: relative;
  z-index: 1;
}

.assistant-activity-item strong {
  color: rgb(212 212 216 / 0.88);
  font-size: 12px;
  font-weight: 650;
}

.assistant-activity-item span {
  color: rgb(196 210 255 / 0.72);
}

.assistant-activity-item.is-active {
  border-color: rgb(106 168 255 / 0.24);
  background:
    linear-gradient(180deg, rgb(106 168 255 / 0.1), rgb(106 168 255 / 0.045)),
    rgb(106 168 255 / 0.035);
  color: #cfe2ff;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.03), 0 6px 18px rgb(0 0 0 / 0.12);
  animation: assistant-activity-breathe 1.9s ease-in-out infinite;
}

.assistant-activity-item.is-active::before {
  opacity: 1;
  animation: assistant-activity-scan 1.65s cubic-bezier(0.22, 0.78, 0.24, 1) infinite;
}

.assistant-activity-item.is-active::after {
  opacity: 1;
  animation: assistant-activity-ring 1.9s ease-in-out infinite;
}

.assistant-activity-item.is-context {
  border-color: rgb(106 168 255 / 0.3);
}

.assistant-activity-item.is-reading {
  border-color: rgb(91 215 255 / 0.28);
}

.assistant-activity-item.is-editing {
  border-color: rgb(214 168 79 / 0.3);
  background:
    linear-gradient(180deg, rgb(214 168 79 / 0.1), rgb(214 168 79 / 0.035)),
    rgb(106 168 255 / 0.02);
}

.assistant-activity-item.is-celebrating {
  border-color: rgb(85 216 153 / 0.32);
  background:
    radial-gradient(circle at 18% 50%, rgb(85 216 153 / 0.18), transparent 42%),
    rgb(85 216 153 / 0.045);
}

.assistant-activity-item.is-processing::before {
  animation-duration: 1.25s;
}

.assistant-activity-item.is-active strong {
  color: #fff;
}

.assistant-activity-item.is-done {
  color: rgb(85 216 153 / 0.72);
}

.assistant-activity-item.is-idle {
  opacity: 0.76;
}

.assistant-activity-icon {
  position: relative;
  display: inline-flex;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
}

.assistant-activity-icon.is-dot::before {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #6aa8ff;
  box-shadow: 0 0 0 0 rgb(106 168 255 / 0.36);
  animation: assistant-activity-pulse 1.45s ease-in-out infinite;
  content: "";
}

.assistant-activity-icon.is-dot::after {
  position: absolute;
  width: 12px;
  height: 12px;
  border: 1px solid rgb(106 168 255 / 0.36);
  border-radius: 999px;
  opacity: 0.72;
  animation: assistant-activity-orbit 1.45s linear infinite;
  content: "";
}

.assistant-activity-item.is-processing .assistant-activity-icon.is-dot::before {
  background: #8fb9ff;
  animation-duration: 0.86s;
}

.assistant-activity-item.is-processing .assistant-activity-icon.is-dot::after {
  border-top-color: rgb(255 255 255 / 0.88);
  animation-duration: 0.86s;
}

.assistant-activity-icon.is-bars {
  display: grid;
  width: 14px;
  height: 12px;
  grid-template-columns: repeat(3, 3px);
  gap: 2px;
  align-items: end;
}

.assistant-activity-icon.is-bars > i {
  display: block;
  height: 40%;
  border-radius: 999px;
  background: #5bd7ff;
  box-shadow: 0 0 10px rgb(91 215 255 / 0.36);
  transform-origin: bottom;
  animation: assistant-activity-bars 0.86s ease-in-out infinite;
}

.assistant-activity-icon.is-bars > i:nth-child(2) {
  animation-delay: 140ms;
}

.assistant-activity-icon.is-bars > i:nth-child(3) {
  animation-delay: 280ms;
}

.assistant-activity-icon.is-pen {
  transform: rotate(-36deg);
}

.assistant-activity-icon.is-pen::before {
  position: absolute;
  left: 5px;
  top: 1px;
  width: 3px;
  height: 11px;
  border-radius: 999px;
  background: #d6a84f;
  animation: assistant-activity-write 1.35s ease-in-out infinite;
  content: "";
}

.assistant-activity-icon.is-pen::after {
  position: absolute;
  left: 4px;
  top: 11px;
  width: 8px;
  height: 2px;
  border-radius: 999px;
  background: linear-gradient(90deg, transparent, rgb(214 168 79 / 0.78), transparent);
  opacity: 0.8;
  transform: rotate(36deg) translateX(-2px);
  animation: assistant-activity-ink 1.35s ease-in-out infinite;
  content: "";
}

.assistant-activity-icon.is-check {
  border: 1px solid rgb(85 216 153 / 0.38);
  border-radius: 50%;
}

.assistant-activity-icon.is-check::after {
  position: absolute;
  left: 4px;
  top: 2px;
  width: 4px;
  height: 7px;
  border-right: 2px solid #55d899;
  border-bottom: 2px solid #55d899;
  transform: rotate(38deg);
  content: "";
}

.assistant-activity-icon.is-spark {
  animation:
    assistant-activity-spin 2s linear infinite,
    assistant-activity-spark-pop 0.9s ease-in-out infinite;
}

.assistant-activity-icon.is-spark::before,
.assistant-activity-icon.is-spark::after {
  position: absolute;
  left: 6px;
  top: 0;
  width: 2px;
  height: 14px;
  border-radius: 999px;
  background: linear-gradient(to bottom, transparent, #f4f4f5 45%, transparent);
  content: "";
}

.assistant-activity-icon.is-spark::after {
  transform: rotate(90deg);
}

.thinking-dot {
  display: inline-block;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: oklch(0.696 0.17 162.48 / 0.75); /* emerald-500 */
  animation: thinking-bounce 1s ease-in-out infinite;
}

@keyframes thinking-bounce {
  0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
  40%           { transform: translateY(-4px); opacity: 1; }
}

@keyframes assistant-activity-breathe {
  0%,
  100% {
    transform: translateY(0);
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.04),
      0 6px 18px rgb(0 0 0 / 0.12),
      0 0 0 rgb(106 168 255 / 0);
  }
  50% {
    transform: translateY(-1px);
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.08),
      0 10px 24px rgb(0 0 0 / 0.16),
      0 0 18px rgb(106 168 255 / 0.16);
  }
}

@keyframes assistant-activity-scan {
  0% {
    transform: translateX(-120%);
  }
  62%,
  100% {
    transform: translateX(120%);
  }
}

@keyframes assistant-activity-ring {
  0%,
  100% {
    border-color: rgb(106 168 255 / 0.08);
    opacity: 0.52;
  }
  50% {
    border-color: rgb(106 168 255 / 0.34);
    opacity: 1;
  }
}

@keyframes assistant-activity-pulse {
  0%,
  100% {
    opacity: 0.38;
    transform: scale(0.82);
    box-shadow: 0 0 0 0 rgb(106 168 255 / 0.28);
  }
  50% {
    opacity: 1;
    transform: scale(1.15);
    box-shadow: 0 0 0 5px rgb(106 168 255 / 0);
  }
}

@keyframes assistant-activity-orbit {
  to {
    transform: rotate(360deg);
  }
}

@keyframes assistant-activity-bars {
  0%,
  100% {
    height: 35%;
    opacity: 0.45;
    transform: scaleY(0.72);
  }
  50% {
    height: 100%;
    opacity: 1;
    transform: scaleY(1);
  }
}

@keyframes assistant-activity-write {
  0%,
  100% {
    opacity: 0.55;
    transform: translateY(-1px);
  }
  50% {
    opacity: 1;
    transform: translateY(2px);
  }
}

@keyframes assistant-activity-ink {
  0%,
  100% {
    opacity: 0;
    transform: rotate(36deg) translateX(-4px) scaleX(0.4);
  }
  45%,
  70% {
    opacity: 0.9;
    transform: rotate(36deg) translateX(1px) scaleX(1);
  }
}

@keyframes assistant-activity-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes assistant-activity-spark-pop {
  0%,
  100% {
    filter: drop-shadow(0 0 0 rgb(85 216 153 / 0));
    opacity: 0.76;
  }
  50% {
    filter: drop-shadow(0 0 8px rgb(85 216 153 / 0.58));
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .assistant-activity-item,
  .assistant-activity-item::before,
  .assistant-activity-item::after,
  .assistant-activity-icon.is-dot::before,
  .assistant-activity-icon.is-dot::after,
  .assistant-activity-icon.is-bars > i,
  .assistant-activity-icon.is-pen::before,
  .assistant-activity-icon.is-pen::after,
  .assistant-activity-icon.is-spark,
  .thinking-dot {
    animation: none;
  }
}
</style>
