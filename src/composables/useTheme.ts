import { ref, computed, watch } from 'vue'
import type { ThemeDefinition } from '@/types/theme'
import { builtinThemes, getThemeById } from '@/themes'
import { useSettingsStore, type ThemeScheduleMode } from '@/stores/settings'

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

  // 注入 CSS 变量覆盖
  for (const [key, value] of Object.entries(theme.colors)) {
    root.style.setProperty(key, value)
  }

  // 更新背景色防止闪烁
  root.style.backgroundColor = theme.terminal.background

  // 同步 Tauri 窗口标题栏主题
  syncTauriWindowTheme(isDark)
}

/** 异步同步 Tauri 窗口标题栏主题 */
async function syncTauriWindowTheme(isDark: boolean) {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const appWindow = getCurrentWindow()
    await appWindow.setTheme(isDark ? 'dark' : 'light')
  } catch {
    // 非 Tauri 环境或 API 未就绪时静默忽略
  }
}

function clearCssOverrides() {
  const root = document.documentElement
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

/** 解析 "HH:mm" 为当天的分钟数（0~1439），格式无效时返回 null */
function parseTimeToMinutes(time: string): number | null {
  const parts = time.split(':')
  if (parts.length !== 2) return null
  const h = Number(parts[0])
  const m = Number(parts[1])
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  if (h < 0 || h > 23 || m < 0 || m > 59) return null
  return h * 60 + m
}

/** 判断当前时间是否处于"白天"区间，解析失败时返回 null */
function isDaytime(lightTime: string, darkTime: string): boolean | null {
  const now = new Date()
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const lightMinutes = parseTimeToMinutes(lightTime)
  const darkMinutes = parseTimeToMinutes(darkTime)

  // 时间解析失败时不做切换
  if (lightMinutes === null || darkMinutes === null) return null

  // 正常情况：白天开始 < 夜间开始（如 07:00 ~ 19:00）
  if (lightMinutes < darkMinutes) {
    return nowMinutes >= lightMinutes && nowMinutes < darkMinutes
  }
  // 跨午夜情况：白天开始 > 夜间开始（如 06:00 ~ 02:00，即 02:00 进入夜间）
  return nowMinutes >= lightMinutes || nowMinutes < darkMinutes
}

/** 根据调度模式决定应使用的主题 ID */
function resolveScheduledThemeId(
  mode: ThemeScheduleMode,
  lightId: string,
  darkId: string,
  scheduleLight: string,
  scheduleDark: string,
): string | null {
  if (mode === 'manual') return null

  if (mode === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    return prefersDark ? darkId : lightId
  }

  // schedule 模式：按时间判断，解析失败时不切换
  const daytime = isDaytime(scheduleLight, scheduleDark)
  if (daytime === null) return null
  return daytime ? lightId : darkId
}

// ===== 定时器管理 =====
let scheduleTimer: ReturnType<typeof setInterval> | null = null
let systemMediaQuery: MediaQueryList | null = null
let systemMediaHandler: ((e: MediaQueryListEvent) => void) | null = null
let settingsWatcher: (() => void) | null = null

function stopScheduler() {
  if (scheduleTimer !== null) {
    clearInterval(scheduleTimer)
    scheduleTimer = null
  }
  if (systemMediaQuery && systemMediaHandler) {
    systemMediaQuery.removeEventListener('change', systemMediaHandler)
    systemMediaQuery = null
    systemMediaHandler = null
  }
}

function startScheduler() {
  stopScheduler()

  // 延迟获取 settings store（避免模块加载循环依赖）
  const settingsStore = useSettingsStore()
  const mode = settingsStore.settings.themeScheduleMode

  if (mode === 'manual') return

  /** 执行一次调度检查并切换主题 */
  const tick = () => {
    const s = settingsStore.settings
    const targetId = resolveScheduledThemeId(
      s.themeScheduleMode,
      s.themeLightId,
      s.themeDarkId,
      s.scheduleLight,
      s.scheduleDark,
    )
    if (targetId && targetId !== activeThemeId.value) {
      clearCssOverrides()
      activeThemeId.value = targetId
    }
  }

  if (mode === 'system') {
    // 监听系统主题变化
    systemMediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    systemMediaHandler = () => tick()
    systemMediaQuery.addEventListener('change', systemMediaHandler)
    tick()
    return
  }

  // schedule 模式：每分钟检查一次
  tick()
  scheduleTimer = setInterval(tick, 60_000)
}

// ===== 模块级别 watch =====
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
    if (mode === 'dark') {
      setColorTheme('default-dark')
    } else if (mode === 'light') {
      setColorTheme('default-light')
    }
  }

  function toggleTheme() {
    const darkThemes = builtinThemes.filter((t) => t.type === 'dark')
    const lightThemes = builtinThemes.filter((t) => t.type === 'light')
    const current = activeTheme.value

    if (current.type === 'dark') {
      setColorTheme(lightThemes[0]?.id ?? 'default-light')
    } else {
      setColorTheme(darkThemes[0]?.id ?? 'default-dark')
    }
  }

  /** 初始化主题调度（在 settings 加载完成后调用一次） */
  function initScheduler() {
    startScheduler()

    // 清理上一个 watcher（防止热重载等场景下叠加）
    settingsWatcher?.()

    // 监听调度相关设置变化，自动重启调度器
    const settingsStore = useSettingsStore()
    settingsWatcher = watch(
      () => [
        settingsStore.settings.themeScheduleMode,
        settingsStore.settings.themeLightId,
        settingsStore.settings.themeDarkId,
        settingsStore.settings.scheduleLight,
        settingsStore.settings.scheduleDark,
      ],
      () => startScheduler(),
    )
  }

  return {
    themeMode,
    activeThemeId,
    activeTheme,
    themes: builtinThemes,
    setColorTheme,
    setTheme,
    toggleTheme,
    initScheduler,
  }
}
