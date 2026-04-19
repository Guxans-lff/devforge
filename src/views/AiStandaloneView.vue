<script setup lang="ts">
/**
 * 独立 AI 对话窗口视图
 *
 * 通过 Tauri WebviewWindow 独立运行，每个窗口有独立的 Vue app 实例。
 * 从 URL query 解析 windowId，生成独立 sessionId。
 * 窗口关闭前自动保存会话。
 */
import { ref, computed, onMounted, watch, onBeforeUnmount, shallowRef } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useRoute } from 'vue-router'
import { useAiChatStore } from '@/stores/ai-chat'
import { useAiChat } from '@/composables/useAiChat'
import { useAiMemoryStore } from '@/stores/ai-memory'
import { useFileAttachment, stripMentionMarkers } from '@/composables/useFileAttachment'
import { checkTokenLimit } from '@/utils/file-markers'
import { buildToolGuide } from '@/utils/ai-prompts'
import { setApprovalMode, setActiveSessionId } from '@/composables/useToolApproval'
import { useWorkspaceFilesStore } from '@/stores/workspace-files'
import { getCredential } from '@/api/connection'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import type { ProviderConfig, ModelConfig, AiSession } from '@/types/ai'
import type { ChatMode } from '@/components/ai/AiInputArea.vue'
import AiMessageBubble from '@/components/ai/AiMessageBubble.vue'
import AiInputArea from '@/components/ai/AiInputArea.vue'
import AiUsageBadge from '@/components/ai/AiUsageBadge.vue'
import AiProviderConfig from '@/components/ai/AiProviderConfig.vue'
import AiSessionDrawer from '@/components/ai/AiSessionDrawer.vue'
import AiMemoryDrawer from '@/components/ai/AiMemoryDrawer.vue'
import AiCompactBanner from '@/components/ai/AiCompactBanner.vue'
import WorkspaceFilePicker from '@/components/ai/WorkspaceFilePicker.vue'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import {
  Bot,
  Settings,
  History,
  Plus,
  Sparkles,
  Zap,
  MessageSquareText,
  FolderOpen,
  Brain,
  Check,
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const route = useRoute()
const store = useAiChatStore()
const fileAttachment = useFileAttachment()
const memoryStore = useAiMemoryStore()

// ─────────────────────── 窗口标识 ───────────────────────

/** 从 URL query 解析 windowId */
const windowId = computed(() => (route.query.windowId as string) || `ai-${Date.now()}`)

/** 独立 sessionId（默认 session-{windowId}；切换历史会话后可覆盖） */
const currentSessionId = ref<string>(`session-${windowId.value}`)
/** 标记用户已手动选择历史会话 — windowId 变化时不再覆盖 */
const userPickedSession = ref(false)
watch(windowId, (wid) => {
  if (userPickedSession.value) return
  currentSessionId.value = `session-${wid}`
})

// ─────────────────────── 视图状态 ───────────────────────

const currentView = ref<'chat' | 'provider-config'>('chat')
const showSessionDrawer = ref(false)
const showMemoryDrawer = ref(false)
const showFilePicker = ref(false)
const selectedProviderId = ref<string | null>(null)
const selectedModelId = ref<string | null>(null)
const systemPrompt = ref<string | undefined>(undefined)
const chatMode = ref<ChatMode>('normal')

// chatMode → 审批模式（auto=放行 / plan=拒绝副作用 / normal=弹窗）
watch(chatMode, (m) => {
  setApprovalMode(m === 'auto' ? 'auto' : m === 'plan' ? 'deny' : 'ask', currentSessionId.value)
}, { immediate: true })

const MODE_SUFFIXES: Record<ChatMode, string> = {
  normal: '',
  plan: '\n\n【模式：规划模式】\n你现在处于规划模式。对于用户的任何请求：\n1. 先详细分析需求，列出关键点\n2. 提出实施方案（如有多个方案则对比优劣）\n3. 列出具体步骤计划\n4. 等待用户确认后才给出最终的代码或执行方案\n不要直接给出代码，先让用户审核你的计划。',
  auto: '\n\n【模式：全自动模式】\n你现在处于全自动模式。对于用户的请求：\n1. 直接完整地分析问题并给出最终解决方案\n2. 包括完整的代码实现、配置、命令等\n3. 主动考虑边界情况、错误处理、性能优化\n4. 给出可直接使用的结果，无需用户二次确认\n以最高效率给出完整、可执行的解决方案。',
}

// ─────────────────────── 对话核心 ───────────────────────

const scrollContainer = ref<HTMLElement | null>(null)
const wsFiles = useWorkspaceFilesStore()

const chat = useAiChat({
  sessionId: currentSessionId,
  scrollContainer,
})

// ─────────────────────── 虚拟滚动（G1） ───────────────────────

const virtualizer = useVirtualizer(computed(() => ({
  count: chat.messages.value.length,
  getScrollElement: () => scrollContainer.value,
  estimateSize: () => 120,
  overscan: 4,
  measureElement: (el: Element) => el.getBoundingClientRect().height,
})))

const virtualItems = computed(() => virtualizer.value.getVirtualItems())
const totalSize = computed(() => virtualizer.value.getTotalSize())

const virtualItemEls = shallowRef<HTMLElement[]>([])

const currentProvider = computed<ProviderConfig | null>(() =>
  store.providers.find(p => p.id === selectedProviderId.value) ?? null,
)

const currentModel = computed<ModelConfig | null>(() =>
  currentProvider.value?.models.find(m => m.id === selectedModelId.value) ?? null,
)

// ─────────────────────── 窗口关闭拦截 ───────────────────────

let unlistenClose: (() => void) | null = null

onMounted(async () => {
  if (currentSessionId.value) setActiveSessionId(currentSessionId.value)

  try {
    await store.init()
  } catch (e) {
    chat.error.value = '初始化失败，请刷新重试'
    console.error('[AiStandalone] 初始化失败:', e)
    return
  }

  // 自动选中默认 Provider
  const dp = store.defaultProvider
  if (dp) {
    selectedProviderId.value = dp.id
    const firstModel = dp.models[0]
    if (firstModel) selectedModelId.value = firstModel.id
  }

  if (store.providers.length === 0) {
    currentView.value = 'provider-config'
    return
  }

  if (currentSessionId.value) {
    await chat.loadHistory()
  }

  if (chat.workDir.value) {
    memoryStore.setWorkspace(chat.workDir.value)
  }

  // 拦截窗口关闭 → 先保存会话
  const appWindow = getCurrentWebviewWindow()
  unlistenClose = await appWindow.onCloseRequested(async () => {
    await saveCurrentSession()
    // 不阻止关闭
  })
})

onBeforeUnmount(() => {
  unlistenClose?.()
})

// Provider 列表变化时自动选中
watch(() => store.providers, (providers) => {
  if (providers.length > 0 && !selectedProviderId.value) {
    const dp = store.defaultProvider
    if (dp) {
      selectedProviderId.value = dp.id
      const firstModel = dp.models[0]
      if (firstModel) selectedModelId.value = firstModel.id
    }
  }
}, { deep: true })

// 工作目录变化时更新窗口标题
watch(() => chat.workDir.value, async (dir) => {
  const appWindow = getCurrentWebviewWindow()
  if (dir) {
    const parts = dir.replace(/\\/g, '/').split('/').filter(Boolean)
    const name = parts[parts.length - 1] || 'AI'
    await appWindow.setTitle(`AI - ${name}`)
  } else {
    await appWindow.setTitle('AI 对话')
  }
})

// ─────────────────────── 操作 ───────────────────────

const effectiveSystemPrompt = computed(() => {
  const base = systemPrompt.value ?? ''
  const suffix = MODE_SUFFIXES[chatMode.value]
  const enableTools = currentModel.value?.capabilities.toolUse && !!chat.workDir.value
  const toolGuide = enableTools
    ? buildToolGuide({
        workDir: chat.workDir.value,
        chatMode: chatMode.value,
        modelId: currentModel.value?.id,
        ideContext: wsFiles.activeEditor,
      })
    : ''
  const result = base + (suffix || '') + toolGuide
  return result || undefined
})

/** 保存当前会话到 SQLite */
async function saveCurrentSession() {
  if (!currentProvider.value || !currentModel.value) return
  const msgCount = chat.messages.value.filter(m => m.role !== 'error').length
  if (msgCount === 0) return
  const session: AiSession = {
    id: currentSessionId.value,
    title: chat.messages.value.find(m => m.role === 'user')?.content?.slice(0, 30) || '新对话',
    providerId: currentProvider.value.id,
    model: currentModel.value.id,
    systemPrompt: systemPrompt.value,
    messageCount: msgCount,
    totalTokens: chat.totalTokens.value,
    estimatedCost: 0,
    createdAt: chat.messages.value[0]?.timestamp ?? Date.now(),
    updatedAt: Date.now(),
    workDir: chat.workDir.value || undefined,
  }
  await store.saveSession(session).catch(e => console.warn('[AI] 关闭保存失败:', e))
}

async function handleSend(content: string) {
  if (!currentProvider.value || !currentModel.value) return
  const cleanContent = stripMentionMarkers(content)
  const apiKey = await getCredential(`ai-provider-${currentProvider.value.id}`) ?? ''
  if (!apiKey) {
    chat.error.value = '未配置 API Key，请在服务商配置中设置'
    return
  }
  const attachments = fileAttachment.getReadyAttachments()
  if (currentModel.value.capabilities.maxContext > 0) {
    const totalText = cleanContent + attachments.map(f => f.content ?? '').join('')
    const check = checkTokenLimit(totalText, chat.totalTokens.value, currentModel.value.capabilities.maxContext)
    if (check.warn) {
      console.warn(`[AI] Token 接近上限: 预估 ${check.usage} / 上限 ${check.limit}`)
    }
  }
  await chat.send(cleanContent, currentProvider.value, currentModel.value, apiKey, effectiveSystemPrompt.value, attachments)
  fileAttachment.clearAttachments()
}

/** 继续生成 — 基于最后一条用户消息重新发起一轮流式 */
async function handleContinue() {
  if (!currentProvider.value || !currentModel.value) return
  const apiKey = await getCredential(`ai-provider-${currentProvider.value.id}`) ?? ''
  if (!apiKey) {
    chat.error.value = '未配置 API Key'
    return
  }
  await chat.regenerate(currentProvider.value, currentModel.value, apiKey, effectiveSystemPrompt.value)
}

/** 一键调大当前模型 maxOutput 并继续刚才未完成的任务 */
async function handleBumpMaxOutput(value: number) {
  if (!currentProvider.value || !currentModel.value) return
  const apiKey = await getCredential(`ai-provider-${currentProvider.value.id}`) ?? ''
  if (!apiKey) {
    chat.error.value = '未配置 API Key'
    return
  }
  const provider = currentProvider.value
  const modelId = currentModel.value.id
  const next: ProviderConfig = {
    ...provider,
    models: provider.models.map(m =>
      m.id === modelId
        ? { ...m, capabilities: { ...m.capabilities, maxOutput: value } }
        : m,
    ),
  }
  await store.saveProvider(next)
  chat.removeLastError()
  const nextProvider = store.providers.find(p => p.id === provider.id) ?? next
  const nextModel = nextProvider.models.find(m => m.id === modelId) ?? currentModel.value
  await chat.send(
    '已调大输出预算，请接着上一轮未完成的任务清单继续推进，不要重复已完成步骤',
    nextProvider,
    nextModel,
    apiKey,
    effectiveSystemPrompt.value,
  )
}

function handleCreateSession() {
  const newSessionId = `session-${windowId.value}-${Date.now()}`
  store.setActiveSession(newSessionId)
  chat.clearMessages()
  chat.workDir.value = ''
  currentView.value = 'chat'
}

async function handleSelectSession(id: string) {
  store.setActiveSession(id)
  currentSessionId.value = id
  userPickedSession.value = true
  currentView.value = 'chat'
  await chat.loadHistory(id)
}

async function handleDeleteSession(id: string) {
  await store.removeSession(id)
}

/** 打开新的独立 AI 窗口 */
async function handleNewWindow() {
  const { invoke } = await import('@tauri-apps/api/core')
  try {
    await invoke('create_ai_window')
  } catch (e) {
    chat.error.value = String(e)
  }
}

function handleMentionFile(path: string) {
  fileAttachment.addFile(path)
}

function handleFilePickerConfirm(paths: string[]) {
  showFilePicker.value = false
  for (const p of paths) fileAttachment.addFile(p)
}

function openProviderConfig() {
  currentView.value = 'provider-config'
}

function handleBackFromConfig() {
  currentView.value = 'chat'
  if (store.providers.length > 0 && !selectedProviderId.value) {
    const dp = store.defaultProvider
    if (dp) {
      selectedProviderId.value = dp.id
      const firstModel = dp.models[0]
      if (firstModel) selectedModelId.value = firstModel.id
    }
  }
}

async function handleSelectWorkDir() {
  const dir = await openDialog({ directory: true, multiple: false })
  if (dir) setWorkDir(dir as string)
}

async function setWorkDir(dir: string) {
  chat.workDir.value = dir
  if (dir) memoryStore.setWorkspace(dir)
  await saveCurrentSession()
}

const workDirDisplay = computed(() => {
  const dir = chat.workDir.value
  if (!dir) return ''
  const parts = dir.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length <= 2) return parts.join('/')
  return '…/' + parts.slice(-2).join('/')
})

