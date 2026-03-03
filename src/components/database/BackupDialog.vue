<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { save } from '@tauri-apps/plugin-dialog'
import { listen } from '@tauri-apps/api/event'
import { HardDrive, Loader2, Check, X } from 'lucide-vue-next'
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

const allSelected = computed(() =>
  tables.value.length > 0 && selectedTables.value.size === tables.value.length,
)

const someSelected = computed(() =>
  selectedTables.value.size > 0 && selectedTables.value.size < tables.value.length,
)

const progressPercent = computed(() => {
  if (totalTables.value === 0) return 0
  return Math.round((tableIndex.value / totalTables.value) * 100)
})

function toggleAll() {
  if (allSelected.value) {
    selectedTables.value = new Set()
  } else {
    selectedTables.value = new Set(tables.value.map((t) => t.name))
  }
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
}

watch(open, (val) => {
  if (val) {
    reset()
    loadTables()
  } else {
    progressUnlisten?.()
    progressUnlisten = null
  }
})

onBeforeUnmount(() => {
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
              <!-- 全选 -->
              <label class="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/50 cursor-pointer">
                <input
                  type="checkbox"
                  :checked="allSelected"
                  :indeterminate="someSelected"
                  class="size-3.5 rounded border-muted-foreground/40 accent-primary"
                  @change="toggleAll"
                />
                <span class="text-xs font-medium">{{ t('backup.selectAll') }}</span>
              </label>
              <Separator />
              <div class="max-h-40 overflow-y-auto space-y-0.5">
                <label
                  v-for="tbl in tables"
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

              <!-- 结果 -->
              <div
                v-if="backupDone"
                class="flex items-center gap-2 rounded-md px-3 py-2 text-xs"
                :class="backupSuccess ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-destructive/10 text-destructive'"
              >
                <Check v-if="backupSuccess" class="size-3.5 shrink-0" />
                <X v-else class="size-3.5 shrink-0" />
                <span v-if="backupSuccess">{{ t('backup.success') }}</span>
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
