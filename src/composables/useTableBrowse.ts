/**
 * 表数据浏览 composable
 * 从 useQueryExecution 提取，负责表浏览模式的分页加载、筛选、排序
 * 支持分页缓存，避免翻页时重复查询 MySQL
 */
import { ref, type Ref, type ComputedRef } from 'vue'
import { useDatabaseWorkspaceStore } from '@/stores/database-workspace'
import * as dbApi from '@/api/database'
import type { QueryTabContext } from '@/types/database-workspace'
import { TablePageCache } from './useQueryResultCache'
import { parseBackendError } from '@/types/error'

export interface UseTableBrowseOptions {
  connectionId: Ref<string>
  tabId: Ref<string>
  isConnected: Ref<boolean>
  tabContext: ComputedRef<QueryTabContext | undefined>
  isExecuting: ComputedRef<boolean>
}

export function useTableBrowse(options: UseTableBrowseOptions) {
  const { connectionId, tabId, isConnected, tabContext, isExecuting } = options
  const store = useDatabaseWorkspaceStore()
  const isLoadingMore = ref(false)
  const pageCache = new TablePageCache()

  async function browseTable(database: string, table: string, whereClause?: string, orderBy?: string) {
    if (!isConnected.value || isExecuting.value) return

    // 参数变化时缓存自动清除（fingerprint 不同），第一页一般不命中
    store.updateTabContext(connectionId.value, tabId.value, { isExecuting: true })
    try {
      const result = await dbApi.dbGetTableData(connectionId.value, database, table, 1, 200, whereClause, orderBy)
      // 缓存第一页
      pageCache.set(database, table, 1, 200, result, whereClause, orderBy)
      store.updateTabContext(connectionId.value, tabId.value, {
        result,
        isExecuting: false,
        tableBrowse: { database, table, currentPage: 1, pageSize: 200, whereClause, orderBy },
        activeResultTabId: undefined,
      })
    } catch (e: unknown) {
      const errorStr = parseBackendError(e).message
      store.updateTabContext(connectionId.value, tabId.value, {
        result: {
          columns: [],
          rows: [],
          affectedRows: 0,
          executionTimeMs: 0,
          isError: true,
          error: errorStr,
          totalCount: null,
          truncated: false,
        },
        isExecuting: false,
      })
    }
  }

  async function loadMoreRows() {
    const ctx = tabContext.value
    if (!ctx?.tableBrowse || !ctx.result || isLoadingMore.value) return

    const { database, table, currentPage, pageSize, whereClause, orderBy } = ctx.tableBrowse
    const nextPage = currentPage + 1

    // 优先查缓存
    const cached = pageCache.get(database, table, nextPage, pageSize, whereClause, orderBy)
    if (cached && cached.rows.length > 0) {
      const merged: typeof ctx.result = {
        ...ctx.result,
        rows: [...ctx.result.rows, ...cached.rows],
        totalCount: cached.totalCount,
      }
      store.updateTabContext(connectionId.value, tabId.value, {
        result: merged,
        tableBrowse: { ...ctx.tableBrowse, currentPage: nextPage },
      })
      return
    }

    isLoadingMore.value = true
    try {
      const moreResult = await dbApi.dbGetTableData(connectionId.value, database, table, nextPage, pageSize, whereClause, orderBy)
      if (moreResult.rows.length > 0) {
        // 写入缓存
        pageCache.set(database, table, nextPage, pageSize, moreResult, whereClause, orderBy)
        const merged: typeof ctx.result = {
          ...ctx.result,
          rows: [...ctx.result.rows, ...moreResult.rows],
          totalCount: moreResult.totalCount,
        }
        store.updateTabContext(connectionId.value, tabId.value, {
          result: merged,
          tableBrowse: { ...ctx.tableBrowse, currentPage: nextPage },
        })
      }
    } catch (_e) {
      // 静默失败
    } finally {
      isLoadingMore.value = false
    }
  }

  function handleServerFilter(whereClause: string) {
    const ctx = tabContext.value
    if (ctx?.tableBrowse) {
      browseTable(ctx.tableBrowse.database, ctx.tableBrowse.table, whereClause || undefined, ctx.tableBrowse.orderBy)
    }
  }

  function handleServerSort(orderBy: string) {
    const ctx = tabContext.value
    if (ctx?.tableBrowse) {
      browseTable(ctx.tableBrowse.database, ctx.tableBrowse.table, ctx.tableBrowse.whereClause, orderBy || undefined)
    }
  }

  /** DML 操作后清除缓存 */
  function invalidateCache() {
    pageCache.clear()
  }

  return {
    isLoadingMore,
    browseTable,
    loadMoreRows,
    handleServerFilter,
    handleServerSort,
    invalidateCache,
  }
}
