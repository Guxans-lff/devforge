<script setup lang="ts">
import { computed, watch, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVirtualizer } from '@tanstack/vue-virtual'
import {
  useVueTable,
  getCoreRowModel,
  getSortedRowModel,
  createColumnHelper,
  FlexRender,
} from '@tanstack/vue-table'
import type { ColumnDef as TanstackColumnDef, SortingState } from '@tanstack/vue-table'
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Clock,
  AlertCircle,
  CheckCircle2,
  Hash,
  Download,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  RefreshCw,
} from 'lucide-vue-next'
import type { QueryResult as QueryResultType } from '@/types/database'
import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@/api/database'
import { formatData, getFilters, type ExportFormat } from '@/utils/exportData'
import { useToast } from '@/composables/useToast'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  result: QueryResultType | null
  loading?: boolean
  showReconnect?: boolean
}>()

const emit = defineEmits<{
  reconnect: []
}>()

const { t } = useI18n()
const sorting = ref<SortingState>([])
const toast = useToast()
const currentPage = ref(1)
const pageSize = ref(100)
const PAGE_SIZE_OPTIONS = [50, 100, 200, 500, 1000]
const selectedRowIndex = ref<number | null>(null)

function handleCellClick(value: unknown) {
  const text = value === null || value === undefined ? 'NULL' : String(value)
  navigator.clipboard.writeText(text).then(() => {
    toast.success(t('toast.copySuccess'))
  }).catch(() => {})
}

type RowData = Record<string, unknown>

async function handleExport(format: ExportFormat) {
  if (!props.result || props.result.isError) return

  const filters = getFilters(format)
  const path = await save({
    defaultPath: `export.${format}`,
    filters,
  })

  if (!path) return

  try {
    const content = formatData(props.result, format, 'exported_table')
    await writeTextFile(path, content)
    toast.success(t('toast.exportSuccess'))
  } catch (e) {
    toast.error(t('toast.exportFailed'), String(e))
  }
}

const allTableData = computed<RowData[]>(() => {
  if (!props.result || props.result.isError || props.result.columns.length === 0) return []
  return props.result.rows.map((row) => {
    const obj: RowData = {}
    props.result!.columns.forEach((col, i) => {
      obj[col.name] = row[i]
    })
    return obj
  })
})

const totalRows = computed(() => allTableData.value.length)
const totalPages = computed(() => Math.max(1, Math.ceil(totalRows.value / pageSize.value)))

const tableData = computed<RowData[]>(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return allTableData.value.slice(start, start + pageSize.value)
})

watch(() => props.result, () => {
  currentPage.value = 1
  selectedRowIndex.value = null
})

const columns = computed<TanstackColumnDef<RowData, unknown>[]>(() => {
  if (!props.result || props.result.columns.length === 0) return []
  const helper = createColumnHelper<RowData>()
  return props.result.columns.map((col) =>
    helper.accessor(col.name, {
      header: col.name,
      cell: (info) => {
        const val = info.getValue()
        if (val === null || val === undefined) return 'NULL'
        return String(val)
      },
    }),
  )
})

const table = useVueTable({
  get data() {
    return tableData.value
  },
  get columns() {
    return columns.value
  },
  state: {
    get sorting() {
      return sorting.value
    },
  },
  onSortingChange: (updater) => {
    sorting.value = typeof updater === 'function' ? updater(sorting.value) : updater
  },
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
})

const tableScrollRef = ref<HTMLDivElement | null>(null)
const ROW_HEIGHT = 28

