import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

const STORAGE_KEY = 'devforge-settings'

export interface ShortcutBinding {
  id: string
  keys: string  // e.g. "Ctrl+N", "Ctrl+Shift+T"
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
  { id: 'newConnection', keys: 'Ctrl+N' },
  { id: 'newTab', keys: 'Ctrl+T' },
  { id: 'closeTab', keys: 'Ctrl+W' },
  { id: 'nextTab', keys: 'Ctrl+Tab' },
  { id: 'settings', keys: 'Ctrl+,' },
  { id: 'toggleSidebar', keys: 'Ctrl+B' },
  { id: 'toggleBottomPanel', keys: 'Ctrl+`' },
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
      return { ...defaults, ...JSON.parse(raw) }
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
