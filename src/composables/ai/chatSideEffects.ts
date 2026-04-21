import { aiUpdateJournalSection } from '@/api/ai'
import type { Logger } from '@/utils/logger'
import { genId } from './chatHelpers'

export type SpawnedTaskStatus = 'pending' | 'running' | 'done' | 'error' | 'cancelled'
export type TaskExecutionMode = 'headless' | 'tab'
export type TaskPriority = 'high' | 'normal' | 'low'
export type TaskSummaryMode = 'brief' | 'normal'
export type TaskDispatchStatus = 'queued' | 'ready' | 'running' | 'done' | 'error' | 'cancelled' | 'blocked'

export interface SpawnedTask {
  id: string
  description: string
  status: SpawnedTaskStatus
  createdAt: number
  startedAt?: number
  finishedAt?: number
  durationMs?: number
  lastError?: string
  lastSummary?: string
  sourceMessageId?: string
  spawnAlias?: string
  dependsOn?: string[]
  executionMode?: TaskExecutionMode
  priority?: TaskPriority
  summaryMode?: TaskSummaryMode
  dispatchStatus?: TaskDispatchStatus
  autoRetryBudget?: number
  attemptCount?: number
  resultSummary?: string
  resultSessionId?: string
  startedByDispatcher?: boolean
  taskTabId?: string
  taskSessionId?: string
  retryCount: number
}

export interface SpawnedTaskRelation {
  standalone: boolean
  sourceGroupNumber?: number
  sourceTaskIndex: number
  sourceTaskCount: number
  previousTaskId?: string
  previousTaskDescription?: string
  explicitDependencyIds: string[]
  explicitDependencyDescriptions: string[]
  explicitMissingDependencyIds: string[]
  displayDependencyIds: string[]
  displayDependencyDescriptions: string[]
  displayMissingDependencyIds: string[]
}

export interface SpawnedTaskSourceGroup {
  key: string
  sourceMessageId?: string
  sourceGroupNumber?: number
  tasks: SpawnedTask[]
}

export interface SpawnedTaskAnalysis {
  relations: Map<string, SpawnedTaskRelation>
  sourceGroups: SpawnedTaskSourceGroup[]
}

export function parseAndWriteJournalSections(text: string, workDirPath: string, log: Logger): void {
  const regex = /<!-- @@@journal:(\S+) -->([\s\S]*?)<!-- @@@end:journal:\1 -->/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    const marker = match[1]!
    const content = match[2]!.trim()
    aiUpdateJournalSection(workDirPath, marker, content)
      .catch(error => log.warn('journal_write_failed', { marker }, error))
  }
}

const VALID_EXECUTION_MODES = new Set<TaskExecutionMode>(['headless', 'tab'])
const VALID_PRIORITIES = new Set<TaskPriority>(['high', 'normal', 'low'])
const VALID_SUMMARY_MODES = new Set<TaskSummaryMode>(['brief', 'normal'])

interface ParsedSpawnHeader {
  alias?: string
  dependsOn: string[]
  description: string
  executionMode?: TaskExecutionMode
  priority: TaskPriority
  summaryMode: TaskSummaryMode
}

