export type TabType = 'database' | 'terminal' | 'file-manager' | 'settings' | 'welcome' | 'multi-exec' | 'terminal-player' | 'redis' | 'git' | 'screenshot' | 'tunnel' | 'ai-chat' | 'file-editor'

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

/** Side Panel 面板 ID */
export type SidePanelId = 'connections' | 'files' | 'search' | 'ai'

export interface PanelState {
  /** 当前激活的侧面板，null 表示折叠 */
  activeSidePanel: SidePanelId | null
  /** 侧面板宽度（px） */
  sidePanelWidth: number
  /** 是否显示底部状态栏 */
  showStatusBar: boolean
  bottomPanelHeight: number
  bottomPanelCollapsed: boolean
  bottomPanelTab: 'query-history' | 'log' | 'transfer' | 'history' | 'dev'
  /** 沉浸式模式（AI 对话等场景，隐藏 ActivityBar/SidePanel/BottomPanel/StatusBar） */
  immersiveMode: boolean
  /** Zen Mode（极简：隐藏所有面板与 TabBar，仅保留当前 Tab 主体） */
  zenMode: boolean
}

// 工作区快照 - 用于持久化
export interface WorkspaceSnapshot {
  version: number  // 快照版本，用于未来兼容性
  tabs: Tab[]
  activeTabId: string
  panelState: PanelState
  timestamp: number
}
