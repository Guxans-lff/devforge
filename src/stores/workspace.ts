import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { usePersistence } from '@/plugins/persistence'
import type { Tab, PanelState, SidePanelId, WorkspaceSnapshot } from '@/types/workspace'
import { useDatabaseWorkspaceStore } from '@/stores/database-workspace'
import { useConnectionStore } from '@/stores/connections'
import { useTransferStore } from '@/stores/transfer'

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
    activeSidePanel: 'connections',
    sidePanelWidth: 260,
    showStatusBar: true,
    bottomPanelHeight: 200,
    bottomPanelCollapsed: true,
    bottomPanelTab: 'query-history',
    immersiveMode: false,
    zenMode: false,
  })

  const activeTab = computed(() =>
    tabs.value.find((t) => t.id === activeTabId.value),
  )

  /** 底部面板是否由程序自动打开（非用户手动操作），用于切换页面时自动关闭 */
  let _bottomPanelAutoOpened = false

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

    // 本地文件编辑器：未保存时弹确认
    if (tab.type === 'file-editor' && tab.dirty) {
      const confirmed = window.confirm(`文件 "${tab.title}" 有未保存的修改，确定要关闭吗？`)
      if (!confirmed) return
      const absPath = tab.meta?.absolutePath
      if (absPath) {
        import('@/stores/local-file-editor').then(({ useLocalFileEditorStore }) => {
          useLocalFileEditorStore().close(absPath)
        })
      }
    } else if (tab.type === 'file-editor') {
      const absPath = tab.meta?.absolutePath
      if (absPath) {
        import('@/stores/local-file-editor').then(({ useLocalFileEditorStore }) => {
          useLocalFileEditorStore().close(absPath)
        })
      }
    }

    // 关闭 database tab 时清理内部工作区状态并断开连接
    if (tab.type === 'database' && tab.connectionId) {
      const dbWorkspaceStore = useDatabaseWorkspaceStore()
      const connectionStore = useConnectionStore()
      dbWorkspaceStore.cleanup(tab.connectionId)
      connectionStore.updateConnectionStatus(tab.connectionId, 'disconnected')
      // 异步断开数据库连接，不阻塞 UI
      import('@/api/database').then(({ dbDisconnect }) => {
        dbDisconnect(tab.connectionId!).catch((e: unknown) => console.warn('[Workspace] 断开数据库连接失败:', e))
      })
    }

    // 关闭 Redis tab 时断开连接
    if (tab.type === 'redis' && tab.connectionId) {
      const connectionStore = useConnectionStore()
      connectionStore.updateConnectionStatus(tab.connectionId, 'disconnected')
      import('@/api/redis').then(({ redisDisconnect }) => {
        redisDisconnect(tab.connectionId!).catch((e: unknown) => console.warn('[Workspace] 断开 Redis 连接失败:', e))
      })
    }

    // 关闭本地终端 tab 时清理后端 PTY 资源（KeepAlive 的 backup）
    if (tab.type === 'terminal' && tab.meta?.isLocal) {
      import('@/api/local-shell').then(({ localShellClose }) => {
        localShellClose(tabId).catch((e: unknown) => console.warn('[Workspace] 关闭本地终端失败:', e))
      })
    }

    // 关闭 Git tab 时清理后端仓库缓存
    if (tab.type === 'git' && tab.meta?.repositoryPath) {
      const repoPath = tab.meta.repositoryPath
      import('@/api/git').then(({ gitClose }) => {
        gitClose(repoPath).catch((e: unknown) => console.warn('[Workspace] 关闭 Git 仓库失败:', e))
      })
    }

    // 关闭 SSH 终端 / SFTP tab 时，若该连接无其他打开的 tab，则更新连接状态
    if ((tab.type === 'terminal' || tab.type === 'file-manager') && tab.connectionId && !tab.meta?.isLocal) {
      const connId = tab.connectionId
      const hasOtherTabs = tabs.value.some(
        (t) => t.id !== tabId && t.connectionId === connId,
      )
      if (!hasOtherTabs) {
        const connectionStore = useConnectionStore()
        connectionStore.updateConnectionStatus(connId, 'disconnected')
        // SFTP 可以按 connectionId 断开；SSH 需要 sessionId，由组件 unmount 时处理
        if (tab.type === 'file-manager') {
          import('@/api/sftp').then(({ sftpDisconnect }) => {
            sftpDisconnect(connId).catch((e: unknown) => console.warn('[Workspace] 断开 SFTP 连接失败:', e))
          })
        }
      }
    }

    const index = tabs.value.findIndex((t) => t.id === tabId)
    tabs.value = tabs.value.filter((t) => t.id !== tabId)

    if (activeTabId.value === tabId) {
      const nextIndex = Math.min(index, tabs.value.length - 1)
      activeTabId.value = tabs.value[nextIndex]?.id ?? ''
    }
  }

  /** 更新指定 Tab 的标题 */
  function updateTabTitle(tabId: string, title: string) {
    tabs.value = tabs.value.map(t => t.id === tabId ? { ...t, title } : t)
  }

  /** 更新指定 Tab 的 meta（不可变更新） */
  function updateTabMeta(tabId: string, meta: Record<string, unknown>) {
    tabs.value = tabs.value.map(t =>
      t.id === tabId ? { ...t, meta: { ...t.meta, ...meta } } : t,
    )
  }

  function setActiveTab(tabId: string) {
    activeTabId.value = tabId
    // 切换页面时：如果底部面板是程序自动打开的（如传输），且无活跃传输任务，自动收起
    if (_bottomPanelAutoOpened && !panelState.value.bottomPanelCollapsed) {
      try {
        const transferStore = useTransferStore()
        const hasActive = Array.from(transferStore.tasks.values()).some(
          t => t.status === 'pending' || t.status === 'transferring',
        )
        if (!hasActive) {
          panelState.value = { ...panelState.value, bottomPanelCollapsed: true }
          _bottomPanelAutoOpened = false
        }
      } catch {
        // transferStore 尚未初始化时静默忽略
      }
    }
  }

  /** 设置激活的侧面板 */
  function setActiveSidePanel(panelId: SidePanelId | null) {
    panelState.value = { ...panelState.value, activeSidePanel: panelId }
  }

  /** 切换侧面板（单击已激活的图标→折叠） */
  function toggleSidePanel(panelId: SidePanelId) {
    if (panelState.value.activeSidePanel === panelId) {
      setActiveSidePanel(null)
    } else {
      setActiveSidePanel(panelId)
    }
  }

  /** 快捷键入口（Ctrl+B） */
  function toggleSidebar() {
    if (panelState.value.activeSidePanel) {
      setActiveSidePanel(null)
    } else {
      setActiveSidePanel('connections')
    }
  }

  function toggleBottomPanel() {
    _bottomPanelAutoOpened = false  // 用户手动操作，清除自动标记
    panelState.value = {
      ...panelState.value,
      bottomPanelCollapsed: !panelState.value.bottomPanelCollapsed,
    }
  }

  /** 设置侧面板宽度（拖拽调整） */
  function setSidePanelWidth(width: number) {
    panelState.value = { ...panelState.value, sidePanelWidth: Math.max(200, Math.min(500, width)) }
  }

  function setBottomPanelHeight(height: number) {
    panelState.value = { ...panelState.value, bottomPanelHeight: height }
  }

  function setBottomPanelTab(tab: PanelState['bottomPanelTab'], autoOpen = false) {
    _bottomPanelAutoOpened = autoOpen  // 仅程序触发时标记为自动打开
    panelState.value = {
      ...panelState.value,
      bottomPanelTab: tab,
      bottomPanelCollapsed: false,
    }
  }

  // ===== 沉浸式模式 =====

  /** 进入沉浸式前保存的面板状态快照 */
  let _panelSnapshot: {
    activeSidePanel: SidePanelId | null
    bottomPanelCollapsed: boolean
    showStatusBar: boolean
  } | null = null

  /** 用户是否手动退出了沉浸式（防止 watch 自动重新进入） */
  let _immersiveManuallyExited = false

  /** 进入沉浸式模式（隐藏 ActivityBar + SidePanel + BottomPanel + StatusBar） */
  function enterImmersive(): void {
    if (panelState.value.immersiveMode) return
    if (_immersiveManuallyExited) return  // 用户主动退出后不自动重新进入
    // 保存当前面板状态
    _panelSnapshot = {
      activeSidePanel: panelState.value.activeSidePanel,
      bottomPanelCollapsed: panelState.value.bottomPanelCollapsed,
      showStatusBar: panelState.value.showStatusBar,
    }
    panelState.value = {
      ...panelState.value,
      activeSidePanel: null,
      bottomPanelCollapsed: true,
      showStatusBar: false,
      immersiveMode: true,
    }
  }

  /** 退出沉浸式模式（恢复面板状态） */
  function exitImmersive(): void {
    if (!panelState.value.immersiveMode) return
    _immersiveManuallyExited = true  // 标记用户主动退出
    const snapshot = _panelSnapshot ?? {
      activeSidePanel: 'connections' as SidePanelId,
      bottomPanelCollapsed: true,
      showStatusBar: true,
    }
    _panelSnapshot = null
    panelState.value = {
      ...panelState.value,
      activeSidePanel: snapshot.activeSidePanel,
      bottomPanelCollapsed: snapshot.bottomPanelCollapsed,
      showStatusBar: snapshot.showStatusBar,
      immersiveMode: false,
    }
  }

  /** 重置沉浸式手动退出标记（离开 AI tab 时调用） */
  function resetImmersiveFlag(): void {
    _immersiveManuallyExited = false
  }

  // ===== Zen Mode =====

  /** Zen 模式前的面板快照 */
  let _zenSnapshot: {
    activeSidePanel: SidePanelId | null
    bottomPanelCollapsed: boolean
    showStatusBar: boolean
  } | null = null

  /** 切换 Zen 模式（隐藏一切 chrome，仅保留当前 Tab 主体） */
  function toggleZenMode(): void {
    if (!panelState.value.zenMode) {
      _zenSnapshot = {
        activeSidePanel: panelState.value.activeSidePanel,
        bottomPanelCollapsed: panelState.value.bottomPanelCollapsed,
        showStatusBar: panelState.value.showStatusBar,
      }
      panelState.value = {
        ...panelState.value,
        activeSidePanel: null,
        bottomPanelCollapsed: true,
        showStatusBar: false,
        zenMode: true,
      }
    } else {
      const snap = _zenSnapshot ?? {
        activeSidePanel: 'connections' as SidePanelId,
        bottomPanelCollapsed: true,
        showStatusBar: true,
      }
      _zenSnapshot = null
      panelState.value = {
        ...panelState.value,
        activeSidePanel: snap.activeSidePanel,
        bottomPanelCollapsed: snap.bottomPanelCollapsed,
        showStatusBar: snap.showStatusBar,
        zenMode: false,
      }
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
    version: 2,
    debounce: 500,
    migrations: {
      // v1 → v2：PanelState 字段替换（sidebarCollapsed/Width → activeSidePanel/sidePanelWidth/showStatusBar）
      2: (oldData) => {
        const data = oldData as PersistedWorkspace
        const ps = data.panelState as any
        if (ps) {
          ps.activeSidePanel = ps.sidebarCollapsed ? null : 'connections'
          ps.sidePanelWidth = ps.sidebarWidth ?? 260
          ps.showStatusBar = true
          delete ps.sidebarCollapsed
          delete ps.sidebarWidth
        }
        return data
      },
    },
    serialize: () => ({
      tabs: tabs.value,
      activeTabId: activeTabId.value,
      panelState: panelState.value,
    }),
    deserialize: (data) => {
      // 恢复 tabs（过滤掉无效的 tabs）
      // 本地终端 tab 无 connectionId，重启后 PTY 进程已丢失，不恢复
      const validTabs = (data.tabs ?? []).filter(tab => {
        if (tab.type === 'welcome' || tab.type === 'settings') return true
        if (tab.type === 'git') return !!tab.meta?.repositoryPath
        if (tab.type === 'file-editor') return !!tab.meta?.absolutePath
        if (tab.type === 'database' || tab.type === 'terminal' || tab.type === 'file-manager' || tab.type === 'redis') {
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
        panelState.value = { ...panelState.value, ...data.panelState }
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
        if (tab.type === 'git') return !!tab.meta?.repositoryPath
        if (tab.type === 'file-editor') return !!tab.meta?.absolutePath
        if (tab.type === 'database' || tab.type === 'terminal' || tab.type === 'file-manager' || tab.type === 'redis') {
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
      if (data.panelState) panelState.value = { ...panelState.value, ...data.panelState }

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
    updateTabMeta,
    updateTabTitle,
    setActiveTab,
    toggleSidebar,
    toggleBottomPanel,
    setActiveSidePanel,
    toggleSidePanel,
    setSidePanelWidth,
    setBottomPanelHeight,
    setBottomPanelTab,
    enterImmersive,
    exitImmersive,
    resetImmersiveFlag,
    toggleZenMode,
    // 持久化方法
    restoreState,
    enableAutoSave,
  }
})
