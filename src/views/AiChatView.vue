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
import {
  analyzeSpawnedTasks,
  markSpawnedTaskClosed,
  markSpawnedTaskDone,
  normalizeSpawnedTask,
  resetSpawnedTaskForRetry,
  syncSpawnedTaskFromTabMeta,
  type SpawnedTask,
} from '@/composables/ai/chatSideEffects'
import { createChatTaskDispatcher } from '@/composables/ai/chatTaskDispatcher'
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

interface AiChatShellExposed {
  scrollContainer: HTMLElement | null
  focusInput?: () => void
  setInputDraft?: (value: string, options?: { append?: boolean; focus?: boolean }) => void
}

const { t } = useI18n()
const defaultChatTitle = computed(() => t('ai.messages.title'))
const newChatTitle = computed(() => t('ai.messages.primaryActionStandalone'))

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

const chatShellRef = ref<AiChatShellExposed | null>(null)
const scrollContainer = computed(() => chatShellRef.value?.scrollContainer ?? null)

const ownTabId = workspace.activeTabId
const ownTab = workspace.tabs.find(tab => tab.id === ownTabId)
const sourceTaskId = typeof ownTab?.meta?.sourceTaskId === 'string'
  ? ownTab.meta.sourceTaskId
  : null
const taskCancelRequested = computed(() => Boolean(
  sourceTaskId && workspace.tabs.find(tab => tab.id === ownTabId)?.meta?.taskCancelRequested,
))

const currentSessionId = ref<string>(
  (ownTab?.meta?.sessionId as string | undefined)
    ?? localStorage.getItem(LAST_SESSION_KEY)
    ?? `session-${crypto.randomUUID()}`,
)
const pendingSessionLoadId = ref<string | null>(null)

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

const latestAssistantSummary = computed(() => {
  for (let index = chat.messages.value.length - 1; index >= 0; index -= 1) {
    const message = chat.messages.value[index]
    if (message?.role === 'assistant' && message.content.trim()) {
      return message.content.slice(0, 120)
    }
  }
  return undefined
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
      if (pendingSessionLoadId.value === sessionId) {
        pendingSessionLoadId.value = null
        return
      }
      chat.loadHistory(sessionId).catch((error) => {
        console.warn('[AiChatView] watch loadHistory failed:', error)
      })
    }, 50)
  }
}, { immediate: true })

watch(
  () => ({
    taskStatus: sourceTaskId
      ? taskCancelRequested.value
        ? 'cancelled'
        : chat.error.value
        ? 'error'
        : chat.isStreaming.value || chat.isLoading.value
          ? 'running'
          : chat.messages.value.some(message => message.role === 'assistant' && message.content.trim())
            ? 'done'
            : 'running'
      : null,
    taskError: taskCancelRequested.value ? t('ai.tasks.taskCancelled') : chat.error.value,
    taskSummary: latestAssistantSummary.value,
  }),
  ({ taskStatus, taskError, taskSummary }) => {
    if (!sourceTaskId || !taskStatus) return
    workspace.updateTabMeta(ownTabId, {
      taskStatus,
      taskError: taskError ?? undefined,
      taskSummary: taskSummary ?? undefined,
    })
  },
  { deep: true },
)

watch(taskCancelRequested, (cancelRequested) => {
  if (!sourceTaskId || !cancelRequested) return

  if (chat.isStreaming.value || chat.isLoading.value) {
    void chat.abort()
  }

  workspace.updateTabMeta(ownTabId, {
    taskStatus: 'cancelled',
    taskError: t('ai.tasks.taskCancelled'),
    taskSummary: latestAssistantSummary.value ?? undefined,
  })
}, { immediate: true })

