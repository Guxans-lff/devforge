import { onMounted, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWorkspaceStore } from '@/stores/workspace'
import { useDatabaseWorkspaceStore } from '@/stores/database-workspace'
import { useSettingsStore } from '@/stores/settings'
import { useCommandPaletteStore } from '@/stores/command-palette'
import { useTheme } from '@/composables/useTheme'

function parseShortcut(keys: string): { ctrl: boolean; shift: boolean; alt: boolean; key: string; isChord: boolean; chordKeys?: string[] } {
  // 检查是否是组合键（如 "Ctrl+K T"）
  const isChord = keys.includes(' ')

  if (isChord) {
    const chordKeys = keys.split(' ')
    return {
      ctrl: false,
      shift: false,
      alt: false,
      key: '',
      isChord: true,
      chordKeys,
    }
  }

  const parts = keys.split('+').map(p => p.trim())
  return {
    ctrl: parts.includes('Ctrl'),
    shift: parts.includes('Shift'),
    alt: parts.includes('Alt'),
    key: parts[parts.length - 1] || '',  // last part is the actual key
    isChord: false,
  }
}

function matchesParsed(e: KeyboardEvent, parsed: ReturnType<typeof parseShortcut>): boolean {
  if (parsed.isChord) return false

  const ctrl = e.ctrlKey || e.metaKey

  if (parsed.ctrl !== ctrl) return false
  if (parsed.shift !== e.shiftKey) return false
  if (parsed.alt !== e.altKey) return false

  const eventKey = e.key === '`' ? '`' : e.key
  const keyMatch = eventKey.toLowerCase() === parsed.key.toLowerCase()

  // 兼容性处理：如果按的是 K 且 parsed.key 是 P (旧配置)，或者反之，也可以考虑兼容
  // 但目前直接改默认值为 Ctrl+K 更干净
  return keyMatch
}

function matchesShortcut(e: KeyboardEvent, keys: string): boolean {
  return matchesParsed(e, parseShortcut(keys))
}

export function useKeyboardShortcuts() {
  const workspace = useWorkspaceStore()
  const dbWorkspaceStore = useDatabaseWorkspaceStore()
  const settingsStore = useSettingsStore()
  const commandPaletteStore = useCommandPaletteStore()
  const { toggleTheme } = useTheme()
  const { t } = useI18n()

  // 组合键状态
  const chordFirstKey = ref<string | null>(null)
  const chordTimeout = ref<ReturnType<typeof setTimeout> | null>(null)

  // 预解析快捷键缓存，避免每次按键都重新解析
  let parsedShortcutsCache: { id: string; keys: string; parsed: ReturnType<typeof parseShortcut> }[] = []
  let lastShortcutsRef: any = null

  function ensureParsedCache() {
    const shortcuts = settingsStore.settings.shortcuts
    if (shortcuts !== lastShortcutsRef) {
      lastShortcutsRef = shortcuts
      parsedShortcutsCache = shortcuts.map(s => ({
        id: s.id,
        keys: s.keys,
        parsed: parseShortcut(s.keys),
      }))
    }
  }

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
    commandPalette: () => {
      commandPaletteStore.toggle()
    },
    toggleTheme: () => {
      toggleTheme()
    },
    reopenTab: () => {
      // 从当前活跃的数据库标签页中恢复关闭的内部标签
      const activeTab = workspace.tabs.find(t => t.id === workspace.activeTabId)
      if (activeTab?.type === 'database' && activeTab.connectionId) {
        dbWorkspaceStore.reopenLastClosedTab(activeTab.connectionId)
      }
    },
  }

  function resetChord() {
    chordFirstKey.value = null
    if (chordTimeout.value) {
      clearTimeout(chordTimeout.value)
      chordTimeout.value = null
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    ensureParsedCache()

    // 处理组合键
    for (const { id, parsed } of parsedShortcutsCache) {
      if (parsed.isChord && parsed.chordKeys) {
        const [first, second] = parsed.chordKeys

        if (!chordFirstKey.value) {
          if (first && matchesShortcut(e, first)) {
            e.preventDefault()
            chordFirstKey.value = first
            chordTimeout.value = setTimeout(resetChord, 1000)
            return
          }
        } else if (chordFirstKey.value === first) {
          if (second && matchesShortcut(e, second)) {
            e.preventDefault()
            resetChord()
            const action = actions[id]
            if (action) {
              action()
            }
            return
          }
        }
      }
    }

    // 处理普通快捷键（使用预解析缓存，避免重复解析）
    for (const { id, parsed } of parsedShortcutsCache) {
      if (!parsed.isChord && matchesParsed(e, parsed)) {
        const action = actions[id]
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

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', handleKeydown)
    resetChord()
  })
}
