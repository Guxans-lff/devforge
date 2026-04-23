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
import { extractNumericCursorValue, resolveInitialTableSeek, resolveTableSeekAfterFirstPage } from '@/composables/useTableSeek'

export interface UseTableBrowseOptions {
  connectionId: Ref<string>
  tabId: Ref<string>
  isConnected: Ref<boolean>
  tabContext: ComputedRef<QueryTabContext | undefined>
  isExecuting: ComputedRef<boolean>
}

export function useTableBrowse(options: UseTableBrowseOptions) {
  const { connectionId, tabId, isConnected, tabContext } = options
  const store = useDatabaseWorkspaceStore()
  const isLoadingMore = ref(false)
  const pageCache = new TablePageCache()
  /** 请求版本号，防止快速切换表时旧响应覆盖新数据 */
  let browseVersion = 0

  async function browseTable(database: string, table: string, whereClause?: string, orderBy?: string) {
    if (!isConnected.value) return

    // 递增版本号，后续只有版本匹配时才写入结果
    const currentVersion = ++browseVersion
    console.log(`[browseTable] 开始 v${currentVersion}: ${database}.${table}`)

    // 切换表时立即清除旧结果和结果标签页，防止新旧数据混杂
    store.updateTabContext(connectionId.value, tabId.value, {
      isExecuting: true,
      result: null,
      resultTabs: [],
      activeResultTabId: undefined,
    })
    try {
      const initialSeek = await resolveInitialTableSeek(connectionId.value, database, table, orderBy)
      const effectiveOrderBy = initialSeek.effectiveOrderBy
      const result = await dbApi.dbGetTableData(connectionId.value, database, table, 1, 200, whereClause, effectiveOrderBy)
      const seek = resolveTableSeekAfterFirstPage(result, initialSeek.seekColumn)
      // 版本不匹配说明已有更新的请求，丢弃此结果
      if (currentVersion !== browseVersion) {
        console.log(`[browseTable] 版本过期 v${currentVersion} != v${browseVersion}，丢弃 ${database}.${table} 的结果`)
        return
      }
      console.log(`[browseTable] 完成 v${currentVersion}: ${database}.${table}，列数=${result.columns.length}，行数=${result.rows.length}`)
      // 缓存第一页
      pageCache.set(database, table, 1, 200, result, whereClause, effectiveOrderBy)
      store.updateTabContext(connectionId.value, tabId.value, {
        result,
        isExecuting: false,
        tableBrowse: { database, table, currentPage: 1, pageSize: 200, whereClause, orderBy, ...seek },
        resultTabs: [],
        activeResultTabId: undefined,
      })
    } catch (e: unknown) {
      console.error(`[browseTable] 失败 v${currentVersion}: ${database}.${table}`, e)
      if (currentVersion !== browseVersion) return
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

    const { database, table, currentPage, pageSize, whereClause, orderBy, seekOrderBy, seekColumn, seekValue } = ctx.tableBrowse
    const nextPage = currentPage + 1
    const effectiveOrderBy = orderBy?.trim() ? orderBy : seekOrderBy

    // 优先查缓存
    const cached = pageCache.get(database, table, nextPage, pageSize, whereClause, effectiveOrderBy)
    if (cached && cached.rows.length > 0) {
      const nextSeekValue = extractNumericCursorValue(cached.rows, cached.columns, ctx.tableBrowse.seekColumn)
      const merged: typeof ctx.result = {
        ...ctx.result,
        rows: [...ctx.result.rows, ...cached.rows],
        totalCount: cached.totalCount,
      }
      store.updateTabContext(connectionId.value, tabId.value, {
        result: merged,
        tableBrowse: {
          ...ctx.tableBrowse,
          currentPage: nextPage,
          seekValue: nextSeekValue ?? ctx.tableBrowse.seekValue,
        },
      })
      return
    }

    isLoadingMore.value = true
    try {
      const moreResult = await dbApi.dbGetTableData(
        connectionId.value,
        database,
        table,
        nextPage,
        pageSize,
        whereClause,
        effectiveOrderBy,
        seekColumn,
        typeof seekValue === 'number' ? seekValue : undefined,
      )
      // 请求完成后检查当前表是否已切换，防止旧数据污染新表
      const currentCtx = tabContext.value
      if (!currentCtx?.tableBrowse || currentCtx.tableBrowse.database !== database || currentCtx.tableBrowse.table !== table) return
      if (!currentCtx.result) return
      if (moreResult.rows.length > 0) {
        // 写入缓存
        pageCache.set(database, table, nextPage, pageSize, moreResult, whereClause, effectiveOrderBy)
        const merged: typeof currentCtx.result = {
          ...currentCtx.result,
          rows: [...currentCtx.result.rows, ...moreResult.rows],
          totalCount: moreResult.totalCount,
        }
        const nextSeekValue = extractNumericCursorValue(moreResult.rows, moreResult.columns, currentCtx.tableBrowse.seekColumn)
        store.updateTabContext(connectionId.value, tabId.value, {
          result: merged,
          tableBrowse: {
            ...currentCtx.tableBrowse,
            currentPage: nextPage,
            seekValue: nextSeekValue ?? currentCtx.tableBrowse.seekValue,
          },
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