watch(
  () => workspace.tabs.map(tab => ({
    id: tab.id,
    sessionId: tab.meta?.sessionId,
    taskStatus: tab.meta?.taskStatus,
    taskError: tab.meta?.taskError,
    taskSummary: tab.meta?.taskSummary,
  })),
  (taskTabs) => {
    for (const task of chat.spawnedTasks.value) {
      if (task.status !== 'running' || !task.taskTabId) continue

      const index = chat.spawnedTasks.value.findIndex(item => item.id === task.id)
      if (index === -1) continue

      const tab = taskTabs.find(item => item.id === task.taskTabId)
      if (!tab) {
        chat.spawnedTasks.value[index] = markSpawnedTaskClosed(task, t('ai.tasks.taskClosed'))
        const waiter = tabTaskWaiters.get(task.id)
        if (waiter) {
          waiter({
            status: 'error',
            error: t('ai.tasks.taskClosed'),
            summary: task.lastSummary,
            sessionId: task.taskSessionId,
            taskTabId: task.taskTabId,
            startedAt: task.startedAt ?? Date.now(),
            finishedAt: Date.now(),
          })
          tabTaskWaiters.delete(task.id)
        }
        continue
      }

      chat.spawnedTasks.value[index] = syncSpawnedTaskFromTabMeta(task, {
        taskStatus: tab.taskStatus,
        taskError: tab.taskError || t('ai.tasks.taskFailed'),
        taskSummary: tab.taskSummary,
      })

      if (tab.taskStatus === 'done' || tab.taskStatus === 'error' || tab.taskStatus === 'cancelled') {
        const waiter = tabTaskWaiters.get(task.id)
        if (waiter) {
          waiter({
            status: tab.taskStatus,
            error: typeof tab.taskError === 'string' ? tab.taskError : undefined,
            summary: typeof tab.taskSummary === 'string' ? tab.taskSummary : undefined,
            sessionId: typeof tab.sessionId === 'string' ? tab.sessionId : task.taskSessionId,
            taskTabId: tab.id,
            startedAt: task.startedAt ?? Date.now(),
            finishedAt: Date.now(),
          })
          tabTaskWaiters.delete(task.id)
        }
      }
    }
  },
  { deep: true, immediate: true },
)

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
    chat.error.value = t('ai.messages.initFailed')
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
const headlessCancelledTaskIds = new Set<string>()
const tabTaskWaiters = new Map<string, (result: {
  status: 'done' | 'error' | 'cancelled'
  summary?: string
  error?: string
  sessionId?: string
  taskTabId?: string
  startedAt: number
  finishedAt: number
}) => void>()

function getDispatcherMaxParallel(): number {
  return Math.max(1, store.currentWorkspaceConfig?.dispatcherMaxParallel ?? 3)
}

function getDispatcherAutoRetryCount(): number {
  return Math.max(0, store.currentWorkspaceConfig?.dispatcherAutoRetryCount ?? 1)
}

function getDispatcherDefaultMode(): 'headless' | 'tab' {
  return store.currentWorkspaceConfig?.dispatcherDefaultMode ?? 'headless'
}

