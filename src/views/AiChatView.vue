<script setup lang="ts">
/**
 * Main AI chat view.
 *
 * Keeps the immersive chat experience while delegating shared provider/model
 * and workdir state into `useAiChatViewState`.
 */
import { computed, onActivated, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAiChatStore } from '@/stores/ai-chat'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWorkspaceFilesStore } from '@/stores/workspace-files'
import { useAiMemoryStore } from '@/stores/ai-memory'
import { useSettingsStore } from '@/stores/settings'
import { useAiChat } from '@/composables/useAiChat'
import { useAiChatViewState } from '@/composables/useAiChatViewState'
import { useFileAttachment } from '@/composables/useFileAttachment'
import { setActiveSessionId } from '@/composables/useToolApproval'
import { getCredential } from '@/api/connection'
import type { AiMessage } from '@/types/ai'
import type { ChatMode } from '@/components/ai/AiInputArea.vue'
import AiChatShell from '@/components/ai/AiChatShell.vue'
import AiDiagnosticsPanel from '@/components/ai/AiDiagnosticsPanel.vue'
import AiPlanGateBar from '@/components/ai/AiPlanGateBar.vue'
import AiPhaseBar from '@/components/ai/AiPhaseBar.vue'
import AiSpawnedTasksPanel from '@/components/ai/AiSpawnedTasksPanel.vue'
import {
  MessageSquareText,
  Sparkles,
  Zap,
} from 'lucide-vue-next'

interface MessageGroup {
  isGroupStart: boolean
  isGroupEnd: boolean
  groupSize: number
  msg: AiMessage
}

const { t } = useI18n()

const CHAT_MODE_CONFIG: Record<ChatMode, {
  label: string
  desc: string
  icon: unknown
  color: string
  bg: string
}> = {
  normal: {
    label: t('ai.chat.normalChat'),
    desc: t('ai.chat.normalChatDesc'),
    icon: MessageSquareText,
    color: 'text-blue-500',
    bg: 'bg-blue-500/10',
  },
  plan: {
    label: t('ai.chat.planMode'),
    desc: t('ai.chat.planModeDesc'),
    icon: Sparkles,
    color: 'text-violet-500',
    bg: 'bg-violet-500/10',
  },
  auto: {
    label: t('ai.chat.autoMode'),
    desc: t('ai.chat.autoModeDesc'),
    icon: Zap,
    color: 'text-amber-500',
    bg: 'bg-amber-500/10',
  },
  dispatcher: {
    label: t('ai.chat.dispatcher'),
    desc: t('ai.chat.dispatcherDesc'),
    icon: Zap,
    color: 'text-orange-500',
    bg: 'bg-orange-500/10',
  },
}

const LAST_SESSION_KEY = 'devforge:ai:lastSessionId'

const store = useAiChatStore()
const workspace = useWorkspaceStore()
const wsFiles = useWorkspaceFilesStore()
const memoryStore = useAiMemoryStore()
const settingsStore = useSettingsStore()
const fileAttachment = useFileAttachment()

const currentView = ref<'chat' | 'provider-config'>('chat')
const showSessionDrawer = ref(false)
const showMemoryDrawer = ref(false)
const showFilePicker = ref(false)

const chatShellRef = ref<InstanceType<typeof AiChatShell> | null>(null)
const scrollContainer = computed(() => chatShellRef.value?.scrollContainer ?? null)

const ownTabId = workspace.activeTabId
const ownTab = workspace.tabs.find(tab => tab.id === ownTabId)

const currentSessionId = ref<string>(
  (ownTab?.meta?.sessionId as string | undefined)
    ?? localStorage.getItem(LAST_SESSION_KEY)
    ?? `session-${crypto.randomUUID()}`,
)

watch(
  () => workspace.tabs.find(tab => tab.id === ownTabId)?.meta?.sessionId,
  (sessionId) => {
    if (typeof sessionId === 'string' && sessionId && sessionId !== currentSessionId.value) {
      currentSessionId.value = sessionId
    }
  },
)

const chat = useAiChat({
  sessionId: currentSessionId,
  scrollContainer,
})

