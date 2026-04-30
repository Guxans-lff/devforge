import { defineStore } from 'pinia'
import { ref } from 'vue'
import { usePersistence } from '@/plugins/persistence'
import { getSuggestedDataPath } from '@/api/system'
import type { AiPermissionRuleConfig } from '@/types/ai'

/** localStorage 遗留 key（仅用于一次性迁移） */
const LEGACY_STORAGE_KEY = 'devforge-settings'

export type ShortcutCategory = 'connection' | 'tab' | 'editor' | 'view' | 'general' | 'screenshot'

export interface ShortcutBinding {
  id: string
  keys: string  // e.g. “Ctrl+N”, “Ctrl+Shift+T”
  category: ShortcutCategory
  description?: string  // 用于显示的描述
}

/** 主题调度模式 */
export type ThemeScheduleMode = 'manual' | 'system' | 'schedule'

export interface AiDiagnosticsThresholds {
  firstTokenWarnMs: number
  firstTokenDangerMs: number
  responseWarnMs: number
  responseDangerMs: number
  historyWarnMs: number
  historyDangerMs: number
  toolQueueWarnCount: number
  toolQueueDangerCount: number
  toolRunWarnMs: number
  toolRunDangerMs: number
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
  /** Terminal scrollback lines */
  terminalScrollback: number
  /** UI font size in px */
  uiFontSize: number
  /** Custom keyboard shortcuts */
  shortcuts: ShortcutBinding[]
  /** Data storage path */
  dataStoragePath: string
  /** 开发者模式 */
  devMode: boolean
  /** 主题调度模式：manual=手动选择, system=跟随系统, schedule=按时间自动切换 */
  themeScheduleMode: ThemeScheduleMode
  /** 白天使用的主题 ID（schedule 模式） */
  themeLightId: string
  /** 夜间使用的主题 ID（schedule 模式） */
  themeDarkId: string
  /** 白天开始时间，格式 "HH:mm"（schedule 模式） */
  scheduleLight: string
  /** 夜间开始时间，格式 "HH:mm"（schedule 模式） */
  scheduleDark: string
  /** AI 对话密度：comfortable=舒适（默认），compact=紧凑 */
  aiDensity: 'comfortable' | 'compact'
  aiDiagnosticsThresholds: AiDiagnosticsThresholds
  /** User 级 AI 工具权限规则 */
  aiPermissionRules: AiPermissionRuleConfig[]
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
  { id: 'toggleZenMode', keys: 'Ctrl+K Z', category: 'view' },

  // 通用操作 (5个)
  { id: 'commandPalette', keys: 'Ctrl+K', category: 'general' },
  { id: 'toggleTheme', keys: 'Ctrl+K T', category: 'general' },
  { id: 'settings', keys: 'Ctrl+,', category: 'general' },
  { id: 'help', keys: 'F1', category: 'general' },
  { id: 'quit', keys: 'Ctrl+Q', category: 'general' },

  // 截图（全局快捷键，由 Rust 侧注册）
  { id: 'screenshotFullscreen', keys: 'Ctrl+Shift+A', category: 'screenshot' },
  { id: 'screenshotOpen', keys: 'Ctrl+Shift+X', category: 'screenshot' },
]

export const DEFAULT_AI_DIAGNOSTICS_THRESHOLDS: AiDiagnosticsThresholds = {
  firstTokenWarnMs: 2000,
  firstTokenDangerMs: 5000,
  responseWarnMs: 15000,
  responseDangerMs: 45000,
  historyWarnMs: 500,
  historyDangerMs: 2000,
  toolQueueWarnCount: 0,
  toolQueueDangerCount: 3,
  toolRunWarnMs: 1000,
  toolRunDangerMs: 4000,
}

