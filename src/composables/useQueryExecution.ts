import { ref, computed, type Ref, type ComputedRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDatabaseWorkspaceStore } from '@/stores/database-workspace'
import { useNotification } from '@/composables/useNotification'
import { useExecutionTimer } from '@/composables/useExecutionTimer'
import * as dbApi from '@/api/database'
import * as historyApi from '@/api/query-history'
import type { QueryResult, QueryChunk, ErrorStrategy } from '@/types/database'
import type { QueryTabContext, ResultTab, SubStatementResult } from '@/types/database-workspace'
import { detectDangerousStatements, isReadOnlyStatement } from '@/utils/dangerousSqlDetector'
import { isMultiStatement } from '@/utils/sqlParser'
import type { DangerousStatement, EnvironmentType } from '@/types/environment'

/** useQueryExecution 入参 */
export interface UseQueryExecutionOptions {
  connectionId: Ref<string>
  connectionName: Ref<string | undefined>
  tabId: Ref<string>
  isConnected: Ref<boolean>
  environment: Ref<EnvironmentType | undefined>
  readOnly: Ref<boolean>
  confirmDanger: Ref<boolean>
  /** 添加结果标签页的回调 */
  addResultTab: (sql: string, result: QueryResult) => void
  /** 获取当前 tab context */
  tabContext: ComputedRef<QueryTabContext | undefined>
}

/** 最大结果标签页数量 */
const MAX_RESULT_TABS = 10

/**
 * 查询执行 composable
 * 负责：SQL 执行（流式/非流式/多语句）、表浏览、事务管理、EXPLAIN、危险操作确认
 */
