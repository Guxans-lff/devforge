<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Splitpanes, Pane } from 'splitpanes'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Play, Loader2, Square, WrapText, Bookmark, ListTree } from 'lucide-vue-next'
import SqlEditor from '@/components/database/SqlEditorLazy.vue'
import QueryResultComponent from '@/components/database/QueryResult.vue'
import SqlSnippetPanel from '@/components/database/SqlSnippetPanel.vue'
import ExplainPanel from '@/components/database/ExplainPanel.vue'
import { useDatabaseWorkspaceStore } from '@/stores/database-workspace'
import { useNotification } from '@/composables/useNotification'
import * as dbApi from '@/api/database'
import * as historyApi from '@/api/query-history'
import type { QueryResult, SchemaCache } from '@/types/database'
import type { QueryTabContext } from '@/types/database-workspace'

const props = defineProps<{
  connectionId: string
  connectionName?: string
  tabId: string
  isConnected: boolean
  schemaCache: SchemaCache | null
  driver: string
}>()

const emit = defineEmits<{
  reconnect: []
}>()

const { t } = useI18n()
const store = useDatabaseWorkspaceStore()
const notification = useNotification()
const editorRef = ref<InstanceType<typeof SqlEditor>>()

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

async function handleExecute(sql: string) {
  if (!sql.trim() || !props.isConnected || isExecuting.value) return

  // 手动执行 SQL 时清除表浏览模式
  store.updateTabContext(props.connectionId, props.tabId, {
    isExecuting: true,
    tableBrowse: undefined,
  })

  const startTime = Date.now()

  try {
    const result = await dbApi.dbExecuteQuery(props.connectionId, sql)
    store.updateTabContext(props.connectionId, props.tabId, {
      result,
      isExecuting: false,
    })

    // 显示成功通知
    const executionTime = Date.now() - startTime
    if (result.isError) {
      notification.error(
        t('database.queryFailed'),
        result.error ?? undefined,
        true
      )
    } else {
      const rowCount = result.totalCount ?? result.rows.length
      notification.success(
        t('database.querySuccess'),
        t('database.queryResultSummary', {
          rows: rowCount,
          time: executionTime
        }),
        3000
      )
    }

    // 保存查询历史（异步，不阻塞）
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

    // 显示错误通知
    notification.error(
      t('database.queryFailed'),
      String(e),
      true
    )

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
  }
}
function handleFormat() {
  (editorRef.value as any)?.formatDocument()
}

const snippetPanelOpen = ref(false)
const explainResult = ref<Record<string, unknown> | null>(null)
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
  try {
    const explainSql = props.driver === 'postgresql'
      ? `EXPLAIN (FORMAT JSON, ANALYZE) ${cleanSql}`
      : `EXPLAIN FORMAT=JSON ${cleanSql}`
    const result = await dbApi.dbExecuteQuery(props.connectionId, explainSql)
    if (result.isError) {
      explainResult.value = { error: result.error }
    } else if (result.rows.length > 0) {
      const raw = String(result.rows[0]![0] ?? '{}')
      try {
        explainResult.value = JSON.parse(raw)
      } catch {
        explainResult.value = { raw }
      }
    } else {
      explainResult.value = { error: 'EXPLAIN returned no rows' }
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
          :driver="driver"
          @execute="handleExecute"
          @execute-selected="handleExecute"
        />
      </Pane>
      <Pane :size="50" :min-size="20">
        <ExplainPanel
          v-if="showExplain"
          :result="explainResult"
          :loading="isExplaining"
          @close="showExplain = false"
        />
        <QueryResultComponent
          v-else
          :result="queryResult"
          :loading="isExecuting"
          :loading-more="isLoadingMore"
          :has-more-server-rows="hasMoreServerRows"
          :show-reconnect="!isConnected"
          :connection-id="connectionId"
          :database="currentBrowseDb"
          :table-name="currentBrowseTable"
          :driver="driver"
          :is-table-browse="!!tabContext?.tableBrowse"
          @reconnect="$emit('reconnect')"
          @load-more="loadMoreRows"
          @refresh="handleRefresh"
          @server-filter="handleServerFilter"
          @server-sort="handleServerSort"
        />
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
