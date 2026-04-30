/**
 * 主键查询与全局缓存 composable
 *
 * 超越 Navicat 的关键设计：
 * - 双层缓存（内存 Map），避免重复 API 调用
 * - 自动识别复合主键（多列联合主键）
 * - 提供连接级别的缓存失效机制
 */
import { ref, type Ref, watch, onBeforeUnmount } from 'vue'
import { dbGetColumns } from '@/api/database'
import { fetchWithCache } from '@/composables/useMetadataCache'

/** 主键缓存：key = `${connectionId}/${database}/${table}` */
const pkCache = new Map<string, string[]>()
const pkInflight = new Map<string, Promise<string[]>>()
const pkSubscribers = new Map<string, Set<Ref<string[]>>>()
const pkLoadingSubscribers = new Map<string, Set<Ref<boolean>>>()

function buildPkCacheKey(connectionId: string, database: string, table: string): string {
  return `${connectionId}/${database}/${table}`
}

function setSubscriberLoading(cacheKey: string, loading: boolean) {
  for (const target of pkLoadingSubscribers.get(cacheKey) ?? []) {
    target.value = loading
  }
}

function setSubscriberValue(cacheKey: string, value: string[]) {
  for (const target of pkSubscribers.get(cacheKey) ?? []) {
    target.value = value
  }
}

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
  const cacheKey = buildPkCacheKey(connectionId, database, table)
  if (pkCache.has(cacheKey)) return pkCache.get(cacheKey)!

  const existing = pkInflight.get(cacheKey)
  if (existing) return existing

  setSubscriberLoading(cacheKey, true)

  const request = (async () => {
    try {
      const { data: columns } = await fetchWithCache(
        `${connectionId}:${database}:${table}:columns`,
        () => dbGetColumns(connectionId, database, table),
      )
      const pks = columns.filter(c => c.isPrimaryKey).map(c => c.name)
      pkCache.set(cacheKey, pks)
      setSubscriberValue(cacheKey, pks)
      return pks
    } catch {
      // 查询失败（可能是视图/权限问题）返回空 — 该表标记为只读
      pkCache.set(cacheKey, [])
      setSubscriberValue(cacheKey, [])
      return []
    } finally {
      pkInflight.delete(cacheKey)
      setSubscriberLoading(cacheKey, false)
    }
  })()

  pkInflight.set(cacheKey, request)
  return request
}

export function usePrimaryKeys(
  connectionId: Ref<string | undefined>,
  database: Ref<string | undefined>,
  table: Ref<string | undefined>,
) {
  const primaryKeys = ref<string[]>([])
  const pkLoading = ref(false)
  let currentCacheKey: string | null = null

  function unsubscribe(cacheKey: string | null) {
    if (!cacheKey) return

    const values = pkSubscribers.get(cacheKey)
    values?.delete(primaryKeys)
    if (values && values.size === 0) pkSubscribers.delete(cacheKey)

    const loadings = pkLoadingSubscribers.get(cacheKey)
    loadings?.delete(pkLoading)
    if (loadings && loadings.size === 0) pkLoadingSubscribers.delete(cacheKey)
  }

  watch(
    [connectionId, database, table],
    async ([connId, db, tbl]) => {
      unsubscribe(currentCacheKey)
      currentCacheKey = null

      if (!connId || !db || !tbl) {
        primaryKeys.value = []
        pkLoading.value = false
        return
      }

      const cacheKey = buildPkCacheKey(connId, db, tbl)
      currentCacheKey = cacheKey

      const valueSubscribers = pkSubscribers.get(cacheKey) ?? new Set<Ref<string[]>>()
      valueSubscribers.add(primaryKeys)
      pkSubscribers.set(cacheKey, valueSubscribers)

      const loadingSubscribers = pkLoadingSubscribers.get(cacheKey) ?? new Set<Ref<boolean>>()
      loadingSubscribers.add(pkLoading)
      pkLoadingSubscribers.set(cacheKey, loadingSubscribers)

      if (pkCache.has(cacheKey)) {
        primaryKeys.value = pkCache.get(cacheKey)!
        pkLoading.value = false
        return
      }

      pkLoading.value = true
      primaryKeys.value = []
      await fetchPrimaryKeys(connId, db, tbl)
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    unsubscribe(currentCacheKey)
  })

  return {
    primaryKeys,
    pkLoading,
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
    for (const key of pkInflight.keys()) {
      if (key.startsWith(`${connectionId}/`)) pkInflight.delete(key)
    }
  } else {
    pkCache.clear()
    pkInflight.clear()
  }
}