export function useQueryExecution(options: UseQueryExecutionOptions) {
  const {
    connectionId,
    connectionName,
    tabId,
    isConnected,
    environment,
    readOnly,
    confirmDanger,
    addResultTab,
    tabContext,
  } = options

  const { t } = useI18n()
  const store = useDatabaseWorkspaceStore()
  const notification = useNotification()
  const executionTimer = useExecutionTimer()

  // ===== 状态 =====
  const isLoadingMore = ref(false)
  const pendingExecuteSql = ref<string | null>(null)

  /** 错误策略（多语句执行） */
  const errorStrategy = ref<ErrorStrategy>('stopOnError')

  /** 长耗时通知定时器 ID */
  let longRunningNotifyId: ReturnType<typeof setTimeout> | null = null

  // ===== 危险操作确认 =====
  const dangerConfirmOpen = ref(false)
  const dangerConfirmSql = ref('')
  const dangerStatements = ref<DangerousStatement[]>([])
  const dangerConfirmInput = ref('')

  const dangerNeedInput = computed(() => environment.value === 'production')
  const dangerInputTarget = computed(() => {
    const db = tabContext.value?.currentDatabase
    return db || connectionName.value || ''
  })
  const dangerCanConfirm = computed(() =>
    !dangerNeedInput.value || dangerConfirmInput.value === dangerInputTarget.value,
  )

  // ===== EXPLAIN =====
  const explainResult = ref<Record<string, unknown> | null>(null)
  const explainTableRows = ref<Record<string, unknown>[] | null>(null)
  const showExplain = ref(false)
  const isExplaining = ref(false)

  // ===== 计算属性 =====
  const isExecuting = computed(() => tabContext.value?.isExecuting ?? false)
  const isInTransaction = computed(() => tabContext.value?.isInTransaction ?? false)
  const queryTimeout = computed({
    get: () => tabContext.value?.queryTimeout ?? 30,
    set: (val: number) => {
      store.updateTabContext(connectionId.value, tabId.value, { queryTimeout: val })
    },
  })

  // ===== 计时器管理 =====
  function startExecutionTimer() {
    executionTimer.start()
    clearLongRunningNotify()
    longRunningNotifyId = setTimeout(() => {
      if (isExecuting.value) {
        notification.warning(
          t('database.longRunningTitle'),
          t('database.longRunningDesc', { time: executionTimer.elapsed.value }),
          0,
        )
      }
    }, 5000)
  }

  function stopExecutionTimer() {
    executionTimer.stop()
    clearLongRunningNotify()
  }

  function clearLongRunningNotify() {
    if (longRunningNotifyId) {
      clearTimeout(longRunningNotifyId)
      longRunningNotifyId = null
    }
  }

  // ===== 主入口：执行 SQL =====
  async function handleExecute(sql: string): Promise<{ success: boolean }> {
    if (!sql.trim() || !isConnected.value || isExecuting.value) return { success: false }

    // 只读模式检查
    if (readOnly.value && !isReadOnlyStatement(sql)) {
      notification.error(
        t('environment.readOnlyBlocked'),
        t('environment.readOnlyBlockedDesc'),
      )
      return { success: false }
    }

    // 危险操作检查
    if (confirmDanger.value) {
      const dangers = detectDangerousStatements(sql)
      if (dangers.length > 0) {
        dangerStatements.value = dangers
        dangerConfirmSql.value = sql
        dangerConfirmInput.value = ''
        dangerConfirmOpen.value = true
        return { success: false }
      }
    }

    await doExecute(sql)
    return { success: true }
  }

  /** 确认危险操作后继续执行 */
  function handleDangerConfirm() {
    if (!dangerCanConfirm.value) return
    dangerConfirmOpen.value = false
    const sql = dangerConfirmSql.value
    dangerConfirmSql.value = ''
    dangerStatements.value = []
    dangerConfirmInput.value = ''
    doExecute(sql)
  }

  /** 核心执行逻辑（绕过危险检查） */
  async function doExecute(sql: string) {
    if (!sql.trim() || !isConnected.value || isExecuting.value) return

    startExecutionTimer()

    // USE 语句特殊处理
    const useMatch = sql.trim().match(/^USE\s+`?(\w+)`?\s*;?\s*$/i)
    if (useMatch) {
      const dbName = useMatch[1]!
      stopExecutionTimer()
      store.updateTabContext(connectionId.value, tabId.value, {
        currentDatabase: dbName,
        result: {
          columns: [],
          rows: [],
          affectedRows: 0,
          executionTimeMs: 0,
          isError: false,
          error: null,
          totalCount: null,
          truncated: false,
        },
        isExecuting: false,
      })
      dbApi.dbSwitchDatabase(connectionId.value, tabId.value, dbName).catch(() => {})
      notification.success(t('database.databaseSwitched', { name: dbName }) || `已切换到数据库 ${dbName}`)
      return dbName
    }

    // 清除旧状态
    store.updateTabContext(connectionId.value, tabId.value, {
      isExecuting: true,
      result: null,
      tableBrowse: undefined,
      activeResultTabId: undefined,
    })

    const startTime = Date.now()

    // 多语句检测
    if (isMultiStatement(sql)) {
      await handleMultiExecute(sql, startTime)
      return
    }

    // SELECT 类查询优先流式执行
    const firstWord = sql.trim().split(/\s+/)[0]?.toUpperCase() ?? ''
    const isSelectLike = ['SELECT', 'SHOW', 'DESCRIBE', 'EXPLAIN'].includes(firstWord)

    if (isSelectLike) {
      await handleStreamExecute(sql, startTime)
    } else {
      await handleNonStreamExecute(sql, startTime)
    }
  }

  /** 流式执行 SELECT 查询 */
  async function handleStreamExecute(sql: string, startTime: number) {
    let allColumns: QueryResult['columns'] = []
    let allRows: unknown[][] = []
    let lastError: string | null = null
    let totalTimeMs = 0

    try {
      const timeoutSecs = queryTimeout.value > 0 ? queryTimeout.value : undefined

      let resolveStream: () => void
      let rejectStream: (reason: unknown) => void
      const streamFinishedPromise = new Promise<void>((res, rej) => {
        resolveStream = res
        rejectStream = rej
      })

      const onChunk = (chunk: QueryChunk) => {
        if (chunk.columns && chunk.columns.length > 0) {
          allColumns = chunk.columns
        }
        if (chunk.rows && chunk.rows.length > 0) {
          allRows = [...allRows, ...chunk.rows]
        }
        if (chunk.error) {
          lastError = chunk.error
        }
        if (chunk.totalTimeMs !== null && chunk.totalTimeMs !== undefined) {
          totalTimeMs = chunk.totalTimeMs
        }

        // 实时更新结果
        store.updateTabContext(connectionId.value, tabId.value, {
          result: {
            columns: allColumns,
            rows: allRows,
            affectedRows: 0,
            executionTimeMs: totalTimeMs || (Date.now() - startTime),
            isError: !!lastError,
            error: lastError,
            totalCount: chunk.isLast ? allRows.length : null,
            truncated: false,
          },
        })

        if (chunk.isLast) {
          resolveStream()
        }
      }

      const currentDb = tabContext.value?.currentDatabase
      const invokePromise = dbApi.dbExecuteQueryStreamOnSession(
        connectionId.value, tabId.value, sql, onChunk, currentDb, timeoutSecs,
      ).catch(e => {
        rejectStream!(e)
      })

      const waitTimeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('流式查询响应超时')), 5000),
      )

      await Promise.race([
        Promise.all([invokePromise, streamFinishedPromise]),
        waitTimeoutPromise,
      ])

      const finalResult: QueryResult = {
        columns: allColumns,
        rows: allRows,
        affectedRows: 0,
        executionTimeMs: totalTimeMs || (Date.now() - startTime),
        isError: !!lastError,
        error: lastError,
        totalCount: allRows.length,
        truncated: false,
      }

      stopExecutionTimer()
      store.updateTabContext(connectionId.value, tabId.value, {
        result: finalResult,
        isExecuting: false,
      })

      const executionTime = Date.now() - startTime
      if (!lastError) {
        addResultTab(sql, finalResult)
        notification.success(
          t('database.querySuccess'),
          t('database.queryResultSummary', { rows: allRows.length, time: executionTime }),
          3000,
        )
      } else {
        notification.error(t('database.queryFailed'), lastError, true)
      }
      saveHistory(sql, finalResult)
    } catch (_e) {
      console.warn('流式查询无法完成，降级到传统 API:', _e)
      await handleNonStreamExecute(sql, startTime)
    }
  }

  /** 非流式执行（INSERT/UPDATE/DELETE 等） */
  async function handleNonStreamExecute(sql: string, startTime: number) {
    try {
      const timeoutSecs = queryTimeout.value > 0 ? queryTimeout.value : undefined
      const currentDb = tabContext.value?.currentDatabase
      const result = await dbApi.dbExecuteQueryOnSession(
        connectionId.value, tabId.value, sql, currentDb, timeoutSecs,
      )
      stopExecutionTimer()
      store.updateTabContext(connectionId.value, tabId.value, {
        result,
        isExecuting: false,
      })

      const executionTime = Date.now() - startTime
      if (result.isError) {
        notification.error(t('database.queryFailed'), result.error ?? undefined, true)
      } else {
        addResultTab(sql, result)
        const rowCount = result.totalCount ?? result.rows.length
        notification.success(
          t('database.querySuccess'),
          t('database.queryResultSummary', { rows: rowCount, time: executionTime }),
          3000,
        )
      }
      saveHistory(sql, result)
    } catch (e) {
      const errorResult: QueryResult = {
        columns: [],
        rows: [],
        affectedRows: 0,
        executionTimeMs: Date.now() - startTime,
        isError: true,
        error: String(e),
        totalCount: null,
        truncated: false,
      }
      stopExecutionTimer()
      store.updateTabContext(connectionId.value, tabId.value, {
        result: errorResult,
        isExecuting: false,
      })
      notification.error(t('database.queryFailed'), String(e), true)
      saveHistory(sql, errorResult)
    }
  }

  /** 多语句智能执行 */
  async function handleMultiExecute(sql: string, startTime: number) {
    try {
      const currentDb = tabContext.value?.currentDatabase
      const timeoutSecs = queryTimeout.value > 0 ? queryTimeout.value : undefined

      const results = await dbApi.dbExecuteMultiV2(
        connectionId.value,
        sql,
        currentDb,
        errorStrategy.value,
        timeoutSecs,
      )

      const totalTime = Date.now() - startTime
      const successCount = results.filter(r => !r.result.isError).length
      const failCount = results.length - successCount

      // 构建子结果列表
      const subResults: SubStatementResult[] = results.map(stmt => ({
        index: stmt.index,
        sql: stmt.sql,
        statementType: stmt.statementType,
        result: stmt.result,
      }))

      // 找到最后一条有数据的结果作为主展示
      const selectResult = results.find(r => !r.result.isError && r.result.columns.length > 0)
      const lastResult = selectResult?.result ?? (results.length > 0 ? results[results.length - 1]!.result : null)

      const summaryResult: QueryResult = lastResult ? {
        ...lastResult,
        executionTimeMs: totalTime,
        multiStatementSummary: { total: results.length, success: successCount, fail: failCount },
      } : {
        columns: [],
        rows: [],
        affectedRows: 0,
        executionTimeMs: totalTime,
        isError: false,
        error: null,
        totalCount: null,
        truncated: false,
        multiStatementSummary: { total: results.length, success: successCount, fail: failCount },
      }

      // 创建汇总结果 Tab
      const tabs = [...(tabContext.value?.resultTabs ?? [])]
      while (tabs.length >= MAX_RESULT_TABS) {
        const unpinnedIdx = tabs.findIndex(t => !t.isPinned)
        if (unpinnedIdx === -1) break
        tabs.splice(unpinnedIdx, 1)
      }
      const newTab: ResultTab = {
        id: crypto.randomUUID(),
        title: `批量执行 (${successCount}/${results.length})`,
        result: summaryResult,
        sql: sql.trim(),
        isPinned: false,
        createdAt: Date.now(),
        subResults,
      }
      tabs.push(newTab)

      stopExecutionTimer()
      store.updateTabContext(connectionId.value, tabId.value, {
        resultTabs: tabs,
        activeResultTabId: newTab.id,
        result: summaryResult,
        isExecuting: false,
      })

      const summaryMsg = t('database.multiStatement.executionSummary', {
        total: results.length,
        success: successCount,
        fail: failCount,
        time: `${(totalTime / 1000).toFixed(1)}s`,
      })

      if (failCount > 0) {
        notification.warning('执行完成', summaryMsg, 0)
      } else {
        notification.success('执行完成', summaryMsg, 3000)
      }

      if (lastResult) {
        saveHistory(sql, lastResult)
      }
    } catch (e) {
      const errorResult: QueryResult = {
        columns: [],
        rows: [],
        affectedRows: 0,
        executionTimeMs: Date.now() - startTime,
        isError: true,
        error: String(e),
        totalCount: null,
        truncated: false,
      }
      stopExecutionTimer()
      store.updateTabContext(connectionId.value, tabId.value, {
        result: errorResult,
        isExecuting: false,
      })
      notification.error(t('database.queryFailed'), String(e), true)
      saveHistory(sql, errorResult)
    }
  }

  /** 保存查询历史 */
  function saveHistory(sql: string, result: QueryResult) {
    historyApi.saveQueryHistory({
      id: crypto.randomUUID(),
      connectionId: connectionId.value,
      connectionName: connectionName.value ?? null,
      databaseName: tabContext.value?.currentDatabase ?? null,
      sqlText: sql.trim(),
      executionTimeMs: result.executionTimeMs,
      isError: result.isError,
      errorMessage: result.error ?? null,
      affectedRows: result.affectedRows,
      rowCount: result.totalCount ?? (result.isError ? null : result.rows.length),
      executedAt: Date.now(),
    }).catch(() => {
      // 静默处理
    })
  }

  // ===== 表浏览模式 =====
  async function browseTable(database: string, table: string, whereClause?: string, orderBy?: string) {
    if (!isConnected.value || isExecuting.value) return

    store.updateTabContext(connectionId.value, tabId.value, { isExecuting: true })
    try {
      const result = await dbApi.dbGetTableData(connectionId.value, database, table, 1, 200, whereClause, orderBy)
      store.updateTabContext(connectionId.value, tabId.value, {
        result,
        isExecuting: false,
        tableBrowse: { database, table, currentPage: 1, pageSize: 200, whereClause, orderBy },
        activeResultTabId: undefined,
      })
    } catch (e) {
      store.updateTabContext(connectionId.value, tabId.value, {
        result: {
          columns: [],
          rows: [],
          affectedRows: 0,
          executionTimeMs: 0,
          isError: true,
          error: String(e),
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
    isLoadingMore.value = true

    try {
      const moreResult = await dbApi.dbGetTableData(connectionId.value, database, table, nextPage, pageSize, whereClause, orderBy)
      if (moreResult.rows.length > 0) {
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

  function handleRefresh(sqlContent: string) {
    const ctx = tabContext.value
    if (ctx?.tableBrowse) {
      browseTable(ctx.tableBrowse.database, ctx.tableBrowse.table, ctx.tableBrowse.whereClause, ctx.tableBrowse.orderBy)
    } else if (sqlContent.trim()) {
      handleExecute(sqlContent)
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

  // ===== 取消查询 =====
  async function handleCancel() {
    try {
      await dbApi.dbCancelQuery(connectionId.value)
    } catch (_e) {
      // 静默处理
    } finally {
      stopExecutionTimer()
      store.updateTabContext(connectionId.value, tabId.value, {
        isExecuting: false,
      })
    }
  }

  // ===== 事务管理 =====
  async function handleBeginTransaction() {
    if (!isConnected.value) return
    try {
      await dbApi.dbBeginTransaction(connectionId.value)
      store.updateTabContext(connectionId.value, tabId.value, {
        isInTransaction: true,
      })
    } catch (e) {
      notification.error('开始事务失败', String(e), true)
    }
  }

  async function handleCommit() {
    if (!isConnected.value) return
    try {
      await dbApi.dbCommit(connectionId.value)
      store.updateTabContext(connectionId.value, tabId.value, {
        isInTransaction: false,
      })
    } catch (e) {
      notification.error('提交事务失败', String(e), true)
    }
  }

  async function handleRollback() {
    if (!isConnected.value) return
    try {
      await dbApi.dbRollback(connectionId.value)
      store.updateTabContext(connectionId.value, tabId.value, {
        isInTransaction: false,
      })
    } catch (e) {
      notification.error('回滚事务失败', String(e), true)
    }
  }

  // ===== EXPLAIN =====
  async function handleExplain(getSql: () => string) {
    const sql = getSql()
    if (!sql || !isConnected.value) return

    const cleanSql = sql.replace(/^\s*EXPLAIN\s+(FORMAT\s*=\s*\w+\s+|ANALYZE\s+|\(.*?\)\s+)*/i, '')
    if (!cleanSql.trim()) return

    isExplaining.value = true
    showExplain.value = true
    explainResult.value = null
    explainTableRows.value = null

    try {
      const [jsonResult, tableResult] = await Promise.all([
        dbApi.dbExplain(connectionId.value, cleanSql, 'json'),
        dbApi.dbExplain(connectionId.value, cleanSql, 'table'),
      ])

      if (jsonResult.isError) {
        explainResult.value = { error: jsonResult.error }
      } else if (jsonResult.rows.length > 0) {
        const raw = String(jsonResult.rows[0]![0] ?? '{}')
        try {
          explainResult.value = JSON.parse(raw)
        } catch {
          explainResult.value = { raw }
        }
      }

      if (!tableResult.isError && tableResult.columns.length > 0) {
        explainTableRows.value = tableResult.rows.map(row => {
          const obj: Record<string, unknown> = {}
          tableResult.columns.forEach((col, i) => {
            obj[col.name] = row[i]
          })
          return obj
        })
      }
    } catch (e) {
      explainResult.value = { error: String(e) }
    } finally {
      isExplaining.value = false
    }
  }

  // ===== 错误策略 =====
  function toggleErrorStrategy() {
    errorStrategy.value = errorStrategy.value === 'stopOnError' ? 'continueOnError' : 'stopOnError'
  }

  // ===== 数据库切换 =====
  async function handleDatabaseSelect(database: string, emit: (event: 'databaseChanged', database: string) => void) {
    if (!database || !isConnected.value) return
    store.updateTabContext(connectionId.value, tabId.value, {
      currentDatabase: database,
    })
    try {
      await dbApi.dbSwitchDatabase(connectionId.value, tabId.value, database)
    } catch (e) {
      console.warn('[Session] 切换数据库失败:', e)
    }
    emit('databaseChanged', database)
  }

  return {
    // 状态
    isExecuting,
    isLoadingMore,
    isInTransaction,
    queryTimeout,
    errorStrategy,
    pendingExecuteSql,
    executionTimer,

    // 危险操作确认
    dangerConfirmOpen,
    dangerConfirmSql,
    dangerStatements,
    dangerConfirmInput,
    dangerNeedInput,
    dangerInputTarget,
    dangerCanConfirm,
    handleDangerConfirm,

    // EXPLAIN
    explainResult,
    explainTableRows,
    showExplain,
    isExplaining,
    handleExplain,

    // 执行相关
    handleExecute,
    doExecute,
    handleCancel,
    browseTable,
    loadMoreRows,
    handleRefresh,
    handleServerFilter,
    handleServerSort,
    handleDatabaseSelect,
    toggleErrorStrategy,

    // 事务
    handleBeginTransaction,
    handleCommit,
    handleRollback,

    // 清理
    clearLongRunningNotify,
  }
}
