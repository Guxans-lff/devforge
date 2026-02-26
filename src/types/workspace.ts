export type TabType = 'database' | 'terminal' | 'file-manager' | 'settings' | 'welcome'

export interface Tab {
  id: string
  type: TabType
  title: string
  icon?: string
  connectionId?: string
  closable: boolean
  dirty?: boolean
}

export interface PanelState {
  sidebarWidth: number
  sidebarCollapsed: boolean
  bottomPanelHeight: number
  bottomPanelCollapsed: boolean
  bottomPanelTab: 'output' | 'log' | 'transfer' | 'history'
}
