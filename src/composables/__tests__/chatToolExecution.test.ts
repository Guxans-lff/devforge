import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { executeToolCalls } from '@/composables/ai/chatToolExecution'
import { clearApprovalStateForTests, setActiveSessionId, setApprovalMode } from '@/composables/useToolApproval'
import type { AiMessage, ToolCallInfo } from '@/types/ai'

const { aiExecuteToolMock, aiEnforceToolResultBudgetMock } = vi.hoisted(() => ({
  aiExecuteToolMock: vi.fn(),
  aiEnforceToolResultBudgetMock: vi.fn(),
}))

vi.mock('@/api/ai', () => ({
  aiExecuteTool: aiExecuteToolMock,
  aiEnforceToolResultBudget: aiEnforceToolResultBudgetMock,
}))

function makeToolCall(
  id: string,
  name: string,
  args: Record<string, unknown> = {},
): ToolCallInfo {
  return {
    id,
    name,
    arguments: JSON.stringify(args),
    parsedArgs: args,
    status: 'pending',
  }
}

function makeParams(toolCalls: ToolCallInfo[]) {
  return {
    sessionId: 'session-1',
    workDir: 'D:/workspace',
    toolCalls,
    toolFailureCounter: new Map<string, number>(),
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    clearWatchdog: vi.fn(),
    setInToolExec: vi.fn(),
    updateStreamingMessage: vi.fn((updater: (msg: AiMessage) => AiMessage) => {
      updater({
        id: 'msg-1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      })
    }),
    refreshWorkspaceDirectoryForToolPath: vi.fn().mockResolvedValue(undefined),
  }
}

describe('chatToolExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearApprovalStateForTests()
    setActiveSessionId('session-1')
    setApprovalMode('auto', 'session-1')
    aiEnforceToolResultBudgetMock.mockImplementation(async (_sessionId: string, results: Array<{ toolCallId: string, toolName: string, content: string }>) => results)
  })

  afterEach(() => {
    clearApprovalStateForTests()
  })

  it('keeps result order while running reads before web, writes, and bash', async () => {
    const toolCalls = [
      makeToolCall('read-1', 'read_file', { path: 'a.ts' }),
      makeToolCall('web-1', 'web_fetch', { url: 'https://example.com/a' }),
      makeToolCall('write-1', 'write_file', { path: 'a.ts', content: 'a' }),
      makeToolCall('bash-1', 'bash', { command: 'pnpm test' }),
      makeToolCall('read-2', 'search_files', { query: 'foo' }),
    ]

    const started: string[] = []
    aiExecuteToolMock.mockImplementation(async (name: string, _args: string, _workDir: string, _sessionId: string, toolCallId: string) => {
      started.push(toolCallId)
      return {
        success: true,
        content: `${name}:${toolCallId}`,
      }
    })

    const results = await executeToolCalls(makeParams(toolCalls))

    expect(started).toEqual(['read-1', 'read-2', 'web-1', 'write-1', 'bash-1'])
    expect(results.map(item => item.toolCallId)).toEqual(['read-1', 'web-1', 'write-1', 'bash-1', 'read-2'])
    expect(toolCalls.map(item => item.status)).toEqual(['success', 'success', 'success', 'success', 'success'])
    expect(results[0]?.metadata?.queue).toBe('read-other')
    expect(results[1]?.metadata?.queue).toBe('web')
    expect(results[2]?.metadata?.queue).toBe('write')
    expect(results[3]?.metadata?.queue).toBe('bash')
  })

  it('limits web tools to two concurrent executions', async () => {
    const toolCalls = [
      makeToolCall('web-1', 'web_search', { query: 'one' }),
      makeToolCall('web-2', 'web_search', { query: 'two' }),
      makeToolCall('web-3', 'web_search', { query: 'three' }),
      makeToolCall('web-4', 'web_search', { query: 'four' }),
    ]

    let active = 0
    let maxActive = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    aiExecuteToolMock.mockImplementation(async (_name: string, _args: string, _workDir: string, _sessionId: string, toolCallId: string) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      if (toolCallId === 'web-1' || toolCallId === 'web-2') {
        await gate
      }
      active -= 1
      return {
        success: true,
        content: toolCallId,
      }
    })

    const pending = executeToolCalls(makeParams(toolCalls))
    await Promise.resolve()
    await Promise.resolve()

    expect(maxActive).toBe(2)

    release()
    const results = await pending
    expect(results).toHaveLength(4)
    expect(maxActive).toBe(2)
  })

  it('runs write tools serially and refreshes edited paths', async () => {
    const toolCalls = [
      makeToolCall('write-1', 'write_file', { path: 'src/a.ts', content: 'a' }),
      makeToolCall('edit-1', 'edit_file', { path: 'src/b.ts', old_string: 'b', new_string: 'bb' }),
      makeToolCall('write-2', 'write_file', { path: 'src/c.ts', content: 'c' }),
    ]

    const stages: string[] = []
    aiExecuteToolMock.mockImplementation(async (_name: string, _args: string, _workDir: string, _sessionId: string, toolCallId: string) => {
      stages.push(`start:${toolCallId}`)
      await Promise.resolve()
      stages.push(`end:${toolCallId}`)
      return {
        success: true,
        content: toolCallId,
      }
    })

    const params = makeParams(toolCalls)
    await executeToolCalls(params)

    expect(stages).toEqual([
      'start:write-1',
      'end:write-1',
      'start:edit-1',
      'end:edit-1',
      'start:write-2',
      'end:write-2',
    ])
    expect(params.refreshWorkspaceDirectoryForToolPath).toHaveBeenCalledTimes(3)
    expect(params.refreshWorkspaceDirectoryForToolPath).toHaveBeenNthCalledWith(1, 'D:/workspace/src/a.ts')
    expect(params.refreshWorkspaceDirectoryForToolPath).toHaveBeenNthCalledWith(2, 'D:/workspace/src/b.ts')
    expect(params.refreshWorkspaceDirectoryForToolPath).toHaveBeenNthCalledWith(3, 'D:/workspace/src/c.ts')
  })

  it('retries transient timeout failures for read tools and records metadata', async () => {
    const toolCalls = [
      makeToolCall('read-1', 'read_file', { path: 'src/a.ts' }),
    ]

    let attempts = 0
    aiExecuteToolMock.mockImplementation(async () => {
      attempts += 1
      if (attempts === 1) {
        await new Promise(resolve => setTimeout(resolve, 20))
        return { success: true, content: 'late-first-attempt' }
      }
      return { success: true, content: 'second-attempt-success' }
    })

    const params = makeParams(toolCalls)
    params.timeoutMsByClass = { read: 5 }

    const results = await executeToolCalls(params)

    expect(attempts).toBe(2)
    expect(results[0]?.success).toBe(true)
    expect(results[0]?.content).toBe('second-attempt-success')
    expect(results[0]?.metadata?.attempts).toBe(2)
    expect(results[0]?.metadata?.retryCount).toBe(1)
    expect(results[0]?.metadata?.timeoutMs).toBe(5)
    expect(toolCalls[0]?.execution?.timedOut).toBe(false)
    expect(aiExecuteToolMock.mock.calls[0]?.[5]).toBe(5)
  })

  it('does not start queued tools after cancellation', async () => {
    const toolCalls = [
      makeToolCall('bash-1', 'list_files', { path: 'src' }),
      makeToolCall('bash-2', 'bash', { command: 'echo second' }),
    ]

    const controller = new AbortController()
    let releaseFirst!: () => void
    const firstGate = new Promise<void>(resolve => {
      releaseFirst = resolve
    })
    const started: string[] = []

    aiExecuteToolMock.mockImplementation(async (_name: string, _args: string, _workDir: string, _sessionId: string, toolCallId: string) => {
      started.push(toolCallId)
      if (toolCallId === 'bash-1') {
        await firstGate
      }
      return {
        success: true,
        content: toolCallId,
      }
    })

    const params = makeParams(toolCalls)
    params.signal = controller.signal
    const pending = executeToolCalls(params)

    await Promise.resolve()
    controller.abort()
    releaseFirst()
    const results = await pending

    expect(started).toEqual(['bash-1'])
    expect(results.map(item => item.toolCallId)).toEqual(['bash-1', 'bash-2'])
    expect(results[1]?.success).toBe(false)
    expect(results[1]?.content).toContain('[cancelled]')
    expect(results[1]?.metadata?.cancelled).toBe(true)
  })

  it('allows an immediate re-entry run after a cancelled execution', async () => {
    const firstBatch = [
      makeToolCall('bash-1', 'list_files', { path: 'src' }),
      makeToolCall('bash-2', 'bash', { command: 'echo second' }),
    ]
    const secondBatch = [
      makeToolCall('bash-3', 'list_files', { path: 'src' }),
      makeToolCall('bash-4', 'bash', { command: 'echo fourth' }),
    ]

    const firstController = new AbortController()
    let releaseFirst!: () => void
    const firstGate = new Promise<void>(resolve => {
      releaseFirst = resolve
    })
    const started: string[] = []

    aiExecuteToolMock.mockImplementation(async (_name: string, _args: string, _workDir: string, _sessionId: string, toolCallId: string) => {
      started.push(toolCallId)
      if (toolCallId === 'bash-1') {
        await firstGate
      }
      return {
        success: true,
        content: toolCallId,
      }
    })

    const firstParams = makeParams(firstBatch)
    firstParams.signal = firstController.signal

    const firstPending = executeToolCalls(firstParams)
    await Promise.resolve()
    firstController.abort()
    releaseFirst()
    const firstResults = await firstPending

    expect(firstResults.map(item => item.toolCallId)).toEqual(['bash-1', 'bash-2'])
    expect(firstResults[1]?.success).toBe(false)
    expect(firstResults[1]?.metadata?.cancelled).toBe(true)
    expect(firstParams.setInToolExec).toHaveBeenNthCalledWith(1, true)
    expect(firstParams.setInToolExec).toHaveBeenLastCalledWith(false)

    const secondParams = makeParams(secondBatch)
    const secondResults = await executeToolCalls(secondParams)

    expect(secondResults.map(item => item.toolCallId)).toEqual(['bash-3', 'bash-4'])
    expect(secondResults.every(item => item.success)).toBe(true)
    expect(started).toEqual(['bash-1', 'bash-3', 'bash-4'])
    expect(secondBatch[0]?.status).toBe('success')
    expect(secondBatch[1]?.status).toBe('success')
    expect(secondBatch[0]?.execution?.cancelled).toBe(false)
    expect(secondBatch[1]?.execution?.cancelled).toBe(false)
    expect(secondParams.setInToolExec).toHaveBeenNthCalledWith(1, true)
    expect(secondParams.setInToolExec).toHaveBeenLastCalledWith(false)
  })
})
