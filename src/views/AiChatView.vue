<script setup lang="ts">
/**
 * Main AI chat view.
 *
 * Keeps the immersive chat experience while delegating shared provider/model
 * and workdir state into `useAiChatViewState`.
 */
import { computed, onActivated, onMounted, reactive, ref, watch } from 'vue'
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
import { runAiChatSessionTurn } from '@/composables/ai/chatSessionRunner'
import { createChatTaskDispatcher } from '@/composables/ai/chatTaskDispatcher'
import { setActiveSessionId } from '@/composables/useToolApproval'
import { getCredential } from '@/api/connection'
import type { AiMessage } from '@/types/ai'
import type { ChatMode } from '@/components/ai/AiInputArea.vue'
import { executeToolCalls as runToolCalls } from '@/composables/ai/chatToolExecution'
import { handleStreamEvent as applyStreamEvent, type AiChatStreamState } from '@/composables/ai/chatStreamEvents'
import { useAutoCompact } from '@/composables/useAutoCompact'
import { useAiChatObservability } from '@/composables/ai/useAiChatObservability'
import { createLogger } from '@/utils/logger'
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

interface RepositoryFocusItem {
  key: string
  title: string
  note: string
  path: string
  active?: boolean
}

interface RepositoryRootFocus {
  id: string
  name: string
  path: string
  fileCount: number
  selectedCount: number
  active?: boolean
}

