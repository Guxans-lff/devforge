/**
 * 主键查询与全局缓存 composable
 *
 * 超越 Navicat 的关键设计：
 * - 双层缓存（内存 Map），避免重复 API 调用
 * - 自动识别复合主键（多列联合主键）
 * - 提供连接级别的缓存失效机制
 */
import { dbGetColumns } from '@/api/database'
import { fetchWithCache } from '@/composables/useMetadataCache'

/** 主键缓存：key = `${connectionId}/${database}/${table}` */
const pkCache = new Map<string, string[]>()

/**
 * 查询并缓存指定表的主键列名列表
 * @param connectionId 连接 ID
 * @param database 数据库名
 * @param table 表名
 * @returns 主键列名数组（复合主键则有多个，无主键则为空数组）
 */
export async function fetchPrimaryKeys(
  connectionId: string,
  database: string,
  table: string,
): Promise<string[]> {
  const cacheKey = `${connectionId}/${database}/${table}`
  if (pkCache.has(cacheKey)) return pkCache.get(cacheKey)!

  try {
    const { data: columns } = await fetchWithCache(
      `${connectionId}:${database}:${table}:columns`,
      () => dbGetColumns(connectionId, database, table),
    )
    const pks = columns.filter(c => c.isPrimaryKey).map(c => c.name)
    pkCache.set(cacheKey, pks)
    return pks
  } catch {
    // 查询失败（可能是视图/权限问题）返回空 — 该表标记为只读
    pkCache.set(cacheKey, [])
    return []
  }
}

/**
 * 清除主键缓存
 * @param connectionId 若指定则只清该连接的缓存，否则清空全部
 */
export function clearPrimaryKeyCache(connectionId?: string) {
  if (connectionId) {
    for (const key of pkCache.keys()) {
      if (key.startsWith(`${connectionId}/`)) pkCache.delete(key)
    }
  } else {
    pkCache.clear()
  }
}
