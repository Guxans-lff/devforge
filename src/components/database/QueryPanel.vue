<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, toRef } from 'vue'
import { Splitpanes, Pane } from 'splitpanes'
import SqlEditor from '@/components/database/SqlEditorLazy.vue'
import SqlSnippetPanel from '@/components/database/SqlSnippetPanel.vue'
import SqlToolbar from '@/components/database/SqlToolbar.vue'
import QueryResultSection from '@/components/database/QueryResultSection.vue'
import DangerConfirmDialog from '@/components/database/DangerConfirmDialog.vue'
import ParamInputDialog from '@/components/database/ParamInputDialog.vue'
import { useDatabaseWorkspaceStore } from '@/stores/database-workspace'
import { useAiChatStore } from '@/stores/ai-chat'
import { useQueryExecution } from '@/composables/useQueryExecution'
import { useResultTabs } from '@/composables/useResultTabs'
import { useI18n } from 'vue-i18n'
import * as dbApi from '@/api/database'
import type { SchemaCache } from '@/types/database'
import type { QueryTabContext } from '@/types/database-workspace'
import type { EnvironmentType } from '@/types/environment'
import type { SqlEditorExposed } from '@/types/component-exposed'
import { createLogger } from '@/utils/logger'

const log = createLogger('query.panel')

const props = defineProps<{
  connectionId: string
  connectionName?: string
  tabId: string
  isConnected: boolean
  ensureConnected?: () => Promise<boolean>
  schemaCache: SchemaCache | null
  isLoadingSchema?: boolean
  driver: string
  databases?: string[]
  selectedDatabases?: string[]
  environment?: EnvironmentType
  readOnly?: boolean
  confirmDanger?: boolean
}>()

const emit = defineEmits<{
  reconnect: []
  executeSuccess: [sql: string]
  databaseChanged: [database: string]
  openAiConfig: []
}>()

const store = useDatabaseWorkspaceStore()
const aiStore = useAiChatStore()
const { t } = useI18n()
const editorRef = ref<InstanceType<typeof SqlEditor>>()

/** 获取编辑器的类型安全引用 */
function getEditor(): SqlEditorExposed | undefined {
  return editorRef.value as unknown as SqlEditorExposed | undefined
}

// ===== Tab Context =====
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

const currentDatabase = computed({
  get: () => tabContext.value?.currentDatabase ?? '',
  set: (val: string) => {
    if (val) execution.handleDatabaseSelect(val, emit)
  },
})

const batchDatabases = computed(() => props.selectedDatabases ?? [])
const currentAiProvider = computed(() => {
  const providerId = tabContext.value?.aiProviderId
  return aiStore.providers.find(provider => provider.id === providerId) ?? null
})
const currentAiModel = computed(() => {
  const modelId = tabContext.value?.aiModelId
  if (!currentAiProvider.value || !modelId) return null
  return currentAiProvider.value.models.find(model => model.id === modelId) ?? null
})
const aiConfigured = computed(() => Boolean(
  tabContext.value?.aiProviderId
  && tabContext.value?.aiModelId
  && tabContext.value?.aiHasApiKey,
))

// ===== 结果标签页管理 =====
const resultTabsManager = useResultTabs({
  connectionId: toRef(props, 'connectionId'),
  tabId: toRef(props, 'tabId'),
  tabContext,
})

// ===== 查询执行 =====
const execution = useQueryExecution({
  connectionId: toRef(props, 'connectionId'),
  connectionName: toRef(props, 'connectionName'),
  tabId: toRef(props, 'tabId'),
  isConnected: toRef(props, 'isConnected'),
  ensureConnected: props.ensureConnected,
  environment: toRef(props, 'environment'),
  readOnly: computed(() => props.readOnly ?? false),
  confirmDanger: computed(() => props.confirmDanger ?? false),
  addResultTab: resultTabsManager.addResultTab,
  tabContext,
})

// ===== 表浏览模式 =====
const hasMoreServerRows = computed(() => {
  const ctx = tabContext.value
  if (!ctx?.tableBrowse || !ctx.result) return false
  const total = ctx.result.totalCount
  if (total === null || total === undefined) return false
  return ctx.result.rows.length < total
})

