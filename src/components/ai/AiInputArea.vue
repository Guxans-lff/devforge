<script setup lang="ts">
/**
 * AI 输入区组件（VSCode Copilot Chat 风格）
 *
 * 底部集成：文本输入 + 模型选择 + 模式切换 + 配置入口。
 * 支持 Shift+Enter 换行、Enter 发送、自动增高。
 */
import { ref, computed, nextTick, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ProviderConfig, FileAttachment } from '@/types/ai'
import type { FileNode } from '@/types/workspace-files'
import AtMentionPopover from './AtMentionPopover.vue'
import SlashCommandPopover, { type SlashCommand } from './SlashCommandPopover.vue'
import AiPromptEnhancer from './AiPromptEnhancer.vue'
import {
  Send,
  Square,
  Loader2,
  ChevronDown,
  Settings,
  MessageSquareText,
  Sparkles,
  Zap,
  Network,
  AtSign,
  Paperclip,
} from 'lucide-vue-next'
import AiFilePreviewBar from './AiFilePreviewBar.vue'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'

export type ChatMode = 'normal' | 'plan' | 'auto' | 'dispatcher'

const props = withDefaults(defineProps<{
  isStreaming?: boolean
  disabled?: boolean
  loading?: boolean
  placeholder?: string
  /** 可用的 Provider 列表 */
  providers?: ProviderConfig[]
  /** 当前选中的 Provider ID */
  selectedProviderId?: string | null
  /** 当前选中的模型 ID */
  selectedModelId?: string | null
  /** 当前对话模式 */
  chatMode?: ChatMode
  /** 文件附件列表 */
  attachments?: FileAttachment[]
  /** 上下文使用百分比（0-100），用于显示圆环指示器 */
  contextUsagePercent?: number
}>(), {
  isStreaming: false,
  disabled: false,
  loading: false,
  placeholder: '',
  providers: () => [],
  selectedProviderId: null,
  selectedModelId: null,
  chatMode: 'normal',
  attachments: () => [],
  contextUsagePercent: 0,
})

const emit = defineEmits<{
  send: [content: string]
  abort: []
  'update:selectedProviderId': [id: string]
  'update:selectedModelId': [id: string]
  'update:chatMode': [mode: ChatMode]
  openConfig: []
  selectFiles: []
  dropFiles: [files: FileList]
  dropFilePath: [path: string]
  removeAttachment: [id: string]
  mentionFile: [path: string]
  clearSession: []
  compact: []
}>()

const { t } = useI18n()
const inputText = ref('')
const textareaRef = ref<HTMLTextAreaElement | null>()
const isDragOver = ref(false)

// ─────────── 输入历史（G13） ───────────
const INPUT_HISTORY_KEY = 'ai-input-history'
const MAX_HISTORY = 50
const inputHistory = ref<string[]>([])
const historyIndex = ref(-1)
const savedDraft = ref('')

// 输入撤销历史
const undoStack = ref<string[]>([''])
const undoIndex = ref(0)

onMounted(() => {
  try {
    const saved = localStorage.getItem(INPUT_HISTORY_KEY)
    if (saved) inputHistory.value = JSON.parse(saved)
  } catch { /* 忽略 */ }
})

function pushHistory(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return
  // 去重：若已存在则移到末尾
  const idx = inputHistory.value.indexOf(trimmed)
  if (idx !== -1) inputHistory.value.splice(idx, 1)
  inputHistory.value.push(trimmed)
  if (inputHistory.value.length > MAX_HISTORY) inputHistory.value.shift()
  try { localStorage.setItem(INPUT_HISTORY_KEY, JSON.stringify(inputHistory.value)) } catch { /* 忽略 */ }
}

function historyUp() {
  if (inputHistory.value.length === 0) return
  if (historyIndex.value === -1) {
    savedDraft.value = inputText.value
    historyIndex.value = inputHistory.value.length - 1
  } else if (historyIndex.value > 0) {
    historyIndex.value--
  } else {
    return
  }
  inputText.value = inputHistory.value[historyIndex.value]!
  nextTick(adjustHeight)
}

function historyDown() {
  if (historyIndex.value === -1) return
  if (historyIndex.value < inputHistory.value.length - 1) {
    historyIndex.value++
    inputText.value = inputHistory.value[historyIndex.value]!
  } else {
    historyIndex.value = -1
    inputText.value = savedDraft.value
  }
  nextTick(adjustHeight)
}

