<script setup lang="ts">
/**
 * AI 输入区组件（VSCode Copilot Chat 风格）
 *
 * 底部集成：文本输入 + 模型选择 + 模式切换 + 配置入口。
 * 支持 Shift+Enter 换行、Enter 发送、自动增高。
 */
import { ref, computed, nextTick } from 'vue'
import type { ProviderConfig, ModelConfig, FileAttachment } from '@/types/ai'
import {
  Send,
  Square,
  Loader2,
  ChevronDown,
  Settings,
  Sparkles,
  Zap,
  MessageSquareText,
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

export type ChatMode = 'normal' | 'plan' | 'auto'

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
}>(), {
  isStreaming: false,
  disabled: false,
  loading: false,
  placeholder: '发送消息…',
  providers: () => [],
  selectedProviderId: null,
  selectedModelId: null,
  chatMode: 'normal',
  attachments: () => [],
})

const emit = defineEmits<{
  send: [content: string]
  abort: []
  'update:selectedProviderId': [id: string]
  'update:selectedModelId': [id: string]
  'update:chatMode': [mode: ChatMode]
  openConfig: []
  selectFiles: []
  dropFiles: [paths: string[]]
  removeAttachment: [id: string]
}>()

const inputText = ref('')
const textareaRef = ref<HTMLTextAreaElement | null>()
const isDragOver = ref(false)

const canSend = computed(() => inputText.value.trim().length > 0 && !props.disabled && !props.isStreaming)

/** 当前 Provider */
const currentProvider = computed(() =>
  props.providers.find(p => p.id === props.selectedProviderId) ?? null,
)

/** 当前模型 */
const currentModel = computed(() =>
  currentProvider.value?.models.find(m => m.id === props.selectedModelId) ?? null,
)

/** 模式配置 */
const CHAT_MODES = {
  normal: {
    label: '普通对话',
    shortLabel: '普通',
    desc: '标准问答交互',
    icon: MessageSquareText,
    color: 'text-blue-500',
    bg: 'bg-blue-500/10',
  },
  plan: {
    label: '规划模式',
    shortLabel: '规划',
    desc: 'AI 先分析规划，确认后执行',
    icon: Sparkles,
    color: 'text-violet-500',
    bg: 'bg-violet-500/10',
  },
  auto: {
    label: '全自动',
    shortLabel: '自动',
    desc: 'AI 自主分析、决策、执行',
    icon: Zap,
    color: 'text-amber-500',
    bg: 'bg-amber-500/10',
  },
} as const

const currentModeConfig = computed(() => CHAT_MODES[props.chatMode])

/** 处理按键 */
function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    if (canSend.value) {
      handleSend()
    }
  }
}

/** 发送消息 */
function handleSend() {
  const content = inputText.value.trim()
  if (!content) return
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
  // Tauri 拖拽事件中文件路径在 dataTransfer.files 或自定义字段
  const files = e.dataTransfer?.files
  if (files && files.length > 0) {
    const paths: string[] = []
    for (let i = 0; i < files.length; i++) {
      // Tauri webview 中 File 对象的 path 属性包含绝对路径
      const file = files[i]!
      const path = (file as unknown as { path?: string }).path ?? file.name
      paths.push(path)
    }
    emit('dropFiles', paths)
  }
}

/** 切换 Provider 时自动选中第一个模型 */
function selectProvider(providerId: string) {
  emit('update:selectedProviderId', providerId)
  const provider = props.providers.find(p => p.id === providerId)
  if (provider) {
    const firstModel = provider.models[0]
    if (firstModel) {
      emit('update:selectedModelId', firstModel.id)
    }
  }
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

defineExpose({ focus })
</script>

<template>
  <div class="border-t border-border/50 bg-background">
    <!-- 输入框区域 -->
    <div class="px-4 pt-3 pb-2">
      <div
        class="relative rounded-xl border bg-muted/20 transition-colors focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/20"
        :class="isDragOver ? 'border-primary/60 ring-2 ring-primary/30 bg-primary/5' : 'border-border/50'"
        @dragover="handleDragOver"
        @dragleave="handleDragLeave"
        @drop="handleDrop"
      >
        <!-- 拖拽提示蒙层 -->
        <div
          v-if="isDragOver"
          class="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-primary/5 pointer-events-none"
        >
          <span class="text-xs text-primary font-medium">松开以添加文件</span>
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
          :placeholder="placeholder"
          :disabled="disabled"
          rows="1"
          class="w-full resize-none bg-transparent px-4 pt-3 pb-2 text-sm leading-relaxed placeholder:text-muted-foreground/60 focus:outline-none disabled:opacity-50"
          style="max-height: 200px"
          @keydown="handleKeyDown"
          @input="adjustHeight"
        />

        <!-- 底部工具栏 -->
        <div class="flex items-center justify-between px-3 pb-2">
          <div class="flex items-center gap-1">
            <!-- 模型选择器 -->
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <button
                  class="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
                  :disabled="disabled"
                >
                  <AtSign class="h-3 w-3" />
                  <span v-if="currentModel" class="max-w-[120px] truncate">{{ currentModel.name }}</span>
                  <span v-else>选择模型</span>
                  <ChevronDown class="h-3 w-3 opacity-50" />
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
                        <span v-if="model.capabilities.thinking" class="text-[8px] px-1 rounded bg-violet-500/10 text-violet-500">思考</span>
                        <span v-if="model.capabilities.vision" class="text-[8px] px-1 rounded bg-blue-500/10 text-blue-500">视觉</span>
                      </div>
                    </div>
                    <span v-if="selectedModelId === model.id && selectedProviderId === provider.id" class="text-[10px] text-primary">
                      ✓
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </template>
                <DropdownMenuItem class="text-xs text-muted-foreground" @click="emit('openConfig')">
                  <Settings class="h-3 w-3 mr-2" />
                  管理服务商…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <!-- 模式切换 -->
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <button
                  class="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors hover:bg-muted/50"
                  :class="currentModeConfig.color"
                >
                  <component :is="currentModeConfig.icon" class="h-3 w-3" />
                  <span>{{ currentModeConfig.shortLabel }}</span>
                  <ChevronDown class="h-3 w-3 opacity-50" />
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

          <!-- 发送/中断按钮 -->
          <div class="flex items-center gap-1">
            <!-- 回形针按钮 -->
            <button
              class="flex items-center justify-center h-7 w-7 rounded-lg text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 transition-colors"
              :disabled="disabled"
              title="添加文件"
              @click="emit('selectFiles')"
            >
              <Paperclip class="h-3.5 w-3.5" />
            </button>

            <Button
              v-if="isStreaming"
              variant="destructive"
              size="icon"
              class="h-7 w-7 rounded-lg"
              @click="handleAbort"
            >
              <Square class="h-3 w-3" />
            </Button>
            <Button
              v-else
              :disabled="!canSend"
              size="icon"
              class="h-7 w-7 rounded-lg"
              @click="handleSend"
            >
              <Loader2 v-if="loading" class="h-3 w-3 animate-spin" />
              <Send v-else class="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部提示 -->
    <div class="flex items-center justify-center px-4 pb-2">
      <p class="text-[10px] text-muted-foreground/40">
        Shift+Enter 换行 · Enter 发送 · AI 回复仅供参考
      </p>
    </div>
  </div>
</template>
