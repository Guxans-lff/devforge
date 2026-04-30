<script setup lang="ts">
/**
 * AI 输入区组件（VSCode Copilot Chat 风格）
 *
 * 底部集成：文本输入 + 模型选择 + 模式切换 + 配置入口。
 * 支持 Shift+Enter 换行、Enter 发送、自动增高。
 */
import { ref, computed, nextTick, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { aiCreateCompletion } from '@/api/ai'
import { getCredential } from '@/api/connection'
import type { ProviderConfig, FileAttachment } from '@/types/ai'
import type { FileNode } from '@/types/workspace-files'
import AtMentionPopover from './AtMentionPopover.vue'
import SlashCommandPopover, { type SlashCommand } from './SlashCommandPopover.vue'
import AiPromptEnhancer from './AiPromptEnhancer.vue'
import { resolveInputIntent } from '@/composables/ai/aiInputResolver'
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
  Paperclip,
  Braces,
  Wand2,
} from 'lucide-vue-next'
import AiFilePreviewBar from './AiFilePreviewBar.vue'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'

export type ChatMode = 'normal' | 'plan' | 'auto' | 'dispatcher'
export interface AiInputAdvancedOptions {
  jsonMode: boolean
  prefixCompletion: boolean
  prefixContent?: string
}

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
  send: [content: string, options: AiInputAdvancedOptions]
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
const atMentionPopoverRef = ref<InstanceType<typeof AtMentionPopover> | null>(null)
const slashCommandPopoverRef = ref<InstanceType<typeof SlashCommandPopover> | null>(null)
const isDragOver = ref(false)

// 输入历史
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

// 发送快捷键配置
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
const fimLoading = ref(false)
const fimError = ref<string | null>(null)
const advancedOptions = ref<AiInputAdvancedOptions>({
  jsonMode: false,
  prefixCompletion: false,
  prefixContent: '',
})
const JSON_MODE_HINT = 'Return valid JSON only. Do not include markdown fences or any text outside JSON.'

const canSend = computed(() => inputText.value.trim().length > 0 && !props.disabled && !props.isStreaming)

// 提示词优化
const showEnhancer = ref(false)
function openEnhancer() {
  if (!inputText.value.trim()) return
  showEnhancer.value = true
}
function handleEnhancerAccept(text: string) {
  inputText.value = text
  nextTick(adjustHeight)
}

function splitFimPrompt(text: string): { prompt: string; suffix: string } | null {
  const marker = '<fim>'
  const index = text.indexOf(marker)
  if (index < 0) return null
  return {
    prompt: text.slice(0, index),
    suffix: text.slice(index + marker.length),
  }
}

function buildAdvancedMessage(content: string): string {
  const hints: string[] = []
  if (advancedOptions.value.jsonMode && !/\bjson\b/i.test(content)) {
    hints.push(JSON_MODE_HINT)
  }
  if (advancedOptions.value.prefixCompletion && !advancedOptions.value.prefixContent?.trim()) {
    hints.push('Continue from the assistant prefix.')
  }
  if (hints.length === 0) return content
  return `${content.trim()}\n\n${hints.join('\n')}`
}

async function runFimCompletion(): Promise<void> {
  if (!currentProvider.value || !currentModel.value) return
  const parts = splitFimPrompt(inputText.value)
  if (!parts) {
    fimError.value = 'Insert <fim> at the cursor position as the completion placeholder.'
    return
  }
  if (!parts.prompt.trim()) {
    fimError.value = 'FIM prefix cannot be empty.'
    return
  }

  fimLoading.value = true
  fimError.value = null
  try {
    const apiKey = await getCredential(`ai-provider-${currentProvider.value.id}`) ?? ''
    if (!apiKey) {
      fimError.value = 'Current Provider has no API Key configured.'
      return
    }
    const result = await aiCreateCompletion({
      providerType: currentProvider.value.providerType,
      model: currentModel.value.id,
      apiKey,
      endpoint: currentProvider.value.endpoint,
      prompt: parts.prompt,
      suffix: parts.suffix,
      maxTokens: Math.min(currentModel.value.capabilities.maxOutput || 1024, 2048),
      temperature: 0.2,
      useBeta: true,
    })
    inputText.value = `${parts.prompt}${result.content}${parts.suffix}`
    nextTick(adjustHeight)
  } catch (error) {
    fimError.value = error instanceof Error ? error.message : String(error)
  } finally {
    fimLoading.value = false
  }
}