const rowVirtualizer = useVirtualizer({
  get count() { return table.getRowModel().rows.length },
  getScrollElement: () => tableScrollRef.value,
  estimateSize: () => ROW_HEIGHT,
  overscan: 15,
})
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <!-- Status bar -->
    <div
      class="flex items-center gap-4 border-b border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground"
    >
      <template v-if="loading">
        <div class="flex items-center gap-1.5">
          <div class="h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          <span>{{ t('database.executing') }}</span>
        </div>
      </template>
      <template v-else-if="result">
        <template v-if="result.isError">
          <div class="flex items-center gap-1.5 text-destructive min-w-0">
            <AlertCircle class="h-3.5 w-3.5 shrink-0" />
            <span class="truncate">{{ result.error }}</span>
          </div>
        </template>
        <template v-else>
          <div class="flex items-center gap-1.5">
            <CheckCircle2 class="h-3.5 w-3.5 text-[var(--df-success)]" />
            <span v-if="result.columns.length > 0">
              {{ result.rows.length }} {{ t('database.rows') }}
            </span>
            <span v-else>
              {{ result.affectedRows }} {{ t('database.rowsAffected') }}
            </span>
          </div>
          <div class="flex items-center gap-1.5">
            <Clock class="h-3.5 w-3.5" />
            <span>{{ result.executionTimeMs }}ms</span>
          </div>
          <div v-if="result.columns.length > 0" class="flex items-center gap-1.5">
            <Hash class="h-3.5 w-3.5" />
            <span>{{ result.columns.length }} {{ t('database.columns') }}</span>
          </div>
          <div class="flex-1" />
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" size="sm" class="h-5 gap-1 text-xs px-1.5">
                <Download class="h-3 w-3" />
                {{ t('database.export') }}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem @click="handleExport('csv')">
                {{ t('database.exportCSV') }}
              </DropdownMenuItem>
              <DropdownMenuItem @click="handleExport('json')">
                {{ t('database.exportJSON') }}
              </DropdownMenuItem>
              <DropdownMenuItem @click="handleExport('sql')">
                {{ t('database.exportSQL') }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </template>
      </template>
      <template v-else>
        <span>{{ t('database.ready') }}</span>
      </template>
    </div>

    <!-- Table -->
    <div ref="tableScrollRef" class="min-h-0 flex-1 overflow-auto">
      <table v-if="result && !result.isError && result.columns.length > 0" class="text-sm border-collapse w-full">
        <thead class="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
          <tr>
            <th
              class="whitespace-nowrap border-b border-r border-border px-3 py-1.5 text-left text-xs font-medium text-muted-foreground"
            >
              #
            </th>
            <th
              v-for="header in table.getFlatHeaders()"
              :key="header.id"
              class="cursor-pointer select-none whitespace-nowrap border-b border-r border-border px-3 py-1.5 text-left text-xs font-medium text-muted-foreground hover:bg-muted/50 transition-colors"
              @click="header.column.getToggleSortingHandler()?.($event)"
            >
              <div class="flex items-center gap-1">
                <FlexRender :render="header.column.columnDef.header" :props="header.getContext()" />
                <ArrowUp
                  v-if="header.column.getIsSorted() === 'asc'"
                  class="h-3 w-3"
                />
                <ArrowDown
                  v-else-if="header.column.getIsSorted() === 'desc'"
                  class="h-3 w-3"
                />
                <ArrowUpDown v-else class="h-3 w-3 opacity-30" />
              </div>
            </th>
          </tr>
        </thead>
        <tbody :style="{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }">
          <tr
            v-for="vRow in rowVirtualizer.getVirtualItems()"
            :key="vRow.key"
            class="transition-colors cursor-pointer absolute left-0 right-0 flex"
            :style="{ height: `${ROW_HEIGHT}px`, transform: `translateY(${vRow.start}px)` }"
            :class="selectedRowIndex === vRow.index ? 'bg-primary/10' : 'hover:bg-muted/30'"
            @click="selectedRowIndex = vRow.index"
          >
            <td
              class="whitespace-nowrap border-b border-r border-border px-3 text-xs text-muted-foreground tabular-nums flex items-center"
            >
              {{ (currentPage - 1) * pageSize + vRow.index + 1 }}
            </td>
            <td
              v-for="cell in table.getRowModel().rows[vRow.index]?.getVisibleCells()"
              :key="cell.id"
              class="select-text whitespace-nowrap border-b border-r border-border px-3 font-mono text-xs cursor-pointer hover:bg-muted/50 flex items-center"
              :class="{
                'text-muted-foreground/50 italic': cell.getValue() === null || cell.getValue() === undefined,
              }"
              @dblclick="handleCellClick(cell.getValue())"
            >
              <FlexRender :render="cell.column.columnDef.cell" :props="cell.getContext()" />
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Error state -->
      <div
        v-else-if="result && result.isError"
        class="flex h-full items-center justify-center p-6"
      >
        <div class="flex max-w-lg flex-col items-center gap-3 text-center">
          <div class="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
            <AlertCircle class="h-5 w-5 text-destructive/70" />
          </div>
          <div class="space-y-1">
            <p class="text-sm font-medium text-foreground/80">{{ t('database.queryError') }}</p>
            <p class="max-h-24 overflow-auto text-xs leading-relaxed text-muted-foreground">{{ result.error }}</p>
          </div>
          <Button
            v-if="showReconnect"
            variant="outline"
            size="sm"
            class="mt-1 h-7 gap-1.5 text-xs"
            @click="emit('reconnect')"
          >
            <RefreshCw class="h-3 w-3" />
            {{ t('database.reconnect') }}
          </Button>
        </div>
      </div>

      <!-- Empty state -->
      <div
        v-else-if="!loading && (!result || (!result.isError && result.columns.length === 0))"
        class="flex h-full items-center justify-center text-muted-foreground"
      >
        <p class="text-sm">{{ t('database.noResults') }}</p>
      </div>
    </div>

    <!-- Pagination -->
    <div
      v-if="result && !result.isError && result.columns.length > 0"
      class="flex items-center justify-between border-t border-border bg-muted/30 px-3 py-1 text-xs text-muted-foreground shrink-0"
    >
      <div class="flex items-center gap-2">
        <span>{{ t('database.rowsPerPage') }}</span>
        <select
          :value="pageSize"
          class="h-6 rounded border border-border bg-background px-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
          @change="pageSize = Number(($event.target as HTMLSelectElement).value); currentPage = 1"
        >
          <option v-for="size in PAGE_SIZE_OPTIONS" :key="size" :value="size">{{ size }}</option>
        </select>
      </div>
      <div class="flex items-center gap-1">
        <span>{{ (currentPage - 1) * pageSize + 1 }}-{{ Math.min(currentPage * pageSize, totalRows) }} / {{ totalRows }}</span>
        <Button variant="ghost" size="icon-sm" class="size-6" :disabled="currentPage <= 1" @click="currentPage = 1">
          <ChevronsLeft class="size-3" />
        </Button>
        <Button variant="ghost" size="icon-sm" class="size-6" :disabled="currentPage <= 1" @click="currentPage--">
          <ChevronLeft class="size-3" />
        </Button>
        <Button variant="ghost" size="icon-sm" class="size-6" :disabled="currentPage >= totalPages" @click="currentPage++">
          <ChevronRight class="size-3" />
        </Button>
        <Button variant="ghost" size="icon-sm" class="size-6" :disabled="currentPage >= totalPages" @click="currentPage = totalPages">
          <ChevronsRight class="size-3" />
        </Button>
      </div>
    </div>
  </div>
</template>
