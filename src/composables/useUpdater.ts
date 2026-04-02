/**
 * HTTP 简化更新 composable
 *
 * 不依赖官方 tauri_plugin_updater，通过 HTTP 拉取 manifest、
 * 调用后端命令下载安装包、启动安装器来实现自定义更新。
 *
 * 功能：
 * - 检查更新（手动 / 自动）
 * - 下载安装包（后端 reqwest，支持进度事件）
 * - 启动安装器 / 打开所在目录
 * - 用户偏好持久化（跳过版本、自动检查开关）
 */

import { ref, readonly } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { parseBackendError } from '@/types/error'
import { getVersion } from '@tauri-apps/api/app'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

// ── 更新服务器配置 ──────────────────────────────────────
// 支持通过 VITE_UPDATE_MANIFEST_URL 环境变量覆盖
const MANIFEST_URL = import.meta.env.VITE_UPDATE_MANIFEST_URL
  || 'http://8.135.60.82:9527/devforge/update.json'

// ── manifest 类型 ──────────────────────────────────────
interface UpdateManifest {
  version: string
  notes?: string
  pub_date?: string
  platforms?: Record<string, {
    url: string
    sha256?: string
    size?: number
  }>
}

// ── 用户偏好 localStorage key ──────────────────────────
const STORAGE_KEY_AUTO_CHECK = 'updater:autoCheck'
const STORAGE_KEY_SKIP_VERSION = 'updater:skipVersion'

// ── 自动检查参数 ──────────────────────────────────────
const INITIAL_DELAY_MS = 30_000       // 启动后 30 秒延迟
const CHECK_INTERVAL_MS = 6 * 3600_000 // 每 6 小时

// ── 响应式状态（模块级单例） ──────────────────────────
const checking = ref(false)
const updateAvailable = ref(false)
const upToDate = ref(false)
const downloading = ref(false)
const downloadProgress = ref(0)       // 0 ~ 100
const downloadTotal = ref(0)
const downloadedBytes = ref(0)
const error = ref<string | null>(null)

// 更新信息
const updateVersion = ref('')
const updateBody = ref('')
const updateDate = ref('')
const currentVersion = ref('')

// 用户偏好
const autoCheck = ref(loadBool(STORAGE_KEY_AUTO_CHECK, true))
const skipVersion = ref(localStorage.getItem(STORAGE_KEY_SKIP_VERSION) ?? '')

// 内部状态
let pendingManifest: UpdateManifest | null = null
let pendingDownloadUrl = ''
let pendingSha256 = ''
let autoCheckTimer: ReturnType<typeof setInterval> | null = null
let initialTimer: ReturnType<typeof setTimeout> | null = null
let progressUnlisten: UnlistenFn | null = null

// ── 工具函数 ──────────────────────────────────────────
function loadBool(key: string, fallback: boolean): boolean {
  const v = localStorage.getItem(key)
  if (v === null) return fallback
  return v === 'true'
}

function saveBool(key: string, value: boolean): void {
  localStorage.setItem(key, String(value))
}

/** 简单语义化版本比较：remote > local 返回 true */
function isNewerVersion(remote: string, local: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number)
  const r = parse(remote)
  const l = parse(local)
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const rv = r[i] ?? 0
    const lv = l[i] ?? 0
    if (rv > lv) return true
    if (rv < lv) return false
  }
  return false
}

/** 获取当前平台的 manifest 平台键 */
function getPlatformKey(): string {
  return 'windows-x86_64'
}

// ── 核心逻辑 ──────────────────────────────────────────

/** 检查更新：通过 HTTP 拉取远端 manifest */
async function checkForUpdate(options?: { silent?: boolean }): Promise<boolean> {
  if (checking.value) return false

  checking.value = true
  error.value = null
  upToDate.value = false

  try {
    // 拉取远端 manifest
    const resp = await fetch(MANIFEST_URL, {
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    })

    if (!resp.ok) {
      // 服务器未部署或返回非 200，视为"暂无更新"
      if (resp.status === 404 || resp.status === 204) {
        updateAvailable.value = false
        upToDate.value = true
        pendingManifest = null
        checking.value = false
        return false
      }
      throw new Error(`检查更新失败：HTTP ${resp.status}`)
    }

    const manifest: UpdateManifest = await resp.json()

    // 确保有当前版本号
    if (!currentVersion.value) {
      try {
        currentVersion.value = await getVersion()
      } catch {
        // 忽略
      }
    }

    // 版本比较
    if (!manifest.version || !isNewerVersion(manifest.version, currentVersion.value)) {
      updateAvailable.value = false
      upToDate.value = true
      pendingManifest = null
      checking.value = false
      return false
    }

    // 如果用户选择跳过该版本，静默模式下不提示
    if (options?.silent && manifest.version === skipVersion.value) {
      checking.value = false
      return false
    }

    // 获取当前平台的下载信息
    const platformInfo = manifest.platforms?.[getPlatformKey()]
    if (!platformInfo?.url) {
      throw new Error('当前平台没有可用的安装包')
    }

    pendingManifest = manifest
    pendingDownloadUrl = platformInfo.url
    pendingSha256 = platformInfo.sha256 ?? ''
    updateAvailable.value = true
    updateVersion.value = manifest.version
    updateBody.value = manifest.notes ?? ''
    updateDate.value = manifest.pub_date ?? ''
    checking.value = false
    return true
  } catch (e) {
    const msg = e instanceof Error ? e.message : parseBackendError(e).message
    if (msg.includes('fetch') || msg.includes('network') || msg.includes('abort')) {
      // 网络问题静默处理
      if (options?.silent) {
        checking.value = false
        return false
      }
    }
    error.value = msg
    checking.value = false
    return false
  }
}

