/**
 * 应用自动更新 composable
 *
 * 功能：
 * - 检查更新（手动 / 自动）
 * - 下载并安装更新
 * - 用户偏好持久化（跳过版本、自动检查开关）
 * - 下载进度跟踪
 */

import { ref, readonly } from 'vue'
import { check, type Update, type DownloadEvent } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { getVersion } from '@tauri-apps/api/app'

// ── 用户偏好 localStorage key ──────────────────────────────
const STORAGE_KEY_AUTO_CHECK = 'updater:autoCheck'
const STORAGE_KEY_SKIP_VERSION = 'updater:skipVersion'

// ── 自动检查参数 ──────────────────────────────────────────
const INITIAL_DELAY_MS = 30_000       // 启动后 30 秒延迟
const CHECK_INTERVAL_MS = 6 * 3600_000 // 每 6 小时

// ── 响应式状态（模块级单例） ──────────────────────────────
const checking = ref(false)
const updateAvailable = ref(false)
const upToDate = ref(false)           // 已是最新版本（检查后无更新）
const downloading = ref(false)
const downloadProgress = ref(0)       // 0 ~ 100
const downloadTotal = ref(0)          // 总字节数
const downloadedBytes = ref(0)        // 已下载字节数
const error = ref<string | null>(null)

// 更新信息
const updateVersion = ref('')
const updateBody = ref('')
const updateDate = ref('')
const currentVersion = ref('')

// 用户偏好
const autoCheck = ref(loadBool(STORAGE_KEY_AUTO_CHECK, true))
const skipVersion = ref(localStorage.getItem(STORAGE_KEY_SKIP_VERSION) ?? '')

// 内部引用：Update 实例（下载/安装时需要）
let pendingUpdate: Update | null = null
let autoCheckTimer: ReturnType<typeof setInterval> | null = null
let initialTimer: ReturnType<typeof setTimeout> | null = null

// ── 工具函数 ──────────────────────────────────────────────
function loadBool(key: string, fallback: boolean): boolean {
  const v = localStorage.getItem(key)
  if (v === null) return fallback
  return v === 'true'
}

function saveBool(key: string, value: boolean): void {
  localStorage.setItem(key, String(value))
}

// ── 核心逻辑 ──────────────────────────────────────────────

/** 检查更新 */
async function checkForUpdate(options?: { silent?: boolean }): Promise<boolean> {
  if (checking.value) return false

  checking.value = true
  error.value = null
  upToDate.value = false

  try {
    const update = await check({ timeout: 30_000 })

    if (update) {
      // 如果用户选择跳过该版本，静默模式下不提示
      if (options?.silent && update.version === skipVersion.value) {
        // 关闭资源
        await update.close()
        checking.value = false
        return false
      }

      pendingUpdate = update
      updateAvailable.value = true
      updateVersion.value = update.version
      updateBody.value = update.body ?? ''
      updateDate.value = update.date ?? ''
      currentVersion.value = update.currentVersion
      checking.value = false
      return true
    }

    // 无可用更新
    updateAvailable.value = false
    upToDate.value = true
    pendingUpdate = null
    checking.value = false
    return false
  } catch (e) {
    const msg = String(e)
    // 服务器未部署更新文件时，视为"暂无更新"而非错误
    if (msg.includes('Could not fetch a valid release JSON') || msg.includes('204')) {
      updateAvailable.value = false
      upToDate.value = true
      pendingUpdate = null
    } else {
      error.value = msg
    }
    checking.value = false
    return false
  }
}

/** 下载并安装更新 */
async function downloadAndInstall(): Promise<void> {
  if (!pendingUpdate || downloading.value) return

  downloading.value = true
  downloadProgress.value = 0
  downloadedBytes.value = 0
  downloadTotal.value = 0
  error.value = null

  try {
    await pendingUpdate.downloadAndInstall((event: DownloadEvent) => {
      if (event.event === 'Started') {
        downloadTotal.value = event.data.contentLength ?? 0
      } else if (event.event === 'Progress') {
        downloadedBytes.value += event.data.chunkLength
        if (downloadTotal.value > 0) {
          downloadProgress.value = Math.min(
            100,
            Math.round((downloadedBytes.value / downloadTotal.value) * 100),
          )
        }
      } else if (event.event === 'Finished') {
        downloadProgress.value = 100
      }
    })

    // 下载安装完成后重启应用
    await relaunch()
  } catch (e) {
    error.value = String(e)
    downloading.value = false
  }
}

/** 跳过当前版本 */
function setSkipVersion(version: string): void {
  skipVersion.value = version
  localStorage.setItem(STORAGE_KEY_SKIP_VERSION, version)
  // 关闭当前更新通知
  dismissUpdate()
}

/** 关闭更新通知（不跳过版本） */
function dismissUpdate(): void {
  updateAvailable.value = false
  if (pendingUpdate) {
    pendingUpdate.close().catch(() => {})
    pendingUpdate = null
  }
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

  // 启动后延迟首次检查
  initialTimer = setTimeout(() => {
    checkForUpdate({ silent: true })
  }, INITIAL_DELAY_MS)

  // 定期检查
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
  // 获取当前应用版本
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
  if (pendingUpdate) {
    pendingUpdate.close().catch(() => {})
    pendingUpdate = null
  }
}

// ── 导出 composable ──────────────────────────────────────
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
