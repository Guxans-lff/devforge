import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Tab, PanelState } from '@/types/workspace'

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
    bottomPanelTab: 'output',
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
  }
})
