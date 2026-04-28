import type { SyncConfig, SyncPreview } from '@/types/data-sync'

export type DataSyncRiskLevel = 'low' | 'medium' | 'high' | 'critical'

export interface DataSyncRiskSummary {
  level: DataSyncRiskLevel
  title: string
  message: string
  destructive: boolean
  totalSourceRows: number
  totalTargetRows: number
}

type SyncPreviewLike = Omit<Readonly<SyncPreview>, 'columns' | 'primaryKeys'> & {
  readonly columns: readonly string[]
  readonly primaryKeys: readonly string[]
}

export function summarizeDataSyncRisk(config: SyncConfig, preview: readonly SyncPreviewLike[]): DataSyncRiskSummary {
  const totalSourceRows = preview.reduce((sum, item) => sum + item.sourceRows, 0)
  const totalTargetRows = preview.reduce((sum, item) => sum + item.targetRows, 0)
  const tables = config.tables.length

  if (config.syncMode === 'full') {
    const level: DataSyncRiskLevel = totalTargetRows > 0 || tables > 5 ? 'critical' : 'high'
    return {
      level,
      title: '确认全量同步',
      message: [
        `将全量同步 ${tables} 张表，源端约 ${totalSourceRows.toLocaleString()} 行。`,
        `目标端现有约 ${totalTargetRows.toLocaleString()} 行可能被清空后重写。`,
        '该操作对目标库具有破坏性，请确认已备份或可回滚。',
      ].join('\n'),
      destructive: true,
      totalSourceRows,
      totalTargetRows,
    }
  }

  const tablesWithoutPrimaryKey = preview.filter((item) => item.primaryKeys.length === 0)
  if (tablesWithoutPrimaryKey.length > 0) {
    return {
      level: 'high',
      title: '确认 UPSERT 同步',
      message: [
        `将 UPSERT 同步 ${tables} 张表，源端约 ${totalSourceRows.toLocaleString()} 行。`,
        `${tablesWithoutPrimaryKey.length} 张表未检测到主键，可能无法稳定执行 UPSERT。`,
        '建议先检查主键或唯一索引，再继续同步。',
      ].join('\n'),
      destructive: false,
      totalSourceRows,
      totalTargetRows,
    }
  }

  return {
    level: totalSourceRows > 100_000 ? 'medium' : 'low',
    title: '确认增量同步',
    message: `将 UPSERT 同步 ${tables} 张表，源端约 ${totalSourceRows.toLocaleString()} 行。`,
    destructive: false,
    totalSourceRows,
    totalTargetRows,
  }
}

export function confirmDataSyncRisk(config: SyncConfig, preview: readonly SyncPreviewLike[]): boolean {
  const risk = summarizeDataSyncRisk(config, preview)
  return window.confirm(`${risk.title}\n\n${risk.message}`)
}
