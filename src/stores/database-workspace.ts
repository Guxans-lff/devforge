import { defineStore } from 'pinia'
import { ref } from 'vue'
import { i18n } from '@/locales'
import { usePersistence } from '@/plugins/persistence'
import type {
  InnerTab,
  ConnectionWorkspace,
  QueryTabContext,
  TableEditorTabContext,
  ImportTabContext,
  TableDataTabContext,
  SchemaCompareTabContext,
} from '@/types/database-workspace'

/** 持久化快照中的标签页（只保存可恢复的最小信息） */
interface PersistedTab {
  id: string
  type: string
  title: string
  closable: boolean
  /** 查询类型标签页的 SQL 内容 */
  sql?: string
  /** 查询类型标签页的当前数据库 */
  currentDatabase?: string
}

/** 持久化快照中的工作区 */
interface PersistedWorkspace {
  tabs: PersistedTab[]
  activeTabId: string
}

/** 持久化快照格式 */
interface PersistedState {
  workspaces: Record<string, PersistedWorkspace>
}

export const useDatabaseWorkspaceStore = defineStore('database-workspace', () => {
  const workspaces = ref<Map<string, ConnectionWorkspace>>(new Map())

  const queryCounters = new Map<string, number>()

  /** 已关闭的标签页记录（按连接分组，每个连接最多 20 条） */
  const closedTabs = ref<Map<string, InnerTab[]>>(new Map())

  function nextQueryCounter(connectionId: string): number {
    const count = (queryCounters.get(connectionId) ?? 0) + 1
    queryCounters.set(connectionId, count)
    return count
  }

  function getOrCreate(connectionId: string): ConnectionWorkspace {
    const existing = workspaces.value.get(connectionId)
    if (existing) return existing

    const counter = nextQueryCounter(connectionId)
    const defaultTab: InnerTab = {
      id: `${connectionId}-query-${counter}`,
      type: 'query',
      title: `Query ${counter}`,
      closable: false,
      context: {
        type: 'query',
        sql: '',
        result: null,
        isExecuting: false,
      },
    }

    const workspace: ConnectionWorkspace = {
      tabs: [defaultTab],
      activeTabId: defaultTab.id,
    }

    workspaces.value = new Map(workspaces.value).set(connectionId, workspace)
    return workspace
  }

  function getWorkspace(connectionId: string): ConnectionWorkspace | undefined {
    return workspaces.value.get(connectionId)
  }

  function addQueryTab(connectionId: string): InnerTab {
    const ws = getOrCreate(connectionId)
    const counter = nextQueryCounter(connectionId)
    const tab: InnerTab = {
      id: `${connectionId}-query-${counter}`,
      type: 'query',
      title: `Query ${counter}`,
      closable: true,
      context: {
        type: 'query',
        sql: '',
        result: null,
        isExecuting: false,
      },
    }
    const updated: ConnectionWorkspace = {
      tabs: [...ws.tabs, tab],
      activeTabId: tab.id,
    }
    workspaces.value = new Map(workspaces.value).set(connectionId, updated)
    return tab
  }

  function addInnerTab(connectionId: string, tab: InnerTab): void {
    const ws = getOrCreate(connectionId)
    const existing = ws.tabs.find((t) => t.id === tab.id)
    if (existing) {
      // 已存在则激活
      const updated: ConnectionWorkspace = { ...ws, activeTabId: tab.id }
      workspaces.value = new Map(workspaces.value).set(connectionId, updated)
      return
    }
    const updated: ConnectionWorkspace = {
      tabs: [...ws.tabs, tab],
      activeTabId: tab.id,
    }
    workspaces.value = new Map(workspaces.value).set(connectionId, updated)
  }

  function closeInnerTab(connectionId: string, tabId: string): void {
    const ws = workspaces.value.get(connectionId)
    if (!ws) return

    const tab = ws.tabs.find((t) => t.id === tabId)
    if (!tab || !tab.closable) return

    // 保存到已关闭列表（用于撤销关闭）
    const existing = closedTabs.value.get(connectionId) ?? []
    const updatedClosed = [{ ...tab }, ...existing].slice(0, 20)
    closedTabs.value = new Map(closedTabs.value).set(connectionId, updatedClosed)

    // 如果关闭的是查询 Tab，释放其 Session 连接
    if (tab.type === 'query') {
      import('@/api/database').then(({ dbReleaseSession }) => {
        dbReleaseSession(connectionId, tabId).catch(() => {})
      })
    }

    const index = ws.tabs.findIndex((t) => t.id === tabId)
    const newTabs = ws.tabs.filter((t) => t.id !== tabId)

    let newActiveId = ws.activeTabId
    if (ws.activeTabId === tabId && newTabs.length > 0) {
      const nextIndex = Math.min(index, newTabs.length - 1)
      newActiveId = newTabs[nextIndex]?.id ?? ''
    }

    const updated: ConnectionWorkspace = {
      tabs: newTabs,
      activeTabId: newActiveId,
    }
    workspaces.value = new Map(workspaces.value).set(connectionId, updated)
  }

  function closeOtherTabs(connectionId: string, tabId: string): void {
    const ws = workspaces.value.get(connectionId)
    if (!ws) return

    const newTabs = ws.tabs.filter((t) => t.id === tabId || !t.closable)
    const updated: ConnectionWorkspace = {
      tabs: newTabs,
      activeTabId: tabId,
    }
    workspaces.value = new Map(workspaces.value).set(connectionId, updated)
  }

  function closeAllTabs(connectionId: string): void {
    const ws = workspaces.value.get(connectionId)
    if (!ws) return

    const newTabs = ws.tabs.filter((t) => !t.closable)
    const updated: ConnectionWorkspace = {
      tabs: newTabs,
      activeTabId: newTabs[0]?.id ?? '',
    }
    workspaces.value = new Map(workspaces.value).set(connectionId, updated)
  }

  function setActiveInnerTab(connectionId: string, tabId: string): void {
    const ws = workspaces.value.get(connectionId)
    if (!ws) return

    const updated: ConnectionWorkspace = { ...ws, activeTabId: tabId }
    workspaces.value = new Map(workspaces.value).set(connectionId, updated)
  }

  function updateTabContext(
    connectionId: string,
    tabId: string,
    context: Partial<QueryTabContext | TableEditorTabContext | ImportTabContext | TableDataTabContext | SchemaCompareTabContext>,
  ): void {
    const ws = workspaces.value.get(connectionId)
    if (!ws) return

    const newTabs = ws.tabs.map((t) => {
      if (t.id !== tabId) return t
      return { ...t, context: { ...t.context, ...context } }
    })

    const updated: ConnectionWorkspace = { ...ws, tabs: newTabs as InnerTab[] }
    workspaces.value = new Map(workspaces.value).set(connectionId, updated)
  }

  function setTabDirty(connectionId: string, tabId: string, dirty: boolean): void {
    const ws = workspaces.value.get(connectionId)
    if (!ws) return

    const newTabs = ws.tabs.map((t) => {
      if (t.id !== tabId) return t
      return { ...t, dirty }
    })

    const updated: ConnectionWorkspace = { ...ws, tabs: newTabs }
    workspaces.value = new Map(workspaces.value).set(connectionId, updated)
  }

  function cleanup(connectionId: string): void {
    const newMap = new Map(workspaces.value)
    newMap.delete(connectionId)
    workspaces.value = newMap
    queryCounters.delete(connectionId)
  }

  // 创建特定类型的 tab 辅助函数
  function openTableEditor(connectionId: string, database: string, table?: string): void {
    const tabId = table
      ? `${connectionId}-table-editor-${database}-${table}`
      : `${connectionId}-table-editor-new-${Date.now()}`
    const tab: InnerTab = {
      id: tabId,
      type: 'table-editor',
      title: table
        ? `${(i18n.global as any).t('tableEditor.alterTable')}: ${table}`
        : (i18n.global as any).t('tableEditor.createTable'),
      closable: true,
      context: { type: 'table-editor', database, table },
    }
    addInnerTab(connectionId, tab)
  }

  function openImport(connectionId: string, database: string, table: string, columns: string[]): void {
    const tabId = `${connectionId}-import-${database}-${table}`
    const tab: InnerTab = {
      id: tabId,
      type: 'import',
      title: `${(i18n.global as any).t('dataImport.title')}: ${table}`,
      closable: true,
      context: { type: 'import', database, table, columns },
    }
    addInnerTab(connectionId, tab)
  }

  function openTableData(connectionId: string, database: string, table: string): void {
    const tabId = `${connectionId}-table-data-${database}-${table}`
    const tab: InnerTab = {
      id: tabId,
      type: 'table-data',
      title: table,
      closable: true,
      context: { type: 'table-data', database, table, page: 1, pageSize: 100 },
    }
    addInnerTab(connectionId, tab)
  }

  function openSchemaCompare(connectionId: string): void {
    const tabId = `${connectionId}-schema-compare`
    const tab: InnerTab = {
      id: tabId,
      type: 'schema-compare',
      title: (i18n.global as any).t('schemaCompare.title'),
      closable: true,
      context: { type: 'schema-compare' },
    }
    addInnerTab(connectionId, tab)
  }

  /** 打开性能监控仪表盘标签页 */
  function openPerformance(connectionId: string): void {
    const tabId = `${connectionId}-performance`
    const tab: InnerTab = {
      id: tabId,
      type: 'performance',
      title: '性能监控',
      closable: true,
      context: { type: 'performance', activeSubTab: 'dashboard' },
    }
    addInnerTab(connectionId, tab)
  }

  /** 打开用户权限管理标签页 */
  function openUserManagement(connectionId: string): void {
    const tabId = `${connectionId}-user-management`
    const tab: InnerTab = {
      id: tabId,
      type: 'user-management',
      title: '用户管理',
      closable: true,
      context: { type: 'user-management' },
    }
    addInnerTab(connectionId, tab)
  }

  /** 打开 ER 关系图标签页 */
  function openErDiagram(connectionId: string, database: string): void {
    const tabId = `${connectionId}-er-diagram-${database}`
    const tab: InnerTab = {
      id: tabId,
      type: 'er-diagram',
      title: `ER: ${database}`,
      closable: true,
      context: { type: 'er-diagram', database },
    }
    addInnerTab(connectionId, tab)
  }

  /** 恢复最近关闭的标签页 */
  function reopenLastClosedTab(connectionId: string): InnerTab | null {
    const stack = closedTabs.value.get(connectionId)
    if (!stack || stack.length === 0) return null

    const [restored, ...rest] = stack
    if (!restored) return null
    closedTabs.value = new Map(closedTabs.value).set(connectionId, rest)

    // 用新 ID 重新添加，避免冲突
    const newTab: InnerTab = {
      ...restored,
      type: restored.type,
      title: restored.title,
      id: `${connectionId}-restored-${Date.now()}`,
      closable: true,
    }
    addInnerTab(connectionId, newTab)
    return newTab
  }

  /** 获取某连接已关闭标签页数量 */
  function getClosedTabCount(connectionId: string): number {
    return closedTabs.value.get(connectionId)?.length ?? 0
  }

  // ===== 持久化 =====
  const persistence = usePersistence<PersistedState>({
    key: 'database-workspace',
    version: 1,
    debounce: 1000,
    serialize: () => {
      const result: Record<string, PersistedWorkspace> = {}
      for (const [connId, ws] of workspaces.value) {
        // 只持久化 query 类型标签页（其他类型依赖活跃连接，不适合恢复）
        const persistedTabs: PersistedTab[] = ws.tabs
          .filter(t => t.type === 'query')
          .map(t => {
            const ctx = t.context as QueryTabContext
            return {
              id: t.id,
              type: t.type,
              title: t.title,
              closable: t.closable,
              sql: ctx?.sql ?? '',
              currentDatabase: ctx?.currentDatabase,
            }
          })
        if (persistedTabs.length > 0) {
          result[connId] = {
            tabs: persistedTabs,
            activeTabId: ws.activeTabId,
          }
        }
      }
      return { workspaces: result }
    },
    deserialize: (data) => {
      const newMap = new Map<string, ConnectionWorkspace>()
      for (const [connId, ws] of Object.entries(data.workspaces)) {
        const tabs: InnerTab[] = ws.tabs.map(pt => ({
          id: pt.id,
          type: pt.type as InnerTab['type'],
          title: pt.title,
          closable: pt.closable,
          context: {
            type: 'query' as const,
            sql: pt.sql ?? '',
            result: null,
            isExecuting: false,
            currentDatabase: pt.currentDatabase,
          },
        }))
        if (tabs.length > 0) {
          newMap.set(connId, {
            tabs,
            activeTabId: ws.activeTabId,
          })
          // 恢复 queryCounter 以避免 ID 冲突
          const maxIdx = tabs.reduce((max, t) => {
            const match = t.id.match(/-query-(\d+)$/)
            return match ? Math.max(max, parseInt(match[1]!, 10)) : max
          }, 0)
          if (maxIdx > 0) {
            queryCounters.set(connId, maxIdx)
          }
        }
      }
      if (newMap.size > 0) {
        workspaces.value = newMap
      }
    },
  })

  /** 从 SQLite 恢复上次的标签页状态 */
  let _restored = false
  async function restoreState(): Promise<boolean> {
    if (_restored) return true
    _restored = true
    return persistence.load()
  }

  /** 设置自动保存（幂等，仅首次调用生效） */
  let _autoSaveEnabled = false
  function enableAutoSave(): void {
    if (_autoSaveEnabled) return
    _autoSaveEnabled = true
    persistence.autoSave(() => workspaces.value)
  }

  return {
    workspaces,
    closedTabs,
    getOrCreate,
    getWorkspace,
    addQueryTab,
    addInnerTab,
    closeInnerTab,
    closeOtherTabs,
    closeAllTabs,
    setActiveInnerTab,
    updateTabContext,
    setTabDirty,
    cleanup,
    openTableEditor,
    openImport,
    openTableData,
    openSchemaCompare,
    openPerformance,
    openUserManagement,
    openErDiagram,
    reopenLastClosedTab,
    getClosedTabCount,
    restoreState,
    enableAutoSave,
  }
})
