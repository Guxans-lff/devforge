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
import { useVerificationJob } from '@/composables/useVerificationJob'
import { useBackgroundJobStore } from '@/stores/background-job'
import {
  analyzeSpawnedTasks,
  normalizeSpawnedTask,
  type SpawnedTask,
} from '@/composables/ai/chatSideEffects'
import { runAiChatSessionTurn } from '@/composables/ai/chatSessionRunner'
import { createChatTaskDispatcher } from '@/composables/ai/chatTaskDispatcher'
import { setActiveSessionId, setApprovalMode } from '@/composables/useToolApproval'
import { getCredential } from '@/api/connection'
import type { TaskIsolationBackendState } from '@/api/workspace-isolation'
import type { AiMessage } from '@/types/ai'
import type { ChatMode } from '@/components/ai/AiInputArea.vue'
import { executeToolCalls as runToolCalls } from '@/composables/ai/chatToolExecution'
import { handleStreamEvent as applyStreamEvent, type AiChatStreamState } from '@/composables/ai/chatStreamEvents'
import { useAutoCompact } from '@/composables/useAutoCompact'
import { useAiChatObservability } from '@/composables/ai/useAiChatObservability'
import { collectFileOperations } from '@/ai-gui/fileChangeSummary'
import { analyzeContextBudget } from '@/composables/ai-agent/diagnostics/contextBudgetAnalyzer'
import type { WorkspaceIsolationExecutionPlanItem } from '@/ai-gui/workspaceIsolationPlan'
import {
  buildSpawnedTaskIsolationContext,
  getWorkspaceIsolationPlanForTask,
} from '@/ai-gui/spawnedTaskIsolationPlan'
import {
  buildSpawnedTaskAutoRunBlockedNotice,
  buildSpawnedTaskIsolationPrepareDecision,
  buildSpawnedTaskRuntimeConfirmMessage,
  evaluateSpawnedTaskRuntimeGate as evaluateSpawnedTaskRuntimeGateDecision,
  filterUnconfirmedSpawnedTasks,
} from '@/ai-gui/spawnedTaskRuntimeGate'
import {
  buildSpawnedTaskAutoStartSpec,
  buildSpawnedTaskCancelTabMeta,
  buildSpawnedTaskTabSpec,
  markSpawnedTaskCompleted,
  markSpawnedTaskForRetry,
  prepareSpawnedTasksForRun,
  resolveHeadlessSpawnedTaskWorkDir,
  selectReadySpawnedTasks,
  syncRunningSpawnedTaskFromTab,
} from '@/ai-gui/spawnedTaskRuntime'
import { latestVerificationJob, parseVerificationReport } from '@/ai-gui/verificationReport'
import { createWorkspaceIsolationRuntimeController } from '@/ai-gui/workspaceIsolationRuntimeController'
import {
  recordProviderSuccess,
  recordProviderTransientFailure,
  resolveRetryableFailureFallback,
} from '@/composables/ai/chatRuntimeRouting'
import { genId } from '@/composables/ai/chatHelpers'
import { createLogger } from '@/utils/logger'
import AiChatShell from '@/components/ai/AiChatShell.vue'
import AiDiagnosticsPanel from '@/components/ai/AiDiagnosticsPanel.vue'
import AiContextBudgetPanel from '@/components/ai/AiContextBudgetPanel.vue'
import AiPlanGateBar from '@/components/ai/AiPlanGateBar.vue'
import AiPlanPanel from '@/components/ai/AiPlanPanel.vue'
import AiPhaseBar from '@/components/ai/AiPhaseBar.vue'
import AiFileChangeSummaryPanel from '@/components/ai/AiFileChangeSummaryPanel.vue'
import AiMcpStatusPanel from '@/components/ai/AiMcpStatusPanel.vue'
import AiSpawnedTasksPanel from '@/components/ai/AiSpawnedTasksPanel.vue'
import AiBackgroundJobsPanel from '@/components/ai/AiBackgroundJobsPanel.vue'
import AiPatchReviewPanel from '@/components/ai/AiPatchReviewPanel.vue'
import AiWorkflowRuntimePanel from '@/components/ai/AiWorkflowRuntimePanel.vue'
import AiWorkspaceIsolationPanel from '@/components/ai/AiWorkspaceIsolationPanel.vue'
import AiProactiveTickPanel from '@/components/ai/AiProactiveTickPanel.vue'
import {
  MessageSquareText,
  Sparkles,
  Zap,
} from 'lucide-vue-next'
import type { ProviderConfig, ModelConfig, FileOperation, WorkspaceConfig } from '@/types/ai'

interface MessageGroup {
  isGroupStart: boolean
  isGroupEnd: boolean
  groupSize: number
  msg: AiMessage
}

interface AiChatShellExposed {
  scrollContainer: HTMLElement | null
  scrollToBottom?: () => void
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

type RetryFallbackReason = 'downgrade_model' | 'switch_provider'

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

const props = defineProps<{
  tabId?: string
}>()

const store = useAiChatStore()
const workspace = useWorkspaceStore()
const wsFiles = useWorkspaceFilesStore()
const memoryStore = useAiMemoryStore()
const settingsStore = useSettingsStore()
const backgroundJobStore = useBackgroundJobStore()
const fileAttachment = useFileAttachment()
const autoCompact = useAutoCompact()
const headlessObservability = useAiChatObservability()
const verificationJob = useVerificationJob()
const log = createLogger('ai.chat.view')

const currentView = ref<'chat' | 'provider-config'>('chat')
const showSessionDrawer = ref(false)
const showMemoryDrawer = ref(false)
const showFilePicker = ref(false)
const showTaskRail = ref(false)
const expandedTaskCardIds = ref<string[]>([])
const fileChangeOperations = ref<FileOperation[]>([])
const isolationConfirmedTaskIds = ref<Set<string>>(new Set())
const taskIsolationStates = ref<Record<string, TaskIsolationBackendState>>({})

const chatShellRef = ref<AiChatShellExposed | null>(null)
const scrollContainer = computed(() => chatShellRef.value?.scrollContainer ?? null)

const ownTabId = props.tabId ?? workspace.activeTabId
const ownTab = computed(() => workspace.tabs.find(tab => tab.id === ownTabId))
const isOwnTabActive = computed(() => workspace.activeTabId === ownTabId)
const sourceTaskId = typeof ownTab.value?.meta?.sourceTaskId === 'string'
  ? ownTab.value.meta.sourceTaskId
  : null
const taskCancelRequested = computed(() => Boolean(
  sourceTaskId && ownTab.value?.meta?.taskCancelRequested,
))

const currentSessionId = ref<string>(
  (ownTab.value?.meta?.sessionId as string | undefined)
    ?? localStorage.getItem(LAST_SESSION_KEY)
    ?? `session-${crypto.randomUUID()}`,
)
const pendingSessionLoadId = ref<string | null>(null)
const mountedHistoryLoaded = ref(false)
const enableChatPerfLog = import.meta.env.DEV && localStorage.getItem('devforge.ai.perf') === '1'

function canRestoreHistoryForThisTab(): boolean {
  return isOwnTabActive.value
}

async function loadHistoryForActiveTab(
  sessionId = currentSessionId.value,
  options: { clearBeforeLoad?: boolean; markMounted?: boolean } = {},
): Promise<boolean> {
  if (!sessionId || !canRestoreHistoryForThisTab()) return false

  if (options.clearBeforeLoad) {
    chat.clearMessages()
  }

  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))

  if (!canRestoreHistoryForThisTab() || currentSessionId.value !== sessionId) {
    return false
  }

  await chat.loadHistory(sessionId)
  if (options.markMounted) {
    mountedHistoryLoaded.value = true
  }
  return true
}

