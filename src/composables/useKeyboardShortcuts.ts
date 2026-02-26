import { onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWorkspaceStore } from '@/stores/workspace'
import { useSettingsStore } from '@/stores/settings'

function parseShortcut(keys: string): { ctrl: boolean; shift: boolean; alt: boolean; key: string } {
  const parts = keys.split('+').map(p => p.trim())
  return {
    ctrl: parts.includes('Ctrl'),
    shift: parts.includes('Shift'),
    alt: parts.includes('Alt'),
    key: parts[parts.length - 1] || '',  // last part is the actual key
  }
}

function matchesShortcut(e: KeyboardEvent, keys: string): boolean {
  const parsed = parseShortcut(keys)
  const ctrl = e.ctrlKey || e.metaKey

  if (parsed.ctrl !== ctrl) return false
  if (parsed.shift !== e.shiftKey) return false
  if (parsed.alt !== e.altKey) return false

  // Handle special key names
  const eventKey = e.key === '`' ? '`' : e.key
  return eventKey.toLowerCase() === parsed.key.toLowerCase()
}

export function useKeyboardShortcuts() {
  const workspace = useWorkspaceStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  // Action handlers mapped by shortcut id
  const actions: Record<string, () => void> = {
    newConnection: () => {
      window.dispatchEvent(new CustomEvent('devforge:new-connection'))
    },
    newTab: () => {
      const id = `tab-${Date.now()}`
      workspace.addTab({ id, type: 'welcome', title: t('tab.welcome'), closable: true })
    },
    closeTab: () => {
      if (workspace.activeTabId) {
        workspace.closeTab(workspace.activeTabId)
      }
    },
    nextTab: () => {
      const tabs = workspace.tabs
      if (tabs.length <= 1) return
      const currentIndex = tabs.findIndex(t => t.id === workspace.activeTabId)
      const nextIndex = (currentIndex + 1) % tabs.length
      const nextTab = tabs[nextIndex]
      if (nextTab) workspace.setActiveTab(nextTab.id)
    },
    settings: () => {
      workspace.addTab({ id: 'settings', type: 'settings', title: t('tab.settings'), closable: true })
    },
    toggleSidebar: () => {
      workspace.toggleSidebar()
    },
    toggleBottomPanel: () => {
      workspace.toggleBottomPanel()
    },
  }

  function handleKeydown(e: KeyboardEvent) {
    for (const shortcut of settingsStore.settings.shortcuts) {
      if (matchesShortcut(e, shortcut.keys)) {
        const action = actions[shortcut.id]
        if (action) {
          e.preventDefault()
          action()
          return
        }
      }
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', handleKeydown)
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeydown)
  })
}
