import type { FileEntry } from '@/types/fileManager'

interface CacheEntry {
  entries: FileEntry[]
  loadedAt: number
}

const DEFAULT_TTL_MS = 15_000
const cache = new Map<string, CacheEntry>()

function normalizePath(path: string): string {
  if (!path) return '/'
  const normalized = path.replace(/\\/g, '/')
  if (normalized.length > 1 && normalized.endsWith('/')) return normalized.slice(0, -1)
  return normalized
}

function cacheKey(connectionId: string, path: string): string {
  return `${connectionId}::${normalizePath(path)}`
}

export interface LoadSftpDirectoryOptions {
  force?: boolean
  ttlMs?: number
}

export async function loadSftpDirectoryCached(
  connectionId: string,
  path: string,
  loader: () => Promise<FileEntry[]>,
  options: LoadSftpDirectoryOptions = {},
): Promise<{ entries: FileEntry[]; fromCache: boolean; isStale: boolean }> {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const key = cacheKey(connectionId, path)
  const now = Date.now()
  const cached = cache.get(key)

  if (!options.force && cached && now - cached.loadedAt <= ttlMs) {
    return { entries: cached.entries.map(entry => ({ ...entry })), fromCache: true, isStale: false }
  }

  const entries = await loader()
  cache.set(key, { entries: entries.map(entry => ({ ...entry })), loadedAt: now })
  return { entries, fromCache: false, isStale: !!cached }
}

export function invalidateSftpDirectory(connectionId: string, path: string): void {
  cache.delete(cacheKey(connectionId, path))
}

export function invalidateSftpParentDirectory(connectionId: string, path: string): void {
  invalidateSftpDirectory(connectionId, getSftpParentPath(path))
}

export function invalidateSftpDirectoryTree(connectionId: string, rootPath?: string): void {
  if (!rootPath) {
    for (const key of cache.keys()) {
      if (key.startsWith(`${connectionId}::`)) cache.delete(key)
    }
    return
  }

  const normalizedRoot = normalizePath(rootPath)
  for (const key of cache.keys()) {
    const [, path = ''] = key.split('::')
    if (key.startsWith(`${connectionId}::`) && (path === normalizedRoot || path.startsWith(`${normalizedRoot}/`))) {
      cache.delete(key)
    }
  }
}

export function getSftpParentPath(path: string): string {
  const normalized = normalizePath(path)
  if (normalized === '/') return '/'
  const index = normalized.lastIndexOf('/')
  if (index <= 0) return '/'
  return normalized.slice(0, index)
}

export function clearSftpDirectoryCache(): void {
  cache.clear()
}
