<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RefreshCw } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import QueryResultComponent from '@/components/database/QueryResult.vue'
import { useDatabaseWorkspaceStore } from '@/stores/database-workspace'
import * as dbApi from '@/api/database'
import type { QueryResult } from '@/types/database'
import type { QueryTabContext } from '@/types/database-workspace'
import {
  extractNumericCursorValue,
  resolveInitialTableSeek,
  resolveTableSeekAfterFirstPage,
} from '@/composables/useTableSeek'

const props = defineProps<{
  connectionId: string
  tabId: string
  isConnected: boolean
  driver?: string
}>()

const { t } = useI18n()
const store = useDatabaseWorkspaceStore()

const tabContext = computed(() => {
  const ws = store.getWorkspace(props.connectionId)
  const tab = ws?.tabs.find((t) => t.id === props.tabId)
  return tab?.context as QueryTabContext | undefined
})

const browseContext = computed(() => tabContext.value?.tableBrowse)
const currentTableBrowse = computed(() => browseContext.value ?? null)

const result = ref<QueryResult | null>(null)
const loading = ref(false)
const loadingMore = ref(false)

const PAGE_SIZES = ['50', '100', '200', '500'] as const

const pageSize = computed(() => String(currentTableBrowse.value?.pageSize ?? 100))
const hasMoreServerRows = computed(() => {
  if (!result.value || result.value.totalCount === null) return false
  return result.value.rows.length < result.value.totalCount
})

function syncTableBrowse(extra: Partial<NonNullable<QueryTabContext['tableBrowse']>> = {}) {
  const ctx = currentTableBrowse.value
  if (!ctx) return

  store.updateTabContext(props.connectionId, props.tabId, {
    tableBrowse: {
      ...ctx,
      ...extra,
    },
  })
}

async function resolveSeekState(ctx: NonNullable<QueryTabContext['tableBrowse']>, requestedOrderBy?: string): Promise<{ effectiveOrderBy?: string; nextSeekColumn?: string }> {
  const initialSeek = await resolveInitialTableSeek(props.connectionId, ctx.database, ctx.table, requestedOrderBy)
  return {
    effectiveOrderBy: initialSeek.effectiveOrderBy,
    nextSeekColumn: initialSeek.seekColumn,
  }
}

async function loadData(overrides: Partial<NonNullable<QueryTabContext['tableBrowse']>> = {}) {
  const ctx = currentTableBrowse.value
  if (!ctx || !props.isConnected) return

  const nextBrowse = {
    ...ctx,
    ...overrides,
    currentPage: 1,
  }

  if (nextBrowse.orderBy?.trim()) {
    nextBrowse.seekOrderBy = undefined
    nextBrowse.seekColumn = undefined
    nextBrowse.seekValue = undefined
  }

  loading.value = true
  try {
    const { effectiveOrderBy, nextSeekColumn } = await resolveSeekState(nextBrowse, nextBrowse.orderBy)
    const firstPage = await dbApi.dbGetTableData(
      props.connectionId,
      nextBrowse.database,
      nextBrowse.table,
      1,
      nextBrowse.pageSize,
      nextBrowse.whereClause || null,
      effectiveOrderBy,
    )

    const resolvedSeek = resolveTableSeekAfterFirstPage(firstPage, nextSeekColumn)
    result.value = firstPage
    syncTableBrowse({
      ...nextBrowse,
      currentPage: 1,
      seekOrderBy: resolvedSeek.seekOrderBy,
      seekColumn: resolvedSeek.seekColumn,
      seekValue: resolvedSeek.seekValue,
    })
  } catch (e) {
    result.value = {
      columns: [],
      rows: [],
      affectedRows: 0,
      executionTimeMs: 0,
      isError: true,
      error: String(e),
      totalCount: null,
      truncated: false,
    }
  } finally {
    loading.value = false
  }
}

async function loadMoreRows() {
  const ctx = currentTableBrowse.value
  if (!ctx || !props.isConnected || !result.value || loadingMore.value) return

  const nextPage = ctx.currentPage + 1
  const userOrderBy = ctx.orderBy?.trim() ?? ''
  const effectiveOrderBy = userOrderBy || ctx.seekOrderBy || null
  loadingMore.value = true
  try {
    const more = await dbApi.dbGetTableData(
      props.connectionId,
      ctx.database,
      ctx.table,
      nextPage,
      ctx.pageSize,
      ctx.whereClause || null,
      effectiveOrderBy,
      ctx.seekColumn,
      typeof ctx.seekValue === 'number' ? ctx.seekValue : undefined,
    )
    if (more.rows.length > 0) {
      result.value = {
        ...result.value,
        rows: [...result.value.rows, ...more.rows],
        totalCount: more.totalCount,
      }
      syncTableBrowse({
        currentPage: nextPage,
        seekValue: extractNumericCursorValue(more.rows, more.columns, ctx.seekColumn) ?? ctx.seekValue,
      })
    }
  } catch (_e) {
    // Silent failure keeps the existing page usable when incremental loading fails.
  } finally {
    loadingMore.value = false
  }
}

function handlePageSizeChange(val: string) {
  loadData({ pageSize: Number(val) })
}

function handleServerFilter(clause: string) {
  loadData({ whereClause: clause, currentPage: 1 })
}

function handleServerSort(ob: string) {
  loadData({ orderBy: ob, currentPage: 1 })
}

watch(() => props.isConnected, (connected) => {
  if (connected && !result.value) loadData()
}, { immediate: true })

defineExpose({ refresh: loadData })
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex items-center gap-2 border-b border-border px-3 py-1.5 shrink-0">
      <span class="text-xs font-medium">{{ browseContext?.table }}</span>
      <span class="text-[10px] text-muted-foreground">{{ browseContext?.database }}</span>
      <div class="flex-1" />
      <div class="flex items-center gap-1.5">
        <span class="text-[10px] text-muted-foreground">{{ t('database.rowsPerPage') }}</span>
        <Select :model-value="pageSize" @update:model-value="handlePageSizeChange($event as string)">
          <SelectTrigger class="h-6 w-16 text-[10px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="s in PAGE_SIZES" :key="s" :value="s" class="text-xs">{{ s }}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button variant="ghost" size="sm" class="h-7 w-7 p-0" :disabled="loading" @click="loadData()">
        <RefreshCw class="size-3.5" :class="{ 'animate-spin': loading }" />
      </Button>
    </div>

    <div class="flex-1 min-h-0">
      <QueryResultComponent
        :result="result"
        :loading="loading"
        :loading-more="loadingMore"
        :has-more-server-rows="hasMoreServerRows"
        :is-table-browse="true"
        :connection-id="connectionId"
        :database="browseContext?.database"
        :table-name="browseContext?.table"
        :driver="driver"
        :table-browse="browseContext"
        @load-more="loadMoreRows"
        @server-filter="handleServerFilter"
        @server-sort="handleServerSort"
        @sync-table-browse="syncTableBrowse"
      />
    </div>
  </div>
</template>
