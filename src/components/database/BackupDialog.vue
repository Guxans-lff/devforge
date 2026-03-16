<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { save } from '@tauri-apps/plugin-dialog'
import { listen } from '@tauri-apps/api/event'
import { HardDrive, Loader2, Check, X, Search } from 'lucide-vue-next'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import Progress from '@/components/ui/progress.vue'
import { useToast } from '@/composables/useToast'
import * as dbApi from '@/api/database'
import { dbBackupDatabase } from '@/api/db-backup'
import type { TableInfo } from '@/types/database'

interface BackupProgress {
  currentTable: string
  tableIndex: number
  totalTables: number
  rowsExported: number
  status: string
  error: string | null
}

const props = defineProps<{
  connectionId: string
  database: string
}>()

const emit = defineEmits<{
  success: []
}>()

const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
const toast = useToast()

// 表列表
const tables = ref<TableInfo[]>([])
const loadingTables = ref(false)
const selectedTables = ref<Set<string>>(new Set())

// 搜索过滤
const tableSearch = ref('')

// 过滤后的表列表
const filteredTables = computed(() => {
  const q = tableSearch.value.trim().toLowerCase()
  if (!q) return tables.value
  return tables.value.filter((t) => t.name.toLowerCase().includes(q))
})

// 全选/半选基于过滤后的表
const allSelected = computed(() =>
  filteredTables.value.length > 0 &&
  filteredTables.value.every((t) => selectedTables.value.has(t.name)),
)

const someSelected = computed(() => {
  const filtered = filteredTables.value
  const selectedInFiltered = filtered.filter((t) => selectedTables.value.has(t.name)).length
  return selectedInFiltered > 0 && selectedInFiltered < filtered.length
})

// 选项
const includeStructure = ref(true)
const includeData = ref(true)

// 进度
const backing = ref(false)
const backupDone = ref(false)
const backupSuccess = ref(false)
const backupError = ref<string | null>(null)
const currentTable = ref('')
const tableIndex = ref(0)
const totalTables = ref(0)
const rowsExported = ref(0)

// 计时
const startTime = ref<number>(0)
const elapsedSeconds = ref(0)
let timerHandle: ReturnType<typeof setInterval> | null = null

const progressPercent = computed(() => {
  if (totalTables.value === 0) return 0
  return Math.round((tableIndex.value / totalTables.value) * 100)
})

// 格式化秒数为 mm:ss 或 hh:mm:ss
function formatSeconds(s: number): string {
  s = Math.floor(s)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  }
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

// 已用时间（可读）
const elapsedText = computed(() => formatSeconds(elapsedSeconds.value))

// 预计完成时间（基于当前进度线性外推）
const etaText = computed(() => {
  const pct = progressPercent.value
  if (pct <= 0 || elapsedSeconds.value <= 0) return '--:--'
  const totalEstimated = elapsedSeconds.value / (pct / 100)
  const remaining = totalEstimated - elapsedSeconds.value
  if (remaining < 0) return '00:00'
  return formatSeconds(remaining)
})

function startTimer() {
  startTime.value = Date.now()
  elapsedSeconds.value = 0
  timerHandle = setInterval(() => {
    elapsedSeconds.value = (Date.now() - startTime.value) / 1000
  }, 500)
}

function stopTimer() {
  if (timerHandle !== null) {
    clearInterval(timerHandle)
    timerHandle = null
  }
}

function toggleAll() {
  const filtered = filteredTables.value
  const next = new Set(selectedTables.value)
  if (allSelected.value) {
    // 取消勾选当前过滤结果中的所有表
    filtered.forEach((t) => next.delete(t.name))
  } else {
    // 勾选当前过滤结果中的所有表
    filtered.forEach((t) => next.add(t.name))
  }
  selectedTables.value = next
}

function toggleTable(name: string) {
  const next = new Set(selectedTables.value)
  if (next.has(name)) {
    next.delete(name)
  } else {
    next.add(name)
  }
  selectedTables.value = next
}

async function loadTables() {
  loadingTables.value = true
  try {
    tables.value = await dbApi.dbGetTables(props.connectionId, props.database)
    selectedTables.value = new Set(tables.value.map((t) => t.name))
  } catch (e: any) {
    toast.error(t('backup.loadTablesFailed'), e?.message ?? String(e))
  } finally {
    loadingTables.value = false
  }
}

