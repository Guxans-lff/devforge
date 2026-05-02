/**
 * 查询执行核心协调器
 * 组合 useDangerConfirm / useTableBrowse / useExplainAnalysis / useTransactionControl
 * 负责：SQL 执行（流式/非流式/多语句）、数据库切换、查询历史
 */
import { ref, computed, type Ref, type ComputedRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useConnectionStore } from '@/stores/connections'
import { useDatabaseWorkspaceStore } from '@/stores/database-workspace'
import { useNotification } from '@/composables/useNotification'
import { useExecutionTimer } from '@/composables/useExecutionTimer'
import { useDangerConfirm } from '@/composables/useDangerConfirm'
import { useTableBrowse } from '@/composables/useTableBrowse'
import { useExplainAnalysis } from '@/composables/useExplainAnalysis'
import { useTransactionControl } from '@/composables/useTransactionControl'
import * as dbApi from '@/api/database'
import * as historyApi from '@/api/query-history'
import * as aiApi from '@/api/ai'
import { getCredential } from '@/api/connection'
import { useAiChatStore } from '@/stores/ai-chat'
import type { QueryResult, QueryChunk, ErrorStrategy } from '@/types/database'
import type { QueryTabContext, SubStatementResult, SqlErrorAnalysis } from '@/types/database-workspace'
import { isMultiStatement, extractTableName } from '@/utils/sqlParser'
import type { EnvironmentType } from '@/types/environment'
import type { AiStreamEvent, ProviderConfig, ModelConfig } from '@/types/ai'
import { parseBackendError, ensureErrorString } from '@/types/error'
import { createLogger } from '@/utils/logger'

