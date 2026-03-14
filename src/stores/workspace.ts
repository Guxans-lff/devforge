import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { usePersistence } from '@/plugins/persistence'
import type { Tab, PanelState, WorkspaceSnapshot } from '@/types/workspace'
import { useDatabaseWorkspaceStore } from '@/stores/database-workspace'
import { useConnectionStore } from '@/stores/connections'

/** localStorage 遗留 key（仅用于一次性迁移） */
const LEGACY_SNAPSHOT_KEY = 'devforge-workspace-snapshot'

export const useWorkspaceStore = defineStore('workspace', () => {
  const tabs = ref<Tab[]>([
    {
      id: 'welcome',
      type: 'welcome',
      title: 'Homepage',
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
      // tab 已存在时更新 meta（用于跨组件传递参数，如文件管理器路径跳转）
      if (tab.meta) {
        existing.meta = { ...existing.meta, ...tab.meta }
      }
      activeTabId.value = tab.id
      return
    }
    tabs.value = [...tabs.value, tab]
    activeTabId.value = tab.id
  }

  function closeTab(tabId: string) {
    const tab = tabs.value.find((t) => t.id === tabId)
    if (!tab || !tab.closable) return

    // 关闭 database tab 时清理内部工作区状态并断开连接
    if (tab.type === 'database' && tab.connectionId) {
      const dbWorkspaceStore = useDatabaseWorkspaceStore()
      const connectionStore = useConnectionStore()
      dbWorkspaceStore.cleanup(tab.connectionId)
      connectionStore.updateConnectionStatus(tab.connectionId, 'disconnected')
      // 异步断开数据库连接，不阻塞 UI
      import('@/api/database').then(({ dbDisconnect }) => {
        dbDisconnect(tab.connectionId!).catch(() => { })
      })
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

  // ===== SQLite 持久化 =====
  /** 持久化快照格式（只保存必要数据，不包含运行时状态） */
  interface PersistedWorkspace {
    tabs: Tab[]
    activeTabId: string
    panelState: PanelState
  }

  const persistence = usePersistence<PersistedWorkspace>({
    key: 'workspace',
    version: 1,
    debounce: 500,
    serialize: () => ({
      tabs: tabs.value,
      activeTabId: activeTabId.value,
      panelState: panelState.value,
    }),
    deserialize: (data) => {
      // 恢复 tabs（过滤掉无效的 tabs）
      const validTabs = (data.tabs ?? []).filter(tab => {
        if (tab.type === 'welcome' || tab.type === 'settings') return true
        if (tab.type === 'database' || tab.type === 'terminal' || tab.type === 'file-manager') {
          return !!tab.connectionId
        }
        return true
      })

      if (validTabs.length === 0) {
        validTabs.push({
          id: 'welcome',
          type: 'welcome',
          title: 'Homepage',
          closable: false,
        })
      }

      tabs.value = validTabs

      const validActiveTab = validTabs.find(t => t.id === data.activeTabId)
      activeTabId.value = validActiveTab ? data.activeTabId : (validTabs[0]?.id ?? '')

      if (data.panelState) {
        panelState.value = data.panelState
      }
    },
  })

  /** 从 SQLite 恢复状态，若无则自动迁移 localStorage 数据 */
  let _restored = false
  async function restoreState(): Promise<boolean> {
    if (_restored) return true
    _restored = true

    // 优先从 SQLite 加载
    const loaded = await persistence.load()
    if (loaded) return true

    // SQLite 无数据 → 尝试从 localStorage 一次性迁移
    try {
      const raw = localStorage.getItem(LEGACY_SNAPSHOT_KEY)
      if (!raw) return false
      const snapshot = JSON.parse(raw) as WorkspaceSnapshot
      if (!snapshot || !Array.isArray(snapshot.tabs)) return false

      // 通过 deserialize 恢复（含 tab 有效性过滤）
      persistence.load() // no-op，但保持一致性
      // 手动构建并恢复
      const data: PersistedWorkspace = {
        tabs: snapshot.tabs,
        activeTabId: snapshot.activeTabId,
        panelState: snapshot.panelState,
      }
      // 直接用 deserialize 逻辑
      const validTabs = (data.tabs ?? []).filter(tab => {
        if (tab.type === 'welcome' || tab.type === 'settings') return true
        if (tab.type === 'database' || tab.type === 'terminal' || tab.type === 'file-manager') {
          return !!tab.connectionId
        }
        return true
      })
      if (validTabs.length === 0) {
        validTabs.push({ id: 'welcome', type: 'welcome', title: 'Homepage', closable: false })
      }
      tabs.value = validTabs
      const validActiveTab = validTabs.find(t => t.id === data.activeTabId)
      activeTabId.value = validActiveTab ? data.activeTabId : (validTabs[0]?.id ?? '')
      if (data.panelState) panelState.value = data.panelState

      // 立即写入 SQLite
      await persistence.saveImmediate()
      // 清理 localStorage 遗留
      localStorage.removeItem(LEGACY_SNAPSHOT_KEY)
      console.info('[Workspace] localStorage → SQLite 迁移完成')
      return true
    } catch (e) {
      console.warn('[Workspace] localStorage 迁移失败:', e)
      return false
    }
  }

  /** 启用自动保存（幂等） */
  let _autoSaveEnabled = false
  function enableAutoSave(): void {
    if (_autoSaveEnabled) return
    _autoSaveEnabled = true
    persistence.autoSave([tabs, activeTabId, panelState])
  }

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
    restoreState,
    enableAutoSave,
  }
})
