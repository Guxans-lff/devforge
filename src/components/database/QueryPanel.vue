<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { Splitpanes, Pane } from 'splitpanes'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Play, Loader2, Square, WrapText, Bookmark, ListTree, PlayCircle, CheckCircle2, XCircle, Clock, Pin, Table2, X as XIcon, ShieldAlert, ShieldCheck, Database } from 'lucide-vue-next'
import SqlEditor from '@/components/database/SqlEditorLazy.vue'
import QueryResultComponent from '@/components/database/QueryResult.vue'
import SqlSnippetPanel from '@/components/database/SqlSnippetPanel.vue'
import ExplainPanel from '@/components/database/ExplainPanel.vue'
import { useDatabaseWorkspaceStore } from '@/stores/database-workspace'
import { useNotification } from '@/composables/useNotification'
import * as dbApi from '@/api/database'
import * as historyApi from '@/api/query-history'
import { useGridSearch } from '@/composables/useGridSearch'
import type { QueryResult, QueryChunk, SchemaCache } from '@/types/database'
import type { ErrorStrategy } from '@/types/database'
import type { QueryTabContext, ResultTab } from '@/types/database-workspace'

const props = defineProps<{
  connectionId: string
  connectionName?: string
  tabId: string
  isConnected: boolean
  schemaCache: SchemaCache | null
  isLoadingSchema?: boolean
  driver: string
  /** 可用数据库列表（由父组件从 ObjectTree 提取） */
  databases?: string[]
}>()

const emit = defineEmits<{
  reconnect: []
  executeSuccess: [sql: string]
  databaseChanged: [database: string]
}>()

const { t } = useI18n()
const store = useDatabaseWorkspaceStore()
const notification = useNotification()
const editorRef = ref<InstanceType<typeof SqlEditor>>()
/** 结果面板容器引用（用于 Data Grid 快捷键监听） */
const resultPanelRef = ref<HTMLDivElement>()

// 集成数据网格搜索功能
const gridSearch = useGridSearch()

/** 跳转到指定行对话框状态 */
const showGoToLineDialog = ref(false)
const goToLineInput = ref('')
const executeDisabledReason = computed(() => {
  if (!props.isConnected) return t('database.notConnected')
  if (isExecuting.value) return t('database.executing')
  return ''
})

const tabContext = computed(() => {
  const ws = store.getWorkspace(props.connectionId)
  const tab = ws?.tabs.find((t) => t.id === props.tabId)
  return tab?.context as QueryTabContext | undefined
})

const sqlContent = computed({
  get: () => tabContext.value?.sql ?? '',
  set: (val: string) => {
    store.updateTabContext(props.connectionId, props.tabId, { sql: val })
  },
})

const queryResult = computed(() => tabContext.value?.result ?? null)
const isExecuting = computed(() => tabContext.value?.isExecuting ?? false)
const isLoadingMore = ref(false)

// ===== 结果标签页管理 =====
const resultTabs = computed(() => tabContext.value?.resultTabs ?? [])
const activeResultTabId = computed(() => tabContext.value?.activeResultTabId ?? null)

// 当前激活的结果标签页
const activeResultTab = computed(() => {
  if (!activeResultTabId.value) return null
  return resultTabs.value.find(t => t.id === activeResultTabId.value) ?? null
})

// ===== 多语句子结果切换 =====
/** 当前选中的子语句索引（-1 表示显示汇总） */
const activeSubResultIndex = ref(-1)

/** 当前激活 Tab 的子结果列表 */
const subResults = computed(() => activeResultTab.value?.subResults ?? [])

/** 是否为多语句汇总 Tab */
const isMultiResultTab = computed(() => subResults.value.length > 0)

/** 切换子语句结果 */
function setActiveSubResult(index: number) {
  activeSubResultIndex.value = index
}

// 切换结果 Tab 时重置子结果索引
watch(activeResultTabId, () => {
  activeSubResultIndex.value = -1
})

// 当前显示的查询结果（优先显示激活的结果标签页）
const displayResult = computed(() => {
  if (activeResultTab.value) {
    // 多语句模式下，如果选中了某条子语句，显示该子语句的结果
    if (isMultiResultTab.value && activeSubResultIndex.value >= 0) {
      const sub = subResults.value[activeSubResultIndex.value]
      if (sub) return sub.result
    }
    return activeResultTab.value.result
  }
  return tabContext.value?.result ?? null
})

/** 最大结果标签页数量 */
const MAX_RESULT_TABS = 10

/** 添加结果标签页 */
function addResultTab(sql: string, result: QueryResult, executionTime: number) {
  const tabs = [...resultTabs.value]

  // 超过最大数量时，关闭最早的非固定标签页
  while (tabs.length >= MAX_RESULT_TABS) {
    const unpinnedIdx = tabs.findIndex(t => !t.isPinned)
    if (unpinnedIdx === -1) break // 全部固定则不再关闭
    tabs.splice(unpinnedIdx, 1)
  }

  const nextIndex = tabs.length + 1
  const newTab: ResultTab = {
    id: crypto.randomUUID(),
    title: `结果 ${nextIndex}`, // 简化标题，去除冗余的 SQL 片段
    result,
    sql: sql.trim(),
    isPinned: false,
    createdAt: Date.now(),
  }
  tabs.push(newTab)

  store.updateTabContext(props.connectionId, props.tabId, {
    resultTabs: tabs,
    activeResultTabId: newTab.id,
  })
}