function appendDispatcherNotice(kind: 'warn' | 'error' | 'info', text: string): void {
  chat.messages.value.push({
    id: `dispatcher-notice-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    role: 'system',
    content: '',
    timestamp: Date.now(),
    notice: { kind, text },
  })
}

async function runHeadlessSpawnedTask(task: SpawnedTask): Promise<{
  status: 'done' | 'error' | 'cancelled'
  summary?: string
  error?: string
  sessionId?: string
  startedAt: number
  finishedAt: number
  retryable?: boolean
}> {
  const startedAt = Date.now()
  const taskSessionId = task.taskSessionId ?? `session-headless-${task.id}-${startedAt}`
  const summary = `[Headless V1 placeholder] ${task.description}`

  if (headlessCancelledTaskIds.has(task.id)) {
    return {
      status: 'cancelled',
      error: t('ai.tasks.taskCancelled'),
      sessionId: taskSessionId,
      startedAt,
      finishedAt: Date.now(),
    }
  }

  return {
    status: 'done',
    summary,
    sessionId: taskSessionId,
    startedAt,
    finishedAt: Date.now(),
  }
}

const taskDispatcher = createChatTaskDispatcher({
  getTasks: () => chat.spawnedTasks.value,
  setTasks: (tasks) => {
    chat.spawnedTasks.value = tasks
  },
  maxParallel: getDispatcherMaxParallel,
  autoRetryCount: getDispatcherAutoRetryCount,
  defaultExecutionMode: getDispatcherDefaultMode,
  executors: {
    headless: {
      mode: 'headless',
      prepare: (task) => ({
        taskSessionId: task.taskSessionId ?? `session-headless-${task.id}-${Date.now()}`,
      }),
      run: runHeadlessSpawnedTask,
      cancel: (task) => {
        headlessCancelledTaskIds.add(task.id)
      },
    },
    tab: {
      mode: 'tab',
      prepare: (task) => ({
        taskTabId: task.taskTabId ?? `ai-task-${task.id}-${Date.now()}`,
        taskSessionId: task.taskSessionId ?? `session-task-${task.id}-${Date.now()}`,
      }),
      run: async (task) => new Promise((resolve) => {
        tabTaskWaiters.set(task.id, resolve)
      }),
      cancel: (task) => {
        if (task.taskTabId) {
          workspace.updateTabMeta(task.taskTabId, {
            taskCancelRequested: true,
            taskStatus: 'cancelled',
            taskError: t('ai.tasks.taskCancelled'),
            taskSummary: task.lastSummary,
          })
        }
      },
    },
  },
  onEvent: (event) => {
    if (event.type === 'blocked') {
      appendDispatcherNotice('warn', event.message)
      return
    }
    if (event.type === 'failed') {
      appendDispatcherNotice('error', event.message)
      return
    }
    appendDispatcherNotice('info', event.message)
  },
})

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
  const beforeTaskIds = new Set(chat.spawnedTasks.value.map(task => task.id))
  await sendMessageNow(content, attachments, (cleanContent) => {
    const tab = workspace.tabs.find(candidate => candidate.id === ownTabId)
    if (!tab) return
    if (!isDefaultAiTabTitle(tab.title)) return
    if (!cleanContent.trim()) return

    const meaningful = cleanContent.trim().replace(/^[A-Za-z]:\\[^\s]*/g, '').trim() || cleanContent.trim()
    const shortTitle = meaningful.replace(/\s+/g, ' ').slice(0, 12)
    workspace.updateTabTitle(tab.id, shortTitle)
  })
  const nextTasks = chat.spawnedTasks.value.map(task => normalizeSpawnedTask(task, {
    executionMode: getDispatcherDefaultMode(),
    autoRetryBudget: getDispatcherAutoRetryCount(),
  }))
  chat.spawnedTasks.value = nextTasks
  const newTasks = nextTasks.filter(task => !beforeTaskIds.has(task.id))
  if (newTasks.length > 0) {
    taskDispatcher.enqueue(newTasks)
    await taskDispatcher.drain()
  } else {
    taskDispatcher.syncTasks(nextTasks)
  }
}

async function handlePlanApprove(): Promise<void> {
  if (!currentProvider.value || !currentModel.value) return

  const apiKey = await getCredential(`ai-provider-${currentProvider.value.id}`) ?? ''
  if (!apiKey) {
    chat.error.value = t('ai.messages.apiKeyNotConfigured')
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
  const task = chat.spawnedTasks.value.find(item => item.id === taskId)
  if (!task) return
  if ((task.executionMode ?? getDispatcherDefaultMode()) === 'tab') {
    const tabId = task.taskTabId ?? `ai-task-${task.id}-${Date.now()}`
    const taskSessionId = task.taskSessionId ?? `session-task-${task.id}-${Date.now()}`
    workspace.addTab({
      id: tabId,
      type: 'ai-chat',
      title: `[Task] ${task.description.slice(0, 20)}`,
      closable: true,
      meta: {
        sessionId: taskSessionId,
        initialMessage: task.description,
        sourceTaskId: task.id,
        taskExecutionMode: 'tab',
        taskAutoStarted: true,
      },
    })
  }
  void taskDispatcher.runTask(taskId, { startedByDispatcher: false })
}

async function handleSpawnRunBatch(taskIds: string[]): Promise<void> {
  for (const taskId of taskIds) {
    const task = chat.spawnedTasks.value.find(item => item.id === taskId)
    if (!task) continue
    if ((task.executionMode ?? getDispatcherDefaultMode()) === 'tab') {
      const tabId = task.taskTabId ?? `ai-task-${task.id}-${Date.now()}`
      const taskSessionId = task.taskSessionId ?? `session-task-${task.id}-${Date.now()}`
      workspace.addTab({
        id: tabId,
        type: 'ai-chat',
        title: `[Task] ${task.description.slice(0, 20)}`,
        closable: true,
        meta: {
          sessionId: taskSessionId,
          initialMessage: task.description,
          sourceTaskId: task.id,
          taskExecutionMode: 'tab',
          taskAutoStarted: true,
        },
      })
    }
  }
  void taskDispatcher.runReadyTasks(taskIds)
}

function handleSpawnRetry(taskId: string): void {
  const index = chat.spawnedTasks.value.findIndex(item => item.id === taskId)
  if (index === -1) return
  chat.spawnedTasks.value[index] = resetSpawnedTaskForRetry(chat.spawnedTasks.value[index]!)
  taskDispatcher.syncTasks(chat.spawnedTasks.value)
  void handleSpawnRun(taskId)
}

function handleSpawnRetryBatch(taskIds: string[]): void {
  for (const taskId of taskIds) {
    handleSpawnRetry(taskId)
  }
}

function handleSpawnOpen(taskId: string): void {
  const task = chat.spawnedTasks.value.find(item => item.id === taskId)
  if (!task?.taskTabId) return
  workspace.setActiveTab(task.taskTabId)
}

function handleSpawnComplete(taskId: string): void {
  const index = chat.spawnedTasks.value.findIndex(item => item.id === taskId)
  if (index === -1) return
  chat.spawnedTasks.value[index] = markSpawnedTaskDone(chat.spawnedTasks.value[index]!)
  taskDispatcher.syncTasks(chat.spawnedTasks.value)
}

function handleSpawnCancel(taskId: string): void {
  const index = chat.spawnedTasks.value.findIndex(item => item.id === taskId)
  if (index === -1) return

  const task = chat.spawnedTasks.value[index]!
  if (task.taskTabId) {
    workspace.updateTabMeta(task.taskTabId, {
      taskCancelRequested: true,
      taskStatus: 'cancelled',
      taskError: t('ai.tasks.taskCancelled'),
      taskSummary: task.lastSummary,
    })
  }
  void taskDispatcher.cancelTask(taskId, t('ai.tasks.taskCancelled'))
}

function handleSpawnCancelBatch(taskIds: string[]): void {
  for (const taskId of taskIds) {
    handleSpawnCancel(taskId)
  }
}

function buildSpawnedTasksSynthesisPrompt(): string {
  const analysis = analyzeSpawnedTasks(chat.spawnedTasks.value)

  const lines: string[] = [
    'Please synthesize the spawned task results into a single final answer for the parent conversation.',
    '',
    'Requirements:',
    '- Merge overlapping findings and remove repetition.',
    '- Prefer summarizing by source group so related spawned tasks stay together.',
    '- Call out unresolved gaps or failed subtasks explicitly.',
    '- If some subtasks are still running or pending, mention that clearly before giving the best partial answer.',
    '- End with a concise next-step recommendation.',
    '',
  ]

  for (const sourceGroup of analysis.sourceGroups) {
    lines.push(sourceGroup.sourceMessageId
      ? `Source Group #${sourceGroup.sourceGroupNumber} (${sourceGroup.sourceMessageId.slice(0, 8)}):`
      : 'Standalone Tasks:')
    for (const task of sourceGroup.tasks) {
      const relation = analysis.relations.get(task.id)
      lines.push(`- [${task.status}] ${task.description}`)
      if (relation?.displayDependencyDescriptions.length) {
        lines.push(`  Depends on: ${relation.displayDependencyDescriptions.join(', ')}`)
      }
      if (relation?.displayMissingDependencyIds.length) {
        lines.push(`  Missing dependencies: ${relation.displayMissingDependencyIds.join(', ')}`)
      }
      if (task.status === 'done') {
        lines.push(`  Summary: ${task.lastSummary?.trim() || 'No summary captured.'}`)
      }
      if (task.status === 'error') {
        lines.push(`  Error: ${task.lastError?.trim() || 'Unknown error.'}`)
        if (task.lastSummary?.trim()) {
          lines.push(`  Partial summary: ${task.lastSummary.trim()}`)
        }
      }
      if (task.status === 'cancelled') {
        lines.push(`  Reason: ${task.lastError?.trim() || 'Cancelled by user.'}`)
        if (task.lastSummary?.trim()) {
          lines.push(`  Partial summary: ${task.lastSummary.trim()}`)
        }
      }
      if (task.status === 'running' && task.lastSummary?.trim()) {
        lines.push(`  Latest summary: ${task.lastSummary.trim()}`)
      }
    }
    lines.push('')
  }

  return lines.join('\n').trim()
}