const currentBrowseDb = computed(() => tabContext.value?.tableBrowse?.database)
function hasPendingBrowse(ctx?: QueryTabContext): ctx is QueryTabContext & { tableBrowse: NonNullable<QueryTabContext['tableBrowse']> } {
  if (!ctx?.tableBrowse || ctx.result || ctx.isExecuting) return false
  if (ctx.currentDatabase && ctx.currentDatabase !== ctx.tableBrowse.database) return false

  const browseSql = `SELECT * FROM \`${ctx.tableBrowse.database}\`.\`${ctx.tableBrowse.table}\`;`
  return ctx.sql.trim() === browseSql
}

const currentBrowseTable = computed(() => tabContext.value?.tableBrowse?.table)
const pendingBrowseRecoveryKey = computed(() => {
  const ctx = tabContext.value
  if (!hasPendingBrowse(ctx)) return null
  return [
    props.isConnected ? '1' : '0',
    ctx.tableBrowse.database,
    ctx.tableBrowse.table,
    ctx.tableBrowse.whereClause ?? '',
    ctx.tableBrowse.orderBy ?? '',
    ctx.sql.trim(),
  ].join('::')
})

// ===== Snippet 面板 =====
const snippetPanelOpen = ref(false)

const sessionAcquireKey = computed(() => {
  if (!props.isConnected) return null
  return `${props.connectionId}::${props.tabId}`
})

const sessionReleaseKey = computed(() => {
  if (props.isConnected) return null
  return `${props.connectionId}::${props.tabId}`
})

// ===== SQL 执行入口 =====

/** 判断 SQL 是否不需要先选择数据库 */
function isDatabaseIndependentSql(sql: string): boolean {
  const trimmed = sql.trim().replace(/^--.*$/gm, '').trim()
  const first = trimmed.split(/\s+/).slice(0, 3).join(' ').toUpperCase()
  return /^(USE\s|SHOW\s+(DATABASES|SCHEMAS)|CREATE\s+DATABASE|DROP\s+DATABASE)/.test(first)
}

function executeCurrentSql() {
  const selected = getEditor()?.getSelectedText()
  if (selected && selected.trim()) {
    handleExecuteWithEmit(selected)
  } else {
    handleExecuteWithEmit(sqlContent.value)
  }
}

async function handleExecuteWithEmit(sql: string) {
  execution.clearSqlErrorAnalysis()
  const selectedBatchDatabases = batchDatabases.value
  if (selectedBatchDatabases.length > 1) {
    const result = await execution.handleBatchExecute(sql, selectedBatchDatabases)
    if (result.success) emit('executeSuccess', sql)
    return
  }

  // 数据库未选择校验（SQLite 无需选库；USE/SHOW DATABASES 等语句不依赖数据库上下文）
  if (props.driver !== 'sqlite' && !currentDatabase.value && !isDatabaseIndependentSql(sql)) {
    store.updateTabContext(props.connectionId, props.tabId, {
      result: {
        columns: [],
        rows: [],
        affectedRows: 0,
        executionTimeMs: 0,
        isError: true,
        error: t('database.noDatabaseSelected'),
        totalCount: null,
        truncated: false,
      },
      isExecuting: false,
    })
    return
  }

  const result = await execution.handleExecute(sql)
  if (result.success) {
    emit('executeSuccess', sql)
    const useMatch = sql.trim().match(/^USE\s+`?(\w+)`?\s*;?\s*$/i)
    if (useMatch) {
      emit('databaseChanged', useMatch[1]!)
    }
  }
  // USE 语句切换数据库通知
}

function handleExecuteAll(sql: string) {
  if (!sql.trim() || execution.isExecuting.value) return
  handleExecuteWithEmit(sql)
}

function handleFormat() {
  getEditor()?.formatDocument()
}

function handleExplain() {
  execution.handleExplain(() => {
    const selected = getEditor()?.getSelectedText()
    return (selected && selected.trim()) ? selected.trim() : sqlContent.value.trim()
  })
}

