import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { Tab, PanelState, WorkspaceSnapshot } from '@/types/workspace'
import { useDatabaseWorkspaceStore } from '@/stores/database-workspace'

const WORKSPACE_SNAPSHOT_KEY = 'devforge-workspace-snapshot'
const SNAPSHOT_VERSION = 1
const SAVE_DEBOUNCE_MS = 500

export const useWorkspaceStore = defineStore('workspace', () => {
  const tabs = ref<Tab[]>([
    {
      id: 'welcome',
      type: 'welcome',
      title: 'Welcome',
      closable: false,
    },
  ])

  const activeTabId = ref('welcome')

  const panelState = ref<PanelState>({
    sidebarWidth: 260,
    sidebarCollapsed: false,
    bottomPanelHeight: 200,
    bottomPanelCollapsed: true,
    bottomPanelTab: 'query-history',
  })

  const activeTab = computed(() =>
    tabs.value.find((t) => t.id === activeTabId.value),
  )

  function addTab(tab: Tab) {
    const existing = tabs.value.find((t) => t.id === tab.id)
    if (existing) {
      activeTabId.value = tab.id
      return
    }
    tabs.value = [...tabs.value, tab]
    activeTabId.value = tab.id
  }

  function closeTab(tabId: string) {
    const tab = tabs.value.find((t) => t.id === tabId)
    if (!tab || !tab.closable) return

    // 关闭 database tab 时清理内部工作区状态
    if (tab.type === 'database' && tab.connectionId) {
      const dbWorkspaceStore = useDatabaseWorkspaceStore()
      dbWorkspaceStore.cleanup(tab.connectionId)
    }

    const index = tabs.value.findIndex((t) => t.id === tabId)
    tabs.value = tabs.value.filter((t) => t.id !== tabId)

    if (activeTabId.value === tabId) {
      const nextIndex = Math.min(index, tabs.value.length - 1)
      activeTabId.value = tabs.value[nextIndex]?.id ?? ''
    }
  }

  function setActiveTab(tabId: string) {
    activeTabId.value = tabId
  }

  function toggleSidebar() {
    panelState.value = {
      ...panelState.value,
      sidebarCollapsed: !panelState.value.sidebarCollapsed,
    }
  }

  function toggleBottomPanel() {
    panelState.value = {
      ...panelState.value,
      bottomPanelCollapsed: !panelState.value.bottomPanelCollapsed,
    }
  }

  function setSidebarWidth(width: number) {
    panelState.value = { ...panelState.value, sidebarWidth: width }
  }

  function setBottomPanelHeight(height: number) {
    panelState.value = { ...panelState.value, bottomPanelHeight: height }
  }

  function setBottomPanelTab(tab: PanelState['bottomPanelTab']) {
    panelState.value = {
      ...panelState.value,
      bottomPanelTab: tab,
      bottomPanelCollapsed: false,
    }
  }

  // 状态持久化
  function createSnapshot(): WorkspaceSnapshot {
    return {
      version: SNAPSHOT_VERSION,
      tabs: tabs.value,
      activeTabId: activeTabId.value,
      panelState: panelState.value,
      timestamp: Date.now(),
    }
  }

  function saveSnapshot() {
    try {
      const snapshot = createSnapshot()
      localStorage.setItem(WORKSPACE_SNAPSHOT_KEY, JSON.stringify(snapshot))
    } catch (err) {
      console.warn('Failed to save workspace snapshot:', err)
    }
  }

  function loadSnapshot(): WorkspaceSnapshot | null {
    try {
      const raw = localStorage.getItem(WORKSPACE_SNAPSHOT_KEY)
      if (!raw) return null
      const snapshot = JSON.parse(raw) as WorkspaceSnapshot
      // 验证版本
      if (snapshot.version !== SNAPSHOT_VERSION) {
        console.warn('Workspace snapshot version mismatch, ignoring')
        return null
      }
      return snapshot
    } catch (err) {
      console.warn('Failed to load workspace snapshot:', err)
      return null
    }
  }

  function restoreSnapshot(snapshot: WorkspaceSnapshot) {
    // 恢复 tabs（过滤掉无效的 tabs）
    const validTabs = snapshot.tabs.filter(tab => {
      // Welcome tab 总是有效
      if (tab.type === 'welcome' || tab.type === 'settings') return true
      // 需要 connectionId 的 tab 必须有 connectionId
      if (tab.type === 'database' || tab.type === 'terminal' || tab.type === 'file-manager') {
        return !!tab.connectionId
      }
      return true
    })

    // 如果没有有效的 tabs，至少保留 welcome tab
    if (validTabs.length === 0) {
      validTabs.push({
        id: 'welcome',
        type: 'welcome',
        title: 'Welcome',
        closable: false,
      })
    }

    tabs.value = validTabs

    // 恢复 activeTabId（如果无效则使用第一个 tab）
    const validActiveTab = validTabs.find(t => t.id === snapshot.activeTabId)
    activeTabId.value = validActiveTab ? snapshot.activeTabId : (validTabs[0]?.id ?? '')

    // 恢复面板状态
    panelState.value = snapshot.panelState
  }

  function clearSnapshot() {
    try {
      localStorage.removeItem(WORKSPACE_SNAPSHOT_KEY)
    } catch (err) {
      console.warn('Failed to clear workspace snapshot:', err)
    }
  }

  // 监听状态变化，自动保存（防抖）
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  watch(
    [tabs, activeTabId, panelState],
    () => {
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        saveSnapshot()
      }, SAVE_DEBOUNCE_MS)
    },
    { deep: false }
  )

  return {
    tabs,
    activeTabId,
    activeTab,
    panelState,
    addTab,
    closeTab,
    setActiveTab,
    toggleSidebar,
    toggleBottomPanel,
    setSidebarWidth,
    setBottomPanelHeight,
    setBottomPanelTab,
    // 持久化方法
    saveSnapshot,
    loadSnapshot,
    restoreSnapshot,
    clearSnapshot,
  }
})
