import type { FileEntry } from '@/types/fileManager'

export type SftpConflictAction = 'ask' | 'skip' | 'overwrite' | 'rename'

export interface SftpConflictDecision {
  action: Exclude<SftpConflictAction, 'ask'>
  targetPath: string
  reason?: string
}

function joinRemotePath(parent: string, name: string): string {
  return parent.endsWith('/') ? `${parent}${name}` : `${parent}/${name}`
}

function splitName(name: string): { base: string; ext: string } {
  const index = name.lastIndexOf('.')
  if (index <= 0) return { base: name, ext: '' }
  return { base: name.slice(0, index), ext: name.slice(index) }
}

export function resolveTransferConflict(
  existingEntries: FileEntry[],
  targetDirectory: string,
  fileName: string,
  preferredAction: SftpConflictAction = 'rename',
): SftpConflictDecision {
  const existingNames = new Set(existingEntries.map(entry => entry.name))
  if (!existingNames.has(fileName)) {
    return { action: 'overwrite', targetPath: joinRemotePath(targetDirectory, fileName), reason: 'no_conflict' }
  }

  if (preferredAction === 'skip') {
    return { action: 'skip', targetPath: joinRemotePath(targetDirectory, fileName), reason: 'target_exists' }
  }
  if (preferredAction === 'overwrite') {
    return { action: 'overwrite', targetPath: joinRemotePath(targetDirectory, fileName), reason: 'target_exists' }
  }

  const { base, ext } = splitName(fileName)
  for (let index = 1; index < 10_000; index++) {
    const candidate = `${base} (${index})${ext}`
    if (!existingNames.has(candidate)) {
      return { action: 'rename', targetPath: joinRemotePath(targetDirectory, candidate), reason: 'target_exists' }
    }
  }

  return { action: 'skip', targetPath: joinRemotePath(targetDirectory, fileName), reason: 'rename_exhausted' }
}

export function getRemoteDeleteRisk(entries: FileEntry[]): { level: 'low' | 'medium' | 'high'; summary: string } {
  const dirCount = entries.filter(entry => entry.isDir).length
  const fileCount = entries.length - dirCount
  if (dirCount > 0 || entries.length >= 20) {
    return { level: 'high', summary: `将删除 ${fileCount} 个文件和 ${dirCount} 个目录，可能触发远程递归删除` }
  }
  if (entries.length > 1) {
    return { level: 'medium', summary: `将批量删除 ${entries.length} 个远程条目` }
  }
  return { level: 'low', summary: '将删除 1 个远程条目' }
}