const {
  selectedProviderId,
  selectedModelId,
  systemPrompt,
  chatMode,
  currentProvider,
  currentModel,
  effectiveSystemPrompt,
  hasProviders,
  workDirDisplay,
  syncDefaultProviderSelection,
  applyWorkspacePreferredModel,
  sendMessageNow,
  handleContinue,
  handleBumpMaxOutput,
  handleSelectWorkDir,
  setWorkDir,
} = useAiChatViewState({
  sessionId: currentSessionId,
  store,
  chat,
  memoryStore,
  wsFiles,
  modeConfigs: CHAT_MODE_CONFIG,
  mapApprovalMode: mode => mode === 'auto' ? 'auto' : mode === 'plan' || mode === 'dispatcher' ? 'deny' : 'ask',
  onModeChanged: (mode) => {
    if (mode === 'plan') {
      chat.planGateEnabled.value = true
      chat.planApproved.value = false
    } else {
      chat.planGateEnabled.value = false
      chat.planApproved.value = false
    }
  },
  onPersistWorkDir: persistWorkDir,
})

let watchLoadTimer: ReturnType<typeof setTimeout> | null = null
watch(currentSessionId, (sessionId, oldSessionId) => {
  if (sessionId) {
    localStorage.setItem(LAST_SESSION_KEY, sessionId)
    setActiveSessionId(sessionId)
  }
  if (sessionId && oldSessionId && sessionId !== oldSessionId) {
    if (watchLoadTimer) clearTimeout(watchLoadTimer)
    watchLoadTimer = setTimeout(() => {
      watchLoadTimer = null
      chat.loadHistory(sessionId).catch((error) => {
        console.warn('[AiChatView] watch loadHistory failed:', error)
      })
    }, 50)
  }
}, { immediate: true })

const groupedMessages = computed<MessageGroup[]>(() => {
  const result: MessageGroup[] = []
  const messages = chat.messages.value
  let index = 0

  while (index < messages.length) {
    const msg = messages[index]!
    if (msg.type === 'divider' || msg.role === 'user' || msg.role === 'error') {
      result.push({ isGroupStart: true, isGroupEnd: true, groupSize: 1, msg })
      index += 1
      continue
    }

    let end = index
    while (end < messages.length && messages[end]!.role === 'assistant' && messages[end]!.type !== 'divider') {
      end += 1
    }

    const groupSize = end - index
    for (let cursor = index; cursor < end; cursor += 1) {
      result.push({
        isGroupStart: cursor === index,
        isGroupEnd: cursor === end - 1,
        groupSize,
        msg: messages[cursor]!,
      })
    }
    index = end
  }

  return result
})

const latestUserMessageId = computed(() => {
  for (let index = chat.messages.value.length - 1; index >= 0; index -= 1) {
    const message = chat.messages.value[index]
    if (message?.role === 'user') return message.id
  }
  return null
})

const messageItems = computed(() =>
  groupedMessages.value.map((item, index) => ({
    key: `${item.msg.id}-${index}${item.msg.isStreaming ? '-s' : ''}`,
    message: item.msg,
    hideHeader: !item.isGroupStart,
    isGroupEnd: item.isGroupEnd,
    inGroup: item.groupSize > 1,
    stickyCompact: item.msg.id === latestUserMessageId.value,
  })),
)

onMounted(async () => {
  try {
    await store.init()
  } catch (error) {
    chat.error.value = 'Initialization failed. Please refresh and try again.'
    console.error('[AiChatView] init failed:', error)
    return
  }

  syncDefaultProviderSelection()

  if (store.providers.length === 0) {
    currentView.value = 'provider-config'
    return
  }

  if (currentSessionId.value) {
    await chat.loadHistory()
  }

  if (chat.workDir.value) {
    await memoryStore.setWorkspace(chat.workDir.value)
    await store.loadWorkspaceConfig(chat.workDir.value)
    applyWorkspacePreferredModel(store.currentWorkspaceConfig?.preferredModel)
  }
})

onActivated(async () => {
  const sessionId = currentSessionId.value
  if (!sessionId) return

  setActiveSessionId(sessionId)
  requestAnimationFrame(() => {
    chat.scrollToBottom()
    setTimeout(() => chat.scrollToBottom(), 60)
  })

  if (chat.isStreaming.value || chat.messages.value.length > 0) return

  try {
    await chat.loadHistory(sessionId)
  } catch (error) {
    console.warn('[AiChatView] onActivated loadHistory failed:', error)
  }
})

const messageQueue = ref<string[]>([])
const queueAttachments = ref<ReturnType<typeof fileAttachment.getReadyAttachments>[]>([])

