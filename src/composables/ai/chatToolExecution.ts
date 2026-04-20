import { aiEnforceToolResultBudget, aiExecuteTool } from '@/api/ai'
import type {
  AiMessage,
  ToolCallInfo,
  ToolExecutionClass,
  ToolExecutionMetadata,
  ToolResultInfo,
  ToolResultMetadata,
} from '@/types/ai'
import { ensureErrorString } from '@/types/error'
import type { Logger } from '@/utils/logger'
import { hashArgs, pickApprovalTool } from './chatHelpers'
import { requestApprovalForTool } from './chatToolApproval'

const MAX_SAME_TOOL_FAILURE = 3
const WEB_TOOL_CONCURRENCY = 2
const DEFAULT_TOOL_TIMEOUT_MS = 30_000
const DEFAULT_WRITE_TIMEOUT_MS = 60_000
const DEFAULT_BASH_TIMEOUT_MS = 120_000
const DEFAULT_RETRY_COUNT = 1

type ToolQueue = 'read-other' | 'web' | 'write' | 'bash'

interface IndexedToolCall {
  toolCall: ToolCallInfo
  index: number
  kind: ToolExecutionClass
  queue: ToolQueue
  lockKey: string
}

interface ToolExecutionResult {
  result: ToolResultInfo
  refreshPath?: string
}

interface RunToolAttemptResult {
  success: boolean
  content: string
  timedOut?: boolean
  cancelled?: boolean
  errorKind?: ToolExecutionMetadata['errorKind']
  metadata: ToolResultMetadata
}

export interface ExecuteToolCallsParams {
  sessionId: string
  workDir: string
  toolCalls: ToolCallInfo[]
  toolFailureCounter: Map<string, number>
  log: Logger
  clearWatchdog: () => void
  setInToolExec: (value: boolean) => void
  updateStreamingMessage: (updater: (msg: AiMessage) => AiMessage) => void
  refreshWorkspaceDirectoryForToolPath: (targetPath: string) => Promise<void>
  signal?: AbortSignal
  timeoutMsByClass?: Partial<Record<ToolExecutionClass, number>>
  retryCountByClass?: Partial<Record<ToolExecutionClass, number>>
}

function updateToolCalls(
  toolCalls: ToolCallInfo[],
  updateStreamingMessage: ExecuteToolCallsParams['updateStreamingMessage'],
): void {
  updateStreamingMessage(msg => ({ ...msg, toolCalls: [...toolCalls] }))
}

function classifyTool(name: string): ToolExecutionClass {
  if (name === 'write_file' || name === 'edit_file') return 'write'
  if (name === 'bash') return 'bash'
  if (name === 'web_search' || name === 'web_fetch') return 'web'
  if (
    name === 'read_file'
    || name === 'list_files'
    || name === 'list_directory'
    || name === 'search_files'
    || name === 'read_tool_result'
  ) {
    return 'read'
  }
  return 'other'
}

function queueForKind(kind: ToolExecutionClass): ToolQueue {
  switch (kind) {
    case 'web':
      return 'web'
    case 'write':
      return 'write'
    case 'bash':
      return 'bash'
    default:
      return 'read-other'
  }
}

function createLockKey(toolCall: ToolCallInfo, kind: ToolExecutionClass): string {
  const normalizedPath = typeof toolCall.parsedArgs?.path === 'string'
    ? String(toolCall.parsedArgs.path).replace(/\\/g, '/').toLowerCase()
    : ''
  if (kind === 'write' && normalizedPath) return `path:${normalizedPath}`
  if (kind === 'bash') return 'bash:workspace'
  return `${toolCall.name}:${hashArgs(toolCall.arguments)}`
}

function indexToolCalls(toolCalls: ToolCallInfo[]): IndexedToolCall[] {
  return toolCalls.map((toolCall, index) => {
    const kind = classifyTool(toolCall.name)
    return {
      toolCall,
      index,
      kind,
      queue: queueForKind(kind),
      lockKey: createLockKey(toolCall, kind),
    }
  })
}

async function runSequential<T>(
  items: T[],
  runner: (item: T) => Promise<void>,
): Promise<void> {
  for (const item of items) {
    await runner(item)
  }
}

async function runLimited<T>(
  items: T[],
  limit: number,
  runner: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0
  const workerCount = Math.min(limit, items.length)
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex]!
      nextIndex += 1
      await runner(item)
    }
  })
  await Promise.all(workers)
}

