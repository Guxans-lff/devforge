import { ref, computed, watch } from 'vue'
import type { ThemeDefinition } from '@/types/theme'
import { builtinThemes, getThemeById } from '@/themes'

export type ThemeMode = 'dark' | 'light' | 'system'

const THEME_ID_KEY = 'devforge-color-theme'
const DEFAULT_THEME_ID = 'default-dark'

const activeThemeId = ref<string>(
  localStorage.getItem(THEME_ID_KEY) ?? DEFAULT_THEME_ID,
)

const activeTheme = computed<ThemeDefinition>(() => {
  return getThemeById(activeThemeId.value) ?? builtinThemes[0]!
})

const themeMode = computed<ThemeMode>(() => activeTheme.value.type)

function applyTheme(theme: ThemeDefinition) {
  const root = document.documentElement
  const isDark = theme.type === 'dark'

  if (isDark) {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }

  // Inject CSS variable overrides
  for (const [key, value] of Object.entries(theme.colors)) {
    root.style.setProperty(key, value)
  }

  // Update background color to prevent flash
  root.style.backgroundColor = theme.terminal.background
}

function clearCssOverrides() {
  const root = document.documentElement
  // Collect all custom properties set on the root style
  const allThemeVars = new Set<string>()
  for (const t of builtinThemes) {
    for (const key of Object.keys(t.colors)) {
      allThemeVars.add(key)
    }
  }
  for (const key of allThemeVars) {
    root.style.removeProperty(key)
  }
}

// 模块级别注册 watch，确保只注册一次（无论多少组件调用 useTheme）
watch(activeThemeId, (id) => {
  localStorage.setItem(THEME_ID_KEY, id)
  const theme = getThemeById(id)
  if (theme) {
    applyTheme(theme)
  }
})

// 模块加载时立即应用当前主题
applyTheme(activeTheme.value)

export function useTheme() {
  function setColorTheme(id: string) {
    const theme = getThemeById(id)
    if (!theme) return
    clearCssOverrides()
    activeThemeId.value = id
  }

  function setTheme(mode: ThemeMode) {
    // For backwards compatibility: map mode to a default theme
    if (mode === 'dark') {
      setColorTheme('default-dark')
    } else if (mode === 'light') {
      setColorTheme('default-light')
    }
    // 'system' is no longer a separate concept; ignored
  }

  function toggleTheme() {
    const darkThemes = builtinThemes.filter((t) => t.type === 'dark')
    const lightThemes = builtinThemes.filter((t) => t.type === 'light')
    const current = activeTheme.value

    if (current.type === 'dark') {
      // Switch to first light theme
      setColorTheme(lightThemes[0]?.id ?? 'default-light')
    } else {
      // Switch to first dark theme
      setColorTheme(darkThemes[0]?.id ?? 'default-dark')
    }
  }

  return {
    themeMode,
    activeThemeId,
    activeTheme,
    themes: builtinThemes,
    setColorTheme,
    setTheme,
    toggleTheme,
  }
}