async function handleSend(content: string): Promise<void> {
  if (!currentProvider.value || !currentModel.value) return

  if (chat.isStreaming.value) {
    const pendingAttachments = fileAttachment.getReadyAttachments()
    fileAttachment.clearAttachments()
    messageQueue.value.push(content)
    queueAttachments.value.push(pendingAttachments)
    return
  }

  await doSend(content, fileAttachment.getReadyAttachments())
  fileAttachment.clearAttachments()

  while (messageQueue.value.length > 0 && !chat.isStreaming.value) {
    const nextContent = messageQueue.value.shift()!
    const nextAttachments = queueAttachments.value.shift() ?? []
    await doSend(nextContent, nextAttachments)
  }
}

async function doSend(
  content: string,
  attachments: ReturnType<typeof fileAttachment.getReadyAttachments>,
): Promise<void> {
  await sendMessageNow(content, attachments, (cleanContent) => {
    const tab = workspace.tabs.find(candidate => candidate.id === ownTabId)
    if (!tab) return
    if (tab.title !== 'AI Chat' && tab.title !== 'AI 对话') return
    if (!cleanContent.trim()) return

    const meaningful = cleanContent.trim().replace(/^[A-Za-z]:\\[^\s]*/g, '').trim() || cleanContent.trim()
    const shortTitle = meaningful.replace(/\s+/g, ' ').slice(0, 12)
    workspace.updateTabTitle(tab.id, shortTitle)
  })
}

async function handlePlanApprove(): Promise<void> {
  if (!currentProvider.value || !currentModel.value) return

  const apiKey = await getCredential(`ai-provider-${currentProvider.value.id}`) ?? ''
  if (!apiKey) {
    chat.error.value = 'API key is not configured.'
    return
  }

  chat.approvePlan()
  await chat.send(
    '[The user approved the execution plan. Continue with the approved steps and use tools when needed.]',
    currentProvider.value,
    currentModel.value,
    apiKey,
    effectiveSystemPrompt.value,
  )
}

function handlePlanReject(): void {
  chat.rejectPlan()
}

async function handleSpawnRun(taskId: string): Promise<void> {
  if (!currentProvider.value || !currentModel.value) return

  const task = chat.spawnedTasks.value.find(item => item.id === taskId)
  if (!task) return

  const taskIndex = chat.spawnedTasks.value.findIndex(item => item.id === taskId)
  if (taskIndex !== -1) {
    chat.spawnedTasks.value[taskIndex] = {
      ...chat.spawnedTasks.value[taskIndex]!,
      status: 'running',
    }
  }

  workspace.addTab({
    id: `ai-chat-${Date.now()}`,
    type: 'ai-chat',
    title: `[Task] ${task.description.slice(0, 20)}`,
    closable: true,
    meta: {
      sessionId: `session-${Date.now()}`,
      initialMessage: task.description,
    },
  })

  setTimeout(() => {
    const index = chat.spawnedTasks.value.findIndex(item => item.id === taskId)
    if (index !== -1) {
      chat.spawnedTasks.value[index] = {
        ...chat.spawnedTasks.value[index]!,
        status: 'done',
      }
    }
  }, 500)
}

function handleNewAiTab(): void {
  workspace.addTab({
    id: `ai-chat-${Date.now()}`,
    type: 'ai-chat',
    title: 'AI Chat',
    closable: true,
    meta: { sessionId: `session-${Date.now()}` },
  })
}

function handleModelChange(newModelId: string): void {
  const previousModelId = selectedModelId.value
  selectedModelId.value = newModelId

  if (!previousModelId || previousModelId === newModelId) return
  if (chat.messages.value.length === 0) return

  const modelLabel = currentProvider.value?.models.find(model => model.id === newModelId)?.name ?? newModelId
  chat.messages.value.push({
    id: `divider-${Date.now()}`,
    role: 'system',
    type: 'divider',
    dividerText: `Model changed · ${modelLabel}`,
    content: '',
    timestamp: Date.now(),
  })
}

async function handleCompact(): Promise<void> {
  if (!currentProvider.value || !currentModel.value) return

  const apiKey = await getCredential(`ai-provider-${currentProvider.value.id}`) ?? ''
  if (!apiKey) {
    chat.error.value = 'API key is not configured.'
    return
  }

  const compacted = await chat.manualCompact(currentProvider.value, currentModel.value, apiKey)
  if (!compacted) {
    chat.error.value = 'Compaction failed: not enough messages or the model is unavailable.'
    return
  }

  chat.scrollToBottom()
}

