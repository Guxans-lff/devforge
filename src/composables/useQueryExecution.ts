/**
 * 查询执行核心协调器
 * 组合 useDangerConfirm / useTableBrowse / useExplainAnalysis / useTransactionControl
 * 负责：SQL 执行（流式/非流式/多语句）、数据库切换、查询历史
 */
import { ref, computed, type Ref, type ComputedRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDatabaseWorkspaceStore } from '@/stores/database-workspace'
import { useNotification } from '@/composables/useNotification'
import { useExecutionTimer } from '@/composables/useExecutionTimer'
import { useDangerConfirm } from '@/composables/useDangerConfirm'
import { useTableBrowse } from '@/composables/useTableBrowse'
import { useExplainAnalysis } from '@/composables/useExplainAnalysis'
import { useTransactionControl } from '@/composables/useTransactionControl'
import * as dbApi from '@/api/database'
import * as historyApi from '@/api/query-history'
import type { QueryResult, QueryChunk, ErrorStrategy } from '@/types/database'
import type { QueryTabContext, ResultTab, SubStatementResult } from '@/types/database-workspace'
import { isMultiStatement, extractTableName } from '@/utils/sqlParser'
import type { EnvironmentType } from '@/types/environment'
import { parseBackendError } from '@/types/error'

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
    connectionId, connectionName, tabId, isConnected,
    environment, readOnly, confirmDanger,
    addResultTab, tabContext,
  } = options

  const { t } = useI18n()
  const store = useDatabaseWorkspaceStore()
  const notification = useNotification()
  const executionTimer = useExecutionTimer()

  // ===== 子模块组合 =====
  const isExecuting = computed(() => tabContext.value?.isExecuting ?? false)
  const isInTransaction = computed(() => tabContext.value?.isInTransaction ?? false)

  const dangerConfirm = useDangerConfirm({
    environment,
    readOnly,
    confirmDanger,
    connectionName,
    currentDatabase: computed(() => tabContext.value?.currentDatabase),
  })

  const tableBrowse = useTableBrowse({
    connectionId, tabId, isConnected, tabContext, isExecuting,
  })

  const explainAnalysis = useExplainAnalysis({
    connectionId, isConnected,
  })

  const transactionControl = useTransactionControl({
    connectionId, tabId, isConnected,
  })

  // ===== 状态 =====
  const pendingExecuteSql = ref<string | null>(null)
  const errorStrategy = ref<ErrorStrategy>('continueOnError')

  const queryTimeout = computed({
    get: () => tabContext.value?.queryTimeout ?? 30,
    set: (val: number) => {
      store.updateTabContext(connectionId.value, tabId.value, { queryTimeout: val })
    },
  })

  // ===== 参数化查询 =====
  /** 检测 SQL 中的 :paramName 占位符 */
  const PARAM_REGEX = /(?<!')(?::([a-zA-Z_]\w*))(?!')/g
  const paramDialogOpen = ref(false)
  const paramNames = ref<string[]>([])
  const paramValues = ref<Record<string, string>>({})
  const paramPendingSql = ref('')

  function detectParams(sql: string): string[] {
    const found = new Set<string>()
    let match: RegExpExecArray | null
    const re = new RegExp(PARAM_REGEX.source, PARAM_REGEX.flags)
    while ((match = re.exec(sql)) !== null) {
      found.add(match[1]!)
    }
    return [...found]
  }

  function substituteParams(sql: string, params: Record<string, string>): string {
    return sql.replace(new RegExp(PARAM_REGEX.source, PARAM_REGEX.flags), (full, name: string) => {
      const val = params[name]
      if (val === undefined || val === '') return full
      // 数字直接替换，否则用单引号包裹并转义
      if (/^-?\d+(\.\d+)?$/.test(val)) return val
      return `'${val.replace(/'/g, "''")}'`
    })
  }

  function executeWithParams(params: Record<string, string>) {
    paramDialogOpen.value = false
    const sql = substituteParams(paramPendingSql.value, params)
    doExecute(sql)
  }

  // ===== 长耗时通知 =====
  let longRunningNotifyId: ReturnType<typeof setTimeout> | null = null

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

    // 参数化查询检测
    const params = detectParams(sql)
    if (params.length > 0) {
      paramPendingSql.value = sql
      paramNames.value = params
      // 保留上次同名参数的值
      const prev = { ...paramValues.value }
      paramValues.value = Object.fromEntries(params.map(p => [p, prev[p] ?? '']))
      paramDialogOpen.value = true
      return { success: false }
    }

    const check = dangerConfirm.checkExecution(sql)
    if (check === 'readonly') {
      notification.error(
        t('environment.readOnlyBlocked'),
        t('environment.readOnlyBlockedDesc'),
      )
      return { success: false }
    }
    if (check === 'danger') {
      return { success: false }
    }

    await doExecute(sql)
    return { success: true }
  }

  /** 确认危险操作后继续执行 */
  function handleDangerConfirm() {
    const sql = dangerConfirm.confirmAndGetSql()
    if (sql) doExecute(sql)
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
          columns: [], rows: [], affectedRows: 0, executionTimeMs: 0,
          isError: false, error: null, totalCount: null, truncated: false,
        },
        isExecuting: false,
      })
      dbApi.dbSwitchDatabase(connectionId.value, tabId.value, dbName).catch((e: unknown) => console.warn('[useQueryExecution]', e))
      notification.success(t('database.databaseSwitched', { name: dbName }) || `已切换到数据库 ${dbName}`)
      return dbName
    }

    // 清除旧状态
    store.updateTabContext(connectionId.value, tabId.value, {
      isExecuting: true, result: null, tableBrowse: undefined, activeResultTabId: undefined,
    })

    const startTime = Date.now()

    if (isMultiStatement(sql)) {
      await handleMultiExecute(sql, startTime)
      return
    }

    const firstWord = sql.trim().split(/\s+/)[0]?.toUpperCase() ?? ''
    const isSelectLike = ['SELECT', 'SHOW', 'DESCRIBE', 'EXPLAIN'].includes(firstWord)

    if (isSelectLike) {
      await handleStreamExecute(sql, startTime)
    } else {
      await handleNonStreamExecute(sql, startTime)
    }
  }

  // ===== 流式执行 =====
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
        if (chunk.columns && chunk.columns.length > 0) allColumns = chunk.columns
        if (chunk.rows && chunk.rows.length > 0) allRows = [...allRows, ...chunk.rows]
        if (chunk.error) lastError = chunk.error
        if (chunk.totalTimeMs !== null && chunk.totalTimeMs !== undefined) totalTimeMs = chunk.totalTimeMs

        store.updateTabContext(connectionId.value, tabId.value, {
          result: {
            columns: allColumns, rows: allRows, affectedRows: 0,
            executionTimeMs: totalTimeMs || (Date.now() - startTime),
            isError: !!lastError, error: lastError,
            totalCount: chunk.isLast ? allRows.length : null, truncated: false,
          },
        })
        if (chunk.isLast) resolveStream()
      }

      const currentDb = tabContext.value?.currentDatabase
      const invokePromise = dbApi.dbExecuteQueryStreamOnSession(
        connectionId.value, tabId.value, sql, onChunk, currentDb, timeoutSecs,
      ).catch(e => { rejectStream!(e) })

      const waitTimeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('流式查询响应超时')), 5000),
      )

      await Promise.race([
        Promise.all([invokePromise, streamFinishedPromise]),
        waitTimeoutPromise,
      ])

      const finalResult: QueryResult = {
        columns: allColumns, rows: allRows, affectedRows: 0,
        executionTimeMs: totalTimeMs || (Date.now() - startTime),
        isError: !!lastError, error: lastError,
        totalCount: allRows.length, truncated: false,
        tableName: extractTableName(sql) || undefined,
      }

      stopExecutionTimer()
      store.updateTabContext(connectionId.value, tabId.value, { result: finalResult, isExecuting: false })

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

  // ===== 非流式执行 =====
  async function handleNonStreamExecute(sql: string, startTime: number) {
    try {
      const timeoutSecs = queryTimeout.value > 0 ? queryTimeout.value : undefined
      const currentDb = tabContext.value?.currentDatabase
      const result = await dbApi.dbExecuteQueryOnSession(
        connectionId.value, tabId.value, sql, currentDb, timeoutSecs,
      )
      if (!result.isError) result.tableName = extractTableName(sql) || undefined

      stopExecutionTimer()
      store.updateTabContext(connectionId.value, tabId.value, { result, isExecuting: false })

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
    } catch (e: unknown) {
      const errorStr = parseBackendError(e).message
      const errorResult: QueryResult = {
        columns: [], rows: [], affectedRows: 0,
        executionTimeMs: Date.now() - startTime,
        isError: true, error: errorStr, totalCount: null, truncated: false,
      }
      stopExecutionTimer()
      store.updateTabContext(connectionId.value, tabId.value, { result: errorResult, isExecuting: false })
      notification.error(t('database.queryFailed'), errorStr, true)
      saveHistory(sql, errorResult)
    }
  }

  // ===== 多语句执行 =====
  async function handleMultiExecute(sql: string, startTime: number) {
    try {
      const currentDb = tabContext.value?.currentDatabase
      const timeoutSecs = queryTimeout.value > 0 ? queryTimeout.value : undefined

      const results = await dbApi.dbExecuteMultiV2(
        connectionId.value, sql, currentDb, errorStrategy.value, timeoutSecs,
      )

      const totalTime = Date.now() - startTime
      const successCount = results.filter(r => !r.result.isError).length
      const failCount = results.length - successCount

      const subResults: SubStatementResult[] = results.map(stmt => ({
        index: stmt.index, sql: stmt.sql, statementType: stmt.statementType, result: stmt.result,
      }))

      const selectResult = results.find(r => !r.result.isError && r.result.columns.length > 0)
      const lastResult = selectResult?.result ?? (results.length > 0 ? results[results.length - 1]!.result : null)

      const summaryResult: QueryResult = lastResult ? {
        ...lastResult,
        executionTimeMs: totalTime,
        multiStatementSummary: { total: results.length, success: successCount, fail: failCount },
      } : {
        columns: [], rows: [], affectedRows: 0, executionTimeMs: totalTime,
        isError: false, error: null, totalCount: null, truncated: false,
        multiStatementSummary: { total: results.length, success: successCount, fail: failCount },
      }

      const tabs = [...(tabContext.value?.resultTabs ?? [])]
      while (tabs.length >= MAX_RESULT_TABS) {
        const unpinnedIdx = tabs.findIndex(tab => !tab.isPinned)
        if (unpinnedIdx === -1) break
        tabs.splice(unpinnedIdx, 1)
      }
      const newTab: ResultTab = {
        id: crypto.randomUUID(),
        title: `批量执行 (${successCount}/${results.length})`,
        result: summaryResult, sql: sql.trim(),
        isPinned: false, createdAt: Date.now(), subResults,
      }
      tabs.push(newTab)

      stopExecutionTimer()
      store.updateTabContext(connectionId.value, tabId.value, {
        resultTabs: tabs, activeResultTabId: newTab.id,
        result: summaryResult, isExecuting: false,
      })

      const summaryMsg = t('database.multiStatement.executionSummary', {
        total: results.length, success: successCount, fail: failCount,
        time: `${(totalTime / 1000).toFixed(1)}s`,
      })

      if (failCount > 0) {
        notification.warning('执行完成', summaryMsg, 0)
      } else {
        notification.success('执行完成', summaryMsg, 3000)
      }

      if (lastResult) saveHistory(sql, lastResult)
    } catch (e: unknown) {
      const errorStr = parseBackendError(e).message
      const errorResult: QueryResult = {
        columns: [], rows: [], affectedRows: 0,
        executionTimeMs: Date.now() - startTime,
        isError: true, error: errorStr, totalCount: null, truncated: false,
      }
      stopExecutionTimer()
      store.updateTabContext(connectionId.value, tabId.value, { result: errorResult, isExecuting: false })
      notification.error(t('database.queryFailed'), errorStr, true)
      saveHistory(sql, errorResult)
    }
  }

  // ===== 查询历史 =====
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
    }).catch((e: unknown) => console.warn('[useQueryExecution]', e))
  }

  // ===== 取消查询 =====
  async function handleCancel() {
    try {
      await dbApi.dbCancelQuery(connectionId.value)
    } catch (_e) {
      // 静默处理
    } finally {
      stopExecutionTimer()
      store.updateTabContext(connectionId.value, tabId.value, { isExecuting: false })
    }
  }

  // ===== 刷新 =====
  function handleRefresh(sqlContent: string) {
    const ctx = tabContext.value
    if (ctx?.tableBrowse) {
      tableBrowse.invalidateCache()
      tableBrowse.browseTable(ctx.tableBrowse.database, ctx.tableBrowse.table, ctx.tableBrowse.whereClause, ctx.tableBrowse.orderBy)
    } else if (sqlContent.trim()) {
      handleExecute(sqlContent)
    }
  }

  // ===== 错误策略 =====
  function toggleErrorStrategy() {
    errorStrategy.value = errorStrategy.value === 'stopOnError' ? 'continueOnError' : 'stopOnError'
  }

  // ===== 数据库切换 =====
  async function handleDatabaseSelect(database: string, emit: (event: 'databaseChanged', database: string) => void) {
    if (!database || !isConnected.value) return
    store.updateTabContext(connectionId.value, tabId.value, { currentDatabase: database })
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
    isLoadingMore: tableBrowse.isLoadingMore,
    isInTransaction,
    queryTimeout,
    errorStrategy,
    pendingExecuteSql,
    executionTimer,

    // 危险操作确认
    dangerConfirmOpen: dangerConfirm.dangerConfirmOpen,
    dangerConfirmSql: dangerConfirm.dangerConfirmSql,
    dangerStatements: dangerConfirm.dangerStatements,
    dangerConfirmInput: dangerConfirm.dangerConfirmInput,
    dangerNeedInput: dangerConfirm.dangerNeedInput,
    dangerInputTarget: dangerConfirm.dangerInputTarget,
    dangerCanConfirm: dangerConfirm.dangerCanConfirm,
    handleDangerConfirm,

    // EXPLAIN
    explainResult: explainAnalysis.explainResult,
    explainTableRows: explainAnalysis.explainTableRows,
    showExplain: explainAnalysis.showExplain,
    isExplaining: explainAnalysis.isExplaining,
    handleExplain: explainAnalysis.handleExplain,

    // 执行相关
    handleExecute,
    doExecute,
    handleCancel,

    // 参数化查询
    paramDialogOpen,
    paramNames,
    paramValues,
    executeWithParams,
    browseTable: tableBrowse.browseTable,
    loadMoreRows: tableBrowse.loadMoreRows,
    invalidateBrowseCache: tableBrowse.invalidateCache,
    handleRefresh,
    handleServerFilter: tableBrowse.handleServerFilter,
    handleServerSort: tableBrowse.handleServerSort,
    handleDatabaseSelect,
    toggleErrorStrategy,

    // 事务
    handleBeginTransaction: transactionControl.handleBeginTransaction,
    handleCommit: transactionControl.handleCommit,
    handleRollback: transactionControl.handleRollback,

    // 清理
    clearLongRunningNotify,
  }
}
