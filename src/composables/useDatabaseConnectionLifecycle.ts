import { ref } from 'vue'
import * as dbApi from '@/api/database'
import type { ConnectResult, QueryResult } from '@/types/database'
import type { ConnectionWorkspace, QueryTabContext } from '@/types/database-workspace'
import { ensureErrorString } from '@/types/error'

interface UseDatabaseConnectionLifecycleOptions {
  connectionId: () => string
  getWorkspace: () => ConnectionWorkspace
  getConnectionStoreState: () => { status: string } | undefined
  restoreWorkspaceState: () => Promise<unknown>
  ensureWorkspaceInitialized: () => void
  enableWorkspaceAutoSave: () => void
  updateConnectionStatus: (status: 'connected' | 'disconnected' | 'error', error?: string) => void
  updateQueryTabContext: (tabId: string, context: Partial<QueryTabContext>) => void
  clearSchemaCache: () => void
  disposeSchemaCache: () => void
  unregisterSchema: () => void
  clearObjectTree: () => void
  loadObjectTreeDatabases: (preloaded?: ConnectResult['databases']) => Promise<void>
  onConnected: () => void
  onDeactivate: () => void
  onResetDisconnected: () => void
  disconnectOnUnmount?: boolean
  logScope?: string
}

function makeErrorResult(error: string): QueryResult {
  return {
    columns: [],
    rows: [],
    affectedRows: 0,
    executionTimeMs: 0,
    isError: true,
    error,
    totalCount: null,
    truncated: false,
  }
}

export function useDatabaseConnectionLifecycle(options: UseDatabaseConnectionLifecycleOptions) {
  const isConnected = ref(false)
  const isConnecting = ref(false)

  let connectTask: Promise<boolean> | null = null
  let isUnmounted = false

  function logWarn(error: unknown) {
    console.warn(options.logScope ?? '[DatabaseView]', error)
  }

  function clearQueryResults() {
    const ws = options.getWorkspace()
    for (const tab of ws.tabs) {
      if (tab.type !== 'query') continue
      options.updateQueryTabContext(tab.id, {
        result: null,
        tableBrowse: undefined,
      })
    }
  }

  function clearActiveQueryErrorResult() {
    const ws = options.getWorkspace()
    const activeQueryTab = ws.tabs.find((tab) => tab.id === ws.activeTabId)
    if (activeQueryTab?.type !== 'query') return

    const context = activeQueryTab.context as QueryTabContext
    if (!context.result?.isError) return

    options.updateQueryTabContext(activeQueryTab.id, {
      result: null,
    })
  }

  function writeActiveQueryError(error: string) {
    const ws = options.getWorkspace()
    const activeQueryTab = ws.tabs.find((tab) => tab.id === ws.activeTabId)
    if (activeQueryTab?.type !== 'query') return

    options.updateQueryTabContext(activeQueryTab.id, {
      result: makeErrorResult(error),
    })
  }

  function resetDisconnectedState() {
    isConnected.value = false
    options.clearSchemaCache()
    options.onResetDisconnected()
    options.clearObjectTree()
    clearQueryResults()
  }

  async function runConnectAndLoad(): Promise<boolean> {
    isConnecting.value = true
    try {
      const result = await dbApi.dbConnect(options.connectionId())
      if (isUnmounted) {
        await dbApi.dbDisconnect(options.connectionId()).catch(logWarn)
        options.updateConnectionStatus('disconnected')
        return false
      }
      isConnected.value = true
      options.updateConnectionStatus('connected')
      options.onConnected()
      clearActiveQueryErrorResult()
      const preloaded = result.databases.length > 0 ? result.databases : undefined
      await options.loadObjectTreeDatabases(preloaded)
      return true
    } catch (error) {
      const message = ensureErrorString(error)
      isConnected.value = false
      options.updateConnectionStatus('error', message)
      options.onResetDisconnected()
      writeActiveQueryError(message)
      return false
    } finally {
      isConnecting.value = false
    }
  }

  async function ensureConnected(): Promise<boolean> {
    if (isConnected.value) return true
    if (connectTask) return connectTask

    connectTask = runConnectAndLoad().finally(() => {
      connectTask = null
    })
    return connectTask
  }

  async function mount() {
    isUnmounted = false
    await options.restoreWorkspaceState().catch(logWarn)
    options.ensureWorkspaceInitialized()
    options.enableWorkspaceAutoSave()
    await ensureConnected()
  }

  async function activate() {
    isUnmounted = false
    const storeState = options.getConnectionStoreState()
    const storeDisconnected = !storeState || storeState.status !== 'connected'
    if (storeDisconnected) {
      resetDisconnectedState()
    }

    if (!isConnected.value) {
      await ensureConnected()
      return
    }

    options.onConnected()
  }

  async function unmount() {
    isUnmounted = true
    options.disposeSchemaCache()
    options.unregisterSchema()
    options.onResetDisconnected()

    if ((options.disconnectOnUnmount ?? true) && isConnected.value) {
      await dbApi.dbDisconnect(options.connectionId()).catch(logWarn)
      options.updateConnectionStatus('disconnected')
    }

    isConnected.value = false
  }

  return {
    isConnected,
    isConnecting,
    ensureConnected,
    mount,
    activate,
    deactivate: options.onDeactivate,
    unmount,
    resetDisconnectedState,
  }
}