const defaults: AppSettings = {
  editorFontSize: 14,
  editorTabSize: 4,
  editorWordWrap: false,
  editorMinimap: true,
  terminalFontSize: 14,
  terminalFontFamily: "'Cascadia Code', 'JetBrains Mono', 'Fira Code', Consolas, monospace",
  terminalCursorStyle: 'block',
  terminalCursorBlink: true,
  terminalScrollback: 5000,
  uiFontSize: 14,
  shortcuts: defaultShortcuts,
  dataStoragePath: 'D:\\DevForgeData',
  devMode: false,
  themeScheduleMode: 'manual',
  themeLightId: 'default-light',
  themeDarkId: 'default-dark',
  scheduleLight: '07:00',
  scheduleDark: '19:00',
  aiDensity: 'comfortable',
  aiDiagnosticsThresholds: { ...DEFAULT_AI_DIAGNOSTICS_THRESHOLDS },
  aiPermissionRules: [],
}

/** 合并快捷键：保留用户自定义的绑定，同时补充新增的默认快捷键 */
function mergeShortcuts(saved?: ShortcutBinding[]): ShortcutBinding[] {
  if (!saved || !Array.isArray(saved)) return [...defaultShortcuts]
  const savedMap = new Map(saved.map(s => [s.id, s]))
  return defaultShortcuts.map(def => savedMap.get(def.id) ?? def)
}

function mergeSettings(saved?: Partial<AppSettings>): AppSettings {
  return {
    ...defaults,
    ...saved,
    shortcuts: mergeShortcuts(saved?.shortcuts),
    aiDiagnosticsThresholds: {
      ...DEFAULT_AI_DIAGNOSTICS_THRESHOLDS,
      ...(saved?.aiDiagnosticsThresholds ?? {}),
    },
    aiPermissionRules: Array.isArray(saved?.aiPermissionRules) ? saved.aiPermissionRules : [],
  }
}

export const useSettingsStore = defineStore('settings', () => {
  // 先用默认值初始化（同步），后续 restoreState() 异步覆盖
  const settings = ref<AppSettings>(mergeSettings())

  // ===== SQLite 持久化 =====
  const persistence = usePersistence<AppSettings>({
    key: 'settings',
    version: 1,
    debounce: 300,
    serialize: () => settings.value,
    deserialize: (data) => {
      const merged = mergeSettings(data)
      settings.value = merged
    },
  })

  /** 从 SQLite 恢复设置，若无则自动迁移 localStorage */
  let _restored = false
  async function restoreState(): Promise<boolean> {
    if (_restored) return true
    _restored = true

    // 优先从 SQLite 加载
    const loaded = await persistence.load()
    if (loaded) return true

    // SQLite 无数据 → 尝试从 localStorage 一次性迁移
    try {
      const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
      if (!raw) return false
      const saved = JSON.parse(raw) as Partial<AppSettings>
      const merged = mergeSettings(saved)
      settings.value = merged
      // 立即写入 SQLite
      await persistence.saveImmediate()
      // 清理 localStorage 遗留
      localStorage.removeItem(LEGACY_STORAGE_KEY)
      console.info('[Settings] localStorage → SQLite 迁移完成')
      return true
    } catch (e) {
      console.warn('[Settings] localStorage 迁移失败:', e)
      return false
    }
  }

  /** 启用自动保存（幂等） */
  let _autoSaveEnabled = false
  function enableAutoSave(): void {
    if (_autoSaveEnabled) return
    _autoSaveEnabled = true
    persistence.autoSave(settings)
  }

  function update(partial: Partial<AppSettings>) {
    settings.value = { ...settings.value, ...partial }
  }

  function reset() {
    settings.value = mergeSettings()
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

  async function initializeDataPath() {
    // 如果还没配置过，或者还在用以前死板的默认值，就去问后端拿”智能建议”
    if (!settings.value.dataStoragePath || settings.value.dataStoragePath === 'D:\\DevForgeData') {
      try {
        const suggested = await getSuggestedDataPath()
        if (suggested) {
          update({ dataStoragePath: suggested })
        }
      } catch (e) {
        console.error('Failed to get suggested data path:', e)
      }
    }
  }

  return {
    settings,
    update,
    reset,
    resetShortcuts,
    updateShortcut,
    initializeDataPath,
    restoreState,
    enableAutoSave,
  }
})