/** 当前 Provider */
const currentProvider = computed(() =>
  props.providers.find(p => p.id === props.selectedProviderId) ?? null,
)

/** 当前模型 */
const currentModel = computed(() =>
  currentProvider.value?.models.find(m => m.id === props.selectedModelId) ?? null,
)

const supportsDeepSeekAdvanced = computed(() => {
  const provider = currentProvider.value
  if (!provider) return false
  return provider.endpoint.includes('api.deepseek.com')
    || provider.name.toLowerCase().includes('deepseek')
})

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
 * 使用 mirror div 计算 textarea 中指定位置的光标坐标。
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
 * 检测光标前是否存在未闭合的 @ 引用。
 * 从光标位置向前搜索，遇到空格或换行停止。
 */
function detectAtMention() {
  const el = textareaRef.value
  if (!el) return

  const text = el.value
  const pos = el.selectionStart ?? 0

  // 从光标向前查找 @
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

/** 检测斜杠命令：仅当文本以 "/" 开头时触发，浮层锚定到输入框上方。 */
function detectSlashCommand() {
  const el = textareaRef.value
  if (!el) return
  const text = el.value
  if (text.startsWith('/') && !text.includes(' ') && !text.includes('\n')) {
    slashQuery.value = text.slice(1)
    const rect = el.getBoundingClientRect()
    // 宽度 320，定位在输入框左侧与顶部对齐。
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

/** 选中斜杠命令：用模板替换输入，clear/compact 走专用事件。 */
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
 * 选中文件后替换 @query 为 @filename 并 emit mentionFile。
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

/** 处理按键，使用 Intent Resolver 统一分发。 */
function handleKeyDown(e: KeyboardEvent) {
  // 浮层可见时，导航键继续交给浮层处理。
  if (showAtPopover.value || showSlashPopover.value) {
    if (['ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'Tab'].includes(e.key)) {
      e.preventDefault()
      e.stopPropagation()
      if (showAtPopover.value) {
        atMentionPopoverRef.value?.onKeydown(e)
      } else if (showSlashPopover.value) {
        slashCommandPopoverRef.value?.onKeydown(e)
      }
      return
    }
  }

  const el = textareaRef.value
  const intent = resolveInputIntent(e, {
    isComposing: e.isComposing,
    slashPopoverOpen: showSlashPopover.value,
    atPopoverOpen: showAtPopover.value,
    popoverHasHighlight: showSlashPopover.value || showAtPopover.value,
    sendMode: sendMode.value,
    cursorAtStart: (el?.selectionStart ?? 0) === 0,
    cursorAtEnd: el ? el.selectionStart === el.value.length : false,
  })

  switch (intent.type) {
    case 'noop':
      return
    case 'undo':
      e.preventDefault()
      undo()
      return
    case 'redo':
      e.preventDefault()
      redo()
      return
    case 'close_popover':
      e.preventDefault()
      closeAtPopover()
      closeSlashPopover()
      return
    case 'history_up':
      e.preventDefault()
      historyUp()
      return
    case 'history_down':
      e.preventDefault()
      historyDown()
      return
    case 'insert_newline':
      // 允许默认换行行为
      return
    case 'submit_message':
      e.preventDefault()
      if (canSend.value) submitMessage(inputText.value.trim())
      return
  }
}

/** 统一消息提交入口 */
function submitMessage(content: string) {
  if (!content) return
  pushHistory(content)
  historyIndex.value = -1
  savedDraft.value = ''
  emit('send', buildAdvancedMessage(content), { ...advancedOptions.value })
  inputText.value = ''
  nextTick(adjustHeight)
}

/** 发送按钮点击，统一走 submitMessage。 */
function handleSend() {
  submitMessage(inputText.value.trim())
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
  // 如果没有文件，允许正常文本粘贴
}

/** 选择具体模型，可能需要同时切换 Provider。 */
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
  <div class="ai-composer-surface border-t border-white/[0.09] bg-[linear-gradient(180deg,rgba(8,8,10,0.35),#08080a)] backdrop-blur supports-[backdrop-filter]:bg-[#08080a]/86">
    <!-- 输入框区域 -->
    <div class="px-6 pb-4 pt-4 sm:px-10">
      <div
        class="ai-composer-card relative mx-auto grid max-w-[1180px] grid-rows-[1fr_auto] overflow-hidden rounded-[18px] border shadow-[0_22px_58px_rgba(0,0,0,0.38),inset_0_1px_0_rgba(255,255,255,0.035)] transition-colors focus-within:border-white/[0.2]"
        :class="isDragOver ? 'border-primary/50 ring-1 ring-primary/20 bg-primary/[0.02]' : 'border-white/[0.13] bg-[linear-gradient(180deg,#121217,#0e0e12)]'"
        @dragover="handleDragOver"
        @dragleave="handleDragLeave"
        @drop="handleDrop"
      >
        <!-- 拖拽提示蒙层 -->
        <div
          v-if="isDragOver"
          class="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-primary/[0.02] pointer-events-none"
        >
          <span class="text-xs text-primary font-medium">{{ t('ai.input.dropFiles') }}</span>
        </div>

        <!-- 文件预览栏 -->
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
          rows="2"
          class="ai-composer-textarea w-full resize-none bg-transparent px-[18px] pb-2 pt-[15px] text-[14px] leading-[1.55] text-foreground placeholder:text-muted-foreground/48 focus:outline-none disabled:opacity-50"
          style="max-height: 200px; min-height: 54px"
          @keydown="handleKeyDown"
          @input="adjustHeight(); detectAtMention(); detectSlashCommand(); pushToUndoStack(inputText)"
          @paste="handlePaste"
        />

        <!-- 状态与操作栏 -->
        <div class="flex flex-wrap items-center justify-between gap-2 px-3 pb-2.5 pt-0.5 text-muted-foreground">
          <div class="flex min-w-0 flex-wrap items-center gap-1">
            <!-- 模型选择 -->
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <button
                  class="composer-chip flex h-7 min-w-0 items-center gap-1 px-2.5"
                  :disabled="disabled"
                  :title="currentModel?.name || t('ai.input.selectModel')"
                >
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

            <!-- 模式选择 -->
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <button
                  class="composer-chip flex h-7 items-center gap-1 px-2.5"
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

            <!-- 附件 -->
            <button
              class="composer-chip flex h-7 items-center gap-1 px-2.5"
              :disabled="disabled"
              :title="t('ai.input.addFile')"
              @click="emit('selectFiles')"
            >
              <Paperclip class="h-3 w-3" />
              <span v-if="attachments.length > 0" class="rounded-full bg-primary/10 px-1 text-[10px] text-primary">
                {{ attachments.length }}
              </span>
            </button>

            <!-- DeepSeek 高级选项 -->
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <button
                  class="composer-chip flex h-7 items-center gap-1 px-2.5"
                  :class="advancedOptions.jsonMode || advancedOptions.prefixCompletion ? 'text-emerald-500' : 'text-muted-foreground/70'"
                  :disabled="disabled || !supportsDeepSeekAdvanced"
                  title="DeepSeek 高级模式"
                >
                  <Braces class="h-3 w-3" />
                  <span>DS</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" class="w-[230px]">
                <DropdownMenuLabel class="text-[10px] text-muted-foreground uppercase tracking-wider">
                  DeepSeek 高级模式
                </DropdownMenuLabel>
                <DropdownMenuCheckboxItem
                  :checked="advancedOptions.jsonMode"
                  @update:checked="advancedOptions.jsonMode = Boolean($event)"
                >
                  JSON Mode
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  :checked="advancedOptions.prefixCompletion"
                  @update:checked="advancedOptions.prefixCompletion = Boolean($event)"
                >
                  Prefix Completion
                </DropdownMenuCheckboxItem>
                <div class="px-2 py-1.5">
                  <input
                    v-model="advancedOptions.prefixContent"
                    class="h-7 w-full rounded-md border border-border/60 bg-background px-2 text-[11px] outline-none focus:border-primary/50"
                    placeholder='assistant prefix example: answer:'
                    @keydown.stop
                  >
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  class="text-xs"
                  :disabled="fimLoading || !inputText.includes('<fim>')"
                  @click="runFimCompletion"
                >
                  <Wand2 class="mr-2 h-3 w-3" />
                  {{ fimLoading ? 'FIM 补全中...' : '执行 FIM 补全' }}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <span v-if="fimError" class="max-w-[180px] truncate text-[10px] text-destructive" :title="fimError">
              {{ fimError }}
            </span>

            <div
              v-if="contextUsagePercent > 0"
              class="composer-chip flex h-7 items-center gap-1 px-2.5 text-muted-foreground/70"
              :title="t('ai.input.contextUsage', { percent: Math.round(contextUsagePercent) })"
            >
              <span
                class="h-1.5 w-1.5 rounded-full"
                :class="contextUsagePercent >= 90 ? 'bg-red-500' : contextUsagePercent >= 70 ? 'bg-amber-500' : 'bg-emerald-500'"
              />
              <span>{{ t('ai.input.contextUsageCompact', { percent: Math.round(contextUsagePercent) }) }}</span>
            </div>
          </div>

          <div class="ml-auto flex items-center gap-1">
            <!-- Prompt 优化 -->
            <button
              class="hidden h-7 items-center gap-1 rounded-full border border-transparent px-2.5 text-[11px] transition-colors sm:flex"
              :class="inputText.trim() ? 'text-violet-500/80 hover:bg-violet-500/10 hover:text-violet-500' : 'text-muted-foreground/25 cursor-not-allowed'"
              :disabled="!inputText.trim() || disabled"
              :title="t('ai.input.enhancePrompt')"
              @click="openEnhancer"
            >
              <Sparkles class="h-3 w-3" />
              <span>{{ t('ai.input.enhancePromptShort') }}</span>
            </button>

            <!-- 发送模式切换 -->
            <button
              class="hidden h-7 items-center gap-1 rounded-full border border-transparent px-2 text-[10px] text-muted-foreground/45 transition-colors hover:border-white/[0.08] hover:bg-white/[0.035] hover:text-muted-foreground sm:flex"
              :title="t('ai.input.toggleSendMode', {
                mode: sendMode === 'enter' ? t('ai.input.sendModeEnter') : t('ai.input.sendModeCmd'),
              })"
              @click="toggleSendMode"
            >
              {{ sendMode === 'enter' ? t('ai.input.sendModeEnterShort') : t('ai.input.sendModeCmdShort') }}
            </button>

            <!-- 停止 / 发送按钮 -->
            <Button
              v-if="isStreaming"
              variant="destructive"
              size="sm"
              class="h-8 rounded-lg px-3 text-xs"
              @click="handleAbort"
            >
              <Square class="mr-1 h-3 w-3" />
              {{ t('ai.input.stopGenerating') }}
            </Button>
            <button
              v-else
              :disabled="!canSend"
              class="flex h-8 items-center gap-1 rounded-lg px-3 text-xs font-medium transition-colors"
              :class="canSend
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
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
      ref="atMentionPopoverRef"
      :query="atQuery"
      :anchor-pos="atAnchorPos"
      :visible="showAtPopover"
      @select="handleAtSelect"
      @close="closeAtPopover"
    />

    <SlashCommandPopover
      ref="slashCommandPopoverRef"
      :query="slashQuery"
      :anchor-pos="slashAnchorPos"
      :visible="showSlashPopover"
      @select="handleSlashSelect"
      @close="closeSlashPopover"
    />

    <p class="sr-only">{{ sendHint }} 路 {{ t('ai.input.replyDisclaimer') }}</p>

    <AiPromptEnhancer
      v-if="showEnhancer"
      v-model:open="showEnhancer"
      :original-text="inputText"
      :provider="currentProvider"
      :model="currentModel"
      @accept="handleEnhancerAccept"
    />
  </div>
</template>

<style scoped>
.ai-composer-surface {
  position: relative;
}

.ai-composer-surface::before {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(circle at 50% 0%, rgb(255 255 255 / 0.06), transparent 36%),
    linear-gradient(90deg, transparent, rgb(16 185 129 / 0.04), transparent);
  content: '';
}

.ai-composer-card {
  isolation: isolate;
}

.ai-composer-card::before {
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background:
    radial-gradient(circle at 12% 0%, rgb(96 165 250 / 0.12), transparent 34%),
    linear-gradient(180deg, rgb(255 255 255 / 0.035), transparent 44%);
  content: '';
}

.ai-composer-card:focus-within {
  box-shadow:
    0 26px 70px rgb(0 0 0 / 0.44),
    0 0 0 1px rgb(255 255 255 / 0.035),
    0 0 34px rgb(16 185 129 / 0.075),
    inset 0 1px 0 rgb(255 255 255 / 0.055);
}

.ai-composer-textarea {
  caret-color: rgb(110 231 183);
}

.composer-chip {
  border: 1px solid rgb(244 244 245 / 0.08);
  border-radius: 999px;
  background: rgb(8 8 10 / 0.72);
  color: rgb(143 143 153 / 0.94);
  font-size: 12px;
  white-space: nowrap;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.025);
  transition:
    border-color 160ms ease,
    background-color 160ms ease,
    color 160ms ease;
}

.composer-chip:hover {
  border-color: rgb(244 244 245 / 0.14);
  background: rgb(21 21 27 / 0.9);
  color: rgb(244 244 245 / 0.86);
}
</style>