watch(
  () => ownTab.value?.meta?.sessionId,
  (sessionId) => {
    if (typeof sessionId === 'string' && sessionId && sessionId !== currentSessionId.value) {
      currentSessionId.value = sessionId
    }
  },
)

const chat = useAiChat({
  sessionId: currentSessionId,
  scrollContainer,
  scrollToBottom: () => chatShellRef.value?.scrollToBottom?.(),
  getVerificationReport: () => latestSessionVerificationReport.value,
  isVerificationRunning: () => verificationRunning.value,
})

const latestAssistantSummary = computed(() => {
  if (chat.isHistoryLoading.value) return undefined
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
const spawnedTaskIsolationContext = computed(() => buildSpawnedTaskIsolationContext(chat.spawnedTasks.value, {
  sessionId: 'dispatcher-panel',
  maxAgents: Math.min(4, Math.max(1, chat.spawnedTasks.value.length)),
}))

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

  // 逐行匹配避免正则在大段文本上回溯；跳过代码块内容
  const lines = trimmed.split('\n')
  const matches: string[] = []
  let inCodeBlock = false
  const lineRegex = /([A-Za-z]:[\\/][^\s`"'<>|]+|(?:src|docs|packages|apps|scripts|tests)[\\/][^\s`"'<>|]+|(?:[A-Za-z0-9_.-]+[\\/]){1,10}[A-Za-z0-9_.-]+\.[A-Za-z0-9_-]{1,8})/g
  for (const line of lines) {
    if (line.startsWith('```')) { inCodeBlock = !inCodeBlock; continue }
    if (inCodeBlock) continue
    if (line.length > 500) continue
    const lineMatches = line.match(lineRegex)
    if (lineMatches) matches.push(...lineMatches)
  }
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

const aiReferencedPaths = ref<string[]>([])
let _aiRefPathsRicHandle: number | null = null
watch(
  () => ({
    loading: chat.isHistoryLoading.value,
    msgLen: chat.messages.value.length,
    lastMsgId: chat.messages.value[chat.messages.value.length - 1]?.id,
    attachLen: fileAttachment.attachments.value.length,
  }),
  ({ loading }) => {
    if (_aiRefPathsRicHandle != null) { cancelIdleCallback(_aiRefPathsRicHandle); _aiRefPathsRicHandle = null }
    if (loading) { aiReferencedPaths.value = []; return }
    _aiRefPathsRicHandle = requestIdleCallback(() => {
      _aiRefPathsRicHandle = null
      const t0 = enableChatPerfLog ? performance.now() : 0
      const attachedPaths = fileAttachment.attachments.value.map(a => a.path)
      const latestMessagePaths = chat.messages.value.slice(-8).flatMap(m => resolveReferencedPaths(m.content))
      aiReferencedPaths.value = collectUniquePaths([...attachedPaths, ...latestMessagePaths])
      if (enableChatPerfLog) {
        const elapsed = performance.now() - t0
        if (elapsed > 2) console.warn('[perf] aiReferencedPaths:', elapsed.toFixed(1), 'ms, messages:', chat.messages.value.length)
      }
    }, { timeout: 500 })
  },
  { immediate: true },
)

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
  return (ownTab.value?.meta as Record<string, unknown> | undefined) ?? {}
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
    expandedTaskCardIds.value = []
  }

  if (summary.running > 0 || summary.blocked > 0) {
    showTaskRail.value = true
  }
}, { immediate: true })

watch(
  () => chat.spawnedTasks.value.map(task => task.id),
  (taskIds) => {
    expandedTaskCardIds.value = expandedTaskCardIds.value.filter(taskId => taskIds.includes(taskId))
    isolationConfirmedTaskIds.value = new Set(
      Array.from(isolationConfirmedTaskIds.value).filter(taskId => taskIds.includes(taskId)),
    )
    if (focusedTaskId.value && !taskIds.includes(focusedTaskId.value)) {
      workspace.updateTabMeta(ownTabId, {
        focusedTaskId: null,
        focusedTaskPaths: [],
        focusedTaskLabel: null,
      })
    }
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

function appendRoutingDivider(text: string): void {
  chat.messages.value.push({
    id: `divider-route-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    role: 'system',
    type: 'divider',
    dividerText: text,
    content: '',
    timestamp: Date.now(),
  })
}

function syncSelectedRoute(provider: ProviderConfig, model: ModelConfig): void {
  selectedProviderId.value = provider.id
  selectedModelId.value = model.id
}

function trackRunnerResult(provider: ProviderConfig, result: { status: string; retryable?: boolean }): void {
  if (result.status === 'done') {
    recordProviderSuccess(provider.id)
    return
  }
  if (result.retryable) {
    recordProviderTransientFailure(provider.id)
  }
}

function appendFallbackDivider(
  provider: ProviderConfig,
  model: ModelConfig,
  reason: RetryFallbackReason,
): void {
  appendRoutingDivider(t(
    reason === 'downgrade_model'
      ? 'ai.messages.autoDowngradedModel'
      : 'ai.messages.autoSwitchedProvider',
    {
      providerLabel: provider.name,
      modelLabel: model.name,
    },
  ))
}

function recordRoutingEvent(reason: RetryFallbackReason | 'provider_circuit_open'): void {
  chat.recordRuntimeRouting?.(reason)
}

function toggleTaskRail(): void {
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

const contextBudgetReport = computed(() => {
  const maxContext = currentModel.value?.capabilities.maxContext ?? 0
  const compactSummary = chat.messages.value.find(message => message.type === 'compact-boundary')?.content

  return analyzeContextBudget({
    systemPrompt: effectiveSystemPrompt.value,
    memories: memoryStore.memories,
    messages: chat.messages.value,
    attachments: fileAttachment.attachments.value,
    maxContextTokens: maxContext,
    compactSummary,
  })
})

const touchedFilePaths = computed(() =>
  [...new Set(fileChangeOperations.value.map(operation => operation.path).filter(Boolean))],
)

const currentSessionBackgroundJobs = computed(() =>
  backgroundJobStore.jobs.filter(job => job.sessionId === currentSessionId.value),
)

const latestSessionVerificationJob = computed(() =>
  latestVerificationJob(currentSessionBackgroundJobs.value),
)

const latestSessionVerificationReport = computed(() =>
  parseVerificationReport(latestSessionVerificationJob.value?.result ?? latestSessionVerificationJob.value?.error),
)

const verificationRunning = computed(() =>
  currentSessionBackgroundJobs.value.some(job =>
    job.kind === 'verification'
    && (job.status === 'queued' || job.status === 'running' || job.status === 'cancelling'),
  ),
)

watch(
  () => latestSessionVerificationJob.value
    ? `${latestSessionVerificationJob.value.id}:${latestSessionVerificationJob.value.status}:${latestSessionVerificationJob.value.finishedAt ?? 0}`
    : '',
  () => {
    if (chat.spawnedTasks.value.length === 0) return
    chat.refreshAdvancedRuntimeContext?.()
  },
)

const runInspectorItemCount = computed(() =>
  taskRailSummary.value.total
  + fileChangeOperations.value.length
  + currentSessionBackgroundJobs.value.length
  + (contextBudgetReport.value.usagePercent > 0 ? 1 : 0),
)

const fileOperationSourceSignature = computed(() =>
  chat.messages.value
    .map(message => [
      message.id,
      message.toolCalls?.map(toolCall => `${toolCall.id}:${toolCall.name}:${toolCall.status}`).join(',') ?? '',
    ].join(':'))
    .join('|'),
)

watch(
  fileOperationSourceSignature,
  () => {
    const existing = new Map(fileChangeOperations.value.map(operation => [operation.toolCallId, operation]))
    fileChangeOperations.value = collectFileOperations(chat.messages.value).map(operation => ({
      ...operation,
      status: existing.get(operation.toolCallId)?.status ?? operation.status,
      errorMessage: existing.get(operation.toolCallId)?.errorMessage,
    }))
  },
  { immediate: true },
)

watch(currentSessionId, (sessionId) => {
  fileChangeOperations.value = []
  if (sessionId) {
    void backgroundJobStore.hydrateJobs(sessionId)
  }
}, { immediate: true })

let watchLoadTimer: ReturnType<typeof setTimeout> | null = null
watch(currentSessionId, (sessionId, oldSessionId) => {
  if (sessionId) {
    if (canRestoreHistoryForThisTab()) {
      localStorage.setItem(LAST_SESSION_KEY, sessionId)
      setActiveSessionId(sessionId)
    }
  }
  if (sessionId && oldSessionId && sessionId !== oldSessionId) {
    if (watchLoadTimer) clearTimeout(watchLoadTimer)
    watchLoadTimer = setTimeout(() => {
      watchLoadTimer = null
      if (!canRestoreHistoryForThisTab()) return
      if (pendingSessionLoadId.value === sessionId) {
        pendingSessionLoadId.value = null
        return
      }
      loadHistoryForActiveTab(sessionId).catch((error) => {
        console.warn('[AiChatView] watch loadHistory failed:', error)
      })
    }, 50)
  }
}, { immediate: true })

watch(
  () => {
    const t0 = enableChatPerfLog ? performance.now() : 0
    if (!sourceTaskId || chat.isHistoryLoading.value) return null
    const result = {
      taskStatus: taskCancelRequested.value
        ? 'cancelled'
        : chat.error.value
        ? 'error'
        : chat.isStreaming.value || chat.isLoading.value
          ? 'running'
          : chat.messages.value.some(message => message.role === 'assistant' && message.content.trim())
            ? 'done'
            : 'running',
      taskError: taskCancelRequested.value ? t('ai.tasks.taskCancelled') : chat.error.value,
      taskSummary: latestAssistantSummary.value,
    }
    if (enableChatPerfLog) {
      const elapsed = performance.now() - t0
      if (elapsed > 2) console.warn('[perf] taskStatus-source:', elapsed.toFixed(1), 'ms')
    }
    return result
  },
  (result) => {
    if (!result) return
    requestAnimationFrame(() => {
      workspace.updateTabMeta(ownTabId, {
        taskStatus: result.taskStatus,
        taskError: result.taskError ?? undefined,
        taskSummary: result.taskSummary ?? undefined,
      })
    })
  },
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

let referencedPathsTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => {
    const t0 = enableChatPerfLog ? performance.now() : 0
    const result = {
      aiReferencedPaths: aiReferencedPaths.value,
      taskReferencedPaths: taskReferencedPaths.value,
    }
    if (enableChatPerfLog) {
      const elapsed = performance.now() - t0
      if (elapsed > 2) console.warn('[perf] referencedPaths-source:', elapsed.toFixed(1), 'ms')
    }
    return result
  },
  ({ aiReferencedPaths: nextAiReferencedPaths, taskReferencedPaths: nextTaskReferencedPaths }) => {
    if (referencedPathsTimer) clearTimeout(referencedPathsTimer)
    referencedPathsTimer = setTimeout(() => {
      referencedPathsTimer = null
      workspace.updateTabMeta(ownTabId, {
        aiReferencedPaths: nextAiReferencedPaths,
        taskReferencedPaths: nextTaskReferencedPaths,
      })
    }, 200)
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
    if (chat.spawnedTasks.value.length === 0) return
    for (const task of chat.spawnedTasks.value) {
      if (task.status !== 'running' || !task.taskTabId) continue

      const index = chat.spawnedTasks.value.findIndex(item => item.id === task.id)
      if (index === -1) continue

      const tab = taskTabs.find(item => item.id === task.taskTabId)
      const result = syncRunningSpawnedTaskFromTab(task, tab, {
        taskClosed: t('ai.tasks.taskClosed'),
        taskFailed: t('ai.tasks.taskFailed'),
      })
      chat.spawnedTasks.value[index] = result.task

      if (result.completion) {
        const waiter = tabTaskWaiters.get(task.id)
        if (waiter) {
          waiter(result.completion)
          tabTaskWaiters.delete(task.id)
        }
      }
    }
  },
  { deep: true, immediate: true },
)

const groupedMessages = computed<MessageGroup[]>(() => {
  if (chat.isHistoryLoading.value) return []
  const t0 = enableChatPerfLog ? performance.now() : 0
  const result: MessageGroup[] = []
  const messages = chat.messages.value
  let index = 0

  while (index < messages.length) {
    const msg = messages[index]!
    if (msg.type === 'divider' || msg.role !== 'assistant') {
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

  if (enableChatPerfLog) {
    const elapsed = performance.now() - t0
    if (elapsed > 2) console.warn('[perf] groupedMessages:', elapsed.toFixed(1), 'ms, count:', result.length)
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

const messageItems = computed(() => {
  const t0 = enableChatPerfLog ? performance.now() : 0
  const items = groupedMessages.value.map((item, index) => ({
    key: `${item.msg.id}-${index}${item.msg.isStreaming ? '-s' : ''}`,
    message: item.msg,
    hideHeader: !item.isGroupStart,
    isGroupEnd: item.isGroupEnd,
    inGroup: item.groupSize > 1,
    stickyCompact: item.msg.id === latestUserMessageId.value,
  }))
  if (enableChatPerfLog) {
    const elapsed = performance.now() - t0
    if (elapsed > 2) console.warn('[perf] messageItems:', elapsed.toFixed(1), 'ms, count:', items.length)
  }
  return items
})

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

  if (currentSessionId.value && canRestoreHistoryForThisTab()) {
    pendingSessionLoadId.value = currentSessionId.value
    await loadHistoryForActiveTab(currentSessionId.value, { markMounted: true })
  }

  if (chat.workDir.value) {
    const wsT0 = performance.now()
    await memoryStore.setWorkspace(chat.workDir.value)
    if (enableChatPerfLog) console.warn(`[perf] onMounted: setWorkspace done: ${(performance.now() - wsT0).toFixed(1)}ms`)
    const cfgT0 = performance.now()
    await store.loadWorkspaceConfig(chat.workDir.value)
    if (enableChatPerfLog) console.warn(`[perf] onMounted: loadWorkspaceConfig done: ${(performance.now() - cfgT0).toFixed(1)}ms`)
    applyWorkspacePreferredModel(store.currentWorkspaceConfig?.preferredModel)
    syncDefaultProviderSelection()
  }

  await maybeAutoStartTaskTab()
  if (enableChatPerfLog) console.warn('[perf] onMounted: all done')
})

onActivated(async () => {
  const sessionId = currentSessionId.value
  if (!sessionId || !canRestoreHistoryForThisTab()) return

  setActiveSessionId(sessionId)
  requestAnimationFrame(() => {
    chat.scrollToBottom()
    setTimeout(() => chat.scrollToBottom(), 60)
  })

  if (chat.isStreaming.value || chat.messages.value.length > 0 || mountedHistoryLoaded.value) return

  try {
    await loadHistoryForActiveTab(sessionId, { markMounted: true })
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
  chat.messages.value = [...chat.messages.value, {
    id: `dispatcher-notice-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    role: 'system' as const,
    content: '',
    timestamp: Date.now(),
    notice: { kind, text },
  }]
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

async function evaluateSpawnedTaskRuntimeGate(tasks: SpawnedTask[]): Promise<{
  allowed: boolean
  requiresConfirmation: boolean
  message: string
}> {
  return evaluateSpawnedTaskRuntimeGateDecision({
    sessionId: currentSessionId.value,
    tasks,
    workspaceIsolation: store.currentWorkspaceConfig?.workspaceIsolation,
    verificationReport: latestSessionVerificationReport.value,
    verifying: verificationRunning.value,
    maxAgents: store.currentWorkspaceConfig?.dispatcherMaxParallel,
    resolveReferencedPaths,
  })
}

async function confirmSpawnedTaskRuntimeGate(tasks: SpawnedTask[]): Promise<boolean> {
  const unconfirmedTasks = filterUnconfirmedSpawnedTasks(tasks, isolationConfirmedTaskIds.value)
  if (unconfirmedTasks.length === 0) return true

  const gate = await evaluateSpawnedTaskRuntimeGate(unconfirmedTasks)
  if (!gate.allowed) {
    appendDispatcherNotice('warn', `隔离门禁阻止任务执行：\n${gate.message}`)
    return false
  }
  if (!gate.requiresConfirmation) return true

  const confirmed = window.confirm(buildSpawnedTaskRuntimeConfirmMessage(unconfirmedTasks, gate.message))
  if (confirmed) {
    isolationConfirmedTaskIds.value = new Set([
      ...isolationConfirmedTaskIds.value,
      ...unconfirmedTasks.map(task => task.id),
    ])
  }
  return confirmed
}

function isolationPlanForTask(task: SpawnedTask): WorkspaceIsolationExecutionPlanItem | null {
  return getWorkspaceIsolationPlanForTask(spawnedTaskIsolationContext.value, task.id)
}

function updateSpawnedTaskById(taskId: string, updater: (task: SpawnedTask) => SpawnedTask): void {
  chat.spawnedTasks.value = chat.spawnedTasks.value.map(task =>
    task.id === taskId ? updater(task) : task,
  )
  taskDispatcher.syncTasks(chat.spawnedTasks.value)
}

function updateTaskIsolationState(taskId: string, state: TaskIsolationBackendState): void {
  taskIsolationStates.value = {
    ...taskIsolationStates.value,
    [taskId]: state,
  }
}

const workspaceIsolationRuntime = createWorkspaceIsolationRuntimeController({
  confirm: message => window.confirm(message),
  getContext: buildWorkspaceIsolationRuntimeContext,
  notice: appendDispatcherNotice,
  setState: updateTaskIsolationState,
  setTaskIsolationWorkDir: (taskId, workspacePath) => {
    updateSpawnedTaskById(taskId, task => ({
      ...task,
      isolationWorkDir: workspacePath,
    }))
  },
  submitVerificationJob: (...args) => verificationJob.submitVerificationJob(...args),
})

function buildWorkspaceIsolationRuntimeContext() {
  const repoPath = activeWorkspaceRoot.value
  if (!repoPath) return null
  return {
    repoPath,
    sessionId: currentSessionId.value,
    states: taskIsolationStates.value,
    jobs: currentSessionBackgroundJobs.value,
    fallbackVerificationReport: latestSessionVerificationReport.value,
    fallbackVerifying: verificationRunning.value,
  }
}

async function prepareIsolationWorkspaceForTask(
  taskId: string,
  plan: WorkspaceIsolationExecutionPlanItem,
  options?: { prompt?: boolean },
): Promise<string | null> {
  return workspaceIsolationRuntime.prepare(taskId, plan, options)
}

async function handleIsolationPrepare(taskId: string, plan: WorkspaceIsolationExecutionPlanItem): Promise<void> {
  await prepareIsolationWorkspaceForTask(taskId, plan)
}

async function ensureIsolationWorkspaceBeforeRun(task: SpawnedTask): Promise<boolean> {
  const plan = isolationPlanForTask(task)
  const decision = buildSpawnedTaskIsolationPrepareDecision({
    task,
    plan,
    repoPath: activeWorkspaceRoot.value,
  })
  if (!decision.required) return true

  const confirmed = window.confirm(decision.confirmMessage)
  if (!confirmed) return false

  const workspacePath = await prepareIsolationWorkspaceForTask(task.id, decision.plan, { prompt: false })
  return Boolean(workspacePath)
}

async function handleIsolationDiff(taskId: string, plan: WorkspaceIsolationExecutionPlanItem): Promise<void> {
  await workspaceIsolationRuntime.run('diff', taskId, plan)
}

async function handleIsolationVerify(taskId: string, plan: WorkspaceIsolationExecutionPlanItem): Promise<void> {
  await workspaceIsolationRuntime.run('verify', taskId, plan)
}

async function handleIsolationApply(taskId: string, plan: WorkspaceIsolationExecutionPlanItem): Promise<void> {
  await workspaceIsolationRuntime.run('apply', taskId, plan)
}

async function handleIsolationCleanup(taskId: string, plan: WorkspaceIsolationExecutionPlanItem): Promise<void> {
  await workspaceIsolationRuntime.run('cleanup', taskId, plan)
}

async function tryAutoRunSpawnedTasks(taskIds?: string[]): Promise<void> {
  const runnableTasks = selectReadySpawnedTasks(taskDispatcher.snapshot(), taskIds)

  if (runnableTasks.length === 0) return

  const gate = await evaluateSpawnedTaskRuntimeGate(runnableTasks)
  if (!gate.allowed || gate.requiresConfirmation) {
    appendDispatcherNotice('warn', buildSpawnedTaskAutoRunBlockedNotice(gate.message))
    return
  }

  void taskDispatcher.runReadyTasks(runnableTasks.map(task => task.id))
}

function openTaskTab(task: SpawnedTask): {
  taskTabId: string
  taskSessionId: string
} {
  const runtime = buildSpawnedTaskTabSpec(task)
  workspace.addTab({
    id: runtime.taskTabId,
    type: 'ai-chat',
    title: runtime.title,
    closable: true,
    meta: runtime.meta,
  })
  return runtime
}

async function maybeAutoStartTaskTab(): Promise<void> {
  if (!canRestoreHistoryForThisTab()) return
  if (autoStartingTaskTab.value || chat.isStreaming.value || chat.isLoading.value) return

  const autoStart = buildSpawnedTaskAutoStartSpec(ownTab.value?.meta)

  if (!autoStart.shouldStart) return

  autoStartingTaskTab.value = true
  if (autoStart.isolationWorkDir) {
    chat.workDir.value = autoStart.isolationWorkDir
  }
  workspace.updateTabMeta(ownTabId, {
    initialMessage: undefined,
    taskAutoStarted: false,
    taskStatus: 'running',
    taskError: undefined,
    taskSummary: undefined,
  })

  try {
    await handleSend(autoStart.initialMessage)
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
  const selectedProvider = currentProvider.value
  const selectedModel = currentModel.value
  if (!selectedProvider || !selectedModel) {
    return {
      status: 'error',
      error: t('ai.messages.initFailed'),
      sessionId: taskSessionId,
      startedAt,
      finishedAt: Date.now(),
      retryable: false,
    }
  }
  let provider: ProviderConfig = selectedProvider
  let model: ModelConfig = selectedModel

  let apiKey = await getCredential(`ai-provider-${provider.id}`) ?? ''
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
  const taskWorkDir = ref(resolveHeadlessSpawnedTaskWorkDir(task, chat.workDir.value))
  const planGateEnabled = ref(false)
  const planApproved = ref(false)
  const currentPhase = ref(null)
  const toolFailureCounter = new Map<string, number>()
  const streamState = reactive<AiChatStreamState>({
    pendingTextDelta: '',
    pendingThinkingDelta: '',
    pendingToolCalls: [],
    lastFinishReason: '',
    lastErrorRetryable: undefined,
    streamingMessageId: '',
    inToolExec: false,
  })
  const abortController = new AbortController()
  headlessObservability.markSendStart()
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
    if (event.type === 'TextDelta' || event.type === 'ThinkingDelta') {
      headlessObservability.markFirstToken()
    }
    if (event.type === 'ToolCall') {
      headlessObservability.updatePendingToolQueueLength(streamState.pendingToolCalls.length + 1)
    }
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
    const runTaskTurn = () => runAiChatSessionTurn({
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
      maxToolLoops: 10,
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
      onPrepareComplete: () => headlessObservability.markPrepareComplete(),
      onRequestStart: () => headlessObservability.markRequestStart(),
      onRecovery: () => headlessObservability.markRecovery(),
      onResponseComplete: () => headlessObservability.markResponseComplete(),
      signal: abortController.signal,
      summaryMode: task.summaryMode,
    })

    let result = await runTaskTurn()
    trackRunnerResult(provider, result)
    if (result.status === 'error' && result.retryable) {
      const fallback = resolveRetryableFailureFallback(store.providers, provider, model)
      if (fallback.rerouted) {
        headlessObservability.recordRuntimeRouting(fallback.reason!)
        provider = fallback.provider
        model = fallback.model
        apiKey = await getCredential(`ai-provider-${provider.id}`) ?? ''
        if (apiKey) {
          result = await runTaskTurn()
          trackRunnerResult(provider, result)
        }
      }
    }
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
  canRunTask: async (task, context) => {
    if (!context.startedByDispatcher) return true
    if (isolationConfirmedTaskIds.value.has(task.id)) return true
    const gate = await evaluateSpawnedTaskRuntimeGate([task])
    if (gate.allowed && !gate.requiresConfirmation) return true
    appendDispatcherNotice('warn', buildSpawnedTaskAutoRunBlockedNotice(gate.message))
    return false
  },
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

async function handleSend(
  content: string,
  options?: { jsonMode?: boolean; prefixCompletion?: boolean; prefixContent?: string },
): Promise<void> {
  if (!currentProvider.value || !currentModel.value) return

  if (chat.isStreaming.value) {
    const pendingAttachments = fileAttachment.getReadyAttachments()
    fileAttachment.clearAttachments()
    messageQueue.value.push(content)
    queueAttachments.value.push(pendingAttachments)
    return
  }

  await doSend(content, fileAttachment.getReadyAttachments(), options)
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
  options?: { jsonMode?: boolean; prefixCompletion?: boolean; prefixContent?: string },
): Promise<void> {
  const beforeTaskIds = new Set(chat.spawnedTasks.value.map(task => task.id))
  const sendOutcome = await sendMessageNow(content, attachments, (cleanContent) => {
    const tab = ownTab.value
    if (!tab) return
    if (!isDefaultAiTabTitle(tab.title)) return
    if (!cleanContent.trim()) return

    const meaningful = cleanContent.trim().replace(/^[A-Za-z]:\\[^\s]*/g, '').trim() || cleanContent.trim()
    const shortTitle = meaningful.replace(/\s+/g, ' ').slice(0, 12)
    workspace.updateTabTitle(tab.id, shortTitle)
  }, {
    responseFormat: options?.jsonMode ? 'json_object' : undefined,
    prefixCompletion: options?.prefixCompletion,
    prefixContent: options?.prefixContent,
  })
  if (!sendOutcome) return

  if (sendOutcome.route.rerouted) {
    recordRoutingEvent('provider_circuit_open')
    syncSelectedRoute(sendOutcome.route.provider, sendOutcome.route.model)
    appendRoutingDivider(t('ai.messages.providerRerouted', {
      providerLabel: sendOutcome.route.provider.name,
      modelLabel: sendOutcome.route.model.name,
    }))
  }

  const primaryResult = sendOutcome.result
  if (primaryResult) {
    trackRunnerResult(sendOutcome.route.provider, primaryResult)
  }

  if (
    primaryResult?.status === 'error'
    && primaryResult.retryable
  ) {
    const fallback = resolveRetryableFailureFallback(
      store.providers,
      sendOutcome.route.provider,
      sendOutcome.route.model,
    )
    if (fallback.rerouted) {
      recordRoutingEvent(fallback.reason!)
      syncSelectedRoute(fallback.provider, fallback.model)
      appendFallbackDivider(fallback.provider, fallback.model, fallback.reason!)
      const apiKey = await getCredential(`ai-provider-${fallback.provider.id}`) ?? ''
      if (apiKey) {
        const retryResult = await chat.regenerate(
          fallback.provider,
          fallback.model,
          apiKey,
          effectiveSystemPrompt.value,
        )
        if (retryResult) {
          trackRunnerResult(fallback.provider, retryResult)
        }
      }
    }
  }

  const nextTasks = chat.spawnedTasks.value.map(task => normalizeSpawnedTask(task, {
    executionMode: getDispatcherDefaultMode(),
    autoRetryBudget: getDispatcherAutoRetryCount(),
  }))
  chat.spawnedTasks.value = nextTasks
  const newTasks = nextTasks.filter(task => !beforeTaskIds.has(task.id))
  if (newTasks.length > 0) {
    taskDispatcher.enqueue(newTasks)
    void tryAutoRunSpawnedTasks(newTasks.map(task => task.id))
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
  setApprovalMode('ask', currentSessionId.value)
  await chat.send(
    '【用户已确认执行计划】请继续按已批准的步骤执行，必要时可以调用工具。',
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
  if (!await confirmSpawnedTaskRuntimeGate([task])) return
  if (!await ensureIsolationWorkspaceBeforeRun(task)) return
  void taskDispatcher.runTask(taskId, { startedByDispatcher: false })
}

async function handleSpawnRunBatch(taskIds: string[]): Promise<void> {
  const runnableTasks = selectReadySpawnedTasks(taskDispatcher.snapshot(), taskIds)

  if (runnableTasks.length === 0) return
  if (!await confirmSpawnedTaskRuntimeGate(runnableTasks)) return
  const preparedTaskIds = await prepareSpawnedTasksForRun(runnableTasks, ensureIsolationWorkspaceBeforeRun)
  if (preparedTaskIds.length === 0) return
  void taskDispatcher.runReadyTasks(preparedTaskIds)
}

function handleSpawnRetry(taskId: string): void {
  const result = markSpawnedTaskForRetry(chat.spawnedTasks.value, taskId)
  if (!result.task) return
  chat.spawnedTasks.value = result.tasks
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
  const result = markSpawnedTaskCompleted(chat.spawnedTasks.value, taskId)
  if (!result.task) return
  chat.spawnedTasks.value = result.tasks
  taskDispatcher.syncTasks(chat.spawnedTasks.value)
}

function handleSpawnCancel(taskId: string): void {
  const task = chat.spawnedTasks.value.find(item => item.id === taskId)
  if (!task) return
  const cancelMessage = t('ai.tasks.taskCancelled')
  if (task.taskTabId) {
    workspace.updateTabMeta(task.taskTabId, buildSpawnedTaskCancelTabMeta(task, cancelMessage))
  }
  void taskDispatcher.cancelTask(taskId, cancelMessage)
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

async function handleRunPatchVerification(commands: string[]): Promise<void> {
  const sessionId = currentSessionId.value
  const workDir = chat.workDir.value
  if (!sessionId || !workDir || commands.length === 0) return

  await verificationJob.submitVerificationJob(
    sessionId,
    workDir,
    commands.map(command => ({ command, timeoutSeconds: 180 })),
  )
}

function handleInsertWorkflowPrompt(prompt: string): void {
  chatShellRef.value?.setInputDraft?.(prompt, { append: true, focus: true })
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
  chat.messages.value = [...chat.messages.value, {
    id: `divider-${Date.now()}`,
    role: 'system' as const,
    type: 'divider' as const,
    dividerText: t('ai.messages.modelChanged', { modelLabel }),
    content: '',
    timestamp: Date.now(),
  }]
}

function handleClearToolResults(): void {
  chat.messages.value = chat.messages.value.map(message =>
    message.toolResults?.length
      ? { ...message, toolResults: [] }
      : message,
  )
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
  const tab = ownTab.value
  if (tab) {
    workspace.updateTabMeta(tab.id, { sessionId })
    workspace.updateTabTitle(tab.id, defaultChatTitle.value)
  }
  chat.clearMessages()
  void switchSession(sessionId, { loadHistory: false })
}

async function handleSelectSession(id: string): Promise<void> {
  if (!canRestoreHistoryForThisTab()) return
  await switchSession(id, { persistToTab: true, loadHistory: true })
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

function handleApplyProviderProfile(payload: {
  workspaceConfig: WorkspaceConfig
  providerConfig?: ProviderConfig
  selectedProviderId: string
  selectedModelId: string
  outputStyleId?: string
}): void {
  selectedProviderId.value = payload.selectedProviderId
  selectedModelId.value = payload.selectedModelId
  chat.planGateEnabled.value = payload.workspaceConfig.planGateEnabled === true
  currentView.value = 'chat'
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
    syncDefaultProviderSelection()
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
    const tab = ownTab.value
    if (tab) {
      workspace.updateTabMeta(tab.id, { sessionId })
    }
  }

  if (options?.loadHistory) {
    pendingSessionLoadId.value = sessionId
    chat.clearMessages()
  }

  currentSessionId.value = sessionId
  store.setActiveSession(sessionId)

  if (options?.resetView ?? true) {
    currentView.value = 'chat'
  }

  if (options?.loadHistory) {
    const loaded = await loadHistoryForActiveTab(sessionId)

    if (loaded && chat.workDir.value) {
      await memoryStore.setWorkspace(chat.workDir.value)
    }
  }
}

async function handleForkMessage(messageId: string): Promise<void> {
  const index = chat.messages.value.findIndex(message => message.id === messageId)
  if (index < 0) return

  const nextMessages = chat.messages.value
    .slice(0, index + 1)
    .map(message => ({
      ...message,
      id: genId(),
      isStreaming: false,
    }))
  const nextSessionId = `session-${crypto.randomUUID()}`
  chat.clearMessages()
  chat.messages.value = nextMessages
  await switchSession(nextSessionId, { persistToTab: true, loadHistory: false })
}

function handleRewindMessage(messageId: string): void {
  const index = chat.messages.value.findIndex(message => message.id === messageId)
  if (index < 0) return
  chat.messages.value = chat.messages.value
    .slice(0, index + 1)
    .map(message => ({
      ...message,
      isStreaming: false,
    }))
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
    :show-side-rail-toggle="true"
    :side-rail-open="showTaskRail"
    :side-rail-count="taskRailSummary.total"
    side-rail-label="后台任务"
    @update:show-session-drawer="showSessionDrawer = $event"
    @update:show-memory-drawer="showMemoryDrawer = $event"
    @update:show-file-picker="showFilePicker = $event"
    @primary-action="handleNewAiTab"
    @secondary-action="handleNewAiWindow"
    @open-config="openProviderConfig"
    @close-config="currentView = 'chat'"
    @apply-provider-profile="handleApplyProviderProfile"
    @select-work-dir="handleSelectWorkDir"
    @set-work-dir="setWorkDir($event)"
    @continue="handleContinue"
    @bump-max-output="handleBumpMaxOutput"
    @load-more-history="chat.loadMoreHistory"
    @scroll-messages="chat.handleScroll"
    @fork-message="handleForkMessage"
    @rewind-message="handleRewindMessage"
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
        <AiDiagnosticsPanel
          :metrics="chat.observability.value"
          :runtime-snapshot="chat.runtimeSnapshot.value"
          :agent-runtime-context="chat.latestAgentRuntimeContextEvent.value"
          :agent-runtime-governance="chat.agentRuntimeGovernance.value"
        />
      </div>

      <div v-if="chat.currentPhase.value" class="mx-auto max-w-4xl px-5">
        <AiPhaseBar
          :current="chat.currentPhase.value.current"
          :total="chat.currentPhase.value.total"
          :label="chat.currentPhase.value.label"
          :is-streaming="chat.isStreaming.value"
        />
      </div>

      <div v-if="chat.awaitingPlanApproval.value" class="mx-auto w-full max-w-6xl px-6 pb-4">
        <AiPlanGateBar
          :plan="chat.pendingPlan.value"
          @approve="handlePlanApprove"
          @reject="handlePlanReject"
        />
      </div>

    </template>

    <template #side-rail>
      <div data-ui="task-rail" class="run-inspector flex h-full flex-col bg-[linear-gradient(180deg,#111116,#0d0d11)]">
        <div class="run-inspector-head flex h-[54px] items-center justify-between border-b border-white/[0.09] bg-[linear-gradient(180deg,rgba(244,244,245,0.04),transparent)] px-3">
          <div class="grid gap-1">
            <p class="font-mono text-[10px] font-bold uppercase leading-none tracking-[0.14em] text-muted-foreground/55">
              运行检查器
            </p>
            <h3 class="text-[15px] font-semibold tracking-[-0.03em] text-foreground/92">运行与验证</h3>
          </div>
          <button
            type="button"
            class="grid h-7 w-7 place-items-center rounded-[9px] border border-white/[0.09] bg-[#0c0c10] text-[16px] leading-none text-muted-foreground transition-colors hover:border-white/[0.18] hover:text-foreground"
            aria-label="关闭运行检查器"
            @click="toggleTaskRail"
          >
            ×
          </button>
        </div>

        <div class="flex-1 overflow-auto p-3">
          <div class="mb-3 grid grid-cols-3 gap-2">
            <div class="rounded-xl border border-white/[0.08] bg-white/[0.025] px-2.5 py-2">
              <span class="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/45">工具</span>
              <b class="block font-mono text-[15px] text-foreground/90">{{ runInspectorItemCount }}</b>
            </div>
            <div class="rounded-xl border border-white/[0.08] bg-white/[0.025] px-2.5 py-2">
              <span class="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/45">文件</span>
              <b class="block font-mono text-[15px] text-foreground/90">{{ fileChangeOperations.length }}</b>
            </div>
            <div class="rounded-xl border border-white/[0.08] bg-white/[0.025] px-2.5 py-2">
              <span class="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/45">任务</span>
              <b class="block font-mono text-[15px] text-foreground/90">{{ currentSessionBackgroundJobs.length }}</b>
            </div>
          </div>

          <div class="space-y-3">
            <section class="run-inspector-card">
              <AiMcpStatusPanel
                :model="currentModel"
                :work-dir="chat.workDir.value"
              />
            </section>

            <section class="run-inspector-card">
              <AiContextBudgetPanel
                :report="contextBudgetReport"
                @compact="handleCompact"
                @clear-attachments="fileAttachment.clearAttachments"
                @clear-tool-results="handleClearToolResults"
              />
            </section>

            <section class="run-inspector-card">
              <AiFileChangeSummaryPanel
                v-model:operations="fileChangeOperations"
                :session-id="currentSessionId"
              />
              <div
                v-if="fileChangeOperations.length === 0"
                class="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] px-3 py-4 text-center"
              >
                <p class="text-xs font-medium text-foreground/76">暂无文件变更</p>
                <p class="mt-1 text-[11px] text-muted-foreground/55">AI 写入或编辑文件后会在这里汇总。</p>
              </div>
            </section>

            <section class="run-inspector-card">
              <AiPatchReviewPanel
                :work-dir="chat.workDir.value"
                :jobs="currentSessionBackgroundJobs"
                :verifying="verificationRunning"
                @verify="handleRunPatchVerification"
              />
            </section>

            <section class="run-inspector-card">
              <AiWorkflowRuntimePanel
                :jobs="currentSessionBackgroundJobs"
                @insert-prompt="handleInsertWorkflowPrompt"
                @verify="handleRunPatchVerification"
              />
            </section>

            <section class="run-inspector-card">
              <AiWorkspaceIsolationPanel
                :files="touchedFilePaths"
                :session-id="currentSessionId"
              />
            </section>

            <section class="run-inspector-card">
              <AiPlanPanel
                :session-id="currentSessionId"
                @approve="handlePlanApprove"
                @reject="handlePlanReject"
                @replan="handlePlanReject"
              />
            </section>

            <section class="run-inspector-card">
              <p class="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground/55">
                Spawned Tasks
              </p>
              <div v-if="chat.spawnedTasks.value.length > 0" class="space-y-3">
                <div class="rounded-xl border border-white/[0.08] bg-[#0f0f13] px-3 py-2.5">
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
                    class="cursor-pointer rounded-xl border px-3 py-2 transition-all"
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

                <div class="rounded-xl border border-white/[0.08] bg-[#0f0f13] p-2">
                  <AiSpawnedTasksPanel
                    :tasks="chat.spawnedTasks.value"
                    :workspace-root="activeWorkspaceRoot"
                    :isolation-states="taskIsolationStates"
                    @run="handleSpawnRun"
                    @run-batch="handleSpawnRunBatch"
                    @retry="handleSpawnRetry"
                    @retry-batch="handleSpawnRetryBatch"
                    @open="handleSpawnOpen"
                    @complete="handleSpawnComplete"
                    @cancel="handleSpawnCancel"
                    @cancel-batch="handleSpawnCancelBatch"
                    @synthesize="handleSpawnSynthesize"
                    @isolation-prepare="handleIsolationPrepare"
                    @isolation-diff="handleIsolationDiff"
                    @isolation-verify="handleIsolationVerify"
                    @isolation-apply="handleIsolationApply"
                    @isolation-cleanup="handleIsolationCleanup"
                  />
                </div>
              </div>

              <div v-else class="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] px-4 py-5 text-center">
                <p class="text-sm text-foreground/80">当前没有后台任务</p>
                <p class="mt-1 text-xs leading-6 text-muted-foreground/65">
                  有任务时这里再展开看，不需要一直盯着。
                </p>
              </div>
            </section>

            <section class="run-inspector-card">
              <p class="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground/55">
                后台任务
              </p>
              <AiBackgroundJobsPanel
                :jobs="currentSessionBackgroundJobs"
                @clear-completed="backgroundJobStore.clearCompleted"
                @cancel="backgroundJobStore.cancelJob"
              />
            </section>

            <section class="run-inspector-card">
              <AiProactiveTickPanel :session-id="currentSessionId" />
            </section>

            <section v-if="settingsStore.settings.devMode" class="run-inspector-card">
              <AiDiagnosticsPanel
                :metrics="chat.observability.value"
                :runtime-snapshot="chat.runtimeSnapshot.value"
                :agent-runtime-context="chat.latestAgentRuntimeContextEvent.value"
                :agent-runtime-governance="chat.agentRuntimeGovernance.value"
              />
            </section>
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

<style scoped>
.run-inspector :deep(section.mx-auto) {
  max-width: none;
  padding-left: 0;
  padding-right: 0;
}

.run-inspector :deep(*) {
  min-width: 0;
}

.run-inspector-card {
  border: 1px solid rgb(255 255 255 / 0.075);
  border-radius: 16px;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 0.035), transparent),
    rgb(10 10 13 / 0.72);
  padding: 10px;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.025);
}

.run-inspector-card :deep(.rounded-xl) {
  border-color: rgb(255 255 255 / 0.08);
}

.run-inspector-card :deep(.max-w-4xl) {
  max-width: none;
}

.run-inspector-card :deep(section.mx-auto > .rounded-xl) {
  padding: 12px;
}

.run-inspector-card :deep(section.mx-auto > .rounded-xl > .flex:first-child) {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: stretch;
  gap: 8px;
}

.run-inspector-card :deep(section.mx-auto > .rounded-xl > .flex:first-child > .flex-1) {
  width: 100%;
}

.run-inspector-card :deep(section.mx-auto > .rounded-xl > .flex:first-child button),
.run-inspector-card :deep(section.mx-auto > .rounded-xl > .flex:first-child select) {
  width: 100%;
  min-height: 30px;
  justify-content: center;
}

.run-inspector-card :deep(section.mx-auto > .rounded-xl > .flex:first-child select) {
  overflow: hidden;
  text-overflow: ellipsis;
}

.run-inspector-card :deep(section.mx-auto > .rounded-xl > .flex:first-child .text-xs.font-semibold) {
  line-height: 1.25;
}

.run-inspector-card :deep(section.mx-auto > .rounded-xl > .flex:first-child .text-\[11px\]) {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-height: 1.45;
  word-break: normal;
}

.run-inspector-card :deep(.flex.items-center.gap-2.text-\[11px\]) {
  flex-wrap: wrap;
}

.run-inspector-card :deep(.flex.items-center.gap-2.text-\[11px\] .truncate) {
  flex-basis: 100%;
}

.run-inspector-card :deep(.line-clamp-2),
.run-inspector-card :deep(.text-muted-foreground) {
  word-break: normal;
}

.run-inspector-card :deep(button.flex.w-full.items-center > .min-w-0 > .flex) {
  flex-wrap: wrap;
}

.run-inspector-card :deep(button.flex.w-full.items-center > .min-w-0 > .flex > span:first-child) {
  flex-basis: 100%;
}
</style>