function handleSpawnSynthesize(): void {
  const prompt = buildSpawnedTasksSynthesisPrompt()
  chatShellRef.value?.setInputDraft?.(prompt, { focus: true })
}

function handleNewAiTab(): void {
  workspace.addTab({
    id: `ai-chat-${Date.now()}`,
    type: 'ai-chat',
    title: defaultChatTitle.value,
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
    dividerText: t('ai.messages.modelChanged', { modelLabel }),
    content: '',
    timestamp: Date.now(),
  })
}

async function handleCompact(): Promise<void> {
  if (!currentProvider.value || !currentModel.value) return

  const apiKey = await getCredential(`ai-provider-${currentProvider.value.id}`) ?? ''
  if (!apiKey) {
    chat.error.value = t('ai.messages.apiKeyNotConfigured')
    return
  }

  const compacted = await chat.manualCompact(currentProvider.value, currentModel.value, apiKey)
  if (!compacted) {
    chat.error.value = t('ai.messages.compactionFailed')
    return
  }

  chat.scrollToBottom()
}

function handleCreateSession(): void {
  const sessionId = `session-${Date.now()}`
  const tab = workspace.tabs.find(candidate => candidate.id === ownTabId)
  if (tab) {
    workspace.updateTabMeta(tab.id, { sessionId })
    workspace.updateTabTitle(tab.id, defaultChatTitle.value)
  }
  chat.clearMessages()
  void switchSession(sessionId, { loadHistory: false })
}

