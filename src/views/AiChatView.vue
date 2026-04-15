<script setup lang="ts">
/**
 * AI 对话主视图 — 沉浸式体验
 *
 * 全屏居中消息流，底部输入区集成模型/模式切换，
 * 历史对话通过 Sheet 抽屉访问，支持多 Tab 独立对话。
 */
import { ref, computed, onMounted, watch } from 'vue'
import { useAiChatStore } from '@/stores/ai-chat'
import { useAiChat } from '@/composables/useAiChat'
import { useFileAttachment } from '@/composables/useFileAttachment'
import { checkTokenLimit } from '@/utils/file-markers'
import { useWorkspaceStore } from '@/stores/workspace'
import { getCredential } from '@/api/connection'
import type { ProviderConfig, ModelConfig, AiSession } from '@/types/ai'
import type { ChatMode } from '@/components/ai/AiInputArea.vue'
import AiMessageBubble from '@/components/ai/AiMessageBubble.vue'
import AiInputArea from '@/components/ai/AiInputArea.vue'
import AiUsageBadge from '@/components/ai/AiUsageBadge.vue'
import AiProviderConfig from '@/components/ai/AiProviderConfig.vue'
import AiSessionDrawer from '@/components/ai/AiSessionDrawer.vue'
import {
  Bot,
  Settings,
  History,
  Plus,
  Minimize2,
  Sparkles,
  Zap,
  MessageSquareText,
  FolderOpen,
} from 'lucide-vue-next'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

const store = useAiChatStore()
const workspace = useWorkspaceStore()
const fileAttachment = useFileAttachment()

// ─────────────────────── 视图状态 ───────────────────────

/** 当前视图：对话 or 配置 */
const currentView = ref<'chat' | 'provider-config'>('chat')

/** 历史对话抽屉是否打开 */
const showSessionDrawer = ref(false)

// 当前选中的 Provider 和 Model
const selectedProviderId = ref<string | null>(null)
const selectedModelId = ref<string | null>(null)
const systemPrompt = ref<string | undefined>(undefined)

// 对话模式
const chatMode = ref<ChatMode>('normal')

/** 模式对应的 system prompt 后缀 */
const MODE_SUFFIXES: Record<ChatMode, string> = {
  normal: '',
  plan: '\n\n【模式：规划模式】\n你现在处于规划模式。对于用户的任何请求：\n1. 先详细分析需求，列出关键点\n2. 提出实施方案（如有多个方案则对比优劣）\n3. 列出具体步骤计划\n4. 等待用户确认后才给出最终的代码或执行方案\n不要直接给出代码，先让用户审核你的计划。',
  auto: '\n\n【模式：全自动模式】\n你现在处于全自动模式。对于用户的请求：\n1. 直接完整地分析问题并给出最终解决方案\n2. 包括完整的代码实现、配置、命令等\n3. 主动考虑边界情况、错误处理、性能优化\n4. 给出可直接使用的结果，无需用户二次确认\n以最高效率给出完整、可执行的解决方案。',
}

// ─────────────────────── 对话核心 ───────────────────────

const scrollContainer = ref<HTMLElement | null>(null)

/** 从 Tab meta 获取 sessionId，或生成默认的 */
const currentSessionId = computed(() => {
  const meta = workspace.activeTab?.meta
  return meta?.sessionId ?? `session-default-${Date.now()}`
})

const chat = useAiChat({
  sessionId: currentSessionId,
  scrollContainer,
})

/** 当前选中的 Provider 配置 */
const currentProvider = computed<ProviderConfig | null>(() =>
  store.providers.find(p => p.id === selectedProviderId.value) ?? null,
)

/** 当前选中的模型配置 */
const currentModel = computed<ModelConfig | null>(() =>
  currentProvider.value?.models.find(m => m.id === selectedModelId.value) ?? null,
)

// ─────────────────────── 初始化 ───────────────────────

