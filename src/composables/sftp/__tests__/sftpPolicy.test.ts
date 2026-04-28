import { describe, expect, it } from 'vitest'
import { classifySftpError } from '../sftpErrors'
import { getRemoteDeleteRisk, resolveTransferConflict } from '../sftpConflictPolicy'
import type { FileEntry } from '@/types/fileManager'

const existing: FileEntry[] = [
  { name: 'app.log', path: '/logs/app.log', isDir: false, size: 1, modified: 0 },
  { name: 'app (1).log', path: '/logs/app (1).log', isDir: false, size: 1, modified: 0 },
]

describe('sftpErrors', () => {
  it('classifies common sftp errors', () => {
    expect(classifySftpError('Permission denied').kind).toBe('permission')
    expect(classifySftpError('No space left on device').action).toBe('free_space')
    expect(classifySftpError('connection reset by peer').retryable).toBe(true)
    expect(classifySftpError('No such file').action).toBe('change_path')
  })
})

describe('sftpConflictPolicy', () => {
  it('renames target when file already exists', () => {
    const decision = resolveTransferConflict(existing, '/logs', 'app.log', 'rename')
    expect(decision).toEqual({
      action: 'rename',
      targetPath: '/logs/app (2).log',
      reason: 'target_exists',
    })
  })

  it('summarizes high risk remote delete', () => {
    expect(getRemoteDeleteRisk([{ name: 'dir', path: '/dir', isDir: true, size: 0, modified: 0 }]).level).toBe('high')
  })
})
