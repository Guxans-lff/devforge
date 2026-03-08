import { defineStore } from 'pinia'
import { ref } from 'vue'
import type {
  InnerTab,
  ConnectionWorkspace,
  QueryTabContext,
  TableEditorTabContext,
  ImportTabContext,
  TableDataTabContext,
  SchemaCompareTabContext,
} from '@/types/database-workspace'

export const useDatabaseWorkspaceStore = defineStore('database-workspace', () => {
  const workspaces = ref<Map<string, ConnectionWorkspace>>(new Map())

  const queryCounters = new Map<string, number>()

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
      title: table ? `Alter: ${table}` : 'New Table',
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
      title: `Import: ${table}`,
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
      title: 'Schema Compare',
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

  return {
    workspaces,
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
  }
})