let progressUnlisten: (() => void) | null = null

async function startBackup() {
  if (selectedTables.value.size === 0) {
    toast.warning(t('backup.noTablesSelected'))
    return
  }
  if (!includeStructure.value && !includeData.value) {
    toast.warning(t('backup.noOptionSelected'))
    return
  }

  const outputPath = await save({
    defaultPath: `${props.database}_backup.sql`,
    filters: [{ name: 'SQL Files', extensions: ['sql'] }],
  })
  if (!outputPath) return

  backing.value = true
  backupDone.value = false
  backupSuccess.value = false
  backupError.value = null
  currentTable.value = ''
  tableIndex.value = 0
  totalTables.value = selectedTables.value.size
  rowsExported.value = 0

  startTimer()

  progressUnlisten = await listen<BackupProgress>('backup://progress', (event) => {
    const p = event.payload
    currentTable.value = p.currentTable
    tableIndex.value = p.tableIndex
    totalTables.value = p.totalTables
    rowsExported.value = p.rowsExported
    if (p.status === 'completed') {
      backupDone.value = true
      backupSuccess.value = true
    }
    if (p.error) {
      backupError.value = p.error
    }
  })

  try {
    await dbBackupDatabase(
      props.connectionId,
      props.database,
      [...selectedTables.value],
      includeStructure.value,
      includeData.value,
      outputPath,
    )
    backupDone.value = true
    backupSuccess.value = true
    toast.success(t('backup.success'))
    emit('success')
  } catch (e: any) {
    backupDone.value = true
    backupSuccess.value = false
    backupError.value = e?.message ?? String(e)
    toast.error(t('backup.failed'), backupError.value ?? '')
  } finally {
    backing.value = false
    stopTimer()
    progressUnlisten?.()
    progressUnlisten = null
  }
}

function reset() {
  backing.value = false
  backupDone.value = false
  backupSuccess.value = false
  backupError.value = null
  currentTable.value = ''
  tableIndex.value = 0
  totalTables.value = 0
  rowsExported.value = 0
  tableSearch.value = ''
  stopTimer()
  elapsedSeconds.value = 0
}

watch(open, (val) => {
  if (val) {
    reset()
    loadTables()
  } else {
    stopTimer()
    progressUnlisten?.()
    progressUnlisten = null
  }
})