/** 输入撤销功能 */
function pushToUndoStack(value: string) {
  if (undoStack.value[undoIndex.value] === value) return
  // 清理重做历史
  undoStack.value.splice(undoIndex.value + 1)
  undoStack.value.push(value)
  undoIndex.value = undoStack.value.length - 1
  // 限制撤销栈大小
  if (undoStack.value.length > 50) {
    undoStack.value.shift()
    undoIndex.value--
  }
}

function undo() {
  if (undoIndex.value > 0) {
    undoIndex.value--
    inputText.value = undoStack.value[undoIndex.value]!
    nextTick(adjustHeight)
  }
}

function redo() {
  if (undoIndex.value < undoStack.value.length - 1) {
    undoIndex.value++
    inputText.value = undoStack.value[undoIndex.value]!
    nextTick(adjustHeight)
  }
}

// ─────────── 发送快捷键配置（G12） ───────────
/** 发送方式：enter = Enter 发送，cmd = Cmd/Ctrl+Enter 发送 */
const SEND_MODE_KEY = 'ai-send-mode'
const sendMode = ref<'enter' | 'cmd'>((localStorage.getItem(SEND_MODE_KEY) as 'enter' | 'cmd' | null) ?? 'enter')
function toggleSendMode() {
  sendMode.value = sendMode.value === 'enter' ? 'cmd' : 'enter'
  localStorage.setItem(SEND_MODE_KEY, sendMode.value)
}
const sendHint = computed(() => sendMode.value === 'enter'
  ? t('ai.input.sendHintEnter')
  : t('ai.input.sendHintCmd'))
const inputPlaceholder = computed(() => props.placeholder || t('ai.input.placeholder'))

/** @ 引用相关状态 */
const showAtPopover = ref(false)
const atQuery = ref('')
const atStartPos = ref(-1)
const atAnchorPos = ref({ x: 0, y: 0 })

/** 斜杠命令状态（仅当输入首字符为 "/" 时触发） */
const showSlashPopover = ref(false)
const slashQuery = ref('')
const slashAnchorPos = ref({ x: 0, y: 0 })

const canSend = computed(() => inputText.value.trim().length > 0 && !props.disabled && !props.isStreaming)

// ─────────── 提示词优化（G14） ───────────
const showEnhancer = ref(false)
function openEnhancer() {
  if (!inputText.value.trim()) return
  showEnhancer.value = true
}
function handleEnhancerAccept(text: string) {
  inputText.value = text
  nextTick(adjustHeight)
}

/** 当前 Provider */
const currentProvider = computed(() =>
  props.providers.find(p => p.id === props.selectedProviderId) ?? null,
)

/** 当前模型 */
const currentModel = computed(() =>
  currentProvider.value?.models.find(m => m.id === props.selectedModelId) ?? null,
)

/** 模式配置 */
const CHAT_MODES = computed(() => ({
  normal: {
    label: t('ai.chat.normalChat'),
    shortLabel: t('ai.input.modeShortNormal'),
    desc: t('ai.chat.normalChatDesc'),
    icon: MessageSquareText,
    color: 'text-blue-500',
    bg: 'bg-blue-500/10',
  },
  plan: {
    label: t('ai.chat.planMode'),
    shortLabel: t('ai.input.modeShortPlan'),
    desc: t('ai.chat.planModeDesc'),
    icon: Sparkles,
    color: 'text-violet-500',
    bg: 'bg-violet-500/10',
  },
  auto: {
    label: t('ai.chat.autoMode'),
    shortLabel: t('ai.input.modeShortAuto'),
    desc: t('ai.chat.autoModeDesc'),
    icon: Zap,
    color: 'text-amber-500',
    bg: 'bg-amber-500/10',
  },
  dispatcher: {
    label: t('ai.chat.dispatcher'),
    shortLabel: t('ai.input.modeShortDispatcher'),
    desc: t('ai.chat.dispatcherDesc'),
    icon: Network,
    color: 'text-sky-500',
    bg: 'bg-sky-500/10',
  },
} as const))

const currentModeConfig = computed(() => CHAT_MODES.value[props.chatMode])

/**
 * 使用 mirror div 技术计算 textarea 中指定位置的光标坐标
 * @param position 文本位置索引
 * @returns 屏幕坐标 { x, y }
 */
