<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { listen } from '@tauri-apps/api/event'
import { FileUp, Upload, Loader2, Check, X, ArrowRight, FileSpreadsheet } from 'lucide-vue-next'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
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
  'update:open': [value: boolean]
}>()

const open = defineModel<boolean>('open', { default: false })

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
  const selected = await openDialog({
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
  } catch (e: any) {
    toast.error(t('dataImport.preview'), e?.message ?? String(e))
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
  } catch (e: any) {
    importDone.value = true
    importSuccess.value = false
    importError.value = e?.message ?? String(e)
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

watch(open, (val) => {
  if (!val) {
    progressUnlisten?.()
    progressUnlisten = null
    reset()
  }
})

watch(() => props.targetTable, (val) => {
  if (val) tableName.value = val
})
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="flex flex-col gap-0 p-0 max-w-2xl max-h-[90vh]">
      <DialogHeader class="px-6 pt-5 pb-4 shrink-0">
        <DialogTitle class="flex items-center gap-2 text-base">
          <FileUp class="size-4" />
          {{ t('dataImport.title') }}
        </DialogTitle>
        <DialogDescription class="text-xs">
          {{ props.database }}
        </DialogDescription>
      </DialogHeader>

      <Separator class="shrink-0" />

      <ScrollArea class="flex-1 min-h-0">
        <div class="px-6 py-4 space-y-5">

          <!-- File Selection -->
          <div class="space-y-3">
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
                      {{ t(`dataImport.${ft}`) }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <template v-if="fileType === 'csv'">
                <div class="flex items-center gap-2">
                  <Switch
                    :id="'has-header'"
                    v-model:checked="hasHeader"
                    class="scale-90"
                  />
                  <Label for="has-header" class="text-xs cursor-pointer">
                    {{ t('dataImport.hasHeader') }}
                  </Label>
                </div>

                <div class="flex items-center gap-2">
                  <Label class="text-xs text-muted-foreground">{{ t('dataImport.delimiter') }}</Label>
                  <Input
                    v-model="delimiter"
                    class="h-7 w-14 text-xs text-center"
                    maxlength="1"
                  />
                </div>
              </template>
            </div>
          </div>

          <!-- Preview -->
          <template v-if="filePath">
            <Separator />
            <div class="space-y-3">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <span class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {{ t('dataImport.previewData') }}
                  </span>
                  <Badge v-if="preview?.totalRows != null" variant="secondary" class="text-xs h-4 px-1.5">
                    {{ t('dataImport.totalRows') }}: {{ preview.totalRows.toLocaleString() }}
                  </Badge>
                </div>
                <Button
                  v-if="filePath && !previewing"
                  variant="ghost"
                  size="sm"
                  class="h-6 text-xs"
                  @click="runPreview"
                >
                  {{ t('dataImport.preview') }}
                </Button>
              </div>

              <div v-if="previewing" class="flex items-center gap-2 py-4 justify-center text-muted-foreground">
                <Loader2 class="size-4 animate-spin" />
                <span class="text-xs">{{ t('dataImport.preview') }}...</span>
              </div>

              <template v-else-if="preview">
                <div class="rounded-md border overflow-hidden">
                  <div class="overflow-x-auto">
                    <table class="w-full text-xs">
                      <thead class="bg-muted/50">
                        <tr>
                          <th
                            v-for="col in preview.columns"
                            :key="col"
                            class="px-3 py-1.5 text-left font-medium text-muted-foreground whitespace-nowrap border-b"
                          >
                            {{ col }}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr
                          v-for="(row, ri) in preview.sampleRows.slice(0, 5)"
                          :key="ri"
                          class="border-b last:border-0 hover:bg-muted/30"
                        >
                          <td
                            v-for="(cell, ci) in row"
                            :key="ci"
                            class="px-3 py-1.5 text-muted-foreground max-w-[160px] truncate"
                            :title="cell"
                          >
                            {{ cell }}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
                <p class="text-xs text-muted-foreground">
                  {{ t('dataImport.sampleData') }}: {{ Math.min(5, preview.sampleRows.length) }} {{ t('dataImport.rowsImported', { count: '' }).replace(/\d+/, '').trim() }}
                </p>
              </template>
            </div>
          </template>

          <!-- Column Mapping -->
          <template v-if="showMapping">
            <Separator />
            <div class="space-y-3">
              <div class="flex items-center gap-2">
                <span class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {{ t('dataImport.columnMapping') }}
                </span>
              </div>

              <div class="space-y-1.5">
                <div class="grid grid-cols-[1fr_auto_1fr] gap-2 items-center px-1 mb-1">
                  <span class="text-xs text-muted-foreground">{{ t('dataImport.sourceColumn') }}</span>
                  <span class="w-5" />
                  <span class="text-xs text-muted-foreground">{{ t('dataImport.targetColumn') }}</span>
                </div>
                <div
                  v-for="mapping in columnMappings"
                  :key="mapping.sourceColumn"
                  class="grid grid-cols-[1fr_auto_1fr] gap-2 items-center"
                >
                  <div class="flex items-center gap-1.5 h-7 px-2.5 rounded-md border bg-muted/40 text-xs truncate">
                    {{ mapping.sourceColumn }}
                  </div>
                  <ArrowRight class="size-3.5 text-muted-foreground shrink-0" />
                  <Select
                    :model-value="getMappingTarget(mapping.sourceColumn)"
                    @update:model-value="(v) => setMappingTarget(mapping.sourceColumn, v as string)"
                  >
                    <SelectTrigger class="h-7 text-xs">
                      <SelectValue :placeholder="t('dataImport.autoDetect')" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="" class="text-xs text-muted-foreground">
                        — {{ t('dataImport.autoDetect') }} —
                      </SelectItem>
                      <SelectItem
                        v-for="col in targetColumns"
                        :key="col"
                        :value="col"
                        class="text-xs"
                      >
                        {{ col }}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </template>

          <!-- Import Config -->
          <template v-if="showPreview">
            <Separator />
            <div class="space-y-3">
              <div class="flex items-center gap-2">
                <span class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {{ t('dataImport.import') }}
                </span>
              </div>

              <div class="grid grid-cols-2 gap-3">
                <div class="space-y-1.5">
                  <Label class="text-xs">{{ t('dataImport.targetTable') }}</Label>
                  <Input v-model="tableName" class="h-7 text-xs" />
                </div>
                <div class="space-y-1.5">
                  <Label class="text-xs">{{ t('dataImport.batchSize') }}</Label>
                  <Input
                    v-model.number="batchSize"
                    type="number"
                    min="1"
                    max="10000"
                    class="h-7 text-xs"
                  />
                </div>
              </div>

              <!-- Progress -->
              <template v-if="importing || importDone">
                <div class="space-y-2 pt-1">
                  <div class="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{{ importStatus || t('dataImport.importing') }}</span>
                    <span v-if="totalImportRows > 0">
                      {{ importedRows.toLocaleString() }} / {{ totalImportRows.toLocaleString() }}
                    </span>
                    <span v-else>{{ importedRows.toLocaleString() }} {{ t('dataImport.rowsImported', { count: '' }).replace(/\d+/, '').trim() }}</span>
                  </div>
                  <Progress :model-value="progressPercent" />
                </div>
              </template>

              <!-- Result -->
              <template v-if="importDone">
                <div
                  class="flex items-center gap-2 rounded-md px-3 py-2 text-xs"
                  :class="importSuccess ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-destructive/10 text-destructive'"
                >
                  <Check v-if="importSuccess" class="size-3.5 shrink-0" />
                  <X v-else class="size-3.5 shrink-0" />
                  <span v-if="importSuccess">
                    {{ t('dataImport.importSuccess') }} — {{ t('dataImport.rowsImported', { count: importedRows.toLocaleString() }) }}
                  </span>
                  <span v-else>{{ importError ?? t('dataImport.importFailed') }}</span>
                </div>
              </template>
            </div>
          </template>

        </div>
      </ScrollArea>

      <Separator class="shrink-0" />

      <DialogFooter class="px-6 py-3 shrink-0">
        <Button variant="outline" size="sm" :disabled="importing" @click="open = false">
          {{ importDone ? t('tableEditor.close', 'Close') : 'Cancel' }}
        </Button>
        <Button
          size="sm"
          :disabled="!filePath || !showPreview || importing || importDone"
          @click="startImport"
        >
          <Loader2 v-if="importing" class="size-3.5 animate-spin" />
          <Upload v-else class="size-3.5" />
          {{ importing ? t('dataImport.importing') : t('dataImport.import') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
