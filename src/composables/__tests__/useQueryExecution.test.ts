import { computed, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Channel, invoke } from '@tauri-apps/api/core'
import * as historyApi from '@/api/query-history'
import { useQueryExecution } from '@/composables/useQueryExecution'
import { useConnectionStore } from '@/stores/connections'
import { useDatabaseWorkspaceStore } from '@/stores/database-workspace'
import type { QueryResult } from '@/types/database'

vi.mock('@/plugins/persistence', () => ({
  usePersistence: () => ({
    load: vi.fn().mockResolvedValue(false),
    autoSave: vi.fn(),
    saveImmediate: vi.fn(),
  }),
}))

function makeQueryResult(rows: unknown[][] = [[1]]): QueryResult {
  return {
    columns: [{ name: 'id', dataType: 'INT', nullable: false }],
    rows,
    affectedRows: 0,
    executionTimeMs: 12,
    isError: false,
    error: null,
    totalCount: rows.length,
    truncated: false,
  }
}

function makeErrorResult(error: string): QueryResult {
  return {
    columns: [],
    rows: [],
    affectedRows: 0,
    executionTimeMs: 3,
    isError: true,
    error,
    totalCount: null,
    truncated: false,
  }
}

function setupQueryExecution(overrides: {
  isConnected?: boolean
  addResultTab?: ReturnType<typeof vi.fn>
} = {}) {
  const workspaceStore = useDatabaseWorkspaceStore()
  const ws = workspaceStore.getOrCreate('conn-1')
  const tabId = ws.activeTabId

  workspaceStore.updateTabContext('conn-1', tabId, {
    type: 'query',
    sql: '',
    result: null,
    isExecuting: false,
    currentDatabase: 'demo',
  })

  const execution = useQueryExecution({
    connectionId: ref('conn-1'),
    connectionName: ref('local mysql'),
    tabId: ref(tabId),
    isConnected: ref(overrides.isConnected ?? true),
    environment: ref('development'),
    readOnly: ref(false),
    confirmDanger: ref(false),
    addResultTab: overrides.addResultTab ?? vi.fn(),
    tabContext: computed(() => workspaceStore.getWorkspace('conn-1')?.tabs.find(tab => tab.id === tabId)?.context as any),
  })

  return { execution, workspaceStore, tabId }
}

