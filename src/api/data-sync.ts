import { Channel } from '@tauri-apps/api/core'
import { invokeCommand } from '@/api/base'
import type { SyncConfig, SyncPreview, SyncProgress } from '@/types/data-sync'

/**
 * 预览同步计划
 *
 * 展示每张表的行数、列信息、主键等预览信息，
 * 供用户在执行同步前确认同步范围。
 *
 * @param config 同步配置
 * @returns 每张表的预览信息列表
 */
export function syncDataPreview(config: SyncConfig): Promise<SyncPreview[]> {
  return invokeCommand('sync_data_preview', {
    sourceConnectionId: config.sourceConnectionId,
    sourceDatabase: config.sourceDatabase,
    targetConnectionId: config.targetConnectionId,
    targetDatabase: config.targetDatabase,
    tables: config.tables,
    syncMode: config.syncMode,
  }, { source: 'DATABASE' })
}

/**
 * 执行数据同步
 *
 * 通过 Tauri Channel 实时推送同步进度到前端。
 *
 * @param config 同步配置
 * @param onProgress 进度回调
 * @returns 执行结果摘要
 */
export function syncDataExecute(
  config: SyncConfig,
  onProgress: (progress: SyncProgress) => void,
): Promise<string> {
  const channel = new Channel<SyncProgress>()
  channel.onmessage = onProgress
  return invokeCommand('sync_data_execute', {
    config,
    onProgress: channel,
  }, { source: 'DATABASE' })
}
