export type TabType = 'database' | 'terminal' | 'file-manager' | 'settings' | 'welcome' | 'multi-exec' | 'terminal-player' | 'redis' | 'git' | 'screenshot' | 'tunnel' | 'ai-chat'

export interface Tab {
  id: string
  type: TabType
  title: string
  icon?: string
  connectionId?: string
  closable: boolean
  dirty?: boolean
  meta?: Record<string, string>
}

export interface PanelState {
  sidebarWidth: number
  sidebarCollapsed: boolean
  bottomPanelHeight: number
  bottomPanelCollapsed: boolean
  bottomPanelTab: 'query-history' | 'log' | 'transfer' | 'history' | 'dev'
  /** 沉浸式模式（AI 对话等场景，隐藏 Sidebar/BottomPanel） */
  immersiveMode: boolean
}

// 工作区快照 - 用于持久化
export interface WorkspaceSnapshot {
  version: number  // 快照版本，用于未来兼容性
  tabs: Tab[]
  activeTabId: string
  panelState: PanelState
  timestamp: number
}
