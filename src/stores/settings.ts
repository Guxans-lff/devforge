import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

const STORAGE_KEY = 'devforge-settings'

export type ShortcutCategory = 'connection' | 'tab' | 'editor' | 'view' | 'general'

export interface ShortcutBinding {
  id: string
  keys: string  // e.g. "Ctrl+N", "Ctrl+Shift+T"
  category: ShortcutCategory
  description?: string  // 用于显示的描述
}

export interface AppSettings {
  /** Editor font size in px */
  editorFontSize: number
  /** Editor tab width (spaces) */
  editorTabSize: number
  /** Editor word wrap */
  editorWordWrap: boolean
  /** Editor minimap */
  editorMinimap: boolean
  /** Terminal font size in px */
  terminalFontSize: number
  /** Terminal font family */
  terminalFontFamily: string
  /** Terminal cursor style */
  terminalCursorStyle: 'block' | 'underline' | 'bar'
  /** Terminal cursor blink */
  terminalCursorBlink: boolean
  /** UI font size in px */
  uiFontSize: number
  /** Custom keyboard shortcuts */
  shortcuts: ShortcutBinding[]
}

const defaultShortcuts: ShortcutBinding[] = [
  // 连接管理 (8个)
  { id: 'newConnection', keys: 'Ctrl+N', category: 'connection' },
  { id: 'duplicateConnection', keys: 'Ctrl+Shift+N', category: 'connection' },
  { id: 'editConnection', keys: 'Ctrl+E', category: 'connection' },
  { id: 'disconnectConnection', keys: 'Ctrl+D', category: 'connection' },
  { id: 'reconnectConnection', keys: 'Ctrl+R', category: 'connection' },
  { id: 'refreshObjectTree', keys: 'F5', category: 'connection' },
  { id: 'testConnection', keys: 'Ctrl+Shift+C', category: 'connection' },
  { id: 'connectionInfo', keys: 'Ctrl+Shift+I', category: 'connection' },

  // 标签页管理 (7个)
  { id: 'newTab', keys: 'Ctrl+T', category: 'tab' },
  { id: 'closeTab', keys: 'Ctrl+W', category: 'tab' },
  { id: 'nextTab', keys: 'Ctrl+Tab', category: 'tab' },
  { id: 'prevTab', keys: 'Ctrl+Shift+Tab', category: 'tab' },
  { id: 'closeAllTabs', keys: 'Ctrl+Shift+W', category: 'tab' },
  { id: 'reopenTab', keys: 'Ctrl+Shift+T', category: 'tab' },
  { id: 'switchToTab1', keys: 'Ctrl+1', category: 'tab' },

  // 编辑器操作 (10个)
  { id: 'executeQuery', keys: 'Ctrl+Enter', category: 'editor' },
  { id: 'executeCurrentLine', keys: 'Ctrl+Shift+Enter', category: 'editor' },
  { id: 'explainQuery', keys: 'F8', category: 'editor' },
  { id: 'commentLine', keys: 'Ctrl+/', category: 'editor' },
  { id: 'formatSQL', keys: 'Ctrl+Shift+F', category: 'editor' },
  { id: 'triggerAutocomplete', keys: 'Ctrl+Space', category: 'editor' },
  { id: 'saveFile', keys: 'Ctrl+S', category: 'editor' },
  { id: 'find', keys: 'Ctrl+F', category: 'editor' },
  { id: 'replace', keys: 'Ctrl+H', category: 'editor' },
  { id: 'gotoLine', keys: 'Ctrl+G', category: 'editor' },

  // 视图控制 (6个)
  { id: 'toggleSidebar', keys: 'Ctrl+B', category: 'view' },
  { id: 'toggleBottomPanel', keys: 'Ctrl+`', category: 'view' },
  { id: 'focusObjectTree', keys: 'Ctrl+Shift+E', category: 'view' },
  { id: 'focusEditor', keys: 'Ctrl+Shift+D', category: 'view' },
  { id: 'toggleMessageCenter', keys: 'Ctrl+Shift+M', category: 'view' },
  { id: 'toggleFullscreen', keys: 'F11', category: 'view' },

  // 通用操作 (5个)
  { id: 'commandPalette', keys: 'Ctrl+K', category: 'general' },
  { id: 'toggleTheme', keys: 'Ctrl+K T', category: 'general' },
  { id: 'settings', keys: 'Ctrl+,', category: 'general' },
  { id: 'help', keys: 'F1', category: 'general' },
  { id: 'quit', keys: 'Ctrl+Q', category: 'general' },
]

const defaults: AppSettings = {
  editorFontSize: 14,
  editorTabSize: 4,
  editorWordWrap: false,
  editorMinimap: true,
  terminalFontSize: 14,
  terminalFontFamily: "'Cascadia Code', 'JetBrains Mono', 'Fira Code', Consolas, monospace",
  terminalCursorStyle: 'block',
  terminalCursorBlink: true,
  uiFontSize: 14,
  shortcuts: defaultShortcuts,
}

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const saved = JSON.parse(raw) as Partial<AppSettings>
      // 合并快捷键：保留用户自定义的绑定，同时补充新增的默认快捷键
      let mergedShortcuts = defaults.shortcuts
      if (saved.shortcuts && Array.isArray(saved.shortcuts)) {
        const savedMap = new Map(saved.shortcuts.map(s => [s.id, s]))
        mergedShortcuts = defaultShortcuts.map(def => savedMap.get(def.id) ?? def)
      }
      return { ...defaults, ...saved, shortcuts: mergedShortcuts }
    }
  } catch {
    // ignore parse errors
  }
  return { ...defaults }
}

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings>(loadSettings())

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  watch(
    settings,
    (val) => {
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(val))
      }, 300)
    },
    { deep: true },
  )

  function update(partial: Partial<AppSettings>) {
    settings.value = { ...settings.value, ...partial }
  }

  function reset() {
    settings.value = { ...defaults }
  }

  function resetShortcuts() {
    settings.value = { ...settings.value, shortcuts: [...defaultShortcuts] }
  }

  function updateShortcut(id: string, keys: string) {
    settings.value = {
      ...settings.value,
      shortcuts: settings.value.shortcuts.map(s =>
        s.id === id ? { ...s, keys } : s
      ),
    }
  }

  return { settings, update, reset, resetShortcuts, updateShortcut }
})