async function handleAnalyzeSqlError() {
  if (!aiConfigured.value) {
    emit('openAiConfig')
    return
  }
  await execution.analyzeSqlError()
}

function handleRefresh() {
  execution.handleRefresh(sqlContent.value)
}

function handleSnippetInsert(sql: string) {
  sqlContent.value = sql
  execution.clearSqlErrorAnalysis()
}

function handleSnippetExecute(sql: string) {
  sqlContent.value = sql
  execution.clearSqlErrorAnalysis()
  handleExecuteWithEmit(sql)
}

// ===== Expose（保持对外接口不变） =====
function executeSql(sql: string) {
  execution.pendingExecuteSql.value = sql
}

defineExpose({ executeSql, browseTable: execution.browseTable })

// ===== 监听 pendingExecuteSql =====
watch(execution.pendingExecuteSql, (sql) => {
  if (sql) {
    execution.pendingExecuteSql.value = null
    handleExecuteWithEmit(sql)
  }
})

// ===== Session 生命周期管理 =====
onMounted(() => {
  document.addEventListener('click', resultTabsManager.closeContextMenu)
})

watch(sessionAcquireKey, (key, prevKey) => {
  if (!key || key === prevKey) return
  dbApi.dbAcquireSession(props.connectionId, props.tabId).catch((e) => {
    log.warn('session_acquire_failed_fallback', undefined, e)
  })
}, { immediate: true })

watch(sessionReleaseKey, (key, prevKey) => {
  if (!key || key === prevKey) return
  dbApi.dbReleaseSession(props.connectionId, props.tabId).catch((e: unknown) => {
    log.warn('release_session_failed', undefined, e)
  })
}, { immediate: true })

watch(pendingBrowseRecoveryKey, (key, prevKey) => {
  if (!props.isConnected || !key || key === prevKey) return
  const ctx = tabContext.value
  if (!ctx?.tableBrowse) return

  execution.browseTable(ctx.tableBrowse.database, ctx.tableBrowse.table, ctx.tableBrowse.whereClause, ctx.tableBrowse.orderBy)
}, { immediate: true })

onBeforeUnmount(() => {
  document.removeEventListener('click', resultTabsManager.closeContextMenu)
  execution.clearLongRunningNotify()
})
</script>