describe('useQueryExecution', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.spyOn(historyApi, 'saveQueryHistory').mockResolvedValue(undefined)

    const connectionStore = useConnectionStore()
    connectionStore.connections.set('conn-1', {
      record: {
        id: 'conn-1',
        name: 'local mysql',
        type: 'database',
        groupId: null,
        host: '127.0.0.1',
        port: 3306,
        username: 'root',
        configJson: JSON.stringify({ driver: 'mysql', autoReconnect: true }),
        color: null,
        sortOrder: 0,
        createdAt: 0,
        updatedAt: 0,
      },
      parsedConfig: { driver: 'mysql', autoReconnect: true },
      status: 'connected',
    })
  })

  it('reconnects, reacquires the tab session, and retries once after an idle disconnect error', async () => {
    const disconnectError = 'error communicating with database: os error 10054'
    vi.mocked(invoke).mockImplementation(async (command: string, args?: any) => {
      if (command === 'db_execute_query_stream_on_session') {
        const calls = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === 'db_execute_query_stream_on_session')
        if (calls.length === 1) {
          throw new Error(disconnectError)
        }
        const channel = args?.onChunk as InstanceType<typeof Channel>
        channel.onmessage?.({
          chunkIndex: 0,
          columns: [{ name: 'id', dataType: 'INT', nullable: false }],
          rows: [[1]],
          isLast: true,
          totalTimeMs: 5,
          error: null,
        })
        return undefined
      }
      if (command === 'db_execute_query_on_session') {
        return makeQueryResult()
      }
      if (command === 'get_credential') return 'secret'
      if (command === 'db_check_and_reconnect') {
        return { success: true, attempt: 1, message: 'reconnected' }
      }
      if (command === 'db_acquire_session') return true
      throw new Error(`unmocked command: ${command}`)
    })

    const { execution, workspaceStore, tabId } = setupQueryExecution()

    const result = await execution.handleExecute('SELECT 1')

    expect(result.success).toBe(true)
    expect(vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === 'db_execute_query_stream_on_session')).toHaveLength(2)
    expect(vi.mocked(invoke).mock.calls.some(([cmd]) => cmd === 'db_check_and_reconnect')).toBe(true)
    expect(vi.mocked(invoke).mock.calls.some(([cmd]) => cmd === 'db_acquire_session')).toBe(true)
    expect(workspaceStore.getWorkspace('conn-1')?.tabs.find(tab => tab.id === tabId)?.context.result).toMatchObject({
      isError: false,
      rows: [[1]],
    })
  })

  it('does not treat PostgreSQL casts as parameter placeholders', async () => {
    const addResultTab = vi.fn()
    const { execution } = setupQueryExecution({ addResultTab })

    vi.mocked(invoke).mockImplementation(async (command: string, args?: any) => {
      if (command === 'db_execute_query_stream_on_session') {
        const channel = args?.onChunk as InstanceType<typeof Channel>
        channel.onmessage?.({
          chunkIndex: 0,
          columns: [{ name: 'value', dataType: 'INT', nullable: false }],
          rows: [[1]],
          isLast: true,
          totalTimeMs: 5,
          error: null,
        })
        return undefined
      }
      throw new Error(`unmocked command: ${command}`)
    })

    const result = await execution.handleExecute('SELECT 1::int AS value')

    expect(result.success).toBe(true)
    expect(execution.paramDialogOpen.value).toBe(false)
    expect(addResultTab).toHaveBeenCalledWith(
      'SELECT 1::int AS value',
      expect.objectContaining({ rows: [[1]] }),
    )
  })

  it('stores multi-statement result tabs and uses the tab session command', async () => {
    const { execution, workspaceStore, tabId } = setupQueryExecution()

    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === 'db_execute_multi_v2_on_session') {
        return [
          { index: 1, sql: 'SELECT 1', statementType: 'SELECT', result: makeQueryResult([[1]]) },
          { index: 2, sql: 'SELECT 2', statementType: 'SELECT', result: makeQueryResult([[2]]) },
        ]
      }
      throw new Error(`unmocked command: ${command}`)
    })

    const result = await execution.handleExecute('SELECT 1; SELECT 2;')
    const ctx = workspaceStore.getWorkspace('conn-1')?.tabs.find(tab => tab.id === tabId)?.context as any

    expect(result.success).toBe(true)
    expect(vi.mocked(invoke).mock.calls.some(([cmd]) => cmd === 'db_execute_multi_v2_on_session')).toBe(true)
    expect(ctx.resultTabs).toHaveLength(1)
    expect(ctx.activeResultTabId).toBe(ctx.resultTabs[0].id)
    expect(ctx.resultTabs[0].subResults).toHaveLength(2)
    expect(ctx.result.multiStatementSummary).toEqual({ total: 2, success: 2, fail: 0 })
  })

  it('cancels only the active tab session and ignores late stream chunks', async () => {
    const { execution, workspaceStore, tabId } = setupQueryExecution()
    let streamChannel: InstanceType<typeof Channel> | null = null

    vi.mocked(invoke).mockImplementation(async (command: string, args?: any) => {
      if (command === 'db_execute_query_stream_on_session') {
        streamChannel = args?.onChunk as InstanceType<typeof Channel>
        return new Promise(() => {})
      }
      if (command === 'db_cancel_query_on_session') {
        return true
      }
      throw new Error(`unmocked command: ${command}`)
    })

    const pending = execution.handleExecute('SELECT SLEEP(10)')
    await vi.waitFor(() => {
      expect(streamChannel).not.toBeNull()
    })

    await execution.handleCancel()

    streamChannel!.onmessage?.({
      chunkIndex: 0,
      columns: [{ name: 'late', dataType: 'INT', nullable: false }],
      rows: [[99]],
      isLast: true,
      totalTimeMs: 10000,
      error: null,
    })

    const ctx = workspaceStore.getWorkspace('conn-1')?.tabs.find(tab => tab.id === tabId)?.context as any
    expect(vi.mocked(invoke).mock.calls.some(([cmd]) => cmd === 'db_cancel_query_on_session')).toBe(true)
    expect(ctx.isExecuting).toBe(false)
    expect(ctx.result).toBeNull()

    pending.catch(() => undefined)
  })

  it('keeps the current database unchanged when switching the session database fails', async () => {
    const { execution, workspaceStore, tabId } = setupQueryExecution()
    const emit = vi.fn()

    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === 'db_switch_database') {
        throw new Error('switch failed')
      }
      throw new Error(`unmocked command: ${command}`)
    })

    await execution.handleDatabaseSelect('analytics', emit)

    const ctx = workspaceStore.getWorkspace('conn-1')?.tabs.find(tab => tab.id === tabId)?.context as any
    expect(ctx.currentDatabase).toBe('demo')
    expect(emit).not.toHaveBeenCalled()
  })

  it('reports USE failures instead of updating the selected database optimistically', async () => {
    const { execution, workspaceStore, tabId } = setupQueryExecution()

    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === 'db_switch_database') {
        throw new Error('unknown database')
      }
      throw new Error(`unmocked command: ${command}`)
    })

    const result = await execution.handleExecute('USE analytics;')
    const ctx = workspaceStore.getWorkspace('conn-1')?.tabs.find(tab => tab.id === tabId)?.context as any

    expect(result.success).toBe(false)
    expect(ctx.currentDatabase).toBe('demo')
    expect(ctx.result).toMatchObject({
      isError: true,
      error: 'unknown database',
    })
  })

  it('begins transactions on the active tab session', async () => {
    const { execution, workspaceStore, tabId } = setupQueryExecution()

    vi.mocked(invoke).mockImplementation(async (command: string, args?: any) => {
      if (command === 'db_begin_transaction') {
        expect(args).toMatchObject({
          connectionId: 'conn-1',
          tabId,
        })
        return true
      }
      throw new Error(`unmocked command: ${command}`)
    })

    await execution.handleBeginTransaction()

    const ctx = workspaceStore.getWorkspace('conn-1')?.tabs.find(tab => tab.id === tabId)?.context as any
    expect(ctx.isInTransaction).toBe(true)
  })
})