/** useQueryExecution 入参 */
export interface UseQueryExecutionOptions {
  connectionId: Ref<string>
  connectionName: Ref<string | undefined>
  tabId: Ref<string>
  isConnected: Ref<boolean>
  ensureConnected?: () => Promise<boolean>
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
const STREAM_RESULT_UPDATE_INTERVAL_MS = 32

const EMPTY_SQL_ERROR_ANALYSIS: SqlErrorAnalysis = {
  loading: false,
  streamingText: '',
  summary: '',
  fixSql: '',
  error: null,
  sourceSql: '',
  sourceError: '',
  updatedAt: null,
}

/**
 * 查询执行 composable
 * 负责：SQL 执行（流式/非流式/多语句）、表浏览、事务管理、EXPLAIN、危险操作确认
 */
export function useQueryExecution(options: UseQueryExecutionOptions) {
  const log = createLogger('query.execution')
  const {
    connectionId, connectionName, tabId, isConnected,
    ensureConnected,
    environment, readOnly, confirmDanger,
    addResultTab, tabContext,
  } = options

  const { t } = useI18n()
  const connectionStore = useConnectionStore()
  const store = useDatabaseWorkspaceStore()
  const aiStore = useAiChatStore()
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
  /** 执行版本号，用于检测流式查询的 onChunk 是否已过时 */
  let executeVersion = 0

  const queryTimeout = computed({
    get: () => tabContext.value?.queryTimeout ?? 30,
    set: (val: number) => {
      store.updateTabContext(connectionId.value, tabId.value, { queryTimeout: val })
    },
  })

  // ===== 参数化查询 =====
  const paramDialogOpen = ref(false)
  const paramNames = ref<string[]>([])
  const paramValues = ref<Record<string, string>>({})
  const paramPendingSql = ref('')

  function scanSqlParams(
    sql: string,
    visitor: (name: string, start: number, end: number) => void,
  ) {
    let inSingleQuote = false
    let inDoubleQuote = false
    let inBacktick = false
    let inLineComment = false
    let inBlockComment = false

    for (let i = 0; i < sql.length; i++) {
      const ch = sql[i]
      const next = sql[i + 1]
      const prev = sql[i - 1]

      if (inLineComment) {
        if (ch === '\n') inLineComment = false
        continue
      }

      if (inBlockComment) {
        if (ch === '*' && next === '/') {
          inBlockComment = false
          i++
        }
        continue
      }

      if (inSingleQuote) {
        if (ch === '\\' && next) {
          i++
          continue
        }
        if (ch === '\'' && next === '\'') {
          i++
          continue
        }
        if (ch === '\'') inSingleQuote = false
        continue
      }

      if (inDoubleQuote) {
        if (ch === '"') inDoubleQuote = false
        continue
      }

      if (inBacktick) {
        if (ch === '`') inBacktick = false
        continue
      }

      if (ch === '-' && next === '-') {
        inLineComment = true
        i++
        continue
      }
      if (ch === '#') {
        inLineComment = true
        continue
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true
        i++
        continue
      }
      if (ch === '\'') {
        inSingleQuote = true
        continue
      }
      if (ch === '"') {
        inDoubleQuote = true
        continue
      }
      if (ch === '`') {
        inBacktick = true
        continue
      }

      if (ch === ':' && prev !== ':' && next && /[A-Za-z_]/.test(next)) {
        let end = i + 2
        while (end < sql.length && /\w/.test(sql[end]!)) {
          end++
        }
        visitor(sql.slice(i + 1, end), i, end)
        i = end - 1
      }
    }
  }

  function detectParams(sql: string): string[] {
    const found = new Set<string>()
    scanSqlParams(sql, name => found.add(name))
    return [...found]
  }

  function substituteParams(sql: string, params: Record<string, string>): string {
    let output = ''
    let lastIndex = 0

    scanSqlParams(sql, (name, start, end) => {
      output += sql.slice(lastIndex, start)
      const val = params[name]
      if (val === undefined || val === '') {
        output += sql.slice(start, end)
      } else if (/^-?\d+(\.\d+)?$/.test(val)) {
        output += val
      } else {
        output += `'${val.replace(/'/g, "''")}'`
      }
      lastIndex = end
    })

    output += sql.slice(lastIndex)
    return output
  }

  function executeWithParams(params: Record<string, string>) {
    paramDialogOpen.value = false
    const sql = substituteParams(paramPendingSql.value, params)
    doExecute(sql)
  }

  function buildEmptyResult(overrides: Partial<QueryResult> = {}): QueryResult {
    return {
      columns: [],
      rows: [],
      affectedRows: 0,
      executionTimeMs: 0,
      isError: false,
      error: null,
      totalCount: null,
      truncated: false,
      ...overrides,
    }
  }

  function getSqlErrorAnalysis(): SqlErrorAnalysis {
    return {
      ...EMPTY_SQL_ERROR_ANALYSIS,
      ...(tabContext.value?.sqlErrorAnalysis ?? {}),
    }
  }

  function updateSqlErrorAnalysis(patch: Partial<SqlErrorAnalysis>) {
    store.updateTabContext(connectionId.value, tabId.value, {
      sqlErrorAnalysis: {
        ...getSqlErrorAnalysis(),
        ...patch,
      },
    })
  }

  function clearSqlErrorAnalysis() {
    store.updateTabContext(connectionId.value, tabId.value, {
      sqlErrorAnalysis: { ...EMPTY_SQL_ERROR_ANALYSIS },
    })
  }

  function parseAnalysisJson(text: string): { summary: string, fixSql: string, explanation: string } | null {
    const trimmed = text.trim()
    if (!trimmed) return null

    const candidates = [trimmed]
    const firstBrace = trimmed.indexOf('{')
    const lastBrace = trimmed.lastIndexOf('}')
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      candidates.push(trimmed.slice(firstBrace, lastBrace + 1))
    }

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate) as Record<string, unknown>
        return {
          summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
          fixSql: typeof parsed.fixSql === 'string' ? parsed.fixSql.trim() : '',
          explanation: typeof parsed.explanation === 'string' ? parsed.explanation.trim() : '',
        }
      } catch {
        continue
      }
    }

    return null
  }

  function getConfiguredAiSummary() {
    const providerId = tabContext.value?.aiProviderId?.trim()
    const modelId = tabContext.value?.aiModelId?.trim()
    const hasApiKey = Boolean(tabContext.value?.aiHasApiKey)
    return { providerId, modelId, hasApiKey }
  }

  async function resolveAiProvider(): Promise<{ provider: ProviderConfig, model: ModelConfig }> {
    await aiStore.init()

    const { providerId, modelId, hasApiKey } = getConfiguredAiSummary()
    if (!providerId) {
      throw new Error('当前数据库页未配置 AI Provider，请先打开 AI 设置')
    }
    if (!modelId) {
      throw new Error('当前数据库页未配置 AI 模型，请先打开 AI 设置')
    }
    if (!hasApiKey) {
      throw new Error('当前 AI Provider 未配置 API Key，请先打开 AI 设置补充密钥')
    }

    const provider = aiStore.providers.find(p => p.id === providerId)
    if (!provider) {
      throw new Error('当前数据库页选择的 AI Provider 已不存在，请重新配置')
    }

    const model = provider.models.find(item => item.id === modelId)
    if (!model) {
      throw new Error('当前数据库页选择的 AI 模型已不存在，请重新配置')
    }

    return { provider, model }
  }

  async function analyzeSqlError(params?: { sql?: string, error?: string, mode?: 'single' | 'multi' | 'batch' }) {
    const sql = (params?.sql ?? tabContext.value?.sql ?? '').trim()
    const error = (params?.error ?? tabContext.value?.result?.error ?? '').trim()
    if (!sql || !error) return

    updateSqlErrorAnalysis({
      loading: true,
      streamingText: '',
      summary: '',
      fixSql: '',
      error: null,
      sourceSql: sql,
      sourceError: error,
      updatedAt: Date.now(),
    })

    try {
      const { provider, model } = await resolveAiProvider()
      const apiKey = await getCredential(`ai-provider-${provider.id}`) ?? ''
      if (!apiKey) {
        throw new Error('当前 AI Provider 未配置 API Key，请先打开 AI 设置补充密钥')
      }

      let streamed = ''
      const onEvent = (event: AiStreamEvent) => {
        if (event.type === 'TextDelta') {
          streamed += event.delta
          updateSqlErrorAnalysis({ streamingText: streamed })
          return
        }
        if (event.type === 'Error') {
          updateSqlErrorAnalysis({ loading: false, error: event.message, updatedAt: Date.now() })
        }
      }

      const connection = connectionStore.connections.get(connectionId.value)
      const result = await aiApi.analyzeDatabaseSqlError({
        providerType: provider.providerType,
        model: model.id,
        apiKey,
        endpoint: provider.endpoint,
        sql,
        error,
        database: tabContext.value?.currentDatabase,
        driver: connection?.record.type,
        executionMode: params?.mode ?? 'single',
      }, onEvent)

      const rawText = streamed || result.content || ''
      const parsed = parseAnalysisJson(rawText)
      if (!parsed) {
        throw new Error('AI 返回结果解析失败，请重试')
      }

      updateSqlErrorAnalysis({
        loading: false,
        streamingText: rawText,
        summary: parsed.summary,
        fixSql: parsed.fixSql,
        error: null,
        updatedAt: Date.now(),
      })
    } catch (e: unknown) {
      updateSqlErrorAnalysis({
        loading: false,
        error: parseBackendError(e).message,
        updatedAt: Date.now(),
      })
    }
  }

  function applyFixedSql(sql: string) {
    if (!sql.trim()) return
    store.updateTabContext(connectionId.value, tabId.value, { sql })
  }

  function updateStreamResult(result: QueryResult, execVersion: number) {
    if (execVersion !== executeVersion) return
    store.updateTabContext(connectionId.value, tabId.value, { result })
  }

  function resetExecutionState(partial: Partial<QueryTabContext> = {}) {
    store.updateTabContext(connectionId.value, tabId.value, {
      isExecuting: true,
      result: null,
      tableBrowse: undefined,
      resultTabs: [],
      activeResultTabId: undefined,
      ...partial,
    })
  }

  // ===== 长耗时通知 =====
  let longRunningDelayTimer: ReturnType<typeof setTimeout> | null = null
  let longRunningUpdateTimer: ReturnType<typeof setInterval> | null = null
  let longRunningMsgId: string | null = null

  function startExecutionTimer() {
    executionTimer.start()
    clearLongRunningNotify()
    longRunningDelayTimer = setTimeout(() => {
      if (!isExecuting.value) return
      // 首次通知（不自动关闭）
      longRunningMsgId = notification.warning(
        t('database.longRunningTitle'),
        t('database.longRunningDesc', { time: executionTimer.elapsed.value }),
        0,
      )
      // 每 5 秒更新耗时
      longRunningUpdateTimer = setInterval(() => {
        if (!isExecuting.value || !longRunningMsgId) {
          clearLongRunningNotify()
          return
        }
        notification.updateMessage(longRunningMsgId, {
          description: t('database.longRunningDesc', { time: executionTimer.elapsed.value }),
        })
      }, 5000)
    }, 5000)
  }

  function stopExecutionTimer() {
    executionTimer.stop()
    if (longRunningMsgId) {
      notification.dismiss(longRunningMsgId)
      longRunningMsgId = null
    }
    clearLongRunningNotify()
  }

  function clearLongRunningNotify() {
    if (longRunningDelayTimer) {
      clearTimeout(longRunningDelayTimer)
      longRunningDelayTimer = null
    }
    if (longRunningUpdateTimer) {
      clearInterval(longRunningUpdateTimer)
      longRunningUpdateTimer = null
    }
  }

  // ===== 主入口：执行 SQL =====
  async function restoreSessionConnection() {
    try {
      await dbApi.dbAcquireSession(connectionId.value, tabId.value)
      return true
    } catch (e: unknown) {
      log.warn('restore_session_failed', undefined, e)
      return false
    }
  }

  async function ensureExecutionConnection() {
    if (isConnected.value) return true
    if (!ensureConnected) return false

    const connected = await ensureConnected()
    if (!connected) return false

    return restoreSessionConnection()
  }

  async function tryAutoReconnect(errorMessage: string) {
    if (!connectionId.value || !connectionStore.isDisconnectError(errorMessage)) return false

    const reconnectResult = await connectionStore.attemptAutoReconnect(connectionId.value)
    if (!reconnectResult?.success) return false

    return restoreSessionConnection()
  }

  function normalizeResultError(result: QueryResult) {
    if (result.error === null || result.error === undefined) return null
    const errorMessage = ensureErrorString(result.error)
    result.error = errorMessage
    return errorMessage
  }

  function getRetryableMultiDisconnectError(results: SubStatementResult[]) {
    let hasSuccessfulStatement = false

    for (const statement of results) {
      if (!statement.result.isError) {
        hasSuccessfulStatement = true
        continue
      }

      const errorMessage = normalizeResultError(statement.result)
      if (!errorMessage) continue
      if (hasSuccessfulStatement) return null

      return connectionStore.isDisconnectError(errorMessage) ? errorMessage : null
    }

    return null
  }

  async function handleBatchExecute(sql: string, databases: string[], hasRetried = false): Promise<{ success: boolean }> {
    const targetDatabases = [...new Set(databases.filter(Boolean))]
    if (!sql.trim() || isExecuting.value || targetDatabases.length <= 1) {
      return { success: false }
    }

    if (!(await ensureExecutionConnection())) return { success: false }

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

    const currentExecVersion = ++executeVersion
    explainAnalysis.showExplain.value = false
    startExecutionTimer()
    resetExecutionState()

    const startTime = Date.now()

    try {
      const timeoutSecs = queryTimeout.value > 0 ? queryTimeout.value : undefined
      const results = await dbApi.dbExecuteQueryInDatabases(
        connectionId.value,
        targetDatabases,
        sql,
        errorStrategy.value,
        timeoutSecs,
      )

      if (currentExecVersion !== executeVersion) return { success: false }

      const disconnectFailure = results.find(item => item.result.isError && item.result.error && connectionStore.isDisconnectError(item.result.error))
      if (disconnectFailure && !hasRetried && await tryAutoReconnect(disconnectFailure.result.error ?? '')) {
        return handleBatchExecute(sql, targetDatabases, true)
      }

      const successCount = results.filter(item => item.success).length
      const failCount = results.length - successCount
      const totalTime = Date.now() - startTime
      const stopped = results.some(item => item.stoppedByStrategy)
      const executedDatabases = results.map(item => item.database)
      const skippedDatabases = stopped
        ? targetDatabases.filter(database => !executedDatabases.includes(database))
        : []
      const lastResult = results.find(item => item.result.columns.length > 0)?.result ?? results[results.length - 1]?.result ?? buildEmptyResult()
      const summaryResult: QueryResult = {
        ...lastResult,
        executionTimeMs: totalTime,
        multiStatementSummary: { total: results.length, success: successCount, fail: failCount },
      }

      const tabs = [...(tabContext.value?.resultTabs ?? [])]
      while (tabs.length >= MAX_RESULT_TABS) {
        const unpinnedIdx = tabs.findIndex(tab => !tab.isPinned)
        if (unpinnedIdx === -1) break
        tabs.splice(unpinnedIdx, 1)
      }

      const newTab = {
        id: crypto.randomUUID(),
        title: `批量库执行 (${successCount}/${results.length})`,
        result: summaryResult,
        sql: sql.trim(),
        isPinned: false,
        createdAt: Date.now(),
        batchDatabaseResults: results,
        batchExecutionSummary: {
          targetDatabases,
          skippedDatabases,
          stoppedByStrategy: stopped,
        },
      }
      tabs.push(newTab)

      stopExecutionTimer()
      store.updateTabContext(connectionId.value, tabId.value, {
        result: summaryResult,
        resultTabs: tabs,
        activeResultTabId: newTab.id,
        isExecuting: false,
      })

      const summaryMsg = `目标 ${targetDatabases.length} 个库，已执行 ${results.length}，成功 ${successCount}，失败 ${failCount}${stopped ? `，已停止，剩余 ${skippedDatabases.length} 个未执行` : ''}`
      if (failCount > 0) {
        notification.warning('批量执行完成', summaryMsg, 0)
      } else {
        notification.success('批量执行完成', summaryMsg, 3000)
      }

      saveHistory(sql, summaryResult)
      return { success: true }
    } catch (e: unknown) {
      const errorStr = parseBackendError(e).message
      if (!hasRetried && await tryAutoReconnect(errorStr)) {
        return handleBatchExecute(sql, targetDatabases, true)
      }
      const errorResult: QueryResult = {
        columns: [], rows: [], affectedRows: 0,
        executionTimeMs: Date.now() - startTime,
        isError: true, error: errorStr, totalCount: null, truncated: false,
      }
      stopExecutionTimer()
      if (currentExecVersion !== executeVersion) return { success: false }
      store.updateTabContext(connectionId.value, tabId.value, { result: errorResult, isExecuting: false })
      notification.error('批量执行失败', errorStr, true)
      saveHistory(sql, errorResult)
      return { success: false }
    }
  }

  async function handleExecute(sql: string): Promise<{ success: boolean }> {
    if (!sql.trim() || isExecuting.value) return { success: false }

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

    const started = await doExecute(sql)
    return { success: started }
  }

  /** 确认危险操作后继续执行 */
  function handleDangerConfirm() {
    const sql = dangerConfirm.confirmAndGetSql()
    if (sql) void doExecute(sql)
  }

  /** 核心执行逻辑（绕过危险检查） */
  async function doExecute(sql: string) {
    if (!sql.trim() || isExecuting.value) return false
    if (!(await ensureExecutionConnection())) return false

    // 递增执行版本号，使正在进行的旧流式查询的 onChunk 失效
    const currentExecVersion = ++executeVersion

    explainAnalysis.showExplain.value = false
    startExecutionTimer()

    // USE 语句特殊处理
    const useMatch = sql.trim().match(/^USE\s+`?(\w+)`?\s*;?\s*$/i)
    if (useMatch) {
      const dbName = useMatch[1]!
      try {
        await dbApi.dbSwitchDatabase(connectionId.value, tabId.value, dbName)
        stopExecutionTimer()
        store.updateTabContext(connectionId.value, tabId.value, {
          currentDatabase: dbName,
          result: buildEmptyResult(),
          isExecuting: false,
        })
        notification.success(t('database.databaseSwitched', { name: dbName }) || `已切换到数据库 ${dbName}`)
        return true
      } catch (e: unknown) {
        const errorResult = buildEmptyResult({
          isError: true,
          error: parseBackendError(e).message,
        })
        stopExecutionTimer()
        if (currentExecVersion !== executeVersion) return false
        store.updateTabContext(connectionId.value, tabId.value, {
          result: errorResult,
          isExecuting: false,
        })
        notification.error(t('database.queryFailed'), errorResult.error ?? undefined, true)
        saveHistory(sql, errorResult)
        return false
      }
    }

    // 清除旧状态
    resetExecutionState()

    const startTime = Date.now()

    if (isMultiStatement(sql)) {
      await handleMultiExecute(sql, startTime, currentExecVersion)
      return true
    }

    const firstWord = sql.trim().split(/\s+/)[0]?.toUpperCase() ?? ''
    const isSelectLike = ['SELECT', 'SHOW', 'DESCRIBE', 'EXPLAIN'].includes(firstWord)

    if (isSelectLike) {
      await handleStreamExecute(sql, startTime, currentExecVersion)
    } else {
      await handleNonStreamExecute(sql, startTime, currentExecVersion)
    }

    return true
  }

  // ===== 流式执行 =====
  async function handleStreamExecute(sql: string, startTime: number, execVersion: number, hasRetried = false) {
    let allColumns: QueryResult['columns'] = []
    let allRows: unknown[][] = []
    let lastError: string | null = null
    let totalTimeMs = 0
    let receivedChunk = false
    let pendingResultTimer: ReturnType<typeof setTimeout> | null = null

    const clearPendingResultFlush = () => {
      if (pendingResultTimer) {
        clearTimeout(pendingResultTimer)
        pendingResultTimer = null
      }
    }

    const flushPartialResult = (isFinal: boolean) => {
      updateStreamResult({
        columns: allColumns,
        rows: allRows,
        affectedRows: 0,
        executionTimeMs: totalTimeMs || (Date.now() - startTime),
        isError: !!lastError,
        error: lastError,
        totalCount: isFinal ? allRows.length : null,
        truncated: false,
      }, execVersion)
    }

    const schedulePartialResultFlush = () => {
      if (pendingResultTimer) return
      pendingResultTimer = setTimeout(() => {
        pendingResultTimer = null
        flushPartialResult(false)
      }, STREAM_RESULT_UPDATE_INTERVAL_MS)
    }

    try {
      const timeoutSecs = queryTimeout.value > 0 ? queryTimeout.value : undefined

      let resolveStream: () => void
      let rejectStream: (reason: unknown) => void
      const streamFinishedPromise = new Promise<void>((res, rej) => {
        resolveStream = res
        rejectStream = rej
      })

      const onChunk = (chunk: QueryChunk) => {
        // 版本号不匹配说明已有新的执行/browseTable，丢弃此 chunk
        if (execVersion !== executeVersion) return
        receivedChunk = true
        if (chunk.columns && chunk.columns.length > 0) allColumns = chunk.columns
        if (chunk.rows && chunk.rows.length > 0) allRows.push(...chunk.rows)
        if (chunk.error) lastError = ensureErrorString(chunk.error)
        if (chunk.totalTimeMs !== null && chunk.totalTimeMs !== undefined) totalTimeMs = chunk.totalTimeMs

        if (chunk.isLast) {
          clearPendingResultFlush()
          flushPartialResult(true)
          resolveStream()
          return
        }

        schedulePartialResultFlush()
      }

      const currentDb = tabContext.value?.currentDatabase
      const invokePromise = dbApi.dbExecuteQueryStreamOnSession(
        connectionId.value, tabId.value, sql, onChunk, currentDb, timeoutSecs,
      ).catch(e => { rejectStream!(e) })

      await Promise.all([invokePromise, streamFinishedPromise])

      const finalResult: QueryResult = {
        columns: allColumns, rows: allRows, affectedRows: 0,
        executionTimeMs: totalTimeMs || (Date.now() - startTime),
        isError: !!lastError, error: lastError,
        totalCount: allRows.length, truncated: false,
        tableName: extractTableName(sql) || undefined,
      }

      // 版本号不匹配说明已有新操作，丢弃此结果
      if (execVersion !== executeVersion) return
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
    } catch (e: unknown) {
      clearPendingResultFlush()
      if (execVersion !== executeVersion) return

      const errorMessage = lastError ?? parseBackendError(e).message
      if (!receivedChunk && !hasRetried && await tryAutoReconnect(errorMessage)) {
        return handleStreamExecute(sql, startTime, execVersion, true)
      }
      const shouldFallback = !receivedChunk
        && /not implemented|unsupported|stream/i.test(errorMessage)

      if (shouldFallback) {
        log.warn('stream_query_unavailable', undefined, e)
        await handleNonStreamExecute(sql, startTime, execVersion)
        return
      }

      const errorResult: QueryResult = {
        columns: allColumns,
        rows: allRows,
        affectedRows: 0,
        executionTimeMs: totalTimeMs || (Date.now() - startTime),
        isError: true,
        error: errorMessage,
        totalCount: allRows.length > 0 ? allRows.length : null,
        truncated: false,
        tableName: extractTableName(sql) || undefined,
      }
      stopExecutionTimer()
      store.updateTabContext(connectionId.value, tabId.value, { result: errorResult, isExecuting: false })
      notification.error(t('database.queryFailed'), errorMessage, true)
      saveHistory(sql, errorResult)
    }
  }

  // ===== 非流式执行 =====
  async function handleNonStreamExecute(sql: string, startTime: number, execVersion: number, hasRetried = false) {
    try {
      const timeoutSecs = queryTimeout.value > 0 ? queryTimeout.value : undefined
      const currentDb = tabContext.value?.currentDatabase
      const result = await dbApi.dbExecuteQueryOnSession(
        connectionId.value, tabId.value, sql, currentDb, timeoutSecs,
      )
      if (execVersion !== executeVersion) return
      if (!result.isError) result.tableName = extractTableName(sql) || undefined
      const errorMessage = normalizeResultError(result)
      if (result.isError && errorMessage && !hasRetried && await tryAutoReconnect(errorMessage)) {
        return handleNonStreamExecute(sql, startTime, execVersion, true)
      }

      stopExecutionTimer()
      // 版本号不匹配说明已有新操作，丢弃此结果
      if (execVersion !== executeVersion) return
      // 防御性处理：后端可能返回对象类型的 error，需确保为字符串
      store.updateTabContext(connectionId.value, tabId.value, { result, isExecuting: false })

      const executionTime = Date.now() - startTime
      if (result.isError) {
        notification.error(t('database.queryFailed'), errorMessage ?? undefined, true)
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
      if (execVersion !== executeVersion) return
      const errorStr = parseBackendError(e).message
      if (!hasRetried && await tryAutoReconnect(errorStr)) {
        return handleNonStreamExecute(sql, startTime, execVersion, true)
      }
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
  async function handleMultiExecute(sql: string, startTime: number, execVersion: number, hasRetried = false) {
    try {
      const currentDb = tabContext.value?.currentDatabase
      const timeoutSecs = queryTimeout.value > 0 ? queryTimeout.value : undefined

      const results = await dbApi.dbExecuteMultiV2OnSession(
        connectionId.value, tabId.value, sql, currentDb, errorStrategy.value, timeoutSecs,
      )

      if (execVersion !== executeVersion) return

      const totalTime = Date.now() - startTime
      const successCount = results.filter(r => !r.result.isError).length
      const failCount = results.length - successCount

      const subResults: SubStatementResult[] = results.map(stmt => ({
        index: stmt.index, sql: stmt.sql, statementType: stmt.statementType, result: stmt.result,
      }))
      const disconnectError = getRetryableMultiDisconnectError(subResults)
      if (disconnectError && !hasRetried && await tryAutoReconnect(disconnectError)) {
        return handleMultiExecute(sql, startTime, execVersion, true)
      }

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
      const newTab = {
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
        result: summaryResult,
        resultTabs: tabs,
        activeResultTabId: newTab.id,
        isExecuting: false,
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
      if (!hasRetried && await tryAutoReconnect(errorStr)) {
        return handleMultiExecute(sql, startTime, execVersion, true)
      }
      const errorResult: QueryResult = {
        columns: [], rows: [], affectedRows: 0,
        executionTimeMs: Date.now() - startTime,
        isError: true, error: errorStr, totalCount: null, truncated: false,
      }
      stopExecutionTimer()
      if (execVersion !== executeVersion) return
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
    }).catch((e: unknown) => log.warn('save_history_failed', undefined, e))
  }

  // ===== 取消查询 =====
  async function handleCancel() {
    try {
      ++executeVersion
      await dbApi.dbCancelQueryOnSession(connectionId.value, tabId.value)
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
    if (database === tabContext.value?.currentDatabase) return
    try {
      await dbApi.dbSwitchDatabase(connectionId.value, tabId.value, database)
      store.updateTabContext(connectionId.value, tabId.value, { currentDatabase: database })
      emit('databaseChanged', database)
    } catch (e) {
      notification.error(t('database.queryFailed'), parseBackendError(e).message, true)
      log.warn('switch_database_failed', undefined, e)
    }
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
    handleBatchExecute,
    doExecute,
    handleCancel,

    // 参数化查询
    paramDialogOpen,
    paramNames,
    paramValues,
    executeWithParams,
    browseTable: (...args: Parameters<typeof tableBrowse.browseTable>) => {
      // browseTable 时递增执行版本号，使旧的流式查询 onChunk 失效
      ++executeVersion
      return tableBrowse.browseTable(...args)
    },
    loadMoreRows: tableBrowse.loadMoreRows,
    invalidateBrowseCache: tableBrowse.invalidateCache,
    handleRefresh,
    handleServerFilter: tableBrowse.handleServerFilter,
    handleServerSort: tableBrowse.handleServerSort,
    handleDatabaseSelect,
    toggleErrorStrategy,
    analyzeSqlError,
    clearSqlErrorAnalysis,
    applyFixedSql,

    // 事务
    handleBeginTransaction: transactionControl.handleBeginTransaction,
    handleCommit: transactionControl.handleCommit,
    handleRollback: transactionControl.handleRollback,

    // 清理
    clearLongRunningNotify,
  }
}
