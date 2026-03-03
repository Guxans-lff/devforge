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
import type { TableDataTabContext } from '@/types/database-workspace'

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
  return tab?.context as TableDataTabContext | undefined
})

const result = ref<QueryResult | null>(null)
const loading = ref(false)
const loadingMore = ref(false)

const PAGE_SIZES = ['50', '100', '200', '500'] as const
const pageSize = ref(String(tabContext.value?.pageSize ?? 100))
const currentPage = ref(tabContext.value?.page ?? 1)
const whereClause = ref('')
const orderBy = ref('')

const hasMoreServerRows = computed(() => {
  if (!result.value || result.value.totalCount === null) return false
  return result.value.rows.length < result.value.totalCount
})

async function loadData() {
  const ctx = tabContext.value
  if (!ctx || !props.isConnected) return

  loading.value = true
  currentPage.value = 1
  try {
    result.value = await dbApi.dbGetTableData(
      props.connectionId, ctx.database, ctx.table, 1, Number(pageSize.value),
      whereClause.value || null, orderBy.value || null
    )
    store.updateTabContext(props.connectionId, props.tabId, {
      page: 1,
      pageSize: Number(pageSize.value),
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
  const ctx = tabContext.value
  if (!ctx || !props.isConnected || !result.value || loadingMore.value) return

  const nextPage = currentPage.value + 1
  loadingMore.value = true
  try {
    const more = await dbApi.dbGetTableData(
      props.connectionId, ctx.database, ctx.table, nextPage, Number(pageSize.value),
      whereClause.value || null, orderBy.value || null
    )
    if (more.rows.length > 0) {
      result.value = {
        ...result.value,
        rows: [...result.value.rows, ...more.rows],
        totalCount: more.totalCount,
      }
      currentPage.value = nextPage
    }
  } catch (_e) {
    // 静默失败
  } finally {
    loadingMore.value = false
  }
}

function handlePageSizeChange(val: string) {
  pageSize.value = val
  loadData()
}

function handleServerFilter(clause: string) {
  whereClause.value = clause
  loadData()
}

function handleServerSort(ob: string) {
  orderBy.value = ob
  loadData()
}

// 初始加载
watch(() => props.isConnected, (connected) => {
  if (connected && !result.value) loadData()
}, { immediate: true })

defineExpose({ refresh: loadData })
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 顶部工具栏 -->
    <div class="flex items-center gap-2 border-b border-border px-3 py-1.5 shrink-0">
      <span class="text-xs font-medium">{{ tabContext?.table }}</span>
      <span class="text-[10px] text-muted-foreground">{{ tabContext?.database }}</span>
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
      <Button variant="ghost" size="sm" class="h-7 w-7 p-0" :disabled="loading" @click="loadData">
        <RefreshCw class="size-3.5" :class="{ 'animate-spin': loading }" />
      </Button>
    </div>

    <!-- 数据表格 -->
    <div class="flex-1 min-h-0">
      <QueryResultComponent
        :result="result"
        :loading="loading"
        :loading-more="loadingMore"
        :has-more-server-rows="hasMoreServerRows"
        :is-table-browse="true"
        :connection-id="connectionId"
        :database="tabContext?.database"
        :table-name="tabContext?.table"
        :driver="driver"
        @load-more="loadMoreRows"
        @server-filter="handleServerFilter"
        @server-sort="handleServerSort"
      />
    </div>
  </div>
</template>