const hasProviders = computed(() => store.providers.length > 0)

const CHAT_MODE_CONFIG = {
  normal: { label: '普通对话', desc: '标准问答交互', icon: MessageSquareText, color: 'text-blue-500', bg: 'bg-blue-500/10' },
  plan: { label: '规划模式', desc: 'AI 先分析规划，确认后执行', icon: Sparkles, color: 'text-violet-500', bg: 'bg-violet-500/10' },
  auto: { label: '全自动', desc: 'AI 自主分析、决策、执行', icon: Zap, color: 'text-amber-500', bg: 'bg-amber-500/10' },
} as const

const currentModeConfig = computed(() => CHAT_MODE_CONFIG[chatMode.value])
</script>

<template>
  <div class="flex h-full flex-col bg-background">
    <!-- Provider 配置页 -->
    <template v-if="currentView === 'provider-config'">
      <AiProviderConfig @back="handleBackFromConfig" />
    </template>

    <!-- 对话页 -->
    <template v-else>
      <!-- 顶栏 -->
      <div class="flex items-center justify-between px-4 py-2 shrink-0 border-b border-border/30">
        <div class="flex items-center gap-1">
          <TooltipProvider :delay-duration="300">
            <!-- 新建对话 -->
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon" class="h-8 w-8" @click="handleNewWindow">
                  <Plus class="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" class="text-[11px]">新建对话</TooltipContent>
            </Tooltip>

            <!-- 新建窗口 -->
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon" class="h-8 w-8" @click="handleNewWindow">
                  <Bot class="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" class="text-[11px]">新窗口</TooltipContent>
            </Tooltip>

            <!-- 历史对话 -->
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon" class="h-8 w-8" @click="showSessionDrawer = true">
                  <History class="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" class="text-[11px]">历史对话</TooltipContent>
            </Tooltip>

            <!-- 配置 -->
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon" class="h-8 w-8" @click="openProviderConfig">
                  <Settings class="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" class="text-[11px]">服务商配置</TooltipContent>
            </Tooltip>

            <!-- 记忆 -->
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon" class="h-8 w-8" @click="showMemoryDrawer = true">
                  <Brain class="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" class="text-[11px]">项目记忆</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <!-- 工作目录选择器 -->
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <button
                class="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition-colors"
                :class="chat.workDir.value
                  ? 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  : 'text-muted-foreground/40 hover:text-muted-foreground/60 hover:bg-muted/50'"
                :title="chat.workDir.value || '设置工作目录（启用 AI 文件操作）'"
              >
                <FolderOpen class="h-3.5 w-3.5" />
                <span v-if="chat.workDir.value">{{ workDirDisplay }}</span>
                <span v-else>设置工作目录</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" class="w-64">
              <DropdownMenuLabel class="text-[11px] text-muted-foreground">资源管理器中的目录</DropdownMenuLabel>
              <DropdownMenuItem
                v-for="root in chat.availableWorkDirs.value"
                :key="root.value"
                class="flex items-center justify-between gap-2 text-[12px]"
                @select="setWorkDir(root.value)"
              >
                <span class="truncate" :title="root.value">{{ root.label }}</span>
                <Check v-if="chat.workDir.value === root.value" class="h-3.5 w-3.5 text-primary shrink-0" />
              </DropdownMenuItem>
              <div
                v-if="chat.availableWorkDirs.value.length === 0"
                class="px-2 py-1.5 text-[11px] text-muted-foreground"
              >资源管理器尚未添加文件夹</div>
              <DropdownMenuSeparator />
              <DropdownMenuItem class="text-[12px]" @select="handleSelectWorkDir">
                <FolderOpen class="mr-2 h-3.5 w-3.5" />
                浏览其他目录…
              </DropdownMenuItem>
              <DropdownMenuItem
                v-if="chat.workDir.value"
                class="text-[12px] text-muted-foreground"
                @select="setWorkDir('')"
              >
                清除工作目录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div class="flex items-center gap-2">
          <AiUsageBadge
            v-if="currentModel"
            :prompt-tokens="chat.totalTokens.value"
            :max-context="currentModel.capabilities.maxContext"
            :pricing="currentModel.capabilities.pricing"
          />
        </div>
      </div>

      <!-- 消息区域 -->
      <div ref="scrollContainer" class="flex-1 overflow-y-auto" @scroll="chat.handleScroll">
        <!-- 空状态 -->
        <div
          v-if="chat.messages.value.length === 0 && !chat.isLoading.value"
          class="flex h-full flex-col items-center justify-center text-center px-6"
        >
          <div class="flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/5 mb-6">
            <Bot class="h-10 w-10 text-primary/40" />
          </div>
          <h2 class="text-xl font-semibold text-foreground/80 mb-2">AI 助手</h2>
          <p class="text-sm text-muted-foreground max-w-md leading-relaxed">
            {{ hasProviders ? '有什么可以帮你的？选择模型后开始对话。' : '请先配置 AI 服务商和 API Key。' }}
          </p>
          <Button v-if="!hasProviders" variant="outline" size="sm" class="mt-6" @click="openProviderConfig">
            <Settings class="mr-2 h-4 w-4" />
            配置服务商
          </Button>

          <div v-if="hasProviders" class="mt-8 flex items-center gap-2">
            <div :class="[currentModeConfig.bg, 'rounded-full px-3 py-1.5 flex items-center gap-1.5']">
              <component :is="currentModeConfig.icon" class="h-3.5 w-3.5" :class="currentModeConfig.color" />
              <span class="text-xs font-medium" :class="currentModeConfig.color">{{ currentModeConfig.label }}</span>
            </div>
            <span class="text-xs text-muted-foreground">{{ currentModeConfig.desc }}</span>
          </div>

          <div v-if="hasProviders" class="mt-8 grid grid-cols-2 gap-2 max-w-sm">
            <button class="rounded-lg border border-border/30 px-4 py-3 text-left hover:bg-muted/30 transition-colors" @click="chatMode = 'plan'">
              <Sparkles class="h-4 w-4 text-violet-500 mb-1.5" />
              <p class="text-xs font-medium">规划模式</p>
              <p class="text-[10px] text-muted-foreground">先规划后执行</p>
            </button>
            <button class="rounded-lg border border-border/30 px-4 py-3 text-left hover:bg-muted/30 transition-colors" @click="chatMode = 'auto'">
              <Zap class="h-4 w-4 text-amber-500 mb-1.5" />
              <p class="text-xs font-medium">全自动模式</p>
              <p class="text-[10px] text-muted-foreground">AI 直接给出方案</p>
            </button>
          </div>
        </div>

        <!-- 消息列表（虚拟滚动） -->
        <div
          v-else
          :style="{ height: `${totalSize}px`, width: '100%', position: 'relative' }"
        >
          <div
            :style="{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualItems[0]?.start ?? 0}px)`,
            }"
          >
            <div
              v-for="vRow in virtualItems"
              :key="chat.messages.value[vRow.index]!.id + (chat.messages.value[vRow.index]!.isStreaming ? '-s' : '')"
              :data-index="vRow.index"
              :ref="(el) => { if (el) { (virtualItemEls.value as HTMLElement[])[vRow.index] = el as HTMLElement; virtualizer.value.measureElement(el as HTMLElement) } }"
              class="px-4 py-0.5"
            >
              <AiMessageBubble
                :message="chat.messages.value[vRow.index]!"
                :session-id="currentSessionId"
                @continue="handleContinue"
                @bump-max-output="handleBumpMaxOutput"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- 压缩提示 -->
      <AiCompactBanner :visible="chat.isCompacting?.value ?? false" />

      <!-- 错误提示 -->
      <div v-if="chat.error.value" class="mx-auto max-w-4xl px-5 mb-2">
        <div class="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-2 text-xs text-destructive">
          {{ chat.error.value }}
        </div>
      </div>

      <!-- 输入区 -->
      <div class="mx-auto w-full max-w-4xl px-5">
        <AiInputArea
          :is-streaming="chat.isStreaming.value"
          :disabled="!hasProviders || !currentModel"
          :loading="chat.isLoading.value"
          :providers="store.providers"
          :selected-provider-id="selectedProviderId"
          :selected-model-id="selectedModelId"
          :chat-mode="chatMode"
          :attachments="fileAttachment.attachments.value"
          :placeholder="chatMode === 'plan' ? '描述你的需求，AI 将先给出规划方案…' : chatMode === 'auto' ? '描述任务，AI 将自动分析并给出完整方案…' : '发送消息…'"
          @send="handleSend"
          @abort="chat.abort"
          @clear-session="handleCreateSession"
          @update:selected-provider-id="selectedProviderId = $event"
          @update:selected-model-id="selectedModelId = $event"
          @update:chat-mode="chatMode = $event"
          @open-config="openProviderConfig"
          @select-files="showFilePicker = true"
          @drop-files="fileAttachment.handleDomDrop"
          @drop-file-path="handleMentionFile"
          @remove-attachment="fileAttachment.removeAttachment"
          @mention-file="handleMentionFile"
        />
      </div>
    </template>

    <!-- 历史会话抽屉 -->
    <AiSessionDrawer
      :open="showSessionDrawer"
      :sessions="store.sessions"
      :active-session-id="store.activeSessionId"
      @update:open="showSessionDrawer = $event"
      @select="handleSelectSession"
      @create="handleCreateSession"
      @delete="handleDeleteSession"
    />

    <!-- 工作区文件选择器 -->
    <WorkspaceFilePicker
      v-if="showFilePicker"
      @confirm="handleFilePickerConfirm"
      @close="showFilePicker = false"
    />

    <!-- 记忆管理抽屉 -->
    <AiMemoryDrawer
      :open="showMemoryDrawer"
      @update:open="showMemoryDrawer = $event"
    />
  </div>
</template>