onMounted(async () => {
  try {
    await store.init()
  } catch (e) {
    chat.error.value = '初始化失败，请刷新重试'
    console.error('[AiChatView] 初始化失败:', e)
    return
  }

  // 自动选中默认 Provider
  const dp = store.defaultProvider
  if (dp) {
    selectedProviderId.value = dp.id
    const firstModel = dp.models[0]
    if (firstModel) {
      selectedModelId.value = firstModel.id
    }
  }

  // 没有 Provider → 自动打开配置页
  if (store.providers.length === 0) {
    currentView.value = 'provider-config'
    return
  }

  // 加载当前会话的历史
  if (currentSessionId.value) {
    await chat.loadHistory()
  }
})

// Provider 列表变化时自动选中
watch(() => store.providers, (providers) => {
  if (providers.length > 0 && !selectedProviderId.value) {
    const dp = store.defaultProvider
    if (dp) {
      selectedProviderId.value = dp.id
      const firstModel = dp.models[0]
      if (firstModel) {
        selectedModelId.value = firstModel.id
      }
    }
  }
}, { deep: true })

// ─────────────────────── 操作 ───────────────────────

/** 计算实际的 system prompt（拼接模式后缀 + 工具行为指引） */
const effectiveSystemPrompt = computed(() => {
  const base = systemPrompt.value ?? ''
  const suffix = MODE_SUFFIXES[chatMode.value]

  // 工具行为指引（模型支持 Tool Use + 有工作目录时追加）
  const enableTools = currentModel.value?.capabilities.toolUse && !!chat.workDir.value
  let toolGuide = ''
  if (enableTools) {
    toolGuide = `\n\n【工具使用指引】\n你可以通过工具调用来操作用户的工作目录中的文件。\n工作目录: ${chat.workDir.value}\n\n使用原则：\n- 需要了解文件内容时，调用工具读取，不要凭记忆猜测\n- 需要创建或修改文件时，调用 write_file 工具直接写入\n- 搜索代码时优先使用 search_files 工具`

    // 全自动模式额外追加
    if (chatMode.value === 'auto') {
      toolGuide += `\n\n当用户要求修改或创建文件时，直接调用 write_file 工具写入，不要在回复中输出完整代码块让用户手动保存。`
    }
  }

  const result = base + (suffix || '') + toolGuide
  return result || undefined
})

/** 发送消息 */
async function handleSend(content: string) {
  if (!currentProvider.value || !currentModel.value) return

  // 从系统密钥环读取 API Key
  const apiKey = await getCredential(`ai-provider-${currentProvider.value.id}`) ?? ''
  if (!apiKey) {
    chat.error.value = '未配置 API Key，请在服务商配置中设置'
    return
  }

  // Token 超限检查
  const attachments = fileAttachment.getReadyAttachments()
  if (currentModel.value.capabilities.maxContext > 0) {
    const totalText = content + attachments.map(f => f.content ?? '').join('')
    const check = checkTokenLimit(totalText, chat.totalTokens.value, currentModel.value.capabilities.maxContext)
    if (check.warn) {
      console.warn(`[AI] Token 接近上限: 预估 ${check.usage} / 上限 ${check.limit}`)
      // 仅警告，不阻止发送
    }
  }

  await chat.send(
    content,
    currentProvider.value,
    currentModel.value,
    apiKey,
    effectiveSystemPrompt.value,
    attachments,
  )

  // 发送后清空附件
  fileAttachment.clearAttachments()
}

/** 新建会话（在当前 Tab 内新建） */
function handleCreateSession() {
  const newSessionId = `session-${Date.now()}`
  // 通过 store 方法更新 Tab meta（不可变）
  const tab = workspace.activeTab
  if (tab) {
    workspace.updateTabMeta(tab.id, { sessionId: newSessionId })
  }
  store.setActiveSession(newSessionId)
  chat.clearMessages()
  chat.workDir.value = ''
  currentView.value = 'chat'
}