/** 下载并安装更新 */
async function downloadAndInstall(): Promise<void> {
  if (!pendingManifest || !pendingDownloadUrl || downloading.value) return

  downloading.value = true
  downloadProgress.value = 0
  downloadedBytes.value = 0
  downloadTotal.value = 0
  error.value = null

  // 监听下载进度事件
  try {
    progressUnlisten = await listen<{
      downloaded: number
      total: number
      percentage: number
    }>('updater://download-progress', (event) => {
      downloadedBytes.value = event.payload.downloaded
      downloadTotal.value = event.payload.total
      downloadProgress.value = event.payload.percentage
    })
  } catch {
    // 事件监听失败不影响下载
  }

  try {
    // 调用后端下载（后端自动使用固定的 updates 目录）
    const result = await invoke<{ savedPath: string; fileSize: number }>('download_update', {
      url: pendingDownloadUrl,
      sha256: pendingSha256 || null,
    })

    downloadProgress.value = 100
    downloading.value = false

    // 清理进度监听
    if (progressUnlisten) {
      progressUnlisten()
      progressUnlisten = null
    }

    // 启动安装器（后端会自动退出应用）
    try {
      await invoke('launch_installer', { path: result.savedPath })
      // 后端调用 app.exit(0) 后应用会退出，正常不会执行到这里
    } catch (e) {
      // 安装器启动失败时，退而求其次：打开所在目录
      console.error('[Updater] 启动安装器失败，尝试打开目录:', e)
      try {
        await invoke('reveal_in_folder', { path: result.savedPath })
        error.value = `安装包已下载到 ${result.savedPath}，请手动双击安装`
      } catch {
        error.value = `安装包已下载到 ${result.savedPath}，请手动前往安装`
      }
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : parseBackendError(e).message
    downloading.value = false

    // 清理进度监听
    if (progressUnlisten) {
      progressUnlisten()
      progressUnlisten = null
    }
  }
}

/** 跳过当前版本 */
function setSkipVersion(version: string): void {
  skipVersion.value = version
  localStorage.setItem(STORAGE_KEY_SKIP_VERSION, version)
  dismissUpdate()
}

/** 关闭更新通知（不跳过版本） */
function dismissUpdate(): void {
  updateAvailable.value = false
  pendingManifest = null
  pendingDownloadUrl = ''
  pendingSha256 = ''
}

/** 设置自动检查开关 */
function setAutoCheck(enabled: boolean): void {
  autoCheck.value = enabled
  saveBool(STORAGE_KEY_AUTO_CHECK, enabled)

  if (enabled) {
    startAutoCheck()
  } else {
    stopAutoCheck()
  }
}

/** 启动自动检查调度 */
function startAutoCheck(): void {
  stopAutoCheck()

  initialTimer = setTimeout(() => {
    checkForUpdate({ silent: true })
  }, INITIAL_DELAY_MS)

  autoCheckTimer = setInterval(() => {
    checkForUpdate({ silent: true })
  }, CHECK_INTERVAL_MS)
}

/** 停止自动检查调度 */
function stopAutoCheck(): void {
  if (initialTimer) {
    clearTimeout(initialTimer)
    initialTimer = null
  }
  if (autoCheckTimer) {
    clearInterval(autoCheckTimer)
    autoCheckTimer = null
  }
}

/** 初始化更新器（在 App.vue onMounted 中调用） */
async function initUpdater(): Promise<void> {
  try {
    currentVersion.value = await getVersion()
  } catch {
    // 忽略获取版本失败
  }

  if (autoCheck.value) {
    startAutoCheck()
  }
}

/** 销毁更新器 */
function destroyUpdater(): void {
  stopAutoCheck()
  if (progressUnlisten) {
    progressUnlisten()
    progressUnlisten = null
  }
  pendingManifest = null
  pendingDownloadUrl = ''
  pendingSha256 = ''
}

// ── 导出 composable ──────────────────────────────────
export function useUpdater() {
  return {
    // 状态（只读）
    checking: readonly(checking),
    updateAvailable: readonly(updateAvailable),
    upToDate: readonly(upToDate),
    downloading: readonly(downloading),
    downloadProgress: readonly(downloadProgress),
    downloadTotal: readonly(downloadTotal),
    downloadedBytes: readonly(downloadedBytes),
    error: readonly(error),
    updateVersion: readonly(updateVersion),
    updateBody: readonly(updateBody),
    updateDate: readonly(updateDate),
    currentVersion: readonly(currentVersion),

    // 用户偏好
    autoCheck: readonly(autoCheck),
    skipVersion: readonly(skipVersion),

    // 操作
    checkForUpdate,
    downloadAndInstall,
    setSkipVersion,
    dismissUpdate,
    setAutoCheck,
    initUpdater,
    destroyUpdater,
  }
}
