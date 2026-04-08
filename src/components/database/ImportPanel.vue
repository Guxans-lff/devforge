<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { parseBackendError } from '@/types/error'
import { useI18n } from 'vue-i18n'
import { open } from '@tauri-apps/plugin-dialog'
import { listen } from '@tauri-apps/api/event'
import { FileUp, Upload, Loader2, Check, X, ArrowRight, FileSpreadsheet } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import Progress from '@/components/ui/progress.vue'
import { useToast } from '@/composables/useToast'
import { importPreview, importData } from '@/api/import'
import type { ColumnMapping, ImportPreview as IImportPreview, ImportProgress } from '@/types/import'

const props = defineProps<{
  connectionId: string
  database: string
  targetTable?: string
  tableColumns?: string[]
}>()

const emit = defineEmits<{
  success: []
}>()

const { t } = useI18n()
const toast = useToast()

// File selection state
const filePath = ref('')
const fileType = ref('csv')
const hasHeader = ref(true)
const delimiter = ref(',')

// Preview state
const previewing = ref(false)
const preview = ref<IImportPreview | null>(null)

// Column mapping state
const columnMappings = ref<ColumnMapping[]>([])

// Import state
const tableName = ref(props.targetTable ?? '')
const batchSize = ref(100)
const importing = ref(false)
const importedRows = ref(0)
const totalImportRows = ref(0)
const importStatus = ref('')
const importDone = ref(false)
const importSuccess = ref(false)
const importError = ref<string | null>(null)

const FILE_TYPES = ['csv', 'json', 'sql'] as const

const showPreview = computed(() => preview.value !== null)
const showMapping = computed(() => showPreview.value && preview.value!.columns.length > 0)
const progressPercent = computed(() => {
  if (totalImportRows.value === 0) return 0
  return Math.round((importedRows.value / totalImportRows.value) * 100)
})

const targetColumns = computed(() => props.tableColumns ?? [])

function detectFileType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  if (ext === 'csv') return 'csv'
  if (ext === 'json') return 'json'
  if (ext === 'sql') return 'sql'
  return 'csv'
}