function parseSpawnHeader(rawHeader: string, defaults?: {
  executionMode?: TaskExecutionMode
  priority?: TaskPriority
  summaryMode?: TaskSummaryMode
}): ParsedSpawnHeader {
  const trimmed = rawHeader.trim()
  const defaultExecutionMode = defaults?.executionMode ?? 'headless'
  const defaultPriority = defaults?.priority ?? 'normal'
  const defaultSummaryMode = defaults?.summaryMode ?? 'normal'
  const extendedMatch = trimmed.match(/^#([A-Za-z0-9_-]+)([^:]*):\s*(.+)$/)

  if (!extendedMatch) {
    return {
      description: trimmed,
      dependsOn: [],
      executionMode: defaultExecutionMode,
      priority: defaultPriority,
      summaryMode: defaultSummaryMode,
    }
  }

  const metadata = extendedMatch[2]?.trim() ?? ''
  const tokens = metadata.split(/\s+/).map(item => item.trim()).filter(Boolean)
  const dependsOn: string[] = []
  let executionMode: TaskExecutionMode | undefined = defaultExecutionMode
  let priority: TaskPriority = defaultPriority
  let summaryMode: TaskSummaryMode = defaultSummaryMode

  for (const token of tokens) {
    const [rawKey, rawValue] = token.split('=', 2)
    const key = rawKey?.trim().toLowerCase()
    const value = rawValue?.trim()
    if (!key || !value) continue

    if (key === 'depends') {
      dependsOn.push(...value.split(',').map(item => item.trim()).filter(Boolean))
      continue
    }
    if (key === 'mode' && VALID_EXECUTION_MODES.has(value as TaskExecutionMode)) {
      executionMode = value as TaskExecutionMode
      continue
    }
    if (key === 'priority' && VALID_PRIORITIES.has(value as TaskPriority)) {
      priority = value as TaskPriority
      continue
    }
    if (key === 'summary' && VALID_SUMMARY_MODES.has(value as TaskSummaryMode)) {
      summaryMode = value as TaskSummaryMode
    }
  }

  return {
    alias: extendedMatch[1],
    dependsOn,
    description: extendedMatch[3]!.trim(),
    executionMode,
    priority,
    summaryMode,
  }
}

export function parseSpawnedTasks(text: string, options?: {
  sourceMessageId?: string
  now?: number
  defaultExecutionMode?: TaskExecutionMode
  defaultPriority?: TaskPriority
  defaultSummaryMode?: TaskSummaryMode
  autoRetryBudget?: number
}): SpawnedTask[] {
  const regex = /\[SPAWN:([^\]]+)\]/g
  const tasks: SpawnedTask[] = []
  const createdAt = options?.now ?? Date.now()
  let match: RegExpExecArray | null
  const aliasToTaskId = new Map<string, string>()
  const parsedHeaders: Array<ParsedSpawnHeader & { id: string }> = []

  while ((match = regex.exec(text)) !== null) {
    const parsed = parseSpawnHeader(match[1]!, {
      executionMode: options?.defaultExecutionMode,
      priority: options?.defaultPriority,
      summaryMode: options?.defaultSummaryMode,
    })
    const id = genId()
    parsedHeaders.push({ ...parsed, id })
    if (parsed.alias) {
      aliasToTaskId.set(parsed.alias, id)
    }
  }

  for (const parsed of parsedHeaders) {
    const dependsOn = parsed.dependsOn.map(dependency => aliasToTaskId.get(dependency) ?? dependency)
    const task: SpawnedTask = {
      id: parsed.id,
      description: parsed.description,
      status: 'pending',
      dispatchStatus: dependsOn.length > 0 ? 'queued' : 'ready',
      createdAt,
      sourceMessageId: options?.sourceMessageId,
      spawnAlias: parsed.alias,
      dependsOn,
      executionMode: parsed.executionMode,
      priority: parsed.priority,
      summaryMode: parsed.summaryMode,
      autoRetryBudget: options?.autoRetryBudget ?? 1,
      attemptCount: 0,
      retryCount: 0,
    }
    tasks.push(task)
  }

  return tasks
}

export function normalizeSpawnedTask(
  task: SpawnedTask,
  defaults?: {
    executionMode?: TaskExecutionMode
    priority?: TaskPriority
    summaryMode?: TaskSummaryMode
    autoRetryBudget?: number
  },
): SpawnedTask {
  const statusDispatchMap: Record<Exclude<SpawnedTaskStatus, 'pending'>, TaskDispatchStatus> = {
    running: 'running',
    done: 'done',
    error: 'error',
    cancelled: 'cancelled',
  }
  const dispatchStatus = task.status === 'pending'
    ? (task.dispatchStatus ?? (task.dependsOn?.length ? 'queued' : 'ready'))
    : statusDispatchMap[task.status]

  return {
    ...task,
    dependsOn: task.dependsOn ?? [],
    executionMode: task.executionMode ?? defaults?.executionMode ?? 'headless',
    priority: task.priority ?? defaults?.priority ?? 'normal',
    summaryMode: task.summaryMode ?? defaults?.summaryMode ?? 'normal',
    dispatchStatus,
    autoRetryBudget: task.autoRetryBudget ?? defaults?.autoRetryBudget ?? 1,
    attemptCount: task.attemptCount ?? (task.status === 'running' || task.status !== 'pending' ? 1 : 0),
    resultSummary: task.resultSummary ?? task.lastSummary,
    resultSessionId: task.resultSessionId ?? task.taskSessionId,
  }
}