<template>
  <div class="absolute inset-0 flex flex-col">
    <!-- 工具栏 -->
    <SqlToolbar
      :is-connected="isConnected"
      :is-executing="execution.isExecuting.value"
      :is-explaining="execution.isExplaining.value"
      :is-in-transaction="execution.isInTransaction.value"
      :show-explain="execution.showExplain.value"
      :snippet-panel-open="snippetPanelOpen"
      :error-strategy="execution.errorStrategy.value"
      :query-timeout="execution.queryTimeout.value"
      :databases="databases ?? []"
      :selected-databases="batchDatabases"
      :current-database="currentDatabase"
      :ai-configured="aiConfigured"
      :ai-provider-name="currentAiProvider?.name"
      :ai-model-name="currentAiModel?.name"
      :timer-running="execution.executionTimer.isRunning.value"
      :timer-elapsed="execution.executionTimer.elapsed.value"
      @execute="executeCurrentSql"
      @cancel="execution.handleCancel"
      @format="handleFormat"
      @explain="handleExplain"
      @toggle-snippet="snippetPanelOpen = !snippetPanelOpen"
      @toggle-error-strategy="execution.toggleErrorStrategy"
      @begin-transaction="execution.handleBeginTransaction"
      @commit="execution.handleCommit"
      @rollback="execution.handleRollback"
      @open-ai-config="emit('openAiConfig')"
      @update:query-timeout="execution.queryTimeout.value = $event"
      @update:current-database="currentDatabase = $event"
    />

    <!-- 编辑器 + 结果面板 + Snippet 面板 -->
    <div class="flex flex-1 min-h-0">
      <Splitpanes horizontal class="flex-1 min-w-0">
        <Pane :size="50" :min-size="20">
          <SqlEditor
            ref="editorRef"
            v-model="sqlContent"
            :connection-id="connectionId"
            :schema="schemaCache"
            :is-loading-schema="isLoadingSchema"
            :driver="driver"
            @execute="handleExecuteWithEmit"
            @execute-selected="handleExecuteWithEmit"
            @execute-all="handleExecuteAll"
            @save="snippetPanelOpen = true"
          />
        </Pane>
        <Pane :size="50" :min-size="20">
          <QueryResultSection
            :display-result="resultTabsManager.displayResult.value"
            :result-tabs="resultTabsManager.resultTabs.value"
            :active-result-tab-id="resultTabsManager.activeResultTabId.value"
            :is-executing="execution.isExecuting.value"
            :is-loading-more="execution.isLoadingMore.value"
            :has-more-server-rows="hasMoreServerRows"
            :is-connected="isConnected"
            :connection-id="connectionId"
            :current-browse-db="currentBrowseDb"
            :current-browse-table="currentBrowseTable"
            :current-database="currentDatabase"
            :driver="driver"
            :is-table-browse="!!tabContext?.tableBrowse"
            :table-browse="tabContext?.tableBrowse"
            :sub-results="resultTabsManager.subResults.value"
            :is-multi-result-tab="resultTabsManager.isMultiResultTab.value"
            :active-sub-result-index="resultTabsManager.activeSubResultIndex.value"
            :show-explain="execution.showExplain.value"
            :explain-result="execution.explainResult.value"
            :explain-table-rows="execution.explainTableRows.value"
            :is-explaining="execution.isExplaining.value"
            :sql-error-analysis="tabContext?.sqlErrorAnalysis"
            :ai-configured="aiConfigured"
            :ai-provider-name="currentAiProvider?.name"
            :ai-model-name="currentAiModel?.name"
            :context-menu="resultTabsManager.contextMenu.value"
            @open-ai-config="emit('openAiConfig')"
            @reconnect="emit('reconnect')"
            @load-more="execution.loadMoreRows"
            @refresh="handleRefresh"
            @server-filter="execution.handleServerFilter"
            @server-sort="execution.handleServerSort"
            @analyze-sql-error="handleAnalyzeSqlError"
            @apply-fixed-sql="execution.applyFixedSql($event)"
            @set-active-result-tab="resultTabsManager.setActiveResultTab"
            @close-result-tab="resultTabsManager.closeResultTab"
            @close-other-result-tabs="resultTabsManager.closeOtherResultTabs"
            @close-all-result-tabs="resultTabsManager.closeAllResultTabs"
            @toggle-pin-result-tab="resultTabsManager.togglePinResultTab"
            @show-context-menu="resultTabsManager.showContextMenu"
            @close-context-menu="resultTabsManager.closeContextMenu"
            @set-active-sub-result="resultTabsManager.setActiveSubResult"
            @close-explain="execution.showExplain.value = false"
          />
        </Pane>
      </Splitpanes>

      <!-- Snippet 面板 -->
      <SqlSnippetPanel
        v-if="snippetPanelOpen"
        @insert="handleSnippetInsert"
        @execute="handleSnippetExecute"
        @close="snippetPanelOpen = false"
      />
    </div>
  </div>

  <!-- 危险操作确认弹窗 -->
  <DangerConfirmDialog
    :open="execution.dangerConfirmOpen.value"
    :statements="execution.dangerStatements.value"
    :need-input="execution.dangerNeedInput.value"
    :input-target="execution.dangerInputTarget.value"
    :confirm-input="execution.dangerConfirmInput.value"
    :can-confirm="execution.dangerCanConfirm.value"
    @update:open="execution.dangerConfirmOpen.value = $event"
    @update:confirm-input="execution.dangerConfirmInput.value = $event"
    @confirm="execution.handleDangerConfirm"
  />

  <!-- 参数化查询输入弹窗 -->
  <ParamInputDialog
    :open="execution.paramDialogOpen.value"
    :param-names="execution.paramNames.value"
    :param-values="execution.paramValues.value"
    @update:open="execution.paramDialogOpen.value = $event"
    @execute="execution.executeWithParams"
  />
</template>