function resolveToolFilePath(toolCall: ToolCallInfo, workDir: string): string {
  const rawPath = (toolCall.parsedArgs?.path as string) ?? ''
  if (!rawPath) return ''
  if (rawPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(rawPath)) return rawPath
  return `${workDir}/${rawPath}`
}

function resolveTimeoutMs(
  kind: ToolExecutionClass,
  overrides?: ExecuteToolCallsParams['timeoutMsByClass'],
): number {
  const configured = overrides?.[kind]
  if (configured && configured > 0) return configured
  switch (kind) {
    case 'write':
      return DEFAULT_WRITE_TIMEOUT_MS
    case 'bash':
      return DEFAULT_BASH_TIMEOUT_MS
    default:
      return DEFAULT_TOOL_TIMEOUT_MS
  }
}

function resolveRetryCount(
  kind: ToolExecutionClass,
  overrides?: ExecuteToolCallsParams['retryCountByClass'],
): number {
  const configured = overrides?.[kind]
  if (typeof configured === 'number' && configured >= 0) return configured
  switch (kind) {
    case 'read':
    case 'web':
    case 'other':
      return DEFAULT_RETRY_COUNT
    default:
      return 0
  }
}

function createExecutionMetadata(
  indexed: IndexedToolCall,
  timeoutMs: number,
  retryCount: number,
): ToolExecutionMetadata {
  return {
    class: indexed.kind,
    queue: indexed.queue,
    lockKey: indexed.lockKey,
    queuedAt: Date.now(),
    attempt: 0,
    maxAttempts: retryCount + 1,
    retryCount: 0,
    timeoutMs,
    hardTimeout: true,
  }
}

function copyResultMetadata(execution: ToolExecutionMetadata): ToolResultMetadata {
  return {
    class: execution.class,
    queue: execution.queue,
    lockKey: execution.lockKey,
    startedAt: execution.startedAt,
    finishedAt: execution.finishedAt,
    durationMs: execution.durationMs,
    waitMs: execution.waitMs,
    attempts: execution.attempt,
    retryCount: execution.retryCount,
    timeoutMs: execution.timeoutMs,
    timedOut: execution.timedOut,
    cancelled: execution.cancelled,
    errorKind: execution.errorKind,
  }
}

function toCancelledResult(toolCall: ToolCallInfo): ToolResultInfo {
  return {
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    success: false,
    content: '[cancelled] Tool execution was cancelled before it started.',
    metadata: toolCall.execution
      ? copyResultMetadata(toolCall.execution)
      : undefined,
  }
}