function getCaretCoordinates(position: number): { x: number; y: number } {
  const el = textareaRef.value
  if (!el) return { x: 0, y: 0 }

  const mirror = document.createElement('div')
  const style = getComputedStyle(el)
  const props = [
    'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'boxSizing', 'whiteSpace', 'wordWrap', 'overflowWrap', 'tabSize', 'textIndent',
  ] as const
  mirror.style.position = 'absolute'
  mirror.style.top = '-9999px'
  mirror.style.left = '-9999px'
  mirror.style.visibility = 'hidden'
  mirror.style.overflow = 'hidden'
  mirror.style.width = `${el.offsetWidth}px`
  for (const prop of props) {
    ;(mirror.style as any)[prop] = style.getPropertyValue(
      prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`),
    )
  }

  // 插入光标前的文本 + 标记 span
  const textBefore = el.value.substring(0, position)
  mirror.textContent = textBefore
  const marker = document.createElement('span')
  marker.textContent = '\u200b' // 零宽字符
  mirror.appendChild(marker)

  document.body.appendChild(mirror)
  const rect = el.getBoundingClientRect()
  const x = rect.left + marker.offsetLeft - el.scrollLeft
  const y = rect.top + marker.offsetTop - el.scrollTop
  document.body.removeChild(mirror)

  return { x, y }
}

/**
 * 检测光标前是否存在未闭合的 @ 引用
 * 从光标位置往前搜索，遇到空格或换行停止
 */
function detectAtMention() {
  const el = textareaRef.value
  if (!el) return

  const text = el.value
  const pos = el.selectionStart ?? 0

  // 从光标往前查找 @
  let i = pos - 1
  while (i >= 0) {
    const ch = text[i]
    if (ch === '@') {
      // 找到 @，提取 query
      atStartPos.value = i
      atQuery.value = text.substring(i + 1, pos)
      atAnchorPos.value = getCaretCoordinates(i)
      showAtPopover.value = true
      return
    }
    if (ch === ' ' || ch === '\n' || ch === '\r') {
      break
    }
    i--
  }

  // 未找到有效 @，关闭浮层
  closeAtPopover()
}

/** 关闭 @ 浮层 */
function closeAtPopover() {
  showAtPopover.value = false
  atQuery.value = ''
  atStartPos.value = -1
}

/** 检测斜杠命令：仅当文本以 "/" 开头时触发；浮层锚定到输入框上方 */
function detectSlashCommand() {
  const el = textareaRef.value
  if (!el) return
  const text = el.value
  if (text.startsWith('/') && !text.includes(' ') && !text.includes('\n')) {
    slashQuery.value = text.slice(1)
    const rect = el.getBoundingClientRect()
    // 宽度 320，定位在输入框左侧与顶部对齐上方 8px（上移浮层高度在 popover 内自适应）
    slashAnchorPos.value = { x: rect.left, y: rect.top }
    showSlashPopover.value = true
  } else {
    closeSlashPopover()
  }
}

function closeSlashPopover() {
  showSlashPopover.value = false
  slashQuery.value = ''
}

/** 选中斜杠命令：用模板替换输入；/clear 走专用事件 */
function handleSlashSelect(cmd: SlashCommand) {
  closeSlashPopover()
  if (cmd.template === '__CLEAR_SESSION__') {
    inputText.value = ''
    emit('clearSession')
    return
  }
  if (cmd.template === '__COMPACT__') {
    inputText.value = ''
    emit('compact')
    return
  }
  inputText.value = cmd.template
  nextTick(() => {
    const el = textareaRef.value
    if (!el) return
    el.focus()
    const pos = inputText.value.length
    el.setSelectionRange(pos, pos)
    adjustHeight()
  })
}

/**
 * 选中文件后替换 @query 为 @filename 并 emit mentionFile
 * @param node 选中的文件节点
 */
function handleAtSelect(node: FileNode) {
  const el = textareaRef.value
  if (!el || atStartPos.value < 0) return

  const before = el.value.substring(0, atStartPos.value)
  const after = el.value.substring(atStartPos.value + 1 + atQuery.value.length)
  inputText.value = `${before}@${node.name} ${after}`

  closeAtPopover()
  emit('mentionFile', node.absolutePath)

  // 聚焦并设置光标到插入文本之后
  nextTick(() => {
    el.focus()
    const cursorPos = atStartPos.value + 1 + node.name.length + 1
    el.setSelectionRange(cursorPos, cursorPos)
    adjustHeight()
  })
}

/** 处理按键 */
function handleKeyDown(e: KeyboardEvent) {
  // @ / 斜杠浮层可见时，拦截导航键交给 popover 处理
  if (showAtPopover.value || showSlashPopover.value) {
    if (['ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'Tab'].includes(e.key)) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
  }

  // Ctrl+Z 撤销功能
  if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
    e.preventDefault()
    undo()
    return
  }

  // Ctrl+Y 或 Ctrl+Shift+Z 重做功能
  if ((e.key === 'y' && (e.ctrlKey || e.metaKey)) ||
      (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey)) {
    e.preventDefault()
    redo()
    return
  }

  // 输入历史导航（仅在输入框无选区时，且非 Popover 状态）
  if (e.key === 'ArrowUp' && !e.shiftKey && (textareaRef.value?.selectionStart ?? 0) === 0) {
    e.preventDefault()
    historyUp()
    return
  }
  if (e.key === 'ArrowDown' && !e.shiftKey) {
    const el = textareaRef.value
    if (el && el.selectionStart === el.value.length) {
      e.preventDefault()
      historyDown()
      return
    }
  }

  // 发送逻辑
  if (sendMode.value === 'enter') {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (canSend.value) handleSend()
    }
  } else {
    // cmd 模式：Cmd/Ctrl+Enter 发送，Enter 换行（默认）
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      if (canSend.value) handleSend()
    }
  }
}

/** 发送消息 */
function handleSend() {
  const content = inputText.value.trim()
  if (!content) return
  pushHistory(content)
  historyIndex.value = -1
  savedDraft.value = ''
  emit('send', content)
  inputText.value = ''
  nextTick(adjustHeight)
}

/** 中断生成 */
function handleAbort() {
  emit('abort')
}

/** 自动调整高度 */
function adjustHeight() {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 200)}px`
}

/** 拖拽进入 */
function handleDragOver(e: DragEvent) {
  e.preventDefault()
  isDragOver.value = true
}

/** 拖拽离开 */
function handleDragLeave() {
  isDragOver.value = false
}

/** 拖拽放入 */
function handleDrop(e: DragEvent) {
  e.preventDefault()
  isDragOver.value = false

  // 优先处理应用内文件树拖拽（携带绝对路径）
  const devforgeData = e.dataTransfer?.getData('application/x-devforge-file')
  if (devforgeData) {
    try {
      const { absolutePath } = JSON.parse(devforgeData)
      if (absolutePath) {
        emit('dropFilePath', absolutePath)
        return
      }
    } catch { /* ignore */ }
  }

  // 系统文件拖拽（DOM File 对象）
  const files = e.dataTransfer?.files
  if (files && files.length > 0) {
    emit('dropFiles', files)
  }
}

/** 粘贴处理 */
function handlePaste(e: ClipboardEvent) {
  const files = e.clipboardData?.files
  if (files && files.length > 0) {
    // 阻止默认粘贴行为，通过文件处理管道处理
    e.preventDefault()
    emit('dropFiles', files)
  }
  // 如果没有文件，允许正常的文本粘贴
}

/** 选择具体模型（可能需要同时切换 Provider） */
function selectModel(providerId: string, modelId: string) {
  if (props.selectedProviderId !== providerId) {
    emit('update:selectedProviderId', providerId)
  }
  emit('update:selectedModelId', modelId)
}

/** 聚焦输入框 */
function focus() {
  textareaRef.value?.focus()
}

function setDraft(value: string, options?: { append?: boolean; focus?: boolean }) {
  const nextValue = options?.append && inputText.value.trim()
    ? `${inputText.value.replace(/\s+$/, '')}\n\n${value}`
    : value
  inputText.value = nextValue
  pushToUndoStack(nextValue)
  nextTick(() => {
    adjustHeight()
    if (options?.focus !== false) {
      textareaRef.value?.focus()
    }
  })
}

defineExpose({ focus, setDraft })
</script>

<template>
  <div class="border-t border-border/40 bg-background">
    <!-- 输入框区域 -->
    <div class="px-4 py-3">
      <div
        class="relative overflow-hidden rounded-2xl border bg-muted/15 shadow-[0_16px_40px_-32px_rgba(0,0,0,0.45)] transition-colors focus-within:border-primary/40 focus-within:bg-background focus-within:ring-1 focus-within:ring-primary/20"
        :class="isDragOver ? 'border-primary/60 ring-2 ring-primary/30 bg-primary/5' : 'border-border/45'"
        @dragover="handleDragOver"
        @dragleave="handleDragLeave"
        @drop="handleDrop"
      >
        <!-- 拖拽提示蒙层 -->
        <div
          v-if="isDragOver"
          class="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-primary/5 pointer-events-none"
        >
          <span class="text-xs text-primary font-medium">{{ t('ai.input.dropFiles') }}</span>
        </div>

        <!-- 文件预览条 -->
        <AiFilePreviewBar
          :attachments="attachments"
          @remove="emit('removeAttachment', $event)"
        />
        <!-- 文本输入 -->
          <textarea
          ref="textareaRef"
          v-model="inputText"
          :placeholder="inputPlaceholder"
          :disabled="disabled"
          rows="1"
          class="w-full resize-none bg-transparent px-4 pt-3 pb-1 text-sm leading-relaxed placeholder:text-muted-foreground/56 focus:outline-none disabled:opacity-50"
          style="max-height: 200px"
          @keydown="handleKeyDown"
          @input="adjustHeight(); detectAtMention(); detectSlashCommand(); pushToUndoStack(inputText)"
          @paste="handlePaste"
        />

        <!-- 状态与操作带 -->
        <div class="flex flex-wrap items-center justify-between gap-2 px-3 pb-3 pt-1">
          <div class="flex min-w-0 flex-wrap items-center gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <button
                  class="flex h-7 min-w-0 items-center gap-1.5 rounded-full border border-border/25 bg-background/60 px-2.5 text-[11px] text-muted-foreground transition-colors hover:border-border/45 hover:bg-muted/25 hover:text-foreground"
                  :disabled="disabled"
                  :title="currentModel?.name || t('ai.input.selectModel')"
                >
                  <AtSign class="h-3 w-3 shrink-0" />
                  <span v-if="currentModel" class="max-w-[120px] truncate">{{ currentModel.name }}</span>
                  <span v-else>{{ t('ai.input.selectModel') }}</span>
                  <ChevronDown class="h-3 w-3 shrink-0 opacity-50" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" class="w-[240px]">
                <template v-for="provider in providers" :key="provider.id">
                  <DropdownMenuLabel class="text-[10px] text-muted-foreground uppercase tracking-wider">
                    {{ provider.name }}
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    v-for="model in provider.models"
                    :key="model.id"
                    class="flex items-center justify-between"
                    :class="{ 'bg-accent': selectedModelId === model.id && selectedProviderId === provider.id }"
                    @click="selectModel(provider.id, model.id)"
                  >
                    <div class="flex items-center gap-2">
                      <span class="text-xs">{{ model.name }}</span>
                      <div class="flex gap-0.5">
                        <span v-if="model.capabilities.thinking" class="text-[8px] px-1 rounded bg-violet-500/10 text-violet-500">{{ t('ai.input.capabilityThinking') }}</span>
                        <span v-if="model.capabilities.vision" class="text-[8px] px-1 rounded bg-blue-500/10 text-blue-500">{{ t('ai.input.capabilityVision') }}</span>
                      </div>
                    </div>
                    <span v-if="selectedModelId === model.id && selectedProviderId === provider.id" class="text-[10px] text-primary">✓</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </template>
                <DropdownMenuItem class="text-xs text-muted-foreground" @click="emit('openConfig')">
                  <Settings class="h-3 w-3 mr-2" />
                  {{ t('ai.messages.providerSettings') }}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <button
                  class="flex h-7 items-center gap-1.5 rounded-full border border-border/25 bg-background/60 px-2.5 text-[11px] transition-colors hover:border-border/45 hover:bg-muted/25"
                  :class="currentModeConfig.color"
                  :title="currentModeConfig.label"
                >
                  <component :is="currentModeConfig.icon" class="h-3 w-3 shrink-0" />
                  <span>{{ currentModeConfig.shortLabel }}</span>
                  <ChevronDown class="h-3 w-3 shrink-0 opacity-50" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" class="w-[200px]">
                <DropdownMenuItem
                  v-for="(config, key) in CHAT_MODES"
                  :key="key"
                  class="flex items-start gap-2.5 py-2"
                  :class="{ 'bg-accent': chatMode === key }"
                  @click="emit('update:chatMode', key as ChatMode)"
                >
                  <div :class="[config.bg, 'rounded p-1 mt-0.5']">
                    <component :is="config.icon" class="h-3 w-3" :class="config.color" />
                  </div>
                  <div>
                    <p class="text-xs font-medium">{{ config.label }}</p>
                    <p class="text-[10px] text-muted-foreground leading-tight">{{ config.desc }}</p>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div class="ml-auto flex items-center gap-1.5">
            <button
              class="flex h-7 items-center gap-1.5 rounded-full border border-border/25 bg-background/60 px-2.5 text-[11px] text-muted-foreground transition-colors hover:border-border/45 hover:bg-muted/25 hover:text-foreground"
              :disabled="disabled"
              :title="t('ai.input.addFile')"
              @click="emit('selectFiles')"
            >
              <Paperclip class="h-3.5 w-3.5" />
              <span>附件</span>
              <span v-if="attachments.length > 0" class="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                {{ attachments.length }}
              </span>
            </button>

            <div
              v-if="contextUsagePercent > 0"
              class="flex h-7 items-center gap-1.5 rounded-full border border-border/25 bg-background/60 px-2.5 text-[11px] text-muted-foreground/70"
              :title="t('ai.input.contextUsage', { percent: Math.round(contextUsagePercent) })"
            >
              <span
                class="h-1.5 w-1.5 rounded-full"
                :class="contextUsagePercent >= 90 ? 'bg-red-500' : contextUsagePercent >= 70 ? 'bg-amber-500' : 'bg-emerald-500'"
              />
              <span>{{ t('ai.input.contextUsageCompact', { percent: Math.round(contextUsagePercent) }) }}</span>
            </div>

            <button
              class="hidden h-7 items-center gap-1.5 rounded-full px-2.5 text-[11px] transition-colors sm:flex"
              :class="inputText.trim() ? 'text-violet-500/80 hover:bg-violet-500/10 hover:text-violet-500' : 'text-muted-foreground/25 cursor-not-allowed'"
              :disabled="!inputText.trim() || disabled"
              :title="t('ai.input.enhancePrompt')"
              @click="openEnhancer"
            >
              <Sparkles class="h-3.5 w-3.5" />
              <span>{{ t('ai.input.enhancePromptShort') }}</span>
            </button>

            <button
              class="hidden h-7 items-center gap-1.5 rounded-full px-2 text-[10px] text-muted-foreground/45 transition-colors hover:bg-muted/25 hover:text-muted-foreground sm:flex"
              :title="t('ai.input.toggleSendMode', {
                mode: sendMode === 'enter' ? t('ai.input.sendModeEnter') : t('ai.input.sendModeCmd'),
              })"
              @click="toggleSendMode"
            >
              {{ sendMode === 'enter' ? t('ai.input.sendModeEnterShort') : t('ai.input.sendModeCmdShort') }}
            </button>

            <Button
              v-if="isStreaming"
              variant="destructive"
              size="sm"
              class="h-8 rounded-full px-3 text-xs"
              @click="handleAbort"
            >
              <Square class="mr-1.5 h-3 w-3" />
              {{ t('ai.input.stopGenerating') }}
            </Button>
            <button
              v-else
              :disabled="!canSend"
              class="flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors"
              :class="canSend
                ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
                : 'text-muted-foreground/25 cursor-not-allowed'"
              @click="handleSend"
            >
              <Loader2 v-if="loading" class="h-3 w-3 animate-spin" />
              <Send v-else class="h-3 w-3" />
              <span>{{ t('common.send') }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <AtMentionPopover
      :query="atQuery"
      :anchor-pos="atAnchorPos"
      :visible="showAtPopover"
      @select="handleAtSelect"
      @close="closeAtPopover"
    />

    <SlashCommandPopover
      :query="slashQuery"
      :anchor-pos="slashAnchorPos"
      :visible="showSlashPopover"
      @select="handleSlashSelect"
      @close="closeSlashPopover"
    />

    <p class="sr-only">{{ sendHint }} · {{ t('ai.input.replyDisclaimer') }}</p>

    <AiPromptEnhancer
      v-model:open="showEnhancer"
      :original-text="inputText"
      :provider="currentProvider"
      :model="currentModel"
      @accept="handleEnhancerAccept"
    />
  </div>
</template>
