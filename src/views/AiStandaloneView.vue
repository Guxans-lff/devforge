<script setup lang="ts">
/**
 * Standalone AI chat window.
 *
 * Runs in a dedicated Tauri WebviewWindow with its own Vue app instance.
 * The window reads `windowId` from the URL and uses an isolated session id.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { useAiChatStore } from '@/stores/ai-chat'
import { useAiMemoryStore } from '@/stores/ai-memory'
import { useWorkspaceFilesStore } from '@/stores/workspace-files'
import { useSettingsStore } from '@/stores/settings'
import { useAiChat } from '@/composables/useAiChat'
import { useAiChatViewState } from '@/composables/useAiChatViewState'
import { useFileAttachment } from '@/composables/useFileAttachment'
import { setActiveSessionId } from '@/composables/useToolApproval'
import type { AiSession } from '@/types/ai'
import type { ChatMode } from '@/components/ai/AiInputArea.vue'
import AiChatShell from '@/components/ai/AiChatShell.vue'
import AiDiagnosticsPanel from '@/components/ai/AiDiagnosticsPanel.vue'
import {
  MessageSquareText,
  Sparkles,
  Zap,
} from 'lucide-vue-next'

const route = useRoute()
const { t } = useI18n()

const CHAT_MODE_CONFIG = computed<Record<ChatMode, {
  label: string
  desc: string
  icon: unknown
  color: string
  bg: string
}>>(() => ({
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
}))

const store = useAiChatStore()
const wsFiles = useWorkspaceFilesStore()
const memoryStore = useAiMemoryStore()
const settingsStore = useSettingsStore()
const fileAttachment = useFileAttachment()

const currentView = ref<'chat' | 'provider-config'>('chat')
const showSessionDrawer = ref(false)
const showMemoryDrawer = ref(false)
const showFilePicker = ref(false)

const windowId = computed(() => (route.query.windowId as string) || `ai-${Date.now()}`)
const currentSessionId = ref<string>(`session-${windowId.value}`)
const userPickedSession = ref(false)

watch(windowId, (value) => {
  if (userPickedSession.value) return
  void switchSession(`session-${value}`, { loadHistory: true, updateUserPicked: false })
})

const chatShellRef = ref<InstanceType<typeof AiChatShell> | null>(null)
const scrollContainer = computed(() => chatShellRef.value?.scrollContainer ?? null)

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
  hasProviders,
  workDirDisplay,
  syncDefaultProviderSelection,
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
  modeConfigs: CHAT_MODE_CONFIG.value,
  modeSuffixes: {
    normal: '',
    plan: '\n\n[Mode: Plan]\nAnalyze first, propose a concrete implementation plan, and wait for confirmation before giving final code or execution steps.',
    auto: '\n\n[Mode: Auto]\nProvide a complete executable solution directly, including implementation details, edge cases, and practical next steps.',
    dispatcher: '',
  },
  onPersistWorkDir: saveCurrentSession,
})

const messageItems = computed(() =>
  chat.messages.value.map((message, index) => ({
    key: `${message.id}-${index}${message.isStreaming ? '-s' : ''}`,
    message,
  })),
)

let unlistenClose: (() => void) | null = null

watch(currentSessionId, (sessionId) => {
  if (sessionId) {
    setActiveSessionId(sessionId)
  }
}, { immediate: true })

watch(() => chat.workDir.value, async (dir) => {
  const appWindow = getCurrentWebviewWindow()
  if (dir) {
    const parts = dir.replace(/\\/g, '/').split('/').filter(Boolean)
    const name = parts[parts.length - 1] || t('ai.messages.title')
    await appWindow.setTitle(`${t('ai.messages.title')} - ${name}`)
    return
  }
  await appWindow.setTitle(t('ai.messages.title'))
}, { immediate: true })

onMounted(async () => {
  try {
    await store.init()
  } catch (error) {
    chat.error.value = t('ai.messages.initFailed')
    console.error('[AiStandaloneView] init failed:', error)
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
  }

  const appWindow = getCurrentWebviewWindow()
  unlistenClose = await appWindow.onCloseRequested(async () => {
    await saveCurrentSession()
  })
})

onBeforeUnmount(() => {
  unlistenClose?.()
})

async function saveCurrentSession(): Promise<void> {
  if (!currentProvider.value || !currentModel.value) return
  const messageCount = chat.messages.value.filter(message => message.role !== 'error').length
  if (messageCount === 0) return

  const session: AiSession = {
    id: currentSessionId.value,
    title: chat.messages.value.find(message => message.role === 'user')?.content?.slice(0, 30) || t('ai.messages.primaryActionStandalone'),
    providerId: currentProvider.value.id,
    model: currentModel.value.id,
    systemPrompt: systemPrompt.value,
    messageCount,
    totalTokens: chat.totalTokens.value,
    estimatedCost: 0,
    createdAt: chat.messages.value[0]?.timestamp ?? Date.now(),
    updatedAt: Date.now(),
    workDir: chat.workDir.value || undefined,
  }

  await store.saveSession(session).catch(error => {
    console.warn('[AI] failed to persist standalone session:', error)
  })
}

async function handleSend(content: string): Promise<void> {
  const attachments = fileAttachment.getReadyAttachments()
  await sendMessageNow(content, attachments, () => {
    fileAttachment.clearAttachments()
  })
}

function handleCreateSession(): void {
  const nextSessionId = `session-${windowId.value}-${Date.now()}`
  chat.clearMessages()
  chat.workDir.value = ''
  void switchSession(nextSessionId, { loadHistory: false, updateUserPicked: true })
}

async function handleSelectSession(id: string): Promise<void> {
  await switchSession(id, { loadHistory: true, updateUserPicked: true })
}

function handlePreloadSession(id: string): void {
  void chat.preloadHistory(id)
}

async function handleDeleteSession(id: string): Promise<void> {
  await store.removeSession(id)
}

async function handleNewWindow(): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core')
  try {
    await invoke('create_ai_window')
  } catch (error) {
    chat.error.value = String(error)
  }
}

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

async function switchSession(
  sessionId: string,
  options?: { loadHistory?: boolean; updateUserPicked?: boolean; resetView?: boolean },
): Promise<void> {
  if (!sessionId) return

  currentSessionId.value = sessionId
  if (options?.updateUserPicked !== undefined) {
    userPickedSession.value = options.updateUserPicked
  }
  store.setActiveSession(sessionId)

  if (options?.resetView ?? true) {
    currentView.value = 'chat'
  }

  if (options?.loadHistory) {
    await chat.loadHistory(sessionId)

    if (chat.workDir.value) {
      await memoryStore.setWorkspace(chat.workDir.value)
    }
  }
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
    :primary-action-label="t('ai.messages.primaryActionStandalone')"
    :secondary-action-label="t('ai.messages.secondaryAction')"
    :empty-description-ready="t('ai.messages.emptyDescriptionReady')"
    :empty-description-missing-provider="t('ai.messages.emptyDescriptionMissingProvider')"
    :mode-summary="null"
    :toolbar-border="true"
    background-class="bg-background"
    @update:show-session-drawer="showSessionDrawer = $event"
    @update:show-memory-drawer="showMemoryDrawer = $event"
    @update:show-file-picker="showFilePicker = $event"
    @primary-action="handleCreateSession"
    @secondary-action="handleNewWindow"
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
    @update:selected-model-id="selectedModelId = $event"
    @update:chat-mode="chatMode = $event"
    @drop-files="fileAttachment.handleDomDrop"
    @drop-file-path="handleMentionFile"
    @remove-attachment="fileAttachment.removeAttachment"
    @mention-file="handleMentionFile"
    @select-session="handleSelectSession"
    @create-session="handleCreateSession"
    @delete-session="handleDeleteSession"
    @preload-session="handlePreloadSession"
    @file-picker-confirm="handleFilePickerConfirm"
  >
    <template #after-compact>
      <div v-if="settingsStore.settings.devMode" class="mx-auto max-w-4xl px-5">
        <AiDiagnosticsPanel :metrics="chat.observability.value" />
      </div>
    </template>

    <template #empty-state-extra>
      <div v-if="hasProviders" class="mt-8 grid max-w-sm grid-cols-2 gap-2">
        <button
          class="rounded-lg border border-border/30 px-4 py-3 text-left transition-colors hover:bg-muted/30"
          @click="chatMode = 'plan'"
        >
          <Sparkles class="mb-1.5 h-4 w-4 text-violet-500" />
          <p class="text-xs font-medium">{{ t('ai.chat.planMode') }}</p>
          <p class="text-[10px] text-muted-foreground">{{ t('ai.chat.planModeDesc') }}</p>
        </button>
        <button
          class="rounded-lg border border-border/30 px-4 py-3 text-left transition-colors hover:bg-muted/30"
          @click="chatMode = 'auto'"
        >
          <Zap class="mb-1.5 h-4 w-4 text-amber-500" />
          <p class="text-xs font-medium">{{ t('ai.chat.autoMode') }}</p>
          <p class="text-[10px] text-muted-foreground">{{ t('ai.chat.autoModeDesc') }}</p>
        </button>
      </div>
    </template>
  </AiChatShell>
</template>
