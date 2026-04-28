import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearSftpDirectoryCache,
  getSftpParentPath,
  invalidateSftpDirectory,
  invalidateSftpDirectoryTree,
  loadSftpDirectoryCached,
} from '../useSftpDirectoryCache'
import type { FileEntry } from '@/types/fileManager'

const entries: FileEntry[] = [{ name: 'a.txt', path: '/a.txt', isDir: false, size: 1, modified: 0 }]

describe('useSftpDirectoryCache', () => {
  beforeEach(() => {
    clearSftpDirectoryCache()
  })

  it('returns cached directory entries within ttl', async () => {
    const loader = vi.fn().mockResolvedValue(entries)

    await loadSftpDirectoryCached('conn', '/tmp', loader)
    const second = await loadSftpDirectoryCached('conn', '/tmp', loader)

    expect(loader).toHaveBeenCalledTimes(1)
    expect(second.fromCache).toBe(true)
    expect(second.entries).toEqual(entries)
  })

  it('bypasses cache when force is enabled', async () => {
    const loader = vi.fn().mockResolvedValue(entries)

    await loadSftpDirectoryCached('conn', '/tmp', loader)
    await loadSftpDirectoryCached('conn', '/tmp', loader, { force: true })

    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('invalidates exact directory and tree', async () => {
    const loader = vi.fn().mockResolvedValue(entries)

    await loadSftpDirectoryCached('conn', '/tmp', loader)
    invalidateSftpDirectory('conn', '/tmp')
    await loadSftpDirectoryCached('conn', '/tmp', loader)
    invalidateSftpDirectoryTree('conn', '/tmp')
    await loadSftpDirectoryCached('conn', '/tmp/child', loader)

    expect(loader).toHaveBeenCalledTimes(3)
  })

  it('resolves parent paths', () => {
    expect(getSftpParentPath('/var/log/app.log')).toBe('/var/log')
    expect(getSftpParentPath('/var')).toBe('/')
    expect(getSftpParentPath('/')).toBe('/')
  })
})
