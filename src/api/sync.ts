import { invokeCommand } from '@/api/base'

export interface SyncEntry {
  path: string
  name: string
  isDir: boolean
  localSize: number | null
  remoteSize: number | null
  localModified: number | null
  remoteModified: number | null
  status: 'added_local' | 'added_remote' | 'modified' | 'unchanged'
}

export interface SyncDiff {
  entries: SyncEntry[]
  addedLocal: number
  addedRemote: number
  modified: number
  unchanged: number
}

/** 比较本地和远程目录差异 */
export function syncCompare(
  connectionId: string,
  localPath: string,
  remotePath: string,
): Promise<SyncDiff> {
  return invokeCommand('sync_compare', { connectionId, localPath, remotePath })
}