export function analyzeSpawnedTasks(tasks: SpawnedTask[]): SpawnedTaskAnalysis {
  const sourceGroupNumbers = new Map<string, number>()
  const groupedTasks = new Map<string, SpawnedTask[]>()
  const taskById = new Map(tasks.map(task => [task.id, task]))
  const aliasToTaskId = new Map<string, string>()

  for (const task of tasks) {
    if (task.spawnAlias) {
      aliasToTaskId.set(task.spawnAlias, task.id)
    }
    if (!task.sourceMessageId) continue

    if (!sourceGroupNumbers.has(task.sourceMessageId)) {
      sourceGroupNumbers.set(task.sourceMessageId, sourceGroupNumbers.size + 1)
    }

    const group = groupedTasks.get(task.sourceMessageId)
    if (group) {
      group.push(task)
      continue
    }

    groupedTasks.set(task.sourceMessageId, [task])
  }

  const sourceGroups: SpawnedTaskSourceGroup[] = []
  const standaloneTasks = tasks.filter(task => !task.sourceMessageId)
  if (standaloneTasks.length > 0) {
    sourceGroups.push({
      key: 'standalone',
      tasks: standaloneTasks,
    })
  }

  for (const [sourceMessageId, sourceTasks] of groupedTasks) {
    sourceGroups.push({
      key: `source:${sourceMessageId}`,
      sourceMessageId,
      sourceGroupNumber: sourceGroupNumbers.get(sourceMessageId),
      tasks: sourceTasks,
    })
  }

  const relations = new Map<string, SpawnedTaskRelation>()
  for (const task of tasks) {
    const sourceTasks = task.sourceMessageId ? groupedTasks.get(task.sourceMessageId) ?? [task] : [task]
    const sourceTaskIndex = Math.max(0, sourceTasks.findIndex(item => item.id === task.id))
    const explicitDependencyIds = task.dependsOn
      ?.map(dependency => aliasToTaskId.get(dependency) ?? dependency)
      .filter(Boolean) ?? []
    const inferredPreviousTask = sourceTaskIndex > 0 ? sourceTasks[sourceTaskIndex - 1] : undefined
    const displayDependencyIds = explicitDependencyIds.length > 0
      ? explicitDependencyIds
      : inferredPreviousTask ? [inferredPreviousTask.id] : []
    const explicitDependencyTasks = explicitDependencyIds
      .map(dependencyId => taskById.get(dependencyId))
      .filter((dependency): dependency is SpawnedTask => Boolean(dependency))
    const displayDependencyTasks = displayDependencyIds
      .map(dependencyId => taskById.get(dependencyId))
      .filter((dependency): dependency is SpawnedTask => Boolean(dependency))
    const explicitDependencyDescriptions = explicitDependencyTasks.map(dependency => dependency.description)
    const displayDependencyDescriptions = displayDependencyTasks.map(dependency => dependency.description)
    const explicitMissingDependencyIds = explicitDependencyIds.filter(dependencyId => !taskById.has(dependencyId))
    const displayMissingDependencyIds = displayDependencyIds.filter(dependencyId => !taskById.has(dependencyId))

    relations.set(task.id, {
      standalone: !task.sourceMessageId,
      sourceGroupNumber: task.sourceMessageId ? sourceGroupNumbers.get(task.sourceMessageId) : undefined,
      sourceTaskIndex: sourceTaskIndex + 1,
      sourceTaskCount: sourceTasks.length,
      previousTaskId: inferredPreviousTask?.id,
      previousTaskDescription: inferredPreviousTask?.description,
      explicitDependencyIds,
      explicitDependencyDescriptions,
      explicitMissingDependencyIds,
      displayDependencyIds,
      displayDependencyDescriptions,
      displayMissingDependencyIds,
    })
  }

  return {
    relations,
    sourceGroups,
  }
}