/** 选择历史会话 */
async function handleSelectSession(id: string) {
  // 通过 store 方法更新 Tab meta（不可变）
  const tab = workspace.activeTab
  if (tab) {
    workspace.updateTabMeta(tab.id, { sessionId: id })
  }
  store.setActiveSession(id)
  currentView.value = 'chat'
  // 显式传入 sessionId，避免 computed 响应式延迟
  await chat.loadHistory(id)
}

/** 删除会话 */
async function handleDeleteSession(id: string) {
  await store.removeSession(id)
}

/** 新建独立 AI Tab */
function handleNewAiTab() {
  const ts = Date.now()
  workspace.addTab({
    id: `ai-chat-${ts}`,
    type: 'ai-chat',
    title: 'AI 对话',
    closable: true,
    meta: { sessionId: `session-${ts}` },
  })
}

/** 是否有 Provider 配置 */
const hasProviders = computed(() => store.providers.length > 0)

/** 打开/关闭配置页 */
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
      if (firstModel) {
        selectedModelId.value = firstModel.id
      }
    }
  }
}

/** 退出沉浸式模式 */
function exitImmersive() {
  workspace.exitImmersive()
}

/** 选择工作目录 */
async function handleSelectWorkDir() {
  const dir = await openDialog({ directory: true, multiple: false })
  if (dir) {
    chat.workDir.value = dir as string
    // 立即持久化到当前 session
    const sid = currentSessionId.value
    if (sid && currentProvider.value && currentModel.value) {
      const session: AiSession = {
        id: sid,
        title: '新对话',
        providerId: currentProvider.value.id,
        model: currentModel.value.id,
        systemPrompt: systemPrompt.value,
        messageCount: chat.messages.value.filter(m => m.role !== 'error').length,
        totalTokens: chat.totalTokens.value,
        estimatedCost: 0,
        createdAt: chat.messages.value[0]?.timestamp ?? Date.now(),
        updatedAt: Date.now(),
        workDir: dir as string,
      }
      store.saveSession(session).catch(e => console.warn('[AI] 保存工作目录失败:', e))
    }
  }
}

/** 截取工作目录显示名（最后两级） */
const workDirDisplay = computed(() => {
  const dir = chat.workDir.value
  if (!dir) return ''
  const parts = dir.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length <= 2) return parts.join('/')
  return '…/' + parts.slice(-2).join('/')
})

/** 模式配置（用于空状态显示） */
const CHAT_MODE_CONFIG = {
  normal: { label: '普通对话', desc: '标准问答交互', icon: MessageSquareText, color: 'text-blue-500', bg: 'bg-blue-500/10' },
  plan: { label: '规划模式', desc: 'AI 先分析规划，确认后执行', icon: Sparkles, color: 'text-violet-500', bg: 'bg-violet-500/10' },
  auto: { label: '全自动', desc: 'AI 自主分析、决策、执行', icon: Zap, color: 'text-amber-500', bg: 'bg-amber-500/10' },
} as const

