<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, toRef } from 'vue'
import { Splitpanes, Pane } from 'splitpanes'
import SqlEditor from '@/components/database/SqlEditorLazy.vue'
import SqlSnippetPanel from '@/components/database/SqlSnippetPanel.vue'
import SqlToolbar from '@/components/database/SqlToolbar.vue'
import QueryResultSection from '@/components/database/QueryResultSection.vue'
import DangerConfirmDialog from '@/components/database/DangerConfirmDialog.vue'
import { useDatabaseWorkspaceStore } from '@/stores/database-workspace'
import { useQueryExecution } from '@/composables/useQueryExecution'
import { useResultTabs } from '@/composables/useResultTabs'
import * as dbApi from '@/api/database'
import type { SchemaCache } from '@/types/database'
import type { QueryTabContext } from '@/types/database-workspace'
import type { EnvironmentType } from '@/types/environment'

const props = defineProps<{
  connectionId: string
  connectionName?: string
  tabId: string
  isConnected: boolean
  schemaCache: SchemaCache | null
  isLoadingSchema?: boolean
  driver: string
  databases?: string[]
  environment?: EnvironmentType
  readOnly?: boolean
  confirmDanger?: boolean
}>()

const emit = defineEmits<{
  reconnect: []
  executeSuccess: [sql: string]
  databaseChanged: [database: string]
}>()

const store = useDatabaseWorkspaceStore()
const editorRef = ref<InstanceType<typeof SqlEditor>>()

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
const currentBrowseTable = computed(() => tabContext.value?.tableBrowse?.table)

// ===== Snippet 面板 =====
const snippetPanelOpen = ref(false)

// ===== SQL 执行入口 =====
function executeCurrentSql() {
  const selected = (editorRef.value as any)?.getSelectedText()
  if (selected && selected.trim()) {
    handleExecuteWithEmit(selected)
  } else {
    handleExecuteWithEmit(sqlContent.value)
  }
}

async function handleExecuteWithEmit(sql: string) {
  const result = await execution.handleExecute(sql)
  if (result.success) {
    emit('executeSuccess', sql)
  }
  // USE 语句切换数据库通知
  const useMatch = sql.trim().match(/^USE\s+`?(\w+)`?\s*;?\s*$/i)
  if (useMatch) {
    emit('databaseChanged', useMatch[1]!)
  }
}

function handleExecuteAll(sql: string) {
  if (!sql.trim() || !props.isConnected || execution.isExecuting.value) return
  handleExecuteWithEmit(sql)
}

function handleFormat() {
  (editorRef.value as any)?.formatDocument()
}

function handleExplain() {
  execution.handleExplain(() => {
    const selected = (editorRef.value as any)?.getSelectedText()
    return (selected && selected.trim()) ? selected.trim() : sqlContent.value.trim()
  })
}

function handleRefresh() {
  execution.handleRefresh(sqlContent.value)
}

function handleSnippetInsert(sql: string) {
  sqlContent.value = sql
}

function handleSnippetExecute(sql: string) {
  sqlContent.value = sql
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
  if (props.isConnected) {
    dbApi.dbAcquireSession(props.connectionId, props.tabId).catch((e) => {
      console.warn('[Session] 获取 Session 连接失败，将降级到传统模式:', e)
    })
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('click', resultTabsManager.closeContextMenu)
  dbApi.dbReleaseSession(props.connectionId, props.tabId).catch(() => {})
  execution.clearLongRunningNotify()
})

watch(() => props.isConnected, (connected) => {
  if (connected) {
    dbApi.dbAcquireSession(props.connectionId, props.tabId).catch((e) => {
      console.warn('[Session] 连接恢复后获取 Session 失败:', e)
    })
  }
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
      :current-database="currentDatabase"
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
            :sub-results="resultTabsManager.subResults.value"
            :is-multi-result-tab="resultTabsManager.isMultiResultTab.value"
            :active-sub-result-index="resultTabsManager.activeSubResultIndex.value"
            :show-explain="execution.showExplain.value"
            :explain-result="execution.explainResult.value"
            :explain-table-rows="execution.explainTableRows.value"
            :is-explaining="execution.isExplaining.value"
            :context-menu="resultTabsManager.contextMenu.value"
            @reconnect="emit('reconnect')"
            @load-more="execution.loadMoreRows"
            @refresh="handleRefresh"
            @server-filter="execution.handleServerFilter"
            @server-sort="execution.handleServerSort"
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
</template>