function handleCreateSession(): void {
  const sessionId = `session-${Date.now()}`
  const tab = workspace.tabs.find(candidate => candidate.id === ownTabId)
  if (tab) {
    workspace.updateTabMeta(tab.id, { sessionId })
    workspace.updateTabTitle(tab.id, 'AI Chat')
  }
  currentSessionId.value = sessionId
  store.setActiveSession(sessionId)
  chat.clearMessages()
  currentView.value = 'chat'
}

async function handleSelectSession(id: string): Promise<void> {
  const tab = workspace.tabs.find(candidate => candidate.id === ownTabId)
  if (tab) {
    workspace.updateTabMeta(tab.id, { sessionId: id })
  }

  currentSessionId.value = id
  store.setActiveSession(id)
  currentView.value = 'chat'
  await chat.loadHistory(id)

  if (chat.workDir.value) {
    await memoryStore.setWorkspace(chat.workDir.value)
  }
}

async function handleDeleteSession(id: string): Promise<void> {
  await store.removeSession(id)
}

async function handleNewAiWindow(): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core')
  try {
    await invoke('create_ai_window')
  } catch (error) {
    chat.error.value = String(error)
  }
}

const contextUsagePercent = computed(() => {
  const maxContext = currentModel.value?.capabilities.maxContext ?? 0
  if (!maxContext) return 0
  return Math.min((chat.totalTokens.value / maxContext) * 100, 100)
})

function handleMentionFile(path: string): void {
  fileAttachment.addFile(path)
}

function handleFilePickerConfirm(paths: string[]): void {
  showFilePicker.value = false
  for (const path of paths) {
    fileAttachment.addFile(path)
  }
}

function openProviderConfig(): void {
  currentView.value = 'provider-config'
}

function exitImmersive(): void {
  workspace.exitImmersive()
}

async function persistWorkDir(dir: string): Promise<void> {
  if (dir) {
    await store.loadWorkspaceConfig(dir).catch((error) => {
      console.warn('[AiChatView] load workspace config failed:', error)
    })
    applyWorkspacePreferredModel(store.currentWorkspaceConfig?.preferredModel)
  }

  const sessionId = currentSessionId.value
  if (!sessionId || !currentProvider.value || !currentModel.value) return

  await store.saveSession({
    id: sessionId,
    title: 'New Chat',
    providerId: currentProvider.value.id,
    model: currentModel.value.id,
    systemPrompt: systemPrompt.value,
    messageCount: chat.messages.value.filter(message => message.role !== 'error').length,
    totalTokens: chat.totalTokens.value,
    estimatedCost: 0,
    createdAt: chat.messages.value[0]?.timestamp ?? Date.now(),
    updatedAt: Date.now(),
    workDir: dir || undefined,
  }).catch((error) => {
    console.warn('[AI] failed to persist work directory:', error)
  })
}
</script>