function normalizeWorkspacePath(path?: string | null): string {
  return (path ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
}

function trimPathToken(token: string): string {
  return token.replace(/^[`"'(\[]+|[`"')\].,;:!?]+$/g, '')
}

function collectUniquePaths(paths: Array<string | undefined | null>): string[] {
  return Array.from(new Set(
    paths
      .map(path => normalizeWorkspacePath(path))
      .filter(Boolean),
  ))
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
const autoCompact = useAutoCompact()
const headlessObservability = useAiChatObservability()
const log = createLogger('ai.chat.view')

const currentView = ref<'chat' | 'provider-config'>('chat')
const showSessionDrawer = ref(false)
const showMemoryDrawer = ref(false)
const showFilePicker = ref(false)
const showTaskRail = ref(false)
const expandedTaskCardIds = ref<string[]>([])

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

const workspaceRootPaths = computed(() =>
  wsFiles.roots.map(root => normalizeWorkspacePath(root.path)).filter(Boolean),
)

const preferredWorkspaceRoots = computed(() => {
  const roots = workspaceRootPaths.value
  const normalizedWorkDir = normalizeWorkspacePath(chat.workDir.value)
  const activeRoot = roots.find(rootPath =>
    normalizedWorkDir === rootPath || normalizedWorkDir.startsWith(`${rootPath}/`),
  )
  if (!activeRoot) return roots
  return [activeRoot, ...roots.filter(rootPath => rootPath !== activeRoot)]
})

const activeWorkspaceRoot = computed(() => preferredWorkspaceRoots.value[0] ?? '')

const ROOT_RELATIVE_PREFIXES = new Set(['src', 'docs', 'packages', 'apps', 'scripts', 'tests'])

function buildWorkspacePathCandidates(relativePath: string): string[] {
  const normalizedRelative = normalizeWorkspacePath(relativePath)
  if (!normalizedRelative) return []

  const segments = normalizedRelative.split('/').filter(Boolean)
  const firstSegment = segments[0] ?? ''
  const workDir = normalizeWorkspacePath(chat.workDir.value)
  const activeRoot = activeWorkspaceRoot.value
  const otherRoots = preferredWorkspaceRoots.value.filter(rootPath => rootPath !== activeRoot)
  const candidates: string[] = []

  const pushCandidate = (basePath?: string | null) => {
    const normalizedBase = normalizeWorkspacePath(basePath)
    if (!normalizedBase) return
    const candidate = normalizeWorkspacePath(`${normalizedBase}/${normalizedRelative}`)
    if (!candidate || candidates.includes(candidate)) return
    candidates.push(candidate)
  }

  // Top-level repo paths like src/... should resolve from the active root before sub-workdirs.
  if (ROOT_RELATIVE_PREFIXES.has(firstSegment)) {
    pushCandidate(activeRoot)
    pushCandidate(workDir)
  } else {
    pushCandidate(workDir)
    pushCandidate(activeRoot)
  }

  for (const rootPath of otherRoots) {
    pushCandidate(rootPath)
  }

  return candidates
}

function resolveReferencedPaths(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed || workspaceRootPaths.value.length === 0) return []

  const matches = trimmed.match(/([A-Za-z]:[\\/][^\s`"'<>|]+|(?:src|docs|packages|apps|scripts|tests)[\\/][^\s`"'<>|]+|(?:(?!https?:\/\/)(?:[A-Za-z0-9_.-]+[\\/])+[A-Za-z0-9_.-]+\.[A-Za-z0-9_-]{1,8}))/g) ?? []
  const referenced = new Set<string>()

  for (const rawMatch of matches) {
    const cleaned = trimPathToken(rawMatch)
    if (!cleaned) continue
    const normalized = normalizeWorkspacePath(cleaned)
    if (!normalized) continue

    if (/^[A-Za-z]:\//.test(normalized)) {
      if (workspaceRootPaths.value.some(rootPath => normalized === rootPath || normalized.startsWith(`${rootPath}/`))) {
        referenced.add(normalized)
      }
      continue
    }

    const candidates = buildWorkspacePathCandidates(normalized)
    if (candidates[0]) {
      referenced.add(candidates[0])
    }
  }

  return Array.from(referenced)
}

const aiReferencedPaths = computed(() => {
  const attachedPaths = fileAttachment.attachments.value.map(attachment => attachment.path)
  const latestMessagePaths = chat.messages.value.slice(-8).flatMap(message => resolveReferencedPaths(message.content))
  return collectUniquePaths([...attachedPaths, ...latestMessagePaths])
})

const taskReferencedPaths = computed(() => {
  const taskPaths = chat.spawnedTasks.value.flatMap(task => [
    ...resolveReferencedPaths(task.description),
    ...resolveReferencedPaths(task.resultSummary ?? ''),
    ...resolveReferencedPaths(task.lastSummary ?? ''),
    ...resolveReferencedPaths(task.lastError ?? ''),
  ])
  return collectUniquePaths(taskPaths)
})

function resolveTaskReferencedPaths(task: SpawnedTask): string[] {
  return collectUniquePaths([
    ...resolveReferencedPaths(task.description),
    ...resolveReferencedPaths(task.resultSummary ?? ''),
    ...resolveReferencedPaths(task.lastSummary ?? ''),
    ...resolveReferencedPaths(task.lastError ?? ''),
  ])
}

function formatReferencedPath(path: string): string {
  const normalized = normalizeWorkspacePath(path)
  const matchedRoot = preferredWorkspaceRoots.value.find(rootPath =>
    normalized === rootPath || normalized.startsWith(`${rootPath}/`),
  )
  if (!matchedRoot) return normalized
  const relative = normalized.slice(matchedRoot.length).replace(/^\/+/, '')
  return relative || normalized.split('/').pop() || normalized
}

function getTaskContextPaths(task: SpawnedTask): string[] {
  return resolveTaskReferencedPaths(task)
}

function getTaskContextCount(task: SpawnedTask): number {
  return getTaskContextPaths(task).length
}

function getTaskContextPreview(task: SpawnedTask): string | null {
  const firstPath = getTaskContextPaths(task)[0]
  return firstPath ? formatReferencedPath(firstPath) : null
}

function resolveWorkspaceFilePath(path: string): string | null {
  const normalized = normalizeWorkspacePath(path)
  if (!normalized) return null
  if (/^[A-Za-z]:\//.test(normalized)) return normalized
  const preferredRoot = preferredWorkspaceRoots.value[0]
  return preferredRoot ? normalizeWorkspacePath(`${preferredRoot}/${normalized}`) : null
}

const currentAiTabMeta = computed<Record<string, unknown>>(() => {
  const tab = workspace.tabs.find(candidate => candidate.id === ownTabId)
  return (tab?.meta as Record<string, unknown> | undefined) ?? {}
})

const focusedTaskId = computed(() =>
  typeof currentAiTabMeta.value.focusedTaskId === 'string'
    ? currentAiTabMeta.value.focusedTaskId
    : null,
)

function focusTaskInRepository(task: SpawnedTask): void {
  const nextFocusedTaskId = focusedTaskId.value === task.id ? null : task.id
  workspace.updateTabMeta(ownTabId, {
    focusedTaskId: nextFocusedTaskId,
    focusedTaskPaths: nextFocusedTaskId ? resolveTaskReferencedPaths(task) : [],
    focusedTaskLabel: nextFocusedTaskId ? task.description : null,
  })
}

function openFileInWorkspace(path: string): void {
  const existing = workspace.tabs.find(
    tab => tab.type === 'file-editor' && tab.meta?.absolutePath === path,
  )
  if (existing) {
    workspace.setActiveTab(existing.id)
    return
  }

  workspace.addTab({
    id: `file-editor:${path}`,
    type: 'file-editor',
    title: path.split('/').filter(Boolean).pop() ?? path,
    closable: true,
    meta: { absolutePath: path },
  })
}

function openTaskContextFile(task: SpawnedTask): void {
  const firstPath = getTaskContextPaths(task)[0]
  if (!firstPath) return
  workspace.updateTabMeta(ownTabId, {
    focusedTaskId: task.id,
    focusedTaskPaths: getTaskContextPaths(task),
    focusedTaskLabel: task.description,
  })
  openFileInWorkspace(firstPath)
}

function openRepositoryFocusItem(item: RepositoryFocusItem): void {
  const targetPath = resolveWorkspaceFilePath(item.path)
  if (!targetPath) return
  workspace.updateTabMeta(ownTabId, {
    focusedFilePaths: [targetPath],
    focusedFileLabel: item.title,
  })
  openFileInWorkspace(targetPath)
}

const repositoryRootFocus = computed<RepositoryRootFocus[]>(() =>
  wsFiles.roots.map(root => ({
    id: root.id,
    name: root.name,
    path: root.path,
    fileCount: wsFiles.flatNodes.filter(node => node.rootId === root.id && !node.isRootHeader).length,
    selectedCount: wsFiles.flatNodes.filter(node => node.rootId === root.id && wsFiles.selectedNodes.has(node.id)).length,
    active: Boolean(chat.workDir.value && root.path === chat.workDir.value),
  })),
)

const repositoryFocusItems = computed<RepositoryFocusItem[]>(() => [
    {
      key: 'ai-chat-view',
      title: 'AiChatView.vue',
      note: '主会话、任务轨与综合结果汇合。',
      path: 'src/views/AiChatView.vue',
      active: true,
    },
    {
      key: 'ai-chat-shell',
      title: 'AiChatShell.vue',
      note: '主画布、输入区与右侧窄轨外壳。',
      path: 'src/components/ai/AiChatShell.vue',
      active: true,
    },
    {
      key: 'main-layout',
      title: 'MainLayout.vue',
      note: '资源管理器和 AI 工作台骨架。',
      path: 'src/views/MainLayout.vue',
    },
    {
      key: 'files-panel',
      title: 'FilesPanel.vue',
      note: '目录树与 AI working set 入口。',
      path: 'src/components/layout/panels/FilesPanel.vue',
    },
  ])

const taskRailSummary = computed(() => ({
  total: chat.spawnedTasks.value.length,
  running: chat.spawnedTasks.value.filter(task => task.status === 'running').length,
  done: chat.spawnedTasks.value.filter(task => task.status === 'done').length,
  blocked: chat.spawnedTasks.value.filter(task => task.dispatchStatus === 'blocked').length,
}))

watch(taskRailSummary, (summary) => {
  if (summary.total === 0) {
    showTaskRail.value = false
    expandedTaskCardIds.value = []
    return
  }

  if (summary.running > 0 || summary.blocked > 0) {
    showTaskRail.value = true
  }
}, { immediate: true })

watch(
  () => chat.spawnedTasks.value.map(task => task.id),
  (taskIds) => {
    expandedTaskCardIds.value = expandedTaskCardIds.value.filter(taskId => taskIds.includes(taskId))
  },
  { deep: true },
)

const compactRuntimeLine = computed(() => {
  const parts = [
    `${repositoryRootFocus.value.length} 个目录`,
    `${repositoryFocusItems.value.length} 个当前文件`,
  ]
  if (taskRailSummary.value.running > 0) {
    parts.push(`${taskRailSummary.value.running} 个任务进行中`)
  }
  if (taskRailSummary.value.blocked > 0) {
    parts.push(`${taskRailSummary.value.blocked} 个任务等待处理`)
  }
  return parts.join('，')
})

function formatTaskMode(task: SpawnedTask): string {
  return task.executionMode === 'tab' ? '独立窗口' : '后台执行'
}

function formatTaskStatus(task: SpawnedTask): string {
  const status = task.dispatchStatus ?? task.status
  switch (status) {
    case 'running':
      return '进行中'
    case 'done':
      return '已完成'
    case 'blocked':
      return '等待中'
    case 'error':
      return '失败'
    case 'cancelled':
      return '已取消'
    case 'queued':
      return '排队中'
    case 'ready':
      return '可执行'
    default:
      return '待处理'
  }
}

function toggleTaskRail(): void {
  if (taskRailSummary.value.total === 0) return
  showTaskRail.value = !showTaskRail.value
}

function isTaskCardExpanded(taskId: string): boolean {
  return expandedTaskCardIds.value.includes(taskId)
}

function toggleTaskCard(taskId: string): void {
  expandedTaskCardIds.value = isTaskCardExpanded(taskId)
    ? expandedTaskCardIds.value.filter(id => id !== taskId)
    : [...expandedTaskCardIds.value, taskId]
}

const workspaceBarTitle = computed(() => {
  const workDir = normalizeWorkspacePath(chat.workDir.value)
  if (workDir) {
    return workDir.split('/').filter(Boolean).pop() ?? workDir
  }
  return repositoryRootFocus.value[0]?.name ?? 'Workspace'
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
  () => ({
    aiReferencedPaths: aiReferencedPaths.value,
    taskReferencedPaths: taskReferencedPaths.value,
  }),
  ({ aiReferencedPaths: nextAiReferencedPaths, taskReferencedPaths: nextTaskReferencedPaths }) => {
    workspace.updateTabMeta(ownTabId, {
      aiReferencedPaths: nextAiReferencedPaths,
      taskReferencedPaths: nextTaskReferencedPaths,
    })
  },
  { deep: true, immediate: true },
)

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

  await maybeAutoStartTaskTab()
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

  await maybeAutoStartTaskTab()
})

const messageQueue = ref<string[]>([])
const queueAttachments = ref<ReturnType<typeof fileAttachment.getReadyAttachments>[]>([])
const autoStartingTaskTab = ref(false)
const headlessTaskRuns = new Map<string, {
  sessionId: string
  abortController: AbortController
}>()
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

function formatTaskStatusLabel(status: SpawnedTask['status']): string {
  switch (status) {
    case 'pending':
      return t('ai.tasks.groups.pending')
    case 'running':
      return t('ai.tasks.groups.running')
    case 'done':
      return t('ai.tasks.groups.done')
    case 'error':
      return t('ai.tasks.groups.error')
    case 'cancelled':
      return t('ai.tasks.groups.cancelled')
    default:
      return status
  }
}

function formatDispatchStatusLabel(status: SpawnedTask['dispatchStatus']): string {
  switch (status) {
    case 'ready':
      return t('ai.tasks.dispatcher.dispatchStatuses.ready')
    case 'queued':
      return t('ai.tasks.dispatcher.dispatchStatuses.queued')
    case 'running':
      return t('ai.tasks.dispatcher.dispatchStatuses.running')
    case 'done':
      return t('ai.tasks.dispatcher.dispatchStatuses.done')
    case 'error':
      return t('ai.tasks.dispatcher.dispatchStatuses.error')
    case 'cancelled':
      return t('ai.tasks.dispatcher.dispatchStatuses.cancelled')
    case 'blocked':
      return t('ai.tasks.dispatcher.dispatchStatuses.blocked')
    default:
      return status ?? t('ai.tasks.dispatcher.dispatchStatuses.ready')
  }
}

function formatExecutionModeLabel(mode: SpawnedTask['executionMode']): string {
  return mode === 'tab'
    ? t('ai.tasks.dispatcher.executionModes.tab')
    : t('ai.tasks.dispatcher.executionModes.headless')
}

function buildDispatcherNotice(event: import('@/composables/ai/chatTaskDispatcher').DispatcherRuntimeEvent): string {
  const task = chat.spawnedTasks.value.find(item => item.id === event.taskId)
  const taskLabel = task?.description ?? event.taskId
  const executionMode = formatExecutionModeLabel(task?.executionMode ?? getDispatcherDefaultMode())

  switch (event.type) {
    case 'blocked':
      return t('ai.tasks.dispatcher.notices.blocked', { task: taskLabel })
    case 'ready':
      return t('ai.tasks.dispatcher.notices.ready', { task: taskLabel, mode: executionMode })
    case 'started':
      return t('ai.tasks.dispatcher.notices.started', { task: taskLabel, mode: executionMode })
    case 'completed':
      return t('ai.tasks.dispatcher.notices.completed', { task: taskLabel })
    case 'failed':
      return t('ai.tasks.dispatcher.notices.failed', { task: taskLabel })
    case 'cancelled':
      return t('ai.tasks.dispatcher.notices.cancelled', { task: taskLabel })
    case 'retried':
      return t('ai.tasks.dispatcher.notices.retried', { task: taskLabel })
    default:
      return event.message
  }
}

function resolveTaskTabRuntime(task: SpawnedTask): {
  taskTabId: string
  taskSessionId: string
} {
  return {
    taskTabId: task.taskTabId ?? `ai-task-${task.id}-${Date.now()}`,
    taskSessionId: task.taskSessionId ?? `session-task-${task.id}-${Date.now()}`,
  }
}

function openTaskTab(task: SpawnedTask): {
  taskTabId: string
  taskSessionId: string
} {
  const runtime = resolveTaskTabRuntime(task)
  workspace.addTab({
    id: runtime.taskTabId,
    type: 'ai-chat',
    title: `[Task] ${task.description.slice(0, 20)}`,
    closable: true,
    meta: {
      sessionId: runtime.taskSessionId,
      initialMessage: task.description,
      sourceTaskId: task.id,
      taskExecutionMode: 'tab',
      taskAutoStarted: true,
    },
  })
  return runtime
}

async function maybeAutoStartTaskTab(): Promise<void> {
  if (autoStartingTaskTab.value || chat.isStreaming.value || chat.isLoading.value) return

  const tab = workspace.tabs.find(candidate => candidate.id === ownTabId)
  const initialMessage = typeof tab?.meta?.initialMessage === 'string'
    ? tab.meta.initialMessage.trim()
    : ''
  const shouldAutoStart = tab?.meta?.taskAutoStarted === true

  if (!shouldAutoStart || !initialMessage) return

  autoStartingTaskTab.value = true
  workspace.updateTabMeta(ownTabId, {
    initialMessage: undefined,
    taskAutoStarted: false,
    taskStatus: 'running',
    taskError: undefined,
    taskSummary: undefined,
  })

  try {
    await handleSend(initialMessage)
  } finally {
    autoStartingTaskTab.value = false
  }
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
  const provider = currentProvider.value
  const model = currentModel.value
  if (!provider || !model) {
    return {
      status: 'error',
      error: t('ai.messages.initFailed'),
      sessionId: taskSessionId,
      startedAt,
      finishedAt: Date.now(),
      retryable: false,
    }
  }

  const apiKey = await getCredential(`ai-provider-${provider.id}`) ?? ''
  if (!apiKey) {
    return {
      status: 'error',
      error: t('ai.messages.apiKeyNotConfigured'),
      sessionId: taskSessionId,
      startedAt,
      finishedAt: Date.now(),
      retryable: false,
    }
  }

  const taskMessages = ref<AiMessage[]>([])
  const taskIsStreaming = ref(false)
  const taskError = ref<string | null>(null)
  const taskWorkDir = ref(chat.workDir.value)
  const planGateEnabled = ref(false)
  const planApproved = ref(false)
  const currentPhase = ref(null)
  const toolFailureCounter = new Map<string, number>()
  const streamState = reactive<AiChatStreamState>({
    pendingTextDelta: '',
    pendingThinkingDelta: '',
    pendingToolCalls: [],
    lastFinishReason: '',
    streamingMessageId: '',
    inToolExec: false,
  })
  const abortController = new AbortController()
  headlessTaskRuns.set(task.id, {
    sessionId: taskSessionId,
    abortController,
  })

  const noop = () => {}
  const updateStreamingMessage = (updater: (msg: AiMessage) => AiMessage) => {
    const messageId = streamState.streamingMessageId
    if (!messageId) return
    const index = taskMessages.value.findIndex(message => message.id === messageId)
    if (index === -1) return
    taskMessages.value[index] = updater(taskMessages.value[index]!)
  }
  const handleIncomingStreamEvent = (event: import('@/types/ai').AiStreamEvent) => {
    applyStreamEvent({
      event,
      sessionId: taskSessionId,
      log,
      streamState,
      messages: taskMessages,
      error: taskError,
      currentPhase,
      planGateEnabled,
      planApproved,
      pendingPlan: ref(''),
      awaitingPlanApproval: ref(false),
      resetWatchdog: noop,
      flushPendingDelta: noop,
      scheduleFlush: noop,
      updateStreamingMessage,
    })
  }

  try {
    const result = await runAiChatSessionTurn({
      sessionId: taskSessionId,
      content: task.description,
      provider,
      model,
      apiKey,
      systemPrompt: effectiveSystemPrompt.value,
      attachments: [],
      workDir: taskWorkDir,
      aiStore: store,
      memoryStore,
      messages: taskMessages,
      isStreaming: taskIsStreaming,
      streamState,
      error: taskError,
      planGateEnabled,
      planApproved,
      log,
      maxToolLoops: 50,
      totalTokens: () => {
        for (let i = taskMessages.value.length - 1; i >= 0; i -= 1) {
          const message = taskMessages.value[i]
          if (message?.role === 'assistant') {
            return message.totalTokens ?? message.tokens ?? 0
          }
        }
        return 0
      },
      forceCompact: autoCompact.forceCompact,
      checkAndCompact: autoCompact.checkAndCompact,
      clearWatchdog: noop,
      resetWatchdog: noop,
      flushPendingDelta: noop,
      updateStreamingMessage,
      executeToolCalls: async (toolCalls, sessionId, signal) => {
        headlessObservability.updatePendingToolQueueLength(toolCalls.length)
        const results = await runToolCalls({
          sessionId,
          workDir: taskWorkDir.value,
          toolCalls,
          toolFailureCounter,
          log,
          clearWatchdog: noop,
          setInToolExec: (value) => {
            streamState.inToolExec = value
          },
          updateStreamingMessage,
          refreshWorkspaceDirectoryForToolPath: async () => {},
          signal,
        })
        headlessObservability.recordToolRun(toolCalls, results)
        headlessObservability.updatePendingToolQueueLength(0)
        return results
      },
      parseAndWriteJournalSections: () => {},
      parseSpawnedTasks: () => {},
      onStreamEvent: handleIncomingStreamEvent,
      signal: abortController.signal,
      summaryMode: task.summaryMode,
    })
    return result
  } finally {
    headlessTaskRuns.delete(task.id)
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
        const running = headlessTaskRuns.get(task.id)
        running?.abortController.abort()
      },
    },
    tab: {
      mode: 'tab',
      prepare: (task) => openTaskTab(task),
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
    const text = buildDispatcherNotice(event)
    if (event.type === 'blocked') {
      appendDispatcherNotice('warn', text)
      return
    }
    if (event.type === 'failed') {
      appendDispatcherNotice('error', text)
      return
    }
    appendDispatcherNotice('info', text)
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
    void taskDispatcher.drain()
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
  const task = taskDispatcher.snapshot().find(item => item.id === taskId)
  if (!task) return
  if (task.dispatchStatus !== 'ready') return
  void taskDispatcher.runTask(taskId, { startedByDispatcher: false })
}

async function handleSpawnRunBatch(taskIds: string[]): Promise<void> {
  const runnableTasks = taskDispatcher.snapshot()
    .filter(task => taskIds.includes(task.id) && task.dispatchStatus === 'ready')

  if (runnableTasks.length === 0) return

  for (const taskId of runnableTasks.map(task => task.id)) {
    const task = chat.spawnedTasks.value.find(item => item.id === taskId)
    if (!task) continue
  }
  void taskDispatcher.runReadyTasks(runnableTasks.map(task => task.id))
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
    t('ai.tasks.dispatcher.synthesis.intro'),
    '',
    t('ai.tasks.dispatcher.synthesis.requirementsTitle'),
    t('ai.tasks.dispatcher.synthesis.requirementMerge'),
    t('ai.tasks.dispatcher.synthesis.requirementSourceGroup'),
    t('ai.tasks.dispatcher.synthesis.requirementDependencyTree'),
    t('ai.tasks.dispatcher.synthesis.requirementStatus'),
    t('ai.tasks.dispatcher.synthesis.requirementPartial'),
    t('ai.tasks.dispatcher.synthesis.requirementNextStep'),
    '',
  ]

  for (const sourceGroup of analysis.sourceGroups) {
    lines.push(sourceGroup.sourceMessageId
      ? t('ai.tasks.dispatcher.synthesis.sourceGroupTitle', {
          number: sourceGroup.sourceGroupNumber,
          source: sourceGroup.sourceMessageId.slice(0, 8),
        })
      : t('ai.tasks.dispatcher.synthesis.standaloneTitle'))
    for (const task of sourceGroup.tasks) {
      const relation = analysis.relations.get(task.id)
      lines.push(`- [${formatTaskStatusLabel(task.status)} | ${formatDispatchStatusLabel(task.dispatchStatus)} | ${formatExecutionModeLabel(task.executionMode)}] ${task.description}`)
      if (relation?.displayDependencyDescriptions.length) {
        lines.push(`  ${t('ai.tasks.dispatcher.synthesis.dependsOn', { tasks: relation.displayDependencyDescriptions.join(', ') })}`)
      }
      if (relation?.displayMissingDependencyIds.length) {
        lines.push(`  ${t('ai.tasks.dispatcher.synthesis.missingDependencies', { ids: relation.displayMissingDependencyIds.join(', ') })}`)
      }
      if (task.status === 'done') {
        lines.push(`  ${t('ai.tasks.dispatcher.synthesis.summary', { text: task.lastSummary?.trim() || t('ai.tasks.dispatcher.synthesis.emptySummary') })}`)
      }
      if (task.status === 'error') {
        lines.push(`  ${t('ai.tasks.dispatcher.synthesis.error', { text: task.lastError?.trim() || t('ai.tasks.dispatcher.synthesis.unknownError') })}`)
        if (task.lastSummary?.trim()) {
          lines.push(`  ${t('ai.tasks.dispatcher.synthesis.partialSummary', { text: task.lastSummary.trim() })}`)
        }
      }
      if (task.status === 'cancelled') {
        lines.push(`  ${t('ai.tasks.dispatcher.synthesis.cancelledReason', { text: task.lastError?.trim() || t('ai.tasks.dispatcher.synthesis.cancelledDefault') })}`)
        if (task.lastSummary?.trim()) {
          lines.push(`  ${t('ai.tasks.dispatcher.synthesis.partialSummary', { text: task.lastSummary.trim() })}`)
        }
      }
      if ((task.status === 'running' || task.status === 'pending') && task.lastSummary?.trim()) {
        lines.push(`  ${t('ai.tasks.dispatcher.synthesis.latestSummary', { text: task.lastSummary.trim() })}`)
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
    :repository-focus-layout="true"
    :show-side-rail-toggle="taskRailSummary.total > 0"
    :side-rail-open="showTaskRail"
    :side-rail-count="taskRailSummary.total"
    side-rail-label="后台任务"
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
    @toggle-side-rail="toggleTaskRail"
  >
    <template #empty-state>
      <div class="h-full overflow-auto">
        <div data-ui="ai-empty-state" class="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-5 sm:px-5 lg:px-6">
          <div data-ui="workspace-bar" class="rounded-3xl border border-border/30 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.12),transparent_32%),linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0))] px-4 py-4 sm:px-5">
            <div class="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div class="min-w-0">
                <p class="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground/45">
                  主工作台
                </p>
                <div class="mt-2 flex min-w-0 items-center gap-3">
                  <span class="h-2 w-2 shrink-0 rounded-full bg-primary/80" />
                  <h2 class="truncate text-xl font-semibold tracking-tight text-foreground/92">
                    {{ workspaceBarTitle }}
                  </h2>
                </div>
                <p class="mt-2 text-sm text-muted-foreground/72">
                  {{ compactRuntimeLine }}
                </p>
                <p v-if="chat.workDir.value" class="mt-2 truncate font-mono text-[11px] text-muted-foreground/58">
                  {{ chat.workDir.value }}
                </p>
                <p v-else class="mt-2 text-[11px] text-muted-foreground/58">
                  先选工作目录，再进入当前仓库上下文。
                </p>
              </div>

              <div data-ui="workspace-summary" class="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground/66">
                <span class="rounded-full border border-border/30 bg-background/60 px-2.5 py-1">
                  {{ repositoryRootFocus.length }} 个目录
                </span>
                <span class="rounded-full border border-border/30 bg-background/60 px-2.5 py-1">
                  {{ repositoryFocusItems.length }} 个当前文件
                </span>
                <span
                  v-if="taskRailSummary.running > 0"
                  class="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-amber-300"
                >
                  {{ taskRailSummary.running }} 个任务进行中
                </span>
                <span
                  v-if="taskReferencedPaths.length > 0"
                  class="rounded-full border border-sky-500/20 bg-sky-500/10 px-2.5 py-1 text-sky-300"
                >
                  {{ taskReferencedPaths.length }} 个相关文件
                </span>
              </div>
            </div>
          </div>

          <div class="grid gap-4 xl:grid-cols-[minmax(240px,0.72fr)_minmax(0,1.28fr)]">
            <section data-ui="roots-panel" class="rounded-3xl border border-border/30 bg-muted/10 px-4 py-4">
              <div class="space-y-4">
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <p class="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground/50">目录</p>
                    <h3 class="mt-2 text-base font-semibold text-foreground/90">当前仓库</h3>
                  </div>
                </div>

                <div v-if="repositoryRootFocus.length > 0" class="space-y-2.5">
                  <article
                    v-for="root in repositoryRootFocus"
                    :key="root.id"
                    class="rounded-2xl border px-3.5 py-3"
                    :class="root.active
                      ? 'border-primary/25 bg-primary/5'
                      : 'border-border/30 bg-background/60'"
                    >
                      <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                          <h4 class="truncate text-sm font-semibold text-foreground/88">{{ root.name }}</h4>
                          <p
                            v-if="root.active"
                            class="mt-1 truncate font-mono text-[11px] text-muted-foreground/62"
                          >
                            {{ root.path }}
                          </p>
                          <p
                            v-else
                            class="mt-1 text-[11px] text-muted-foreground/58"
                          >
                            {{ root.fileCount }} 项<span v-if="root.selectedCount > 0">，{{ root.selectedCount }} 项已选</span>
                          </p>
                       </div>
                       <span
                         v-if="root.active"
                         class="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-primary"
                       >
                         当前
                       </span>
                     </div>
                    <div
                      v-if="root.active"
                      class="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground/68"
                    >
                      <span>{{ root.fileCount }} 项</span>
                      <span v-if="root.selectedCount > 0">{{ root.selectedCount }} 项已选</span>
                    </div>
                  </article>
                </div>

                <div v-else class="rounded-2xl border border-dashed border-border/30 bg-background/50 px-4 py-5">
                  <p class="text-sm text-foreground/82">还没有 workspace root。</p>
                  <p class="mt-1 text-xs leading-6 text-muted-foreground/68">
                    加入仓库后，这里会直接显示目录和当前文件。
                  </p>
                </div>
              </div>
            </section>

            <section data-ui="working-files-panel" class="rounded-3xl border border-border/30 bg-muted/10 px-4 py-4">
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <p class="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground/50">当前文件</p>
                    <h3 class="mt-2 text-base font-semibold text-foreground/90">这次会直接动到的文件</h3>
                    <p v-if="latestAssistantSummary" class="mt-1 line-clamp-1 text-xs text-muted-foreground/66">
                      {{ latestAssistantSummary }}
                    </p>
                  </div>
                  <span class="rounded-full border border-border/30 bg-background/70 px-2.5 py-1 text-[10px] text-muted-foreground">
                    {{ repositoryFocusItems.length }} 个
                  </span>
                </div>

                <div class="mt-4 divide-y divide-border/20 rounded-2xl border border-border/20 bg-background/55">
                  <button
                    v-for="item in repositoryFocusItems"
                    :key="item.key"
                    type="button"
                    class="working-file-open flex w-full items-center gap-3 px-3 py-3 text-left transition-colors sm:px-4"
                    :class="item.active ? 'bg-primary/5' : 'hover:bg-muted/20'"
                    @click="openRepositoryFocusItem(item)"
                  >
                    <span
                      class="h-2 w-2 shrink-0 rounded-full"
                      :class="item.active ? 'bg-primary/80' : 'bg-muted-foreground/25'"
                    />
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center justify-between gap-3">
                        <h3 class="truncate text-sm font-medium text-foreground/88">{{ item.title }}</h3>
                        <span
                          v-if="item.active"
                          class="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-primary"
                        >
                          当前
                        </span>
                      </div>
                      <p class="mt-1 truncate text-[11px] text-muted-foreground/66">{{ item.note }}</p>
                    </div>
                    <p class="hidden max-w-[38%] truncate font-mono text-[11px] text-muted-foreground/58 2xl:block">
                      {{ item.path }}
                    </p>
                  </button>
                </div>
            </section>
          </div>
        </div>
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

    </template>

    <template #side-rail>
      <div data-ui="task-rail" class="flex h-full flex-col">
        <div class="border-b border-border/30 px-4 py-4">
          <p class="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground/50">任务</p>
          <h3 class="mt-2 text-sm font-semibold text-foreground/90">需要处理时再展开</h3>
        </div>

        <div class="flex-1 overflow-auto p-4">
          <div v-if="chat.spawnedTasks.value.length > 0" class="space-y-3">
            <div class="rounded-2xl border border-border/30 bg-muted/15 px-3 py-2.5">
              <div class="flex items-center justify-between gap-3 text-[11px] text-muted-foreground/68">
                <span>{{ taskRailSummary.running }} 进行中</span>
                <span>{{ taskRailSummary.done }} 已完成</span>
                <span>{{ taskRailSummary.blocked }} 等待中</span>
              </div>
            </div>

            <div class="space-y-1.5">
              <article
                v-for="task in chat.spawnedTasks.value.slice(0, 4)"
                :key="task.id"
                class="cursor-pointer rounded-2xl border px-3 py-2 transition-all"
                :class="focusedTaskId === task.id
                  ? 'border-orange-500/35 bg-orange-500/10 shadow-[inset_0_0_0_1px_rgba(249,115,22,0.14)]'
                  : task.status === 'running'
                    ? 'border-amber-500/18 bg-amber-500/7 hover:border-amber-500/24 hover:bg-amber-500/10'
                    : task.status === 'done'
                      ? 'border-border/20 bg-background/45 text-muted-foreground/82 hover:border-border/30 hover:bg-muted/15'
                      : 'border-border/30 bg-muted/15 hover:border-primary/25 hover:bg-primary/5'"
                @click="focusTaskInRepository(task)"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                      <span
                        class="h-1.5 w-1.5 shrink-0 rounded-full"
                        :class="task.status === 'done'
                          ? 'bg-emerald-400'
                          : task.status === 'running'
                            ? 'bg-amber-400'
                            : task.dispatchStatus === 'blocked'
                              ? 'bg-muted-foreground/45'
                              : 'bg-primary/70'"
                      />
                      <h4 class="line-clamp-1 text-sm font-medium text-foreground/85">{{ task.description }}</h4>
                      <span
                        v-if="focusedTaskId === task.id"
                        class="rounded-full border border-orange-500/20 bg-orange-500/10 px-2 py-0.5 text-[9px] uppercase tracking-[0.16em] text-orange-300"
                      >
                        当前
                      </span>
                      <button
                        type="button"
                        class="ml-auto rounded-md border border-border/20 px-1.5 py-0.5 text-[10px] text-muted-foreground/62 transition-colors hover:border-border/40 hover:bg-muted/20 hover:text-foreground"
                        @click.stop="toggleTaskCard(task.id)"
                      >
                        {{ isTaskCardExpanded(task.id) ? '收起' : '展开' }}
                      </button>
                    </div>
                    <div class="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground/62">
                      <span>{{ formatTaskMode(task) }}</span>
                      <span>{{ formatTaskStatus(task) }}</span>
                    </div>
                    <div
                      v-if="isTaskCardExpanded(task.id)"
                      class="mt-2 space-y-2 rounded-xl border border-border/20 bg-background/40 px-2.5 py-2"
                    >
                      <p
                        v-if="task.resultSummary || task.lastSummary"
                        class="line-clamp-3 text-[11px] leading-5 text-muted-foreground/72"
                      >
                        {{ task.resultSummary || task.lastSummary }}
                      </p>
                      <button
                        v-if="getTaskContextPreview(task)"
                        type="button"
                        class="task-context-open flex max-w-full items-center gap-1 truncate rounded-md border border-transparent px-1.5 py-0.5 text-left font-mono text-[11px] text-muted-foreground/58 transition-colors hover:border-sky-500/20 hover:bg-sky-500/8 hover:text-sky-300"
                        :class="focusedTaskId === task.id ? 'text-orange-200/80' : ''"
                        @click.stop="openTaskContextFile(task)"
                      >
                        <span class="truncate">{{ getTaskContextPreview(task) }}</span>
                        <span v-if="getTaskContextCount(task) > 1" class="text-muted-foreground/45">
                          +{{ getTaskContextCount(task) - 1 }}
                        </span>
                      </button>
                    </div>
                  </div>
                  <div class="flex shrink-0 items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/55">
                    <span>{{ formatTaskStatus(task) }}</span>
                  </div>
                </div>
              </article>
            </div>

            <div class="rounded-2xl border border-border/25 bg-background/55 p-2">
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
          </div>

          <div v-else class="rounded-2xl border border-dashed border-border/30 bg-muted/10 px-4 py-5 text-center">
            <p class="text-sm text-foreground/80">当前没有后台任务</p>
            <p class="mt-1 text-xs leading-6 text-muted-foreground/65">
              有任务时这里再展开看，不需要一直盯着。
            </p>
          </div>
        </div>
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
