import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useConnectionStore } from './connections'
import { useWorkspaceStore } from './workspace'
import { useI18n } from 'vue-i18n'

export interface CommandItem {
  id: string
  label: string
  description?: string
  icon?: string
  category: 'connection' | 'view' | 'settings' | 'recent' | 'action' | 'schema' | 'column' | 'history' | 'snippet'
  keywords?: string[]
  action: () => void
}

export interface RecentItem {
  id: string
  type: 'connection' | 'file'
  label: string
  timestamp: number
  meta?: Record<string, string>
}

const RECENT_ITEMS_KEY = 'devforge-recent-items'
const MAX_RECENT_ITEMS = 10

export const useCommandPaletteStore = defineStore('command-palette', () => {
  const { t } = useI18n()
  const connectionStore = useConnectionStore()
  const workspaceStore = useWorkspaceStore()

  const isOpen = ref(false)
  const recentItems = ref<RecentItem[]>(loadRecentItems())

  // 基础命令列表
  const baseCommands = computed<CommandItem[]>(() => [
    // 连接管理
    {
      id: 'new-connection',
      label: t('command.newConnection'),
      description: t('command.newConnectionDesc'),
      icon: 'Plus',
      category: 'connection',
      keywords: ['new', 'create', 'connection', '新建', '连接'],
      action: () => {
        window.dispatchEvent(new CustomEvent('devforge:new-connection'))
        close()
      },
    },
    {
      id: 'refresh-connections',
      label: t('command.refreshConnections'),
      description: t('command.refreshConnectionsDesc'),
      icon: 'RefreshCw',
      category: 'connection',
      keywords: ['refresh', 'reload', '刷新', '重新加载'],
      action: () => {
        connectionStore.loadConnections()
        close()
      },
    },
    // 视图控制
    {
      id: 'toggle-sidebar',
      label: t('command.toggleSidebar'),
      description: t('command.toggleSidebarDesc'),
      icon: 'PanelLeft',
      category: 'view',
      keywords: ['sidebar', 'panel', 'toggle', '侧边栏', '切换'],
      action: () => {
        workspaceStore.toggleSidebar()
        close()
      },
    },
    {
      id: 'toggle-bottom-panel',
      label: t('command.toggleBottomPanel'),
      description: t('command.toggleBottomPanelDesc'),
      icon: 'PanelBottom',
      category: 'view',
      keywords: ['bottom', 'panel', 'toggle', '底部', '面板', '切换'],
      action: () => {
        workspaceStore.toggleBottomPanel()
        close()
      },
    },
    // 设置
    {
      id: 'open-settings',
      label: t('command.openSettings'),
      description: t('command.openSettingsDesc'),
      icon: 'Settings',
      category: 'settings',
      keywords: ['settings', 'preferences', 'config', '设置', '配置'],
      action: () => {
        workspaceStore.addTab({
          id: 'settings',
          type: 'settings',
          title: t('tab.settings'),
          closable: true,
        })
        close()
      },
    },
    // 标签页操作
    {
      id: 'close-tab',
      label: t('command.closeTab'),
      description: t('command.closeTabDesc'),
      icon: 'X',
      category: 'action',
      keywords: ['close', 'tab', '关闭', '标签'],
      action: () => {
        if (workspaceStore.activeTabId) {
          workspaceStore.closeTab(workspaceStore.activeTabId)
        }
        close()
      },
    },
    {
      id: 'close-all-tabs',
      label: t('command.closeAllTabs'),
      description: t('command.closeAllTabsDesc'),
      icon: 'XCircle',
      category: 'action',
      keywords: ['close', 'all', 'tabs', '关闭', '所有', '标签'],
      action: () => {
        const closableTabs = workspaceStore.tabs.filter(t => t.closable)
        closableTabs.forEach(t => workspaceStore.closeTab(t.id))
        close()
      },
    },
  ])

  // 连接命令（动态生成）
  const connectionCommands = computed<CommandItem[]>(() => {
    return connectionStore.connectionList.map(conn => ({
      id: `conn-${conn.record.id}`,
      label: conn.record.name,
      description: `${conn.record.type.toUpperCase()} - ${conn.record.host}:${conn.record.port}`,
      icon: conn.record.type === 'database' ? 'Database' : conn.record.type === 'ssh' ? 'Terminal' : 'FolderOpen',
      category: 'connection' as const,
      keywords: [conn.record.name, conn.record.host, conn.record.type],
      action: () => {
        openConnection(conn.record.id, conn.record.name, conn.record.type)
        addRecentItem({
          id: conn.record.id,
          type: 'connection',
          label: conn.record.name,
          timestamp: Date.now(),
        })
        close()
      },
    }))
  })

  // 所有命令
  const allCommands = computed<CommandItem[]>(() => [
    ...baseCommands.value,
    ...connectionCommands.value,
  ])

  function open() {
    isOpen.value = true
  }

  function close() {
    isOpen.value = false
  }

  function toggle() {
    isOpen.value = !isOpen.value
  }

  function openConnection(id: string, name: string, type: string) {
    const tabId = `${type}-${id}`
    const tabType = type === 'database' ? 'database' : type === 'ssh' ? 'terminal' : 'file-manager' as const

    workspaceStore.addTab({
      id: tabId,
      type: tabType,
      title: name,
      icon: type === 'database' ? 'Database' : type === 'ssh' ? 'Terminal' : 'FolderOpen',
      connectionId: id,
      closable: true,
    })
  }

  function addRecentItem(item: RecentItem) {
    // 移除重复项
    const filtered = recentItems.value.filter(i => i.id !== item.id)
    // 添加到开头
    recentItems.value = [item, ...filtered].slice(0, MAX_RECENT_ITEMS)
    saveRecentItems()
  }

  function clearRecentItems() {
    recentItems.value = []
    saveRecentItems()
  }

  function loadRecentItems(): RecentItem[] {
    try {
      const raw = localStorage.getItem(RECENT_ITEMS_KEY)
      if (raw) {
        return JSON.parse(raw)
      }
    } catch {
      // ignore
    }
    return []
  }

  function saveRecentItems() {
    try {
      localStorage.setItem(RECENT_ITEMS_KEY, JSON.stringify(recentItems.value))
    } catch {
      // ignore
    }
  }

  return {
    isOpen,
    recentItems,
    baseCommands,
    connectionCommands,
    allCommands,
    open,
    close,
    toggle,
    addRecentItem,
    clearRecentItems,
  }
})