const currentModeConfig = computed(() => CHAT_MODE_CONFIG[chatMode.value])
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- ==================== Provider 配置页 ==================== -->
    <template v-if="currentView === 'provider-config'">
      <AiProviderConfig @back="handleBackFromConfig" />
    </template>

    <!-- ==================== 沉浸式对话页 ==================== -->
    <template v-else>
      <!-- 极简顶栏 -->
      <div class="flex items-center justify-between px-4 py-2 shrink-0">
        <div class="flex items-center gap-1">
          <TooltipProvider :delay-duration="300">
            <!-- 新建对话 -->
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon" class="h-8 w-8" @click="handleCreateSession">
                  <Plus class="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" class="text-[11px]">新建对话</TooltipContent>
            </Tooltip>

            <!-- 新建 Tab -->
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon" class="h-8 w-8" @click="handleNewAiTab">
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
          </TooltipProvider>

          <!-- 工作目录选择器 -->
          <button
            class="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition-colors"
            :class="chat.workDir.value
              ? 'text-muted-foreground hover:text-foreground hover:bg-muted'
              : 'text-muted-foreground/40 hover:text-muted-foreground/60 hover:bg-muted/50'"
            :title="chat.workDir.value || '设置工作目录（启用 AI 文件操作）'"
            @click="handleSelectWorkDir"
          >
            <FolderOpen class="h-3.5 w-3.5" />
            <span v-if="chat.workDir.value">{{ workDirDisplay }}</span>
            <span v-else>设置工作目录</span>
          </button>
        </div>

        <div class="flex items-center gap-2">
          <!-- Token 用量 -->
          <AiUsageBadge
            v-if="currentModel"
            :prompt-tokens="chat.totalTokens.value"
            :max-context="currentModel.capabilities.maxContext"
            :pricing="currentModel.capabilities.pricing"
          />

          <!-- 退出沉浸式 -->
          <TooltipProvider :delay-duration="300">
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon" class="h-8 w-8" @click="exitImmersive">
                  <Minimize2 class="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" class="text-[11px]">退出沉浸式</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      <!-- 消息区域（居中） -->
      <div
        ref="scrollContainer"
        class="flex-1 overflow-y-auto"
        @scroll="chat.handleScroll"
      >
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
          <Button
            v-if="!hasProviders"
            variant="outline"
            size="sm"
            class="mt-6"
            @click="openProviderConfig"
          >
            <Settings class="mr-2 h-4 w-4" />
            配置服务商
          </Button>

          <!-- 模式提示 -->
          <div v-if="hasProviders" class="mt-8 flex items-center gap-2">
            <div :class="[currentModeConfig.bg, 'rounded-full px-3 py-1.5 flex items-center gap-1.5']">
              <component :is="currentModeConfig.icon" class="h-3.5 w-3.5" :class="currentModeConfig.color" />
              <span class="text-xs font-medium" :class="currentModeConfig.color">{{ currentModeConfig.label }}</span>
            </div>
            <span class="text-xs text-muted-foreground">{{ currentModeConfig.desc }}</span>
          </div>

          <!-- 快捷操作提示 -->
          <div v-if="hasProviders" class="mt-8 grid grid-cols-2 gap-2 max-w-sm">
            <button
              class="rounded-lg border border-border/30 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
              @click="chatMode = 'plan'"
            >
              <Sparkles class="h-4 w-4 text-violet-500 mb-1.5" />
              <p class="text-xs font-medium">规划模式</p>
              <p class="text-[10px] text-muted-foreground">先规划后执行</p>
            </button>
            <button
              class="rounded-lg border border-border/30 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
              @click="chatMode = 'auto'"
            >
              <Zap class="h-4 w-4 text-amber-500 mb-1.5" />
              <p class="text-xs font-medium">全自动模式</p>
              <p class="text-[10px] text-muted-foreground">AI 直接给出方案</p>
            </button>
          </div>
        </div>

        <!-- 消息列表（全宽） -->
        <div v-else class="px-4 pb-4">
          <AiMessageBubble
            v-for="msg in chat.messages.value"
            :key="msg.id"
            :message="msg"
          />
        </div>
      </div>

      <!-- 错误提示 -->
      <div
        v-if="chat.error.value"
        class="mx-auto max-w-4xl px-5 mb-2"
      >
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
          @update:selected-provider-id="selectedProviderId = $event"
          @update:selected-model-id="selectedModelId = $event"
          @update:chat-mode="chatMode = $event"
          @open-config="openProviderConfig"
          @select-files="fileAttachment.selectFiles"
          @drop-files="fileAttachment.handleDrop"
          @remove-attachment="fileAttachment.removeAttachment"
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
  </div>
</template>