function withTimeout<T>(
  task: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Tool execution timed out after ${timeoutMs}ms`)), timeoutMs)
    task.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function shouldRetry(kind: ToolExecutionClass, errorKind: ToolExecutionMetadata['errorKind'] | undefined): boolean {
  if (kind === 'write' || kind === 'bash') return false
  return errorKind === 'timeout' || errorKind === 'exception'
}

function markToolCallState(toolCall: ToolCallInfo, state: Partial<ToolCallInfo>): void {
  Object.assign(toolCall, state)
}

async function runToolAttempt(
  indexed: IndexedToolCall,
  params: ExecuteToolCallsParams,
): Promise<RunToolAttemptResult> {
  const { toolCall } = indexed
  const execution = toolCall.execution!
  execution.attempt += 1
  execution.startedAt = Date.now()
  execution.waitMs = execution.startedAt - execution.queuedAt
  execution.retryCount = execution.attempt - 1
  execution.timedOut = false
  execution.cancelled = false
  execution.errorKind = undefined

  try {
    const result = await withTimeout(
      aiExecuteTool(
        toolCall.name,
        toolCall.arguments,
        params.workDir,
        params.sessionId,
        toolCall.id,
      ),
      execution.timeoutMs,
    )
    execution.finishedAt = Date.now()
    execution.durationMs = execution.finishedAt - execution.startedAt
    if (result.success) {
      return {
        success: true,
        content: result.content,
        metadata: copyResultMetadata(execution),
      }
    }
    execution.errorKind = 'tool_error'
    return {
      success: false,
      content: result.content,
      errorKind: execution.errorKind,
      metadata: copyResultMetadata(execution),
    }
  } catch (error) {
    execution.finishedAt = Date.now()
    execution.durationMs = execution.finishedAt - execution.startedAt
    const errMsg = ensureErrorString(error)
    const timedOut = /timed out/i.test(errMsg)
    execution.timedOut = timedOut
    execution.errorKind = timedOut ? 'timeout' : 'exception'
    return {
      success: false,
      content: `Tool execution failed: ${errMsg}`,
      timedOut,
      errorKind: execution.errorKind,
      metadata: copyResultMetadata(execution),
    }
  }
}

async function executeIndexedTool(
  indexed: IndexedToolCall,
  params: ExecuteToolCallsParams,
): Promise<ToolExecutionResult> {
  const { toolCall, kind } = indexed
  const failureKey = `${toolCall.name}:${hashArgs(toolCall.arguments)}`
  const previousFailures = params.toolFailureCounter.get(failureKey) ?? 0

  if (previousFailures >= MAX_SAME_TOOL_FAILURE) {
    const argsBrief = toolCall.arguments.length > 80
      ? `${toolCall.arguments.slice(0, 80)}...`
      : toolCall.arguments
    const content = `[CIRCUIT_OPEN] Repeated failures for ${toolCall.name}(${argsBrief}) reached ${previousFailures}. Use a different approach or answer directly.`
    params.log.warn('tool_circuit_open', { sessionId: params.sessionId, tool: toolCall.name, failures: previousFailures })
    if (toolCall.execution) {
      toolCall.execution.errorKind = 'circuit_open'
      toolCall.execution.finishedAt = Date.now()
    }
    markToolCallState(toolCall, {
      status: 'error',
      error: content,
    })
    return {
      result: {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        success: false,
        content,
        metadata: toolCall.execution ? copyResultMetadata(toolCall.execution) : undefined,
      },
    }
  }

  const approvalTool = pickApprovalTool(toolCall.name)
  if (approvalTool) {
    const decision = await requestApprovalForTool(approvalTool, toolCall, params.sessionId, () => {
      updateToolCalls(params.toolCalls, params.updateStreamingMessage)
    })
    updateToolCalls(params.toolCalls, params.updateStreamingMessage)

    if (decision === 'deny') {
      const content = `[user_rejected] User rejected ${toolCall.name}.`
      if (toolCall.execution) {
        toolCall.execution.errorKind = 'user_rejected'
        toolCall.execution.finishedAt = Date.now()
      }
      markToolCallState(toolCall, {
        status: 'error',
        error: content,
      })
      params.toolFailureCounter.delete(failureKey)
      return {
        result: {
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          success: false,
          content,
          metadata: toolCall.execution ? copyResultMetadata(toolCall.execution) : undefined,
        },
      }
    }

    markToolCallState(toolCall, { status: 'running' })
    updateToolCalls(params.toolCalls, params.updateStreamingMessage)
  }

  const maxAttempts = toolCall.execution?.maxAttempts ?? 1
  let attemptResult: RunToolAttemptResult | null = null

  while ((attemptResult?.metadata.attempts ?? 0) < maxAttempts) {
    if (params.signal?.aborted) {
      if (toolCall.execution) {
        toolCall.execution.cancelled = true
        toolCall.execution.errorKind = 'cancelled'
        toolCall.execution.finishedAt = Date.now()
      }
      markToolCallState(toolCall, {
        status: 'error',
        error: '[cancelled] Tool execution was cancelled before it started.',
      })
      return { result: toCancelledResult(toolCall) }
    }

    attemptResult = await runToolAttempt(indexed, params)
    const shouldRetryAttempt = !attemptResult.success
      && shouldRetry(kind, attemptResult.errorKind)
      && attemptResult.metadata.attempts < maxAttempts

    if (!shouldRetryAttempt) break
    params.log.warn('tool_retry', {
      sessionId: params.sessionId,
      toolCallId: toolCall.id,
      tool: toolCall.name,
      attempt: attemptResult.metadata.attempts,
      maxAttempts,
      errorKind: attemptResult.errorKind,
    })
  }

  const finalResult = attemptResult!
  if (finalResult.success) {
    markToolCallState(toolCall, {
      status: 'success',
      result: finalResult.content,
      error: undefined,
    })
    params.toolFailureCounter.delete(failureKey)

    if (toolCall.name === 'write_file' || toolCall.name === 'edit_file') {
      const refreshPath = resolveToolFilePath(toolCall, params.workDir)
      return {
        result: {
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          success: true,
          content: finalResult.content,
          metadata: finalResult.metadata,
        },
        refreshPath: refreshPath || undefined,
      }
    }

    return {
      result: {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        success: true,
        content: finalResult.content,
        metadata: finalResult.metadata,
      },
    }
  }

  markToolCallState(toolCall, {
    status: 'error',
    result: finalResult.content,
    error: finalResult.content,
  })
  params.toolFailureCounter.set(failureKey, previousFailures + 1)
  return {
    result: {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      success: false,
      content: finalResult.content,
      metadata: finalResult.metadata,
    },
  }
}

export async function executeToolCalls({
  sessionId,
  workDir,
  toolCalls,
  toolFailureCounter,
  log,
  clearWatchdog,
  setInToolExec,
  updateStreamingMessage,
  refreshWorkspaceDirectoryForToolPath,
  signal,
  timeoutMsByClass,
  retryCountByClass,
}: ExecuteToolCallsParams): Promise<ToolResultInfo[]> {
  setInToolExec(true)
  clearWatchdog()

  try {
    const indexedToolCalls = indexToolCalls(toolCalls)
    for (const indexed of indexedToolCalls) {
      const needApproval = pickApprovalTool(indexed.toolCall.name) !== null
      indexed.toolCall.status = needApproval ? 'pending' : 'running'
      indexed.toolCall.execution = createExecutionMetadata(
        indexed,
        resolveTimeoutMs(indexed.kind, timeoutMsByClass),
        resolveRetryCount(indexed.kind, retryCountByClass),
      )
    }
    updateToolCalls(toolCalls, updateStreamingMessage)

    const results = new Array<ToolResultInfo | undefined>(toolCalls.length)

    const runOne = async (indexed: IndexedToolCall): Promise<void> => {
      if (signal?.aborted) {
        const execution = indexed.toolCall.execution
        if (execution) {
          execution.cancelled = true
          execution.errorKind = 'cancelled'
          execution.finishedAt = Date.now()
        }
        indexed.toolCall.status = 'error'
        indexed.toolCall.error = '[cancelled] Tool execution was cancelled before it started.'
        results[indexed.index] = toCancelledResult(indexed.toolCall)
        return
      }

      const executed = await executeIndexedTool(indexed, {
        sessionId,
        workDir,
        toolCalls,
        toolFailureCounter,
        log,
        clearWatchdog,
        setInToolExec,
        updateStreamingMessage,
        refreshWorkspaceDirectoryForToolPath,
        signal,
        timeoutMsByClass,
        retryCountByClass,
      })

      results[indexed.index] = executed.result

      if (executed.refreshPath) {
        import('@/stores/local-file-editor').then(({ useLocalFileEditorStore }) => {
          useLocalFileEditorStore().close(executed.refreshPath!)
        })
        refreshWorkspaceDirectoryForToolPath(executed.refreshPath)
          .catch(error => log.warn('refresh_workspace_dir_failed', { filePath: executed.refreshPath }, error))
      }
    }

    const readAndOtherCalls = indexedToolCalls.filter(item => item.kind === 'read' || item.kind === 'other')
    const webCalls = indexedToolCalls.filter(item => item.kind === 'web')
    const writeCalls = indexedToolCalls.filter(item => item.kind === 'write')
    const bashCalls = indexedToolCalls.filter(item => item.kind === 'bash')

    await Promise.all(readAndOtherCalls.map(runOne))
    await runLimited(webCalls, WEB_TOOL_CONCURRENCY, runOne)
    await runSequential(writeCalls, runOne)
    await runSequential(bashCalls, runOne)

    const orderedResults = results.filter((result): result is ToolResultInfo => result !== undefined)

    try {
      const budgeted = await aiEnforceToolResultBudget(
        sessionId,
        orderedResults.map(result => ({
          toolCallId: result.toolCallId,
          toolName: result.toolName,
          content: result.content,
        })),
      )

      for (const item of budgeted) {
        const result = orderedResults.find(candidate => candidate.toolCallId === item.toolCallId)
        if (result && result.content !== item.content) {
          result.content = item.content
          const toolCall = toolCalls.find(candidate => candidate.id === item.toolCallId)
          if (toolCall) toolCall.result = item.content
        }
      }
    } catch (error) {
      log.warn('budget_check_failed', { sessionId }, error)
    }

    updateToolCalls(toolCalls, updateStreamingMessage)
    return orderedResults
  } finally {
    setInToolExec(false)
  }
}