<template>
  <AiChatShell
    ref="chatShellRef"
    :current-view="currentView"
    :show-session-drawer="showSessionDrawer"
    :show-memory-drawer="showMemoryDrawer"
    :show-file-picker="showFilePicker"
    :message-items="messageItems"
    :session-id="currentSessionId"
    :messages-count="chat.messages.value.length"
    :has-providers="hasProviders"
    :providers="store.providers"
    :sessions="store.sessions"
    :active-session-id="store.activeSessionId"
    :selected-provider-id="selectedProviderId"
    :selected-model-id="selectedModelId"
    :chat-mode="chatMode"
    :attachments="fileAttachment.attachments.value"
    :current-model="currentModel"
    :prompt-tokens="chat.latestUsage.value.promptTokens"
    :completion-tokens="chat.latestUsage.value.completionTokens"
    :cache-read-tokens="chat.latestUsage.value.cacheReadTokens"
    :is-streaming="chat.isStreaming.value"
    :is-loading="chat.isLoading.value"
    :can-load-more-history="chat.canLoadMoreHistory.value"
    :work-dir="chat.workDir.value"
    :available-work-dirs="chat.availableWorkDirs.value"
    :work-dir-display="workDirDisplay"
    :placeholder="chatMode === 'plan'
      ? t('ai.messages.placeholderPlan')
      : chatMode === 'auto'
        ? t('ai.messages.placeholderAuto')
        : t('ai.messages.placeholderDefault')"
    :error="chat.error.value"
    :compact-visible="chat.isCompacting?.value ?? false"
    :context-usage-percent="contextUsagePercent"
    :primary-action-label="t('ai.messages.primaryAction')"
    :secondary-action-label="t('ai.messages.secondaryAction')"
    :empty-description-ready="t('ai.messages.emptyDescriptionReady')"
    :empty-description-missing-provider="t('ai.messages.emptyDescriptionMissingProvider')"
    :show-exit-immersive="true"
    @update:show-session-drawer="showSessionDrawer = $event"
    @update:show-memory-drawer="showMemoryDrawer = $event"
    @update:show-file-picker="showFilePicker = $event"
    @primary-action="handleNewAiTab"
    @secondary-action="handleNewAiWindow"
    @open-config="openProviderConfig"
    @select-work-dir="handleSelectWorkDir"
    @set-work-dir="setWorkDir($event)"
    @continue="handleContinue"
    @bump-max-output="handleBumpMaxOutput"
    @load-more-history="chat.loadMoreHistory"
    @scroll-messages="chat.handleScroll"
    @send="handleSend"
    @abort="chat.abort"
    @clear-session="handleCreateSession"
    @update:selected-provider-id="selectedProviderId = $event"
    @update:selected-model-id="handleModelChange"
    @update:chat-mode="chatMode = $event"
    @drop-files="fileAttachment.handleDomDrop"
    @drop-file-path="handleMentionFile"
    @remove-attachment="fileAttachment.removeAttachment"
    @mention-file="handleMentionFile"
    @compact="handleCompact"
    @select-session="handleSelectSession"
    @create-session="handleCreateSession"
    @delete-session="handleDeleteSession"
    @file-picker-confirm="handleFilePickerConfirm"
    @exit-immersive="exitImmersive"
  >
    <template #empty-state-extra>
      <div v-if="hasProviders" class="mt-8 grid w-full max-w-md grid-cols-4 gap-3">
        <button
          v-for="(config, mode) in CHAT_MODE_CONFIG"
          :key="mode"
          class="rounded-xl border px-4 py-4 text-left transition-all"
          :class="chatMode === mode
            ? 'border-primary/40 bg-primary/5 shadow-sm'
            : 'border-border/30 hover:border-border/60 hover:bg-muted/40'"
          @click="chatMode = mode"
        >
          <component :is="config.icon" class="mb-2 h-4 w-4" :class="config.color" />
          <p class="text-xs font-semibold leading-tight">{{ config.label }}</p>
          <p class="mt-0.5 text-[10px] leading-tight text-muted-foreground/60">{{ config.desc }}</p>
        </button>
      </div>
    </template>

    <template #after-compact>
      <div v-if="settingsStore.settings.devMode" class="mx-auto max-w-4xl px-5">
        <AiDiagnosticsPanel :metrics="chat.observability.value" />
      </div>

      <div v-if="chat.currentPhase.value" class="mx-auto max-w-4xl px-5">
        <AiPhaseBar
          :current="chat.currentPhase.value.current"
          :total="chat.currentPhase.value.total"
          :label="chat.currentPhase.value.label"
          :is-streaming="chat.isStreaming.value"
        />
      </div>

      <div v-if="chat.awaitingPlanApproval.value" class="mx-auto max-w-4xl px-5">
        <AiPlanGateBar
          :plan="chat.pendingPlan.value"
          @approve="handlePlanApprove"
          @reject="handlePlanReject"
        />
      </div>

      <div v-if="chat.spawnedTasks.value.length" class="mx-auto max-w-4xl px-5">
        <AiSpawnedTasksPanel
          :tasks="chat.spawnedTasks.value"
          @run="handleSpawnRun"
        />
      </div>
    </template>

    <template #before-input>
      <div
        v-if="fileAttachment.attachments.value.length > 0 || messageQueue.length > 0"
        class="mx-auto mb-0.5 w-full max-w-4xl px-5"
      >
        <div class="flex items-center gap-2 rounded-lg border border-border/30 bg-muted/30 px-2 py-1 text-[10px] text-muted-foreground/60">
          <span v-if="fileAttachment.attachments.value.length > 0">
            {{ fileAttachment.attachments.value.length }} attached file(s)
          </span>
          <span v-if="messageQueue.length > 0" class="ml-auto text-amber-500">
            {{ messageQueue.length }} queued
          </span>
        </div>
      </div>
      <div
        v-else-if="messageQueue.length > 0"
        class="mx-auto mb-0.5 w-full max-w-4xl px-5"
      >
        <div class="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-600 dark:text-amber-400">
          {{ messageQueue.length }} message(s) are queued and will be sent automatically.
        </div>
      </div>
    </template>
  </AiChatShell>
</template>
