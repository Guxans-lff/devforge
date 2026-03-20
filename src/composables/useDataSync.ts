import { ref, readonly } from 'vue'
import { syncDataPreview, syncDataExecute } from '@/api/data-sync'
import type { SyncConfig, SyncProgress, SyncPreview } from '@/types/data-sync'

/**
 * 数据同步逻辑 composable
 *
 * 管理同步状态：预览、执行、进度追踪。
 */
export function useDataSync() {
  /** 是否正在预览 */
  const previewing = ref(false)
  /** 预览结果 */
  const preview = ref<SyncPreview[]>([])
  /** 预览错误 */
  const previewError = ref<string | null>(null)

  /** 是否正在同步 */
  const syncing = ref(false)
  /** 同步进度 */
  const progress = ref<SyncProgress | null>(null)
  /** 同步结果 */
  const syncResult = ref<string | null>(null)
  /** 同步错误 */
  const syncError = ref<string | null>(null)

  /**
   * 获取同步预览信息
   *
   * @param config 同步配置
   */
  async function previewSync(config: SyncConfig): Promise<SyncPreview[]> {
    previewing.value = true
    previewError.value = null
    preview.value = []

    try {
      const result = await syncDataPreview(config)
      preview.value = result
      return result
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      previewError.value = msg
      throw e
    } finally {
      previewing.value = false
    }
  }

  /**
   * 执行数据同步
   *
   * @param config 同步配置
   */
  async function executeSync(config: SyncConfig): Promise<string> {
    syncing.value = true
    syncError.value = null
    syncResult.value = null
    progress.value = null

    try {
      const result = await syncDataExecute(config, (p) => {
        progress.value = { ...p }
      })
      syncResult.value = result
      return result
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      syncError.value = msg
      throw e
    } finally {
      syncing.value = false
    }
  }

  /** 重置所有状态 */
  function reset() {
    previewing.value = false
    preview.value = []
    previewError.value = null
    syncing.value = false
    progress.value = null
    syncResult.value = null
    syncError.value = null
  }

  return {
    previewing: readonly(previewing),
    preview: readonly(preview),
    previewError: readonly(previewError),
    syncing: readonly(syncing),
    progress: readonly(progress),
    syncResult: readonly(syncResult),
    syncError: readonly(syncError),
    previewSync,
    executeSync,
    reset,
  }
}