onBeforeUnmount(() => {
  stopTimer()
  progressUnlisten?.()
})
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="flex flex-col gap-0 p-0 max-w-lg max-h-[80vh]">
      <DialogHeader class="px-6 pt-5 pb-4 shrink-0">
        <DialogTitle class="flex items-center gap-2 text-base">
          <HardDrive class="size-4" />
          {{ t('backup.title') }}
        </DialogTitle>
        <DialogDescription class="text-xs">
          {{ props.database }}
        </DialogDescription>
      </DialogHeader>

      <Separator class="shrink-0" />

      <ScrollArea class="flex-1 min-h-0">
        <div class="px-6 py-4 space-y-4">

          <!-- 表选择 -->
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {{ t('backup.selectTables') }}
              </span>
              <Badge variant="secondary" class="text-xs h-4 px-1.5">
                {{ selectedTables.size }} / {{ tables.length }}
              </Badge>
            </div>

            <div v-if="loadingTables" class="flex items-center gap-2 py-4 justify-center text-muted-foreground">
              <Loader2 class="size-4 animate-spin" />
              <span class="text-xs">{{ t('common.loading') }}</span>
            </div>

            <div v-else class="space-y-1">
              <!-- 搜索框 -->
              <div class="relative">
                <Search class="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
                <input
                  v-model="tableSearch"
                  type="text"
                  :placeholder="t('backup.searchTables')"
                  class="w-full pl-6 pr-2 py-1 text-xs rounded border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              <!-- 全选（作用于过滤结果） -->
              <label class="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/50 cursor-pointer">
                <input
                  type="checkbox"
                  :checked="allSelected"
                  :indeterminate="someSelected"
                  class="size-3.5 rounded border-muted-foreground/40 accent-primary"
                  @change="toggleAll"
                />
                <span class="text-xs font-medium">{{ t('backup.selectAll') }}</span>
                <span v-if="tableSearch" class="ml-auto text-xs text-muted-foreground">
                  {{ filteredTables.length }} {{ t('backup.matchedTables') }}
                </span>
              </label>
              <Separator />
              <div class="max-h-40 overflow-y-auto space-y-0.5">
                <!-- 无搜索结果提示 -->
                <div v-if="filteredTables.length === 0" class="px-2 py-3 text-xs text-muted-foreground text-center">
                  {{ t('backup.noMatchedTables') }}
                </div>
                <label
                  v-for="tbl in filteredTables"
                  :key="tbl.name"
                  class="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    :checked="selectedTables.has(tbl.name)"
                    class="size-3.5 rounded border-muted-foreground/40 accent-primary"
                    @change="toggleTable(tbl.name)"
                  />
                  <span class="text-xs">{{ tbl.name }}</span>
                  <span v-if="tbl.rowCount != null" class="ml-auto text-xs text-muted-foreground">
                    {{ tbl.rowCount?.toLocaleString() }} rows
                  </span>
                </label>
              </div>
            </div>
          </div>

          <Separator />

          <!-- 选项 -->
          <div class="space-y-2">
            <span class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {{ t('backup.options') }}
            </span>
            <div class="flex items-center gap-4">
              <label class="flex items-center gap-2 cursor-pointer">
                <input
                  v-model="includeStructure"
                  type="checkbox"
                  class="size-3.5 rounded border-muted-foreground/40 accent-primary"
                />
                <span class="text-xs">{{ t('backup.includeStructure') }}</span>
              </label>
              <label class="flex items-center gap-2 cursor-pointer">
                <input
                  v-model="includeData"
                  type="checkbox"
                  class="size-3.5 rounded border-muted-foreground/40 accent-primary"
                />
                <span class="text-xs">{{ t('backup.includeData') }}</span>
              </label>
            </div>
          </div>

          <!-- 进度 -->
          <template v-if="backing || backupDone">
            <Separator />
            <div class="space-y-2">
              <div class="flex items-center justify-between text-xs text-muted-foreground">
                <span v-if="backing">
                  {{ t('backup.backingUp') }}: {{ currentTable }} ({{ tableIndex }}/{{ totalTables }})
                </span>
                <span v-else>{{ t('backup.done') }}</span>
                <span v-if="rowsExported > 0">{{ rowsExported.toLocaleString() }} rows</span>
              </div>
              <Progress :model-value="progressPercent" />

              <!-- 耗时 / 预计完成时间 -->
              <div class="flex items-center justify-between text-xs text-muted-foreground">
                <span>{{ t('backup.elapsed') }}: {{ elapsedText }}</span>
                <span v-if="backing && progressPercent > 0">
                  {{ t('backup.eta') }}: {{ etaText }}
                </span>
              </div>

              <!-- 结果 -->
              <div
                v-if="backupDone"
                class="flex items-center gap-2 rounded-md px-3 py-2 text-xs"
                :class="backupSuccess ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-destructive/10 text-destructive'"
              >
                <Check v-if="backupSuccess" class="size-3.5 shrink-0" />
                <X v-else class="size-3.5 shrink-0" />
                <span v-if="backupSuccess">{{ t('backup.success') }} ({{ t('backup.elapsed') }}: {{ elapsedText }})</span>
                <span v-else>{{ backupError ?? t('backup.failed') }}</span>
              </div>
            </div>
          </template>

        </div>
      </ScrollArea>

      <Separator class="shrink-0" />

      <DialogFooter class="px-6 py-3 shrink-0">
        <Button variant="outline" size="sm" :disabled="backing" @click="open = false">
          {{ backupDone ? t('common.close') : t('common.cancel') }}
        </Button>
        <Button
          size="sm"
          :disabled="backing || backupDone || selectedTables.size === 0"
          @click="startBackup"
        >
          <Loader2 v-if="backing" class="size-3.5 animate-spin" />
          <HardDrive v-else class="size-3.5" />
          {{ backing ? t('backup.backingUp') : t('backup.startBackup') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
