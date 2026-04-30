import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { executeToolCalls } from '@/composables/ai/chatToolExecution'
import { createTranscriptStore } from '@/composables/ai-agent/transcript/transcriptStore'
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
    localStorage.clear()
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
    for (let i = 0; i < 10 && maxActive < 2; i += 1) {
      await Promise.resolve()
    }

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
    expect(localStorage.getItem('devforge.ai.workspace.isolation.v1')).toContain('write_file:write-1')
    expect(localStorage.getItem('devforge.ai.workspace.isolation.v1')).toContain('edit_file:edit-1')
  })

  it('runs safe bash inspection commands without approval prompts', async () => {
    setApprovalMode('ask', 'session-1')
    const toolCalls = [
      makeToolCall('bash-safe', 'bash', { command: 'dir /s /b src\\*.vue' }),
    ]

    aiExecuteToolMock.mockResolvedValue({
      success: true,
      content: 'src/components/App.vue',
    })

    const results = await executeToolCalls(makeParams(toolCalls))

    expect(aiExecuteToolMock).toHaveBeenCalledTimes(1)
    expect(toolCalls[0]?.approvalState).toBeUndefined()
    expect(toolCalls[0]?.status).toBe('success')
    expect(results[0]?.success).toBe(true)
  })

  it('blocks unsafe write paths before invoking backend tools', async () => {
    const toolCalls = [
      makeToolCall('write-unsafe', 'write_file', { path: '../outside.txt', content: 'x' }),
    ]

    const results = await executeToolCalls(makeParams(toolCalls))

    expect(aiExecuteToolMock).not.toHaveBeenCalled()
    expect(results).toHaveLength(1)
    expect(results[0]?.success).toBe(false)
    expect(results[0]?.content).toContain('[path_safety_blocked]')
    expect(results[0]?.content).toContain('工作区外路径')
    expect(toolCalls[0]?.status).toBe('error')
  })

  it('records permission and tool result events into transcript store', async () => {
    const toolCalls = [
      makeToolCall('read-1', 'read_file', { path: 'src/a.ts' }),
    ]
    const transcriptStore = createTranscriptStore()
    aiExecuteToolMock.mockResolvedValue({
      success: true,
      content: 'file content',
    })

    const params = makeParams(toolCalls)
    params.transcriptStore = transcriptStore
    params.turnId = 'turn-1'

    const results = await executeToolCalls(params)

    expect(results[0]?.success).toBe(true)
    const events = transcriptStore.getEvents('session-1')
    expect(events.map(event => event.type)).toEqual(['permission', 'tool_result'])
    expect(transcriptStore.getLatestEvent('session-1', 'permission')?.payload.data.decision).toBe('allowed')
    expect(transcriptStore.getLatestEvent('session-1', 'tool_result')?.payload.data.contentPreview).toBe('file content')
  })

  it('routes read tools through approval when strict provider permission is enabled', async () => {
    setApprovalMode('deny', 'session-1')
    const toolCalls = [
      makeToolCall('read-1', 'read_file', { path: 'src/a.ts' }),
    ]

    const params = makeParams(toolCalls)
    params.permissionContext = {
      strictPermission: true,
      model: {
        id: 'm1',
        name: 'Model',
        capabilities: {
          streaming: true,
          vision: false,
          thinking: false,
          toolUse: true,
          maxContext: 32000,
          maxOutput: 4096,
        },
      },
    }

    const results = await executeToolCalls(params)

    expect(aiExecuteToolMock).not.toHaveBeenCalled()
    expect(toolCalls[0]?.approvalState).toBe('denied')
    expect(results[0]?.success).toBe(false)
    expect(results[0]?.content).toContain('[user_rejected]')
  })

  it('denies tool calls by matching rule against parsed command', async () => {
    const toolCalls = [
      makeToolCall('bash-deny', 'bash', { command: 'git push origin main' }),
    ]

    const params = makeParams(toolCalls)
    params.permissionContext = {
      permissionRules: [
        { source: 'project', behavior: 'deny', toolName: 'bash', pattern: 'git push*', reason: '禁止直接推送' },
      ],
    }

    const results = await executeToolCalls(params)

    expect(aiExecuteToolMock).not.toHaveBeenCalled()
    expect(results[0]?.success).toBe(false)
    expect(results[0]?.content).toContain('[permission_denied]')
    expect(toolCalls[0]?.status).toBe('error')
  })

  it('keeps explicit ask rules effective for safe bash commands', async () => {
    setApprovalMode('deny', 'session-1')
    const toolCalls = [
      makeToolCall('bash-ask', 'bash', { command: 'git status' }),
    ]

    const params = makeParams(toolCalls)
    params.permissionContext = {
      permissionRules: [
        { source: 'session', behavior: 'ask', toolName: 'bash', pattern: 'git status' },
      ],
    }

    const results = await executeToolCalls(params)

    expect(aiExecuteToolMock).not.toHaveBeenCalled()
    expect(toolCalls[0]?.approvalState).toBe('denied')
    expect(results[0]?.content).toContain('[user_rejected]')
  })

  it('allows mutating tool calls by matching rule against parsed path', async () => {
    setApprovalMode('ask', 'session-1')
    const toolCalls = [
      makeToolCall('write-allow', 'write_file', { path: 'src/generated/client.ts', content: 'x' }),
    ]

    aiExecuteToolMock.mockResolvedValue({
      success: true,
      content: 'written',
    })

    const params = makeParams(toolCalls)
    params.permissionContext = {
      permissionRules: [
        { source: 'session', behavior: 'allow', toolName: 'write_file', pattern: 'src/generated/**' },
      ],
    }

    const results = await executeToolCalls(params)

    expect(aiExecuteToolMock).toHaveBeenCalledTimes(1)
    expect(toolCalls[0]?.approvalState).toBeUndefined()
    expect(results[0]?.success).toBe(true)
  })

  it('denies conflicting writes when workspace isolation policy is deny', async () => {
    localStorage.setItem('devforge.ai.workspace.isolation.policy.v1', 'deny')
    localStorage.setItem('devforge.ai.workspace.isolation.v1', JSON.stringify([
      {
        ownerId: 'tool:other:t1',
        ownerLabel: 'other-write',
        allowedPaths: [],
        touchedPaths: ['src/a.ts'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]))
    const toolCalls = [
      makeToolCall('write-deny', 'write_file', { path: 'src/a.ts', content: 'x' }),
    ]

    const results = await executeToolCalls(makeParams(toolCalls))

    expect(aiExecuteToolMock).not.toHaveBeenCalled()
    expect(results[0]?.success).toBe(false)
    expect(results[0]?.content).toContain('[workspace_isolation_denied]')
    expect(toolCalls[0]?.status).toBe('error')
  })

  it('denies cross-session conflicting writes when workspace isolation policy is smart', async () => {
    localStorage.setItem('devforge.ai.workspace.isolation.policy.v1', 'smart')
    localStorage.setItem('devforge.ai.workspace.isolation.v1', JSON.stringify([
      {
        ownerId: 'tool:other-session:t1',
        ownerLabel: 'other-write',
        allowedPaths: [],
        touchedPaths: ['src/a.ts'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]))
    const toolCalls = [
      makeToolCall('write-smart-deny', 'write_file', { path: 'src/a.ts', content: 'x' }),
    ]

    const results = await executeToolCalls(makeParams(toolCalls))

    expect(aiExecuteToolMock).not.toHaveBeenCalled()
    expect(results[0]?.success).toBe(false)
    expect(results[0]?.content).toContain('[workspace_isolation_denied]')
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
