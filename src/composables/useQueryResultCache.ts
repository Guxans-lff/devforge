/**
 * 表浏览分页缓存
 * 缓存表浏览模式下已加载的分页数据，避免翻页时重复查询 MySQL
 */
import type { QueryResult } from '@/types/database'

/** 缓存条目 */
interface CacheEntry {
  result: QueryResult
  timestamp: number
}

/** 缓存键由浏览参数组成 */
function buildKey(database: string, table: string, page: number, pageSize: number, where_?: string, orderBy?: string): string {
  return `${database}.${table}:${page}:${pageSize}:${where_ ?? ''}:${orderBy ?? ''}`
}

/** 缓存指纹（不含 page）：参数变化时整体清除 */
function buildFingerprint(database: string, table: string, pageSize: number, where_?: string, orderBy?: string): string {
  return `${database}.${table}:${pageSize}:${where_ ?? ''}:${orderBy ?? ''}`
}

const MAX_PAGES = 10
const TTL_MS = 60_000 // 60 秒

export class TablePageCache {
  private cache = new Map<string, CacheEntry>()
  private fingerprint = ''

  /** 获取缓存，不存在或过期返回 undefined */
  get(database: string, table: string, page: number, pageSize: number, where_?: string, orderBy?: string): QueryResult | undefined {
    const key = buildKey(database, table, page, pageSize, where_, orderBy)
    const entry = this.cache.get(key)
    if (!entry) return undefined
    if (Date.now() - entry.timestamp > TTL_MS) {
      this.cache.delete(key)
      return undefined
    }
    return entry.result
  }

  /** 写入缓存 */
  set(database: string, table: string, page: number, pageSize: number, result: QueryResult, where_?: string, orderBy?: string): void {
    const fp = buildFingerprint(database, table, pageSize, where_, orderBy)
    // 参数变化时清除旧缓存
    if (fp !== this.fingerprint) {
      this.cache.clear()
      this.fingerprint = fp
    }
    const key = buildKey(database, table, page, pageSize, where_, orderBy)
    this.cache.set(key, { result, timestamp: Date.now() })
    // 超出容量时移除最早的条目
    if (this.cache.size > MAX_PAGES) {
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) {
        this.cache.delete(firstKey)
      }
    }
  }

  /** 清除全部缓存（DML 操作后调用） */
  clear(): void {
    this.cache.clear()
    this.fingerprint = ''
  }

  get size(): number {
    return this.cache.size
  }
}