/** 切换结果标签页 */
function setActiveResultTab(tabId: string) {
  store.updateTabContext(props.connectionId, props.tabId, {
    activeResultTabId: tabId,
  })
}

/** 关闭结果标签页 */
function closeResultTab(tabId: string) {
  const tabs = resultTabs.value.filter(t => t.id !== tabId)
  const newActiveId = activeResultTabId.value === tabId
    ? (tabs.length > 0 ? tabs[tabs.length - 1]!.id : undefined)
    : activeResultTabId.value
  store.updateTabContext(props.connectionId, props.tabId, {
    resultTabs: tabs,
    activeResultTabId: newActiveId,
  })
}

/** 关闭其他结果标签页 */
function closeOtherResultTabs(tabId: string) {
  const tabs = resultTabs.value.filter(t => t.id === tabId || t.isPinned)
  store.updateTabContext(props.connectionId, props.tabId, {
    resultTabs: tabs,
    activeResultTabId: tabId,
  })
}

/** 关闭所有结果标签页 */
function closeAllResultTabs() {
  const tabs = resultTabs.value.filter(t => t.isPinned)
  store.updateTabContext(props.connectionId, props.tabId, {
    resultTabs: tabs,
    activeResultTabId: tabs.length > 0 ? tabs[0]!.id : undefined,
  })
}

/** 切换固定状态 */
function togglePinResultTab(tabId: string) {
  const tabs = resultTabs.value.map(t =>
    t.id === tabId ? { ...t, isPinned: !t.isPinned } : t
  )
  store.updateTabContext(props.connectionId, props.tabId, {
    resultTabs: tabs,
  })
}

// 右键菜单状态
const resultTabContextMenu = ref<{ x: number; y: number; tabId: string } | null>(null)

/** 显示结果标签页右键菜单 */
function showResultTabContextMenu(e: MouseEvent, tabId: string) {
  e.preventDefault()
  resultTabContextMenu.value = { x: e.clientX, y: e.clientY, tabId }
}

/** 关闭右键菜单 */
function closeResultTabContextMenu() {
  resultTabContextMenu.value = null
}

// 全局点击监听，关闭右键菜单
onMounted(() => {
  document.addEventListener('click', closeResultTabContextMenu)
  // 获取 Session 专用连接（企业级模式）
  if (props.isConnected) {
    dbApi.dbAcquireSession(props.connectionId, props.tabId).catch((e) => {
      console.warn('[Session] 获取 Session 连接失败，将降级到传统模式:', e)
    })
  }
})
onBeforeUnmount(() => {
  document.removeEventListener('click', closeResultTabContextMenu)
  // 释放 Session 连接
  dbApi.dbReleaseSession(props.connectionId, props.tabId).catch(() => {})
})

// 表浏览模式下是否还有更多数据
const hasMoreServerRows = computed(() => {
  const ctx = tabContext.value
  if (!ctx?.tableBrowse || !ctx.result) return false
  const total = ctx.result.totalCount
  if (total === null || total === undefined) return false
  return ctx.result.rows.length < total
})

// 用于追踪外部触发的待执行 SQL（如点击表名）
const pendingExecuteSql = ref<string | null>(null)

// 表浏览模式下的数据库和表名（用于编辑/删除）
const currentBrowseDb = computed(() => tabContext.value?.tableBrowse?.database)
const currentBrowseTable = computed(() => tabContext.value?.tableBrowse?.table)

/** 数据库选择下拉框切换处理 */
async function handleDatabaseSelect(database: string) {
  if (!database || !props.isConnected) return
  // 更新 store 中的当前数据库
  store.updateTabContext(props.connectionId, props.tabId, {
    currentDatabase: database,
  })
  // 在 Session 连接上切换数据库（后端执行 USE）
  try {
    await dbApi.dbSwitchDatabase(props.connectionId, props.tabId, database)
  } catch (e) {
    console.warn('[Session] 切换数据库失败:', e)
  }
  // 通知父组件
  emit('databaseChanged', database)
}

/** 当前选中的数据库 */
const currentDatabase = computed({
  get: () => tabContext.value?.currentDatabase ?? '',
  set: (val: string) => {
    if (val) handleDatabaseSelect(val)
  },
})