async function selectFile() {
  const selected = await open({
    multiple: false,
    filters: [
      { name: 'CSV', extensions: ['csv'] },
      { name: 'JSON', extensions: ['json'] },
      { name: 'SQL', extensions: ['sql'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })
  if (!selected) return
  filePath.value = selected as string
  fileType.value = detectFileType(filePath.value)
  await runPreview()
}

async function runPreview() {
  if (!filePath.value) return
  previewing.value = true
  preview.value = null
  columnMappings.value = []
  importDone.value = false
  try {
    preview.value = await importPreview(filePath.value, fileType.value)
    autoMapColumns()
  } catch (e: unknown) {
    toast.error(t('dataImport.preview'), parseBackendError(e).message)
  } finally {
    previewing.value = false
  }
}

function autoMapColumns() {
  if (!preview.value) return
  columnMappings.value = preview.value.columns.map((src) => {
    const match = targetColumns.value.find(
      (col) => col.toLowerCase() === src.toLowerCase()
    )
    return { sourceColumn: src, targetColumn: match ?? '' }
  })
}

function getMappingTarget(sourceColumn: string): string {
  return columnMappings.value.find((m) => m.sourceColumn === sourceColumn)?.targetColumn ?? ''
}

function setMappingTarget(sourceColumn: string, targetColumn: string) {
  columnMappings.value = columnMappings.value.map((m) =>
    m.sourceColumn === sourceColumn ? { ...m, targetColumn } : m
  )
}

let progressUnlisten: (() => void) | null = null

async function startImport() {
  if (!filePath.value) {
    toast.error(t('dataImport.noFile'))
    return
  }
  const activeMapping = columnMappings.value.filter((m) => m.targetColumn)
  if (activeMapping.length === 0) {
    toast.error(t('dataImport.noMapping'))
    return
  }

  importing.value = true
  importDone.value = false
  importSuccess.value = false
  importError.value = null
  importedRows.value = 0
  totalImportRows.value = preview.value?.totalRows ?? 0

  progressUnlisten = await listen<ImportProgress>('import://progress', (event) => {
    const p = event.payload
    importedRows.value = p.importedRows
    if (p.totalRows) totalImportRows.value = p.totalRows
    importStatus.value = p.status
    if (p.error) importError.value = p.error
  })

  try {
    const result = await importData({
      filePath: filePath.value,
      fileType: fileType.value,
      connectionId: props.connectionId,
      database: props.database,
      table: tableName.value,
      columnMapping: activeMapping,
      hasHeader: hasHeader.value,
      delimiter: fileType.value === 'csv' ? delimiter.value : null,
      batchSize: batchSize.value,
    })

    importDone.value = true
    importSuccess.value = result.success
    importedRows.value = result.importedRows
    importError.value = result.error

    if (result.success) {
      toast.success(t('dataImport.importSuccess'), t('dataImport.rowsImported', { count: result.importedRows }))
      emit('success')
    } else {
      toast.error(t('dataImport.importFailed'), result.error ?? '')
    }
  } catch (e: unknown) {
    importDone.value = true
    importSuccess.value = false
    importError.value = parseBackendError(e).message
    toast.error(t('dataImport.importFailed'), importError.value ?? '')
  } finally {
    importing.value = false
    progressUnlisten?.()
    progressUnlisten = null
  }
}

function reset() {
  filePath.value = ''
  fileType.value = 'csv'
  hasHeader.value = true
  delimiter.value = ','
  preview.value = null
  columnMappings.value = []
  tableName.value = props.targetTable ?? ''
  batchSize.value = 100
  importing.value = false
  importDone.value = false
  importSuccess.value = false
  importError.value = null
  importedRows.value = 0
  totalImportRows.value = 0
  importStatus.value = ''
}

watch(() => props.targetTable, (val) => {
  if (val) tableName.value = val
})

onBeforeUnmount(() => {
  progressUnlisten?.()
  progressUnlisten = null
})

defineExpose({ reset })
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 顶部工具栏 -->
    <div class="flex items-center gap-2 border-b border-border px-3 py-1.5 shrink-0">
      <FileUp class="size-3.5 text-muted-foreground" />
      <span class="text-xs font-medium">{{ t('dataImport.title') }}</span>
      <span class="text-[10px] text-muted-foreground">{{ props.database }}</span>
      <div class="flex-1" />
      <Button
        size="sm"
        class="h-7 gap-1.5 text-xs"
        :disabled="!filePath || !showPreview || importing || importDone"
        @click="startImport"
      >
        <Loader2 v-if="importing" class="size-3.5 animate-spin" />
        <Upload v-else class="size-3.5" />
        {{ importing ? t('dataImport.importing') : t('dataImport.import') }}
      </Button>
    </div>

    <!-- 主内容区 -->
    <ScrollArea class="flex-1 min-h-0">
      <div class="px-4 py-3 space-y-4">

        <!-- 文件选择 -->
        <div class="space-y-2.5">
          <div class="flex items-center gap-2">
            <FileSpreadsheet class="size-3.5 text-muted-foreground" />
            <span class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {{ t('dataImport.selectFile') }}
            </span>
          </div>

          <div class="flex gap-2">
            <Input
              :model-value="filePath"
              readonly
              :placeholder="t('dataImport.filePath')"
              class="flex-1 text-xs h-8"
            />
            <Button variant="outline" size="sm" class="shrink-0" @click="selectFile">
              <Upload class="size-3.5" />
              {{ t('dataImport.selectFile') }}
            </Button>
          </div>

          <div class="flex items-center gap-4 flex-wrap">
            <div class="flex items-center gap-2">
              <Label class="text-xs text-muted-foreground">{{ t('dataImport.fileType') }}</Label>
              <Select v-model="fileType" @update:model-value="filePath && runPreview()">
                <SelectTrigger class="h-7 w-24 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="ft in FILE_TYPES" :key="ft" :value="ft" class="text-xs">
                    {{ ft.toUpperCase() }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <template v-if="fileType === 'csv'">
              <div class="flex items-center gap-2">
                <Switch :id="'import-has-header'" v-model:checked="hasHeader" class="scale-90" />
                <Label for="import-has-header" class="text-xs cursor-pointer">
                  {{ t('dataImport.hasHeader') }}
                </Label>
              </div>
              <div class="flex items-center gap-2">
                <Label class="text-xs text-muted-foreground">{{ t('dataImport.delimiter') }}</Label>
                <Input v-model="delimiter" class="h-7 w-12 text-xs text-center" maxlength="1" />
              </div>
            </template>
          </div>
        </div>

        <!-- 预览加载 -->
        <div v-if="previewing" class="flex items-center justify-center py-6">
          <Loader2 class="size-4 animate-spin text-muted-foreground" />
        </div>

        <!-- 无文件提示 -->
        <div v-if="!filePath && !previewing" class="flex flex-col items-center justify-center py-8 text-muted-foreground">
          <FileUp class="size-8 mb-2 opacity-40" />
          <p class="text-xs">{{ t('dataImport.noFileHint') }}</p>
        </div>

        <!-- 预览数据 -->
        <template v-if="showPreview && preview">
          <Separator />

          <!-- 目标表 -->
          <div class="space-y-2">
            <Label class="text-xs text-muted-foreground">{{ t('dataImport.targetTable') }}</Label>
            <Input v-model="tableName" class="h-8 text-xs" :placeholder="t('dataImport.targetTable')" />
          </div>

          <!-- 数据预览 -->
          <div class="space-y-2">
            <div class="flex items-center gap-2">
              <span class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {{ t('dataImport.preview') }}
              </span>
              <Badge variant="secondary" class="text-[10px] h-4">
                {{ preview.columns.length }} {{ t('database.columns') }}
              </Badge>
              <Badge v-if="preview.totalRows" variant="secondary" class="text-[10px] h-4">
                {{ preview.totalRows.toLocaleString() }} {{ t('database.rows') }}
              </Badge>
            </div>
            <div class="overflow-auto rounded border border-border max-h-40">
              <table class="w-full text-xs">
                <thead class="bg-muted/50 sticky top-0">
                  <tr>
                    <th v-for="col in preview.columns" :key="col" class="px-2 py-1 text-left font-medium text-muted-foreground whitespace-nowrap">
                      {{ col }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, i) in preview.sampleRows" :key="i" class="border-t border-border">
                    <td v-for="(cell, j) in row" :key="j" class="px-2 py-1 whitespace-nowrap max-w-[200px] truncate">
                      {{ cell }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- 列映射 -->
          <template v-if="showMapping">
            <Separator />
            <div class="space-y-2">
              <div class="flex items-center gap-2">
                <span class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {{ t('dataImport.columnMapping') }}
                </span>
              </div>
              <p class="text-[10px] text-muted-foreground">{{ t('dataImport.mappingHint') }}</p>
              <div class="space-y-1.5">
                <div
                  v-for="mapping in columnMappings"
                  :key="mapping.sourceColumn"
                  class="flex items-center gap-2"
                >
                  <Badge variant="outline" class="text-[10px] h-6 min-w-[100px] justify-center shrink-0">
                    {{ mapping.sourceColumn }}
                  </Badge>
                  <ArrowRight class="size-3 text-muted-foreground shrink-0" />
                  <Select
                    :model-value="getMappingTarget(mapping.sourceColumn)"
                    @update:model-value="(v) => setMappingTarget(mapping.sourceColumn, v as string)"
                  >
                    <SelectTrigger class="h-7 text-xs flex-1">
                      <SelectValue :placeholder="t('dataImport.targetColumn')" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="" class="text-xs text-muted-foreground">—</SelectItem>
                      <SelectItem v-for="col in targetColumns" :key="col" :value="col" class="text-xs">
                        {{ col }}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </template>

          <!-- 批量大小 -->
          <div class="flex items-center gap-2">
            <Label class="text-xs text-muted-foreground">{{ t('dataImport.batchSize') }}</Label>
            <Input v-model.number="batchSize" type="number" class="h-7 w-24 text-xs" :min="1" :max="10000" />
          </div>

          <!-- 导入进度 -->
          <template v-if="importing || importDone">
            <Separator />
            <template v-if="importing">
              <div class="space-y-2">
                <div class="flex items-center justify-between text-xs">
                  <span class="text-muted-foreground">{{ importStatus || t('dataImport.importing') }}</span>
                  <span class="font-mono">{{ importedRows.toLocaleString() }} / {{ totalImportRows.toLocaleString() }}</span>
                </div>
                <Progress :model-value="progressPercent" />
              </div>
            </template>

            <!-- 结果 -->
            <template v-if="importDone">
              <div
                class="flex items-center gap-2 rounded-md px-3 py-2 text-xs"
                :class="importSuccess ? 'bg-df-success/10 text-df-success' : 'bg-destructive/10 text-destructive'"
              >
                <Check v-if="importSuccess" class="size-3.5 shrink-0" />
                <X v-else class="size-3.5 shrink-0" />
                <span v-if="importSuccess">
                  {{ t('dataImport.importComplete') }} — {{ t('dataImport.rowsImported', { count: importedRows.toLocaleString() }) }}
                </span>
                <span v-else>{{ importError ?? t('dataImport.importFailed') }}</span>
              </div>
            </template>
          </template>
        </template>

      </div>
    </ScrollArea>
  </div>
</template>