async function handleSelectSession(id: string): Promise<void> {
  await switchSession(id, { persistToTab: true, loadHistory: true })
}

function handlePreloadSession(id: string): void {
  void chat.preloadHistory(id)
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
    title: newChatTitle.value,
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

function isDefaultAiTabTitle(title: string): boolean {
  return title === defaultChatTitle.value
    || title === newChatTitle.value
    || title === 'AI Chat'
    || title === 'AI 对话'
    || title === 'New Chat'
    || title === '新建对话'
}

async function switchSession(
  sessionId: string,
  options?: { persistToTab?: boolean; loadHistory?: boolean; resetView?: boolean },
): Promise<void> {
  if (!sessionId) return

  if (options?.persistToTab) {
    const tab = workspace.tabs.find(candidate => candidate.id === ownTabId)
    if (tab) {
      workspace.updateTabMeta(tab.id, { sessionId })
    }
  }

  currentSessionId.value = sessionId
  store.setActiveSession(sessionId)

  if (options?.resetView ?? true) {
    currentView.value = 'chat'
  }

  if (options?.loadHistory) {
    pendingSessionLoadId.value = sessionId
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
    :history-remaining-records="chat.historyRemainingRecords.value"
    :history-load-more-pending="chat.historyLoadMorePending.value"
    :history-load-more-error="chat.historyLoadMoreError.value"
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
    @preload-session="handlePreloadSession"
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
          @run-batch="handleSpawnRunBatch"
          @retry="handleSpawnRetry"
          @retry-batch="handleSpawnRetryBatch"
          @open="handleSpawnOpen"
          @complete="handleSpawnComplete"
          @cancel="handleSpawnCancel"
          @cancel-batch="handleSpawnCancelBatch"
          @synthesize="handleSpawnSynthesize"
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
            {{ t('ai.messages.attachedFiles', { count: fileAttachment.attachments.value.length }) }}
          </span>
          <span v-if="messageQueue.length > 0" class="ml-auto text-amber-500">
            {{ t('ai.messages.queued', { count: messageQueue.length }) }}
          </span>
        </div>
        <div
          v-if="messageQueue.length > 0"
          class="mt-1 flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-600 dark:text-amber-400"
        >
          {{ t('ai.messages.queuedMessages', { count: messageQueue.length }) }}
        </div>
      </div>
    </template>
  </AiChatShell>
</template>