async function handleExecute(sql: string) {
  if (!sql.trim() || !props.isConnected || isExecuting.value) return

  // 如果用户执行的是 USE <database> 语句，直接在前端切换数据库上下文
  // 同时在 Session 连接上执行 USE，保持前后端状态一致
  const useMatch = sql.trim().match(/^USE\s+`?(\w+)`?\s*;?\s*$/i)
  if (useMatch) {
    const dbName = useMatch[1]!
    store.updateTabContext(props.connectionId, props.tabId, {
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
    // 在 Session 连接上同步切换
    dbApi.dbSwitchDatabase(props.connectionId, props.tabId, dbName).catch(() => {})
    emit('databaseChanged', dbName)
    notification.success(t('database.databaseSwitched', { name: dbName }) || `已切换到数据库 ${dbName}`)
    return
  }

  // 手动执行 SQL 时清除表浏览模式和当前活跃的结果标签页
  store.updateTabContext(props.connectionId, props.tabId, {
    isExecuting: true,
    result: null,
    tableBrowse: undefined,
    activeResultTabId: undefined,
  })
  console.log('[DEBUG] 开始执行 SQL，已清除旧 Tab 状态以确保流式渲染可见')

  const startTime = Date.now()

  // 检测是否为多语句
  if (isMultiStatement(sql)) {
    await handleMultiExecute(sql, startTime)
    return
  }

  // SELECT 类查询优先使用流式 API（失败自动降级到传统 API）
  const firstWord = sql.trim().split(/\s+/)[0]?.toUpperCase() ?? ''
  const isSelectLike = ['SELECT', 'SHOW', 'DESCRIBE', 'EXPLAIN'].includes(firstWord)

  if (isSelectLike) {
    await handleStreamExecute(sql, startTime)
  } else {
    await handleNonStreamExecute(sql, startTime)
  }
}

/** 流式执行 SELECT 查询（失败时自动降级到传统 API） */
async function handleStreamExecute(sql: string, startTime: number) {
  let allColumns: QueryResult['columns'] = []
  let allRows: unknown[][] = []
  let lastError: string | null = null
  let totalTimeMs = 0

  try {
    const timeoutSecs = queryTimeout.value > 0 ? queryTimeout.value : undefined

    // 使用 Promise 来协调流的真正结束（解决 invoke 提前 resolve 的竞态问题）
    let resolveStream: () => void
    let rejectStream: (reason: any) => void
    const streamFinishedPromise = new Promise<void>((res, rej) => {
      resolveStream = res
      rejectStream = rej
    })

    console.log('[DEBUG] 正在发起流式 API 调用...')
    // 流式回调：处理每个 chunk 的数据
    const onChunk = (chunk: QueryChunk) => {
        console.log(`[DEBUG] 收到批次: index=${chunk.chunkIndex}, rows=${chunk.rows.length}, isLast=${chunk.isLast}`)
        
        // 首批包含列定义
        if (chunk.columns && chunk.columns.length > 0) {
          allColumns = chunk.columns
          console.log('[DEBUG] 收到列定义:', allColumns.map(c => c.name).join(', '))
        }
        // 追加行数据
        if (chunk.rows && chunk.rows.length > 0) {
          allRows = [...allRows, ...chunk.rows]
        }
        // 错误处理
        if (chunk.error) {
          lastError = chunk.error
          console.error('[DEBUG] Chunk 包含错误:', lastError)
        }
        // 记录耗时
        if (chunk.totalTimeMs !== null && chunk.totalTimeMs !== undefined) {
          totalTimeMs = chunk.totalTimeMs
        }
        
        // 实时更新主结果区域
        store.updateTabContext(props.connectionId, props.tabId, {
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

        // 收到最后一条标识，结束 Promise
        if (chunk.isLast) {
          console.log('[DEBUG] 收到 isLast=true 终止信号')
          resolveStream()
        }
    }

    // 根据是否有当前数据库上下文，选择对应的流式 API（优先使用 Session 模式）
    const currentDb = tabContext.value?.currentDatabase
    const invokePromise = dbApi.dbExecuteQueryStreamOnSession(
      props.connectionId, props.tabId, sql, onChunk, currentDb, timeoutSecs
    ).catch(e => {
      console.warn('[DEBUG] Invoke 过程报错:', e)
      rejectStream!(e)
    })

    // 前端总体等待超时（5秒无任何响应则降级）
    const waitTimeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('流式查询响应超时')), 5000),
    )

    // 必须等到 invoke 完成 且 收到 isLast 信号（或发生错误/超时）
    await Promise.race([
      Promise.all([invokePromise, streamFinishedPromise]),
      waitTimeoutPromise
    ])
    
    console.log('[DEBUG] 流式执行完全结束，准备固化结果')

    // 流完成，执行结果固化
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

    store.updateTabContext(props.connectionId, props.tabId, {
      result: finalResult,
      isExecuting: false,
    })

    const executionTime = Date.now() - startTime
    if (!lastError) {
      addResultTab(sql, finalResult, executionTime)
      notification.success(
        t('database.querySuccess'),
        t('database.queryResultSummary', { rows: allRows.length, time: executionTime }),
        3000,
      )
      emit('executeSuccess', sql)
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
    // 优先使用 Session 模式执行（自动处理数据库上下文）
    const currentDb = tabContext.value?.currentDatabase
    const result = await dbApi.dbExecuteQueryOnSession(
      props.connectionId, props.tabId, sql, currentDb, timeoutSecs
    )
    store.updateTabContext(props.connectionId, props.tabId, {
      result,
      isExecuting: false,
    })

    const executionTime = Date.now() - startTime
    if (result.isError) {
      notification.error(t('database.queryFailed'), result.error ?? undefined, true)
    } else {
      addResultTab(sql, result, executionTime)
      const rowCount = result.totalCount ?? result.rows.length
      notification.success(
        t('database.querySuccess'),
        t('database.queryResultSummary', { rows: rowCount, time: executionTime }),
        3000,
      )
      emit('executeSuccess', sql)
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
    store.updateTabContext(props.connectionId, props.tabId, {
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
      props.connectionId,
      sql,
      currentDb,
      errorStrategy.value,
      timeoutSecs,
    )

    // 多语句执行只创建一个汇总结果 Tab，包含所有子语句结果
    const totalTime = Date.now() - startTime
    const successCount = results.filter(r => !r.result.isError).length
    const failCount = results.length - successCount

    // 构建子结果列表
    const subResults = results.map(stmt => ({
      index: stmt.index,
      sql: stmt.sql,
      statementType: stmt.statementType,
      result: stmt.result,
    }))

    // 找到最后一条有数据的结果作为主展示结果（优先展示 SELECT 结果）
    const selectResult = results.find(r => !r.result.isError && r.result.columns.length > 0)
    const lastResult = selectResult?.result ?? (results.length > 0 ? results[results.length - 1]!.result : null)

    // 构建汇总结果
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

    // 创建一个汇总结果 Tab
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

    store.updateTabContext(props.connectionId, props.tabId, {
      resultTabs: tabs,
      activeResultTabId: newTab.id,
      result: summaryResult,
      isExecuting: false,
    })

    // 显示执行摘要通知
    const summaryMsg = t('database.multiStatement.executionSummary', {
      total: results.length,
      success: successCount,
      fail: failCount,
      time: `${(totalTime / 1000).toFixed(1)}s`,
    })

    if (failCount > 0) {
      notification.warning('执行完成', summaryMsg, true)
    } else {
      notification.success('执行完成', summaryMsg, 3000)
    }

    emit('executeSuccess', sql)

    // 保存历史（用整体 SQL）
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
    store.updateTabContext(props.connectionId, props.tabId, {
      result: errorResult,
      isExecuting: false,
    })
    notification.error(t('database.queryFailed'), String(e), true)
    saveHistory(sql, errorResult)
  }
}

function saveHistory(sql: string, result: QueryResult) {
  historyApi.saveQueryHistory({
    id: crypto.randomUUID(),
    connectionId: props.connectionId,
    connectionName: props.connectionName ?? null,
    databaseName: tabContext.value?.currentDatabase ?? null,
    sqlText: sql.trim(),
    executionTimeMs: result.executionTimeMs,
    isError: result.isError,
    errorMessage: result.error ?? null,
    affectedRows: result.affectedRows,
    rowCount: result.totalCount ?? (result.isError ? null : result.rows.length),
    executedAt: Date.now(),
  }).catch(() => {
    // 静默处理，不影响主流程
  })
}

// 表浏览模式：使用 dbGetTableData 分页加载
async function browseTable(database: string, table: string, whereClause?: string, orderBy?: string) {
  if (!props.isConnected || isExecuting.value) return

  store.updateTabContext(props.connectionId, props.tabId, { isExecuting: true })
  try {
    const result = await dbApi.dbGetTableData(props.connectionId, database, table, 1, 200, whereClause, orderBy)
    store.updateTabContext(props.connectionId, props.tabId, {
      result,
      isExecuting: false,
      tableBrowse: { database, table, currentPage: 1, pageSize: 200, whereClause, orderBy },
      activeResultTabId: undefined, // 清除结果标签页选中，让 displayResult 直接展示表浏览数据
    })
  } catch (e) {
    store.updateTabContext(props.connectionId, props.tabId, {
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

// 加载更多行（表浏览模式下）
async function loadMoreRows() {
  const ctx = tabContext.value
  if (!ctx?.tableBrowse || !ctx.result || isLoadingMore.value) return

  const { database, table, currentPage, pageSize, whereClause, orderBy } = ctx.tableBrowse
  const nextPage = currentPage + 1
  isLoadingMore.value = true

  try {
    const moreResult = await dbApi.dbGetTableData(props.connectionId, database, table, nextPage, pageSize, whereClause, orderBy)
    if (moreResult.rows.length > 0) {
      const merged: typeof ctx.result = {
        ...ctx.result,
        rows: [...ctx.result.rows, ...moreResult.rows],
        totalCount: moreResult.totalCount,
      }
      store.updateTabContext(props.connectionId, props.tabId, {
        result: merged,
        tableBrowse: { ...ctx.tableBrowse, currentPage: nextPage },
      })
    }
  } catch (_e) {
    // 静默失败，用户可以再次滚动触发
  } finally {
    isLoadingMore.value = false
  }
}

// 暴露 execute 方法供父组件调用
function executeSql(sql: string) {
  pendingExecuteSql.value = sql
}

// 编辑/删除后刷新当前表数据
function handleRefresh() {
  const ctx = tabContext.value
  if (ctx?.tableBrowse) {
    browseTable(ctx.tableBrowse.database, ctx.tableBrowse.table, ctx.tableBrowse.whereClause, ctx.tableBrowse.orderBy)
  } else if (sqlContent.value.trim()) {
    handleExecute(sqlContent.value)
  }
}

// 服务端过滤
function handleServerFilter(whereClause: string) {
  const ctx = tabContext.value
  if (ctx?.tableBrowse) {
    browseTable(ctx.tableBrowse.database, ctx.tableBrowse.table, whereClause || undefined, ctx.tableBrowse.orderBy)
  }
}

// 服务端排序
function handleServerSort(orderBy: string) {
  const ctx = tabContext.value
  if (ctx?.tableBrowse) {
    browseTable(ctx.tableBrowse.database, ctx.tableBrowse.table, ctx.tableBrowse.whereClause, orderBy || undefined)
  }
}

defineExpose({ executeSql, browseTable })

// 监听 pendingExecuteSql 触发执行
watch(pendingExecuteSql, (sql) => {
  if (sql) {
    pendingExecuteSql.value = null
    handleExecute(sql)
  }
})

// 连接状态变化时自动管理 Session
watch(() => props.isConnected, (connected) => {
  if (connected) {
    dbApi.dbAcquireSession(props.connectionId, props.tabId).catch((e) => {
      console.warn('[Session] 连接恢复后获取 Session 失败:', e)
    })
  }
})

/** 执行全部语句（忽略选中，强制执行全部 SQL） */
function handleExecuteAll(sql: string) {
  if (!sql.trim() || !props.isConnected || isExecuting.value) return
  handleExecute(sql)
}

/** 保存当前 SQL 为代码片段 */
function handleSaveSqlSnippet() {
  snippetPanelOpen.value = true
}

/**
 * Data Grid 快捷键处理
 * - Ctrl+C: 复制选中单元格（浏览器默认行为已支持文本选中复制）
 * - Ctrl+F: 打开搜索栏
 * - Ctrl+G: 跳转到指定行
 */
function handleResultPanelKeydown(e: KeyboardEvent) {
  const isCtrl = e.ctrlKey || e.metaKey

  if (isCtrl && e.key === 'f') {
    // Ctrl+F: 打开搜索
    e.preventDefault()
    gridSearch.openSearch()
    // 如果有结果数据，执行搜索
    const result = displayResult.value
    if (result && result.columns.length > 0) {
      gridSearch.performSearch(result.rows, result.columns)
    }
  } else if (isCtrl && e.key === 'g') {
    // Ctrl+G: 跳转到指定行
    e.preventDefault()
    showGoToLineDialog.value = true
    goToLineInput.value = ''
  }
}

/** 跳转到指定行 */
function handleGoToLine() {
  const lineNum = parseInt(goToLineInput.value, 10)
  if (isNaN(lineNum) || lineNum < 1) return
  const result = displayResult.value
  if (!result) return
  // 将行号转换为搜索匹配项索引（行号从 1 开始）
  const targetRow = Math.min(lineNum - 1, result.rows.length - 1)
  if (targetRow >= 0) {
    // 通过搜索匹配机制定位到目标行
    gridSearch.matches.value = [{ rowIndex: targetRow, colIndex: 0 }]
    gridSearch.currentMatchIndex.value = 0
  }
  showGoToLineDialog.value = false
  goToLineInput.value = ''
}

async function executeCurrentSql() {
  const selected = (editorRef.value as any)?.getSelectedText()
  if (selected && selected.trim()) {
    handleExecute(selected)
  } else {
    handleExecute(sqlContent.value)
  }
}

async function handleCancel() {
  try {
    await dbApi.dbCancelQuery(props.connectionId)
  } catch (_e) {
    // 静默处理
  } finally {
    // 确保取消后重置执行状态，防止按钮永久禁用
    store.updateTabContext(props.connectionId, props.tabId, {
      isExecuting: false,
    })
  }
}
function handleFormat() {
  (editorRef.value as any)?.formatDocument()
}

const snippetPanelOpen = ref(false)
const explainResult = ref<Record<string, unknown> | null>(null)
const explainTableRows = ref<Record<string, unknown>[] | null>(null)
const showExplain = ref(false)
const isExplaining = ref(false)

async function handleExplain() {
  const selected = (editorRef.value as any)?.getSelectedText()
  const sql = (selected && selected.trim()) ? selected.trim() : sqlContent.value.trim()
  if (!sql || !props.isConnected) return

  // 去掉已有的 EXPLAIN 前缀，避免 EXPLAIN EXPLAIN
  const cleanSql = sql.replace(/^\s*EXPLAIN\s+(FORMAT\s*=\s*\w+\s+|ANALYZE\s+|\(.*?\)\s+)*/i, '')
  if (!cleanSql.trim()) return

  isExplaining.value = true
  showExplain.value = true
  explainResult.value = null
  explainTableRows.value = null

  try {
    // 并行获取 JSON 和 table 两种格式
    const [jsonResult, tableResult] = await Promise.all([
      dbApi.dbExplain(props.connectionId, cleanSql, 'json'),
      dbApi.dbExplain(props.connectionId, cleanSql, 'table'),
    ])

    // JSON 格式用于 tree/json 视图
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

    // table 格式用于表格视图
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
function handleSnippetInsert(sql: string) {
  sqlContent.value = sql
}

function handleSnippetExecute(sql: string) {
  sqlContent.value = sql
  handleExecute(sql)
}

// 事务状态
const isInTransaction = computed(() => tabContext.value?.isInTransaction ?? false)

// 查询超时配置（秒）
const queryTimeout = computed({
  get: () => tabContext.value?.queryTimeout ?? 30,
  set: (val: number) => {
    store.updateTabContext(props.connectionId, props.tabId, { queryTimeout: val })
  },
})

// ===== 多语句执行：错误策略 =====
const errorStrategy = ref<ErrorStrategy>('stopOnError')

/** 切换错误策略 */
function toggleErrorStrategy() {
  errorStrategy.value = errorStrategy.value === 'stopOnError' ? 'continueOnError' : 'stopOnError'
}

/**
 * 简单检测 SQL 文本是否包含多条语句
 * 检查非字符串、非注释内的分号数量
 */
function isMultiStatement(sql: string): boolean {
  let inSingleQuote = false
  let inDoubleQuote = false
  let inBacktick = false
  let inLineComment = false
  let inBlockComment = false
  let semicolonCount = 0

  const chars = sql.split('')
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!
    const next = chars[i + 1]

    if (inLineComment) {
      if (ch === '\n') inLineComment = false
      continue
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') { inBlockComment = false; i++ }
      continue
    }
    if (inSingleQuote) {
      if (ch === "'" && next === "'") { i++; continue }
      if (ch === "'") inSingleQuote = false
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

    if (ch === '-' && next === '-') { inLineComment = true; continue }
    if (ch === '#') { inLineComment = true; continue }
    if (ch === '/' && next === '*') { inBlockComment = true; i++; continue }
    if (ch === "'") { inSingleQuote = true; continue }
    if (ch === '"') { inDoubleQuote = true; continue }
    if (ch === '`') { inBacktick = true; continue }

    if (ch === ';') {
      semicolonCount++
      if (semicolonCount >= 2) return true
      // 检查分号后面是否还有非空白内容
      const rest = sql.slice(i + 1).trim()
      if (rest.length > 0 && !rest.startsWith('--') && !rest.startsWith('#')) {
        return true
      }
    }
  }
  return false
}

/** 开始事务 */
async function handleBeginTransaction() {
  if (!props.isConnected) return
  try {
    await dbApi.dbBeginTransaction(props.connectionId)
    store.updateTabContext(props.connectionId, props.tabId, {
      isInTransaction: true,
    })
  } catch (e) {
    notification.error('开始事务失败', String(e), true)
  }
}

/** 提交事务 */
async function handleCommit() {
  if (!props.isConnected) return
  try {
    await dbApi.dbCommit(props.connectionId)
    store.updateTabContext(props.connectionId, props.tabId, {
      isInTransaction: false,
    })
  } catch (e) {
    notification.error('提交事务失败', String(e), true)
  }
}

/** 回滚事务 */
async function handleRollback() {
  if (!props.isConnected) return
  try {
    await dbApi.dbRollback(props.connectionId)
    store.updateTabContext(props.connectionId, props.tabId, {
      isInTransaction: false,
    })
  } catch (e) {
    notification.error('回滚事务失败', String(e), true)
  }
}
</script>

<template>
  <div class="absolute inset-0 flex flex-col">
    <!-- Mini toolbar -->
    <div class="flex items-center gap-2 border-b border-border px-2 py-1">
      <TooltipProvider :delay-duration="300">
        <Tooltip>
          <TooltipTrigger as-child>
            <div>
              <Button
                variant="default"
                size="sm"
                class="h-6 gap-1 text-[11px]"
                :disabled="!isConnected || isExecuting"
                @click="executeCurrentSql"
              >
                <Loader2 v-if="isExecuting" class="h-3 w-3 animate-spin" />
                <Play v-else class="h-3 w-3" />
                {{ t('database.execute') }}
              </Button>
            </div>
          </TooltipTrigger>
          <TooltipContent v-if="executeDisabledReason" side="bottom" class="text-xs">
            {{ executeDisabledReason }}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <Button
        v-if="isExecuting"
        variant="destructive"
        size="sm"
        class="h-6 gap-1 text-[11px]"
        @click="handleCancel"
      >
        <Square class="h-3 w-3" />
        {{ t('common.cancel') }}
      </Button>
      <TooltipProvider :delay-duration="300">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="sm"
              class="h-6 gap-1 text-[11px]"
              @click="handleFormat"
            >
              <WrapText class="h-3 w-3" />
              {{ t('database.format') }}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" class="text-xs">
            Shift+Alt+F
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <Button
        variant="ghost"
        size="sm"
        class="h-6 gap-1 text-[11px]"
        :disabled="!isConnected || isExplaining"
        :class="{ 'bg-muted': showExplain }"
        @click="handleExplain"
      >
        <Loader2 v-if="isExplaining" class="h-3 w-3 animate-spin" />
        <ListTree v-else class="h-3 w-3" />
        EXPLAIN
      </Button>
      <!-- 数据库上下文选择器（企业级模式） -->
      <div class="w-px h-4 bg-border" />
      <div class="flex items-center gap-1">
        <Database class="h-3 w-3 text-muted-foreground" />
        <select
          v-model="currentDatabase"
          class="h-6 rounded border border-border bg-background px-1.5 text-[11px] min-w-[100px] max-w-[200px] cursor-pointer hover:border-primary/50 transition-colors"
          :title="t('database.selectDatabase')"
        >
          <option value="" disabled>{{ t('database.selectDatabase') }}</option>
          <option v-for="db in (databases ?? [])" :key="db" :value="db">{{ db }}</option>
        </select>
      </div>
      <!-- 错误策略切换按钮 -->
      <TooltipProvider :delay-duration="300">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="sm"
              class="h-6 w-6 p-0"
              @click="toggleErrorStrategy"
            >
              <ShieldAlert v-if="errorStrategy === 'stopOnError'" class="h-3 w-3 text-amber-500" />
              <ShieldCheck v-else class="h-3 w-3 text-green-500" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" class="text-xs">
            {{ t('database.multiStatement.errorStrategyTooltip', { strategy: errorStrategy === 'stopOnError' ? t('database.multiStatement.stopOnError') : t('database.multiStatement.continueOnError') }) }}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <!-- 事务管理按钮组 -->
      <div class="w-px h-4 bg-border" />
      <Button
        v-if="!isInTransaction"
        variant="ghost"
        size="sm"
        class="h-6 gap-1 text-[11px]"
        :disabled="!isConnected"
        @click="handleBeginTransaction"
      >
        <PlayCircle class="h-3 w-3" />
        开始事务
      </Button>
      <Button
        v-if="isInTransaction"
        variant="ghost"
        size="sm"
        class="h-6 gap-1 text-[11px] text-green-600 hover:text-green-700"
        @click="handleCommit"
      >
        <CheckCircle2 class="h-3 w-3" />
        提交
      </Button>
      <Button
        v-if="isInTransaction"
        variant="ghost"
        size="sm"
        class="h-6 gap-1 text-[11px] text-red-600 hover:text-red-700"
        @click="handleRollback"
      >
        <XCircle class="h-3 w-3" />
        回滚
      </Button>
      <div class="w-px h-4 bg-border" />
      <Button
        variant="ghost"
        size="sm"
        class="h-6 gap-1 text-[11px]"
        :class="{ 'bg-muted': snippetPanelOpen }"
        @click="snippetPanelOpen = !snippetPanelOpen"
      >
        <Bookmark class="h-3 w-3" />
        {{ t('sqlSnippet.title') }}
      </Button>
      <span class="text-[10px] text-muted-foreground">Ctrl+Enter</span>
      <!-- 查询超时配置 -->
      <div class="flex items-center gap-1 ml-auto">
        <Clock class="h-3 w-3 text-muted-foreground" />
        <input
          v-model.number="queryTimeout"
          type="number"
          min="0"
          max="3600"
          class="w-14 h-5 rounded border border-border bg-background px-1 text-[10px] text-center tabular-nums"
          placeholder="30"
          title="查询超时（秒），0 表示不限制"
        />
        <span class="text-[10px] text-muted-foreground">秒</span>
      </div>
      <!-- 事务进行中标识 -->
      <span
        v-if="isInTransaction"
        class="inline-flex items-center rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
      >
        事务进行中
      </span>
    </div>

    <!-- Editor + Result + Snippet Panel -->
    <div class="flex flex-1 min-h-0">
      <Splitpanes horizontal class="flex-1 min-w-0">
      <Pane :size="50" :min-size="20">
        <SqlEditor
          ref="editorRef"
          v-model="sqlContent"
          :connection-id="connectionId"
          :schema-cache="schemaCache"
          :is-loading-schema="isLoadingSchema"
          :driver="driver"
          @execute="handleExecute"
          @execute-selected="handleExecute"
          @execute-all="handleExecuteAll"
          @save="handleSaveSqlSnippet"
        />
      </Pane>
      <Pane :size="50" :min-size="20">
        <div ref="resultPanelRef" class="flex flex-col h-full" tabindex="0" @keydown="handleResultPanelKeydown">
          <!-- 搜索栏（Ctrl+F 触发） -->
          <div v-if="gridSearch.isSearchVisible.value" class="flex items-center gap-2 border-b border-border px-2 py-1 bg-muted/30">
            <input
              v-model="gridSearch.searchText.value"
              type="text"
              class="flex-1 h-6 rounded border border-border bg-background px-2 text-xs"
              placeholder="搜索..."
              autofocus
              @input="gridSearch.performSearch(displayResult?.rows ?? [], displayResult?.columns ?? [])"
              @keydown.enter.prevent="gridSearch.nextMatch()"
              @keydown.escape.prevent="gridSearch.closeSearch()"
            />
            <span class="text-[10px] text-muted-foreground tabular-nums">
              {{ gridSearch.matchCount.value > 0 ? `${gridSearch.currentMatchIndex.value + 1}/${gridSearch.matchCount.value}` : '无匹配' }}
            </span>
            <Button variant="ghost" size="sm" class="h-5 w-5 p-0" @click="gridSearch.prevMatch()">↑</Button>
            <Button variant="ghost" size="sm" class="h-5 w-5 p-0" @click="gridSearch.nextMatch()">↓</Button>
            <Button variant="ghost" size="sm" class="h-5 w-5 p-0" @click="gridSearch.closeSearch()">
              <XIcon class="h-3 w-3" />
            </Button>
          </div>

          <!-- 跳转到指定行对话框（Ctrl+G 触发） -->
          <div v-if="showGoToLineDialog" class="flex items-center gap-2 border-b border-border px-2 py-1 bg-muted/30">
            <span class="text-xs text-muted-foreground">跳转到行:</span>
            <input
              v-model="goToLineInput"
              type="number"
              min="1"
              class="w-24 h-6 rounded border border-border bg-background px-2 text-xs"
              placeholder="行号"
              autofocus
              @keydown.enter.prevent="handleGoToLine()"
              @keydown.escape.prevent="showGoToLineDialog = false"
            />
            <Button variant="ghost" size="sm" class="h-5 text-[10px]" @click="handleGoToLine()">确定</Button>
            <Button variant="ghost" size="sm" class="h-5 w-5 p-0" @click="showGoToLineDialog = false">
              <XIcon class="h-3 w-3" />
            </Button>
          </div>
          <!-- 结果标签栏 (移除模糊效果) -->
          <div v-if="resultTabs.length > 0" class="flex items-center border-b border-border bg-muted/20 overflow-x-auto no-scrollbar" @click.self="closeResultTabContextMenu">
            <TooltipProvider :delay-duration="300">
              <div class="flex">
                <Tooltip v-for="tab in resultTabs" :key="tab.id">
                  <TooltipTrigger as-child>
                    <button
                      class="group relative flex items-center gap-2 px-4 py-2 text-[11px] border-r border-border transition-all duration-200 shrink-0"
                      :class="tab.id === activeResultTabId ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'"
                      @click="setActiveResultTab(tab.id)"
                      @contextmenu="showResultTabContextMenu($event, tab.id)"
                    >
                      <!-- 活动状态蓝色底边指示器 -->
                      <div v-if="tab.id === activeResultTabId" class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary shadow-[0_0_8px_rgba(59,130,246,0.5)] animate-in fade-in slide-in-from-bottom-1 duration-300"></div>
                      
                      <div class="flex items-center gap-1.5 min-w-[60px]">
                        <Table2 class="h-3 w-3 shrink-0 opacity-70 group-hover:opacity-100 transition-opacity" :class="tab.id === activeResultTabId ? 'text-primary' : ''" />
                        <span class="truncate font-medium">{{ tab.title }}</span>
                        <Pin v-if="tab.isPinned" class="h-2.5 w-2.5 text-blue-500 animate-in zoom-in-50" />
                      </div>

                      <button
                        v-if="!tab.isPinned"
                        class="ml-1 opacity-0 group-hover:opacity-100 rounded-full hover:bg-muted/80 p-0.5 transition-all text-muted-foreground hover:text-foreground"
                        @click.stop="closeResultTab(tab.id)"
                      >
                        <XIcon class="h-2.5 w-2.5" />
                      </button>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" class="max-w-md p-3 bg-popover border border-border shadow-2xl animate-in fade-in zoom-in-95 duration-200">
                    <div class="space-y-2">
                      <div class="flex items-center justify-between border-b border-border/30 pb-1">
                        <p class="text-[10px] font-bold text-primary uppercase tracking-widest">执行 SQL</p>
                        <p class="text-[9px] text-muted-foreground/60 italic">{{ new Date(tab.createdAt).toLocaleTimeString() }}</p>
                      </div>
                      <div class="relative group/code">
                        <code class="text-[11px] block bg-muted/80 p-2.5 rounded border border-border/20 font-mono text-foreground break-all leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto thin-scrollbar select-all">
                          {{ tab.sql }}
                        </code>
                      </div>
                      <p class="text-[9px] text-muted-foreground/40 text-right">消耗时间: {{ tab.result.executionTimeMs }}ms</p>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </div>
            </TooltipProvider>
          </div>

          <!-- 右键菜单 -->
          <Teleport to="body">
            <div
              v-if="resultTabContextMenu"
              class="fixed z-50 min-w-[140px] rounded-md border border-border bg-popover p-1 shadow-md"
              :style="{ left: resultTabContextMenu.x + 'px', top: resultTabContextMenu.y + 'px' }"
              @click="closeResultTabContextMenu"
            >
              <button class="w-full rounded-sm px-2 py-1 text-left text-xs hover:bg-accent" @click="togglePinResultTab(resultTabContextMenu!.tabId)">
                {{ resultTabs.find(t => t.id === resultTabContextMenu!.tabId)?.isPinned ? '取消固定' : '固定' }}
              </button>
              <button class="w-full rounded-sm px-2 py-1 text-left text-xs hover:bg-accent" @click="closeResultTab(resultTabContextMenu!.tabId)">
                关闭
              </button>
              <button class="w-full rounded-sm px-2 py-1 text-left text-xs hover:bg-accent" @click="closeOtherResultTabs(resultTabContextMenu!.tabId)">
                关闭其他
              </button>
              <button class="w-full rounded-sm px-2 py-1 text-left text-xs hover:bg-accent" @click="closeAllResultTabs()">
                关闭所有
              </button>
            </div>
          </Teleport>

          <!-- 多语句子结果切换条 -->
          <div v-if="isMultiResultTab && !showExplain" class="flex items-center border-b border-border bg-muted/10 overflow-x-auto no-scrollbar shrink-0">
            <!-- 汇总按钮 -->
            <button
              class="flex items-center gap-1.5 px-3 py-1.5 text-[11px] border-r border-border shrink-0 transition-colors"
              :class="activeSubResultIndex === -1 ? 'bg-background text-foreground font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'"
              @click="setActiveSubResult(-1)"
            >
              <ListTree class="h-3 w-3" />
              汇总
              <span class="text-[9px] opacity-60">({{ subResults.length }})</span>
            </button>
            <!-- 各子语句按钮 -->
            <button
              v-for="(sub, idx) in subResults"
              :key="sub.index"
              class="flex items-center gap-1.5 px-3 py-1.5 text-[11px] border-r border-border shrink-0 transition-colors"
              :class="activeSubResultIndex === idx ? 'bg-background text-foreground font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'"
              :title="sub.sql"
              @click="setActiveSubResult(idx)"
            >
              <CheckCircle2 v-if="!sub.result.isError" class="h-3 w-3 text-green-500" />
              <XCircle v-else class="h-3 w-3 text-red-500" />
              <span class="max-w-[120px] truncate">{{ sub.statementType }}</span>
              <span class="text-[9px] opacity-50">{{ sub.result.executionTimeMs }}ms</span>
            </button>
          </div>

          <!-- 原有的结果面板 -->
          <ExplainPanel
            v-if="showExplain"
            :result="explainResult"
            :table-rows="explainTableRows"
            :loading="isExplaining"
            class="flex-1 min-h-0"
            @close="showExplain = false"
          />
          <QueryResultComponent
            v-else
            :result="displayResult"
            :loading="isExecuting"
            :loading-more="isLoadingMore"
            :has-more-server-rows="hasMoreServerRows"
            :show-reconnect="!isConnected"
            :connection-id="connectionId"
            :database="currentBrowseDb"
            :table-name="currentBrowseTable"
            :driver="driver"
            :is-table-browse="!!tabContext?.tableBrowse"
            class="flex-1 min-h-0"
            @reconnect="$emit('reconnect')"
            @load-more="loadMoreRows"
            @refresh="handleRefresh"
            @server-filter="handleServerFilter"
            @server-sort="handleServerSort"
          />
        </div>
      </Pane>
    </Splitpanes>
      <!-- Snippet Panel -->
      <SqlSnippetPanel
        v-if="snippetPanelOpen"
        @insert="handleSnippetInsert"
        @execute="handleSnippetExecute"
        @close="snippetPanelOpen = false"
      />
    </div>
  </div>
</template>