export function markSpawnedTaskRunning(
  task: SpawnedTask,
  options?: { now?: number; taskTabId?: string; taskSessionId?: string; startedByDispatcher?: boolean },
): SpawnedTask {
  const now = options?.now ?? Date.now()
  const normalized = normalizeSpawnedTask(task)
  return {
    ...normalized,
    status: 'running',
    dispatchStatus: 'running',
    startedAt: now,
    finishedAt: undefined,
    durationMs: undefined,
    lastError: undefined,
    taskTabId: options?.taskTabId ?? task.taskTabId,
    taskSessionId: options?.taskSessionId ?? task.taskSessionId,
    resultSessionId: options?.taskSessionId ?? task.resultSessionId ?? task.taskSessionId,
    attemptCount: task.status === 'running' ? normalized.attemptCount : (normalized.attemptCount ?? 0) + 1,
    startedByDispatcher: options?.startedByDispatcher ?? task.startedByDispatcher,
  }
}

export function markSpawnedTaskDone(task: SpawnedTask, now = Date.now()): SpawnedTask {
  const startedAt = task.startedAt ?? now
  const normalized = normalizeSpawnedTask(task)
  return {
    ...normalized,
    status: 'done',
    dispatchStatus: 'done',
    startedAt,
    finishedAt: now,
    durationMs: Math.max(0, now - startedAt),
    lastError: undefined,
    lastSummary: task.lastSummary,
    resultSummary: task.resultSummary ?? task.lastSummary,
    resultSessionId: task.resultSessionId ?? task.taskSessionId,
  }
}

export function markSpawnedTaskError(task: SpawnedTask, error: string, now = Date.now()): SpawnedTask {
  const startedAt = task.startedAt ?? now
  const normalized = normalizeSpawnedTask(task)
  return {
    ...normalized,
    status: 'error',
    dispatchStatus: 'error',
    startedAt,
    finishedAt: now,
    durationMs: Math.max(0, now - startedAt),
    lastError: error,
    lastSummary: task.lastSummary,
    resultSummary: task.resultSummary ?? task.lastSummary,
    resultSessionId: task.resultSessionId ?? task.taskSessionId,
  }
}

export function markSpawnedTaskCancelled(task: SpawnedTask, reason: string, now = Date.now()): SpawnedTask {
  const startedAt = task.startedAt ?? now
  const normalized = normalizeSpawnedTask(task)
  return {
    ...normalized,
    status: 'cancelled',
    dispatchStatus: 'cancelled',
    startedAt,
    finishedAt: now,
    durationMs: Math.max(0, now - startedAt),
    lastError: reason,
    lastSummary: task.lastSummary,
    resultSummary: task.resultSummary ?? task.lastSummary,
    resultSessionId: task.resultSessionId ?? task.taskSessionId,
  }
}

export function resetSpawnedTaskForRetry(task: SpawnedTask, now = Date.now()): SpawnedTask {
  const normalized = normalizeSpawnedTask(task)
  return {
    ...normalized,
    status: 'pending',
    dispatchStatus: task.dependsOn?.length ? 'queued' : 'ready',
    createdAt: task.createdAt || now,
    startedAt: undefined,
    finishedAt: undefined,
    durationMs: undefined,
    lastError: undefined,
    lastSummary: undefined,
    taskTabId: undefined,
    taskSessionId: undefined,
    resultSessionId: undefined,
    retryCount: task.retryCount + 1,
  }
}

export function syncSpawnedTaskFromTabMeta(
  task: SpawnedTask,
  tabMeta?: Record<string, unknown>,
): SpawnedTask {
  if (task.status !== 'running') return task
  const withSummary = tabMeta?.taskSummary
    ? { ...task, lastSummary: String(tabMeta.taskSummary) }
    : task
  const taskStatus = tabMeta?.taskStatus
  if (taskStatus === 'done') {
    return markSpawnedTaskDone({
      ...withSummary,
      resultSummary: withSummary.lastSummary,
      resultSessionId: withSummary.taskSessionId,
    })
  }
  if (taskStatus === 'error') {
    return markSpawnedTaskError(withSummary, String(tabMeta?.taskError || 'Task failed'))
  }
  if (taskStatus === 'cancelled') {
    return markSpawnedTaskCancelled(withSummary, String(tabMeta?.taskError || 'Task cancelled'))
  }
  return withSummary
}

export function markSpawnedTaskClosed(task: SpawnedTask, error: string, now = Date.now()): SpawnedTask {
  return markSpawnedTaskError(task, error, now)
}
