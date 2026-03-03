<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Table2, Plus, X, Loader2, Code, Play, Key, Hash, ChevronDown } from 'lucide-vue-next'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { useToast } from '@/composables/useToast'
import { generateCreateTableSql, generateAlterTableSql, executeDdl, getTableDetail } from '@/api/table-editor'
import type { ColumnDefinition, IndexDefinition, TableDefinition, TableAlteration, ColumnChange, IndexChange, TableDetail } from '@/types/table-editor'

const props = defineProps<{
  connectionId: string
  database: string
  driver: string
  table?: string
}>()

const emit = defineEmits<{
  success: []
  'update:open': [value: boolean]
}>()

const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
const toast = useToast()

const isAlterMode = computed(() => !!props.table)
const activeTab = ref('columns')
const loading = ref(false)
const executing = ref(false)
const generatedSql = ref('')
const showSqlPreview = ref(false)

// Table metadata
const tableName = ref('')
const tableEngine = ref('InnoDB')
const tableCharset = ref('utf8mb4')
const tableCollation = ref('utf8mb4_unicode_ci')
const tableComment = ref('')

// Columns
const columns = ref<ColumnDefinition[]>([])
const originalColumns = ref<ColumnDefinition[]>([])

// Indexes
const indexes = ref<IndexDefinition[]>([])
const originalIndexes = ref<IndexDefinition[]>([])

const isMysql = computed(() => props.driver === 'mysql' || props.driver === 'mariadb')

const COMMON_TYPES = [
  'INT', 'BIGINT', 'SMALLINT', 'TINYINT',
  'VARCHAR(255)', 'VARCHAR(100)', 'TEXT', 'LONGTEXT',
  'DECIMAL(10,2)', 'FLOAT', 'DOUBLE',
  'DATETIME', 'DATE', 'TIMESTAMP', 'TIME',
  'BOOLEAN', 'JSON', 'BLOB',
]

const INDEX_TYPES = ['INDEX', 'UNIQUE', 'PRIMARY', 'FULLTEXT']

function newColumn(): ColumnDefinition {
  return { name: '', dataType: 'VARCHAR(255)', length: null, nullable: true, isPrimaryKey: false, defaultValue: null, autoIncrement: false, onUpdate: null, comment: null }
}

function newIndex(): IndexDefinition {
  return { name: '', columns: [], indexType: 'INDEX' }
}

function addColumn() {
  columns.value = [...columns.value, newColumn()]
}

function removeColumn(idx: number) {
  columns.value = columns.value.filter((_, i) => i !== idx)
}

function addIndex() {
  indexes.value = [...indexes.value, newIndex()]
}

function removeIndex(idx: number) {
  indexes.value = indexes.value.filter((_, i) => i !== idx)
}

function setColumnType(idx: number, type: string) {
  columns.value = columns.value.map((col, i) => i === idx ? { ...col, dataType: type } : col)
}

function updateColumn(idx: number, field: keyof ColumnDefinition, value: unknown) {
  columns.value = columns.value.map((col, i) => i === idx ? { ...col, [field]: value } : col)
}

function updateIndex(idx: number, field: keyof IndexDefinition, value: unknown) {
  indexes.value = indexes.value.map((ix, i) => i === idx ? { ...ix, [field]: value } : ix)
}

function updateIndexColumns(idx: number, value: string) {
  const cols = value.split(',').map(s => s.trim()).filter(Boolean)
  updateIndex(idx, 'columns', cols)
}

async function loadTableDetail() {
  if (!isAlterMode.value || !props.table) return
  loading.value = true
  try {
    const detail: TableDetail = await getTableDetail(props.connectionId, props.database, props.table)
    tableName.value = detail.name
    tableEngine.value = detail.engine ?? 'InnoDB'
    tableCharset.value = detail.charset ?? 'utf8mb4'
    tableCollation.value = detail.collation ?? 'utf8mb4_unicode_ci'
    tableComment.value = detail.comment ?? ''
    columns.value = detail.columns.map(c => ({ ...c }))
    originalColumns.value = detail.columns.map(c => ({ ...c }))
    indexes.value = detail.indexes.map(i => ({ ...i }))
    originalIndexes.value = detail.indexes.map(i => ({ ...i }))
  } catch (e) {
    toast.error(String(e))
  } finally {
    loading.value = false
  }
}

function buildTableDefinition(): TableDefinition {
  return {
    name: tableName.value,
    database: props.database,
    columns: columns.value,
    indexes: indexes.value,
    foreignKeys: [],
    engine: isMysql.value ? tableEngine.value : null,
    charset: isMysql.value ? tableCharset.value : null,
    collation: isMysql.value ? tableCollation.value : null,
    comment: tableComment.value || null,
  }
}

function buildTableAlteration(): TableAlteration {
  const columnChanges: ColumnChange[] = []

  // Detect added/modified columns
  for (const col of columns.value) {
    const orig = originalColumns.value.find(c => c.name === col.name)
    if (!orig) {
      columnChanges.push({ changeType: 'add', column: col, oldName: null, afterColumn: null })
    } else if (JSON.stringify(orig) !== JSON.stringify(col)) {
      columnChanges.push({ changeType: 'modify', column: col, oldName: col.name, afterColumn: null })
    }
  }

  // Detect dropped columns
  for (const orig of originalColumns.value) {
    if (!columns.value.find(c => c.name === orig.name)) {
      columnChanges.push({ changeType: 'drop', column: orig, oldName: orig.name, afterColumn: null })
    }
  }

  const indexChanges: IndexChange[] = []

  // Detect added indexes
  for (const ix of indexes.value) {
    if (!originalIndexes.value.find(i => i.name === ix.name)) {
      indexChanges.push({ changeType: 'add', index: ix })
    }
  }

  // Detect dropped indexes
  for (const orig of originalIndexes.value) {
    if (!indexes.value.find(i => i.name === orig.name)) {
      indexChanges.push({ changeType: 'drop', index: orig })
    }
  }

  return {
    database: props.database,
    table: props.table!,
    columnChanges,
    indexChanges,
    newName: tableName.value !== props.table ? tableName.value : null,
    newComment: tableComment.value || null,
    newEngine: isMysql.value ? tableEngine.value : null,
    newCharset: isMysql.value ? tableCharset.value : null,
  }
}

async function previewSql() {
  if (columns.value.length === 0) {
    toast.warning(t('tableEditor.noColumns'))
    return
  }
  loading.value = true
  try {
    const result = isAlterMode.value
      ? await generateAlterTableSql(buildTableAlteration(), props.driver)
      : await generateCreateTableSql(buildTableDefinition(), props.driver)
    generatedSql.value = result.sql
    showSqlPreview.value = true
  } catch (e) {
    toast.error(String(e))
  } finally {
    loading.value = false
  }
}

async function executeSql() {
  if (!generatedSql.value) {
    await previewSql()
    if (!generatedSql.value) return
  }
  executing.value = true
  try {
    await executeDdl(props.connectionId, generatedSql.value)
    toast.success(isAlterMode.value ? t('tableEditor.alterTable') : t('tableEditor.createTable'))
    open.value = false
    emit('success')
  } catch (e) {
    toast.error(String(e))
  } finally {
    executing.value = false
  }
}

watch(open, (val) => {
  if (val) {
    activeTab.value = 'columns'
    generatedSql.value = ''
    showSqlPreview.value = false
    if (isAlterMode.value) {
      loadTableDetail()
    } else {
      tableName.value = ''
      tableEngine.value = 'InnoDB'
      tableCharset.value = 'utf8mb4'
      tableCollation.value = 'utf8mb4_unicode_ci'
      tableComment.value = ''
      columns.value = [newColumn()]
      indexes.value = []
      originalColumns.value = []
      originalIndexes.value = []
    }
  }
})
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-w-6xl max-h-[90vh] flex flex-col gap-0 p-0">
      <DialogHeader class="px-6 pt-5 pb-4 shrink-0">
        <DialogTitle class="flex items-center gap-2 text-base">
          <Table2 class="size-4 text-muted-foreground" />
          <span v-if="isAlterMode">{{ t('tableEditor.alterTable') }}: {{ props.table }}</span>
          <span v-else>{{ t('tableEditor.createTable') }}</span>
        </DialogTitle>
        <DialogDescription class="sr-only">{{ t('tableEditor.title') }}</DialogDescription>
      </DialogHeader>

      <Separator />

      <!-- Table name + database row -->
      <div class="px-6 py-3 flex items-center gap-4 shrink-0 bg-muted/30">
        <div class="flex items-center gap-2 flex-1">
          <Label class="text-xs text-muted-foreground whitespace-nowrap">{{ t('tableEditor.tableName') }}</Label>
          <Input
            v-model="tableName"
            class="h-7 text-sm"
            :placeholder="t('tableEditor.tableName')"
          />
        </div>
        <div class="flex items-center gap-2">
          <Label class="text-xs text-muted-foreground whitespace-nowrap">{{ t('tableEditor.database') }}</Label>
          <span class="text-sm font-mono px-2 py-0.5 rounded bg-muted text-muted-foreground">{{ props.database }}</span>
        </div>
      </div>

      <Separator />

      <!-- Tabs -->
      <Tabs v-model="activeTab" class="flex flex-col flex-1 min-h-0">
        <TabsList class="mx-6 mt-3 mb-0 w-fit shrink-0">
          <TabsTrigger value="columns" class="gap-1.5 text-xs">
            <Hash class="size-3" />{{ t('tableEditor.columns') }}
          </TabsTrigger>
          <TabsTrigger value="indexes" class="gap-1.5 text-xs">
            <Key class="size-3" />{{ t('tableEditor.indexes') }}
          </TabsTrigger>
          <TabsTrigger value="options" class="gap-1.5 text-xs">
            <Table2 class="size-3" />{{ t('tableEditor.options') }}
          </TabsTrigger>
        </TabsList>

        <!-- Columns Tab -->
        <TabsContent value="columns" class="flex-1 min-h-0 mt-0 flex flex-col">
          <div v-if="loading" class="flex items-center justify-center h-32 text-muted-foreground">
            <Loader2 class="size-5 animate-spin" />
          </div>
          <template v-else>
            <div class="flex-1 min-h-0 overflow-auto border-y border-border">
              <table class="w-full border-collapse text-xs">
                <thead class="sticky top-0 z-10 bg-muted">
                  <tr class="text-left text-muted-foreground font-medium">
                    <th class="border-b border-r border-border px-2 py-1.5 w-8 text-center">#</th>
                    <th class="border-b border-r border-border px-2 py-1.5 min-w-[160px]">{{ t('tableEditor.columnName') }}</th>
                    <th class="border-b border-r border-border px-2 py-1.5 min-w-[180px]">{{ t('tableEditor.dataType') }}</th>
                    <th class="border-b border-r border-border px-2 py-1.5 w-16 text-center">{{ t('tableEditor.nullable') }}</th>
                    <th class="border-b border-r border-border px-2 py-1.5 min-w-[120px]">{{ t('tableEditor.defaultValue') }}</th>
                    <th class="border-b border-r border-border px-2 py-1.5 w-16 text-center">AI</th>
                    <th class="border-b border-r border-border px-2 py-1.5 min-w-[140px]">{{ t('tableEditor.comment') }}</th>
                    <th class="border-b border-border px-2 py-1.5 w-8" />
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="columns.length === 0">
                    <td colspan="8" class="text-center text-muted-foreground py-8">{{ t('tableEditor.noColumns') }}</td>
                  </tr>
                  <tr
                    v-for="(col, idx) in columns"
                    :key="idx"
                    class="group hover:bg-muted/40 transition-colors"
                  >
                    <td class="border-b border-r border-border px-2 py-0.5 text-center text-muted-foreground/60 tabular-nums">{{ idx + 1 }}</td>
                    <td class="border-b border-r border-border p-0.5">
                      <input
                        :value="col.name"
                        class="w-full h-7 px-2 text-xs font-mono bg-transparent border border-transparent rounded focus:border-ring focus:outline-none hover:border-border"
                        placeholder="column_name"
                        @input="updateColumn(idx, 'name', ($event.target as HTMLInputElement).value)"
                      />
                    </td>
                    <td class="border-b border-r border-border p-0.5">
                      <div class="flex">
                        <input
                          :value="col.dataType"
                          class="flex-1 min-w-0 h-7 px-2 text-xs font-mono bg-transparent border border-transparent rounded-l focus:border-ring focus:outline-none hover:border-border"
                          placeholder="VARCHAR(255)"
                          @input="setColumnType(idx, ($event.target as HTMLInputElement).value)"
                        />
                        <DropdownMenu>
                          <DropdownMenuTrigger as-child>
                            <button class="h-7 w-6 shrink-0 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded-r border border-transparent hover:border-border">
                              <ChevronDown class="size-3" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" class="max-h-48 overflow-auto">
                            <DropdownMenuItem v-for="type in COMMON_TYPES" :key="type" class="text-xs font-mono" @click="setColumnType(idx, type)">{{ type }}</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                    <td class="border-b border-r border-border px-2 py-0.5 text-center">
                      <input type="checkbox" :checked="col.nullable" class="accent-primary size-3.5 cursor-pointer" @change="updateColumn(idx, 'nullable', ($event.target as HTMLInputElement).checked)" />
                    </td>
                    <td class="border-b border-r border-border p-0.5">
                      <input
                        :value="col.defaultValue ?? ''"
                        class="w-full h-7 px-2 text-xs font-mono bg-transparent border border-transparent rounded focus:border-ring focus:outline-none hover:border-border"
                        placeholder="NULL"
                        @input="updateColumn(idx, 'defaultValue', ($event.target as HTMLInputElement).value || null)"
                      />
                    </td>
                    <td class="border-b border-r border-border px-2 py-0.5 text-center">
                      <input type="checkbox" :checked="col.autoIncrement" class="accent-primary size-3.5 cursor-pointer" @change="updateColumn(idx, 'autoIncrement', ($event.target as HTMLInputElement).checked)" />
                    </td>
                    <td class="border-b border-r border-border p-0.5">
                      <input
                        :value="col.comment ?? ''"
                        class="w-full h-7 px-2 text-xs bg-transparent border border-transparent rounded focus:border-ring focus:outline-none hover:border-border"
                        placeholder="..."
                        @input="updateColumn(idx, 'comment', ($event.target as HTMLInputElement).value || null)"
                      />
                    </td>
                    <td class="border-b border-border px-0.5 py-0.5 text-center">
                      <button class="size-6 inline-flex items-center justify-center rounded opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all" @click="removeColumn(idx)">
                        <X class="size-3.5" />
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="shrink-0 px-4 py-2">
              <Button variant="outline" size="sm" class="h-7 text-xs gap-1.5" @click="addColumn">
                <Plus class="size-3.5" />{{ t('tableEditor.addColumn') }}
              </Button>
            </div>
          </template>
        </TabsContent>

        <!-- Indexes Tab -->
        <TabsContent value="indexes" class="flex-1 min-h-0 mt-0 flex flex-col">
          <div class="flex-1 min-h-0 overflow-auto border-y border-border">
            <table class="w-full border-collapse text-xs">
              <thead class="sticky top-0 z-10 bg-muted">
                <tr class="text-left text-muted-foreground font-medium">
                  <th class="border-b border-r border-border px-2 py-1.5 w-8 text-center">#</th>
                  <th class="border-b border-r border-border px-2 py-1.5 min-w-[180px]">{{ t('tableEditor.indexName') }}</th>
                  <th class="border-b border-r border-border px-2 py-1.5 w-[140px]">{{ t('tableEditor.indexType') }}</th>
                  <th class="border-b border-r border-border px-2 py-1.5 min-w-[200px]">{{ t('tableEditor.indexColumns') }}</th>
                  <th class="border-b border-border px-2 py-1.5 w-8" />
                </tr>
              </thead>
              <tbody>
                <tr v-if="indexes.length === 0">
                  <td colspan="5" class="text-center text-muted-foreground py-8">—</td>
                </tr>
                <tr
                  v-for="(ix, idx) in indexes"
                  :key="idx"
                  class="group hover:bg-muted/40 transition-colors"
                >
                  <td class="border-b border-r border-border px-2 py-0.5 text-center text-muted-foreground/60 tabular-nums">{{ idx + 1 }}</td>
                  <td class="border-b border-r border-border p-0.5">
                    <input
                      :value="ix.name"
                      class="w-full h-7 px-2 text-xs font-mono bg-transparent border border-transparent rounded focus:border-ring focus:outline-none hover:border-border"
                      placeholder="idx_name"
                      @input="updateIndex(idx, 'name', ($event.target as HTMLInputElement).value)"
                    />
                  </td>
                  <td class="border-b border-r border-border p-0.5">
                    <Select :model-value="ix.indexType" @update:model-value="(v) => updateIndex(idx, 'indexType', v)">
                      <SelectTrigger class="h-7 text-xs border-transparent hover:border-border">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem v-for="type in INDEX_TYPES" :key="type" :value="type" class="text-xs">{{ type }}</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  <td class="border-b border-r border-border p-0.5">
                    <input
                      :value="ix.columns.join(', ')"
                      class="w-full h-7 px-2 text-xs font-mono bg-transparent border border-transparent rounded focus:border-ring focus:outline-none hover:border-border"
                      placeholder="col1, col2"
                      @input="updateIndexColumns(idx, ($event.target as HTMLInputElement).value)"
                    />
                  </td>
                  <td class="border-b border-border px-0.5 py-0.5 text-center">
                    <button class="size-6 inline-flex items-center justify-center rounded opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all" @click="removeIndex(idx)">
                      <X class="size-3.5" />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="shrink-0 px-4 py-2">
            <Button variant="outline" size="sm" class="h-7 text-xs gap-1.5" @click="addIndex">
              <Plus class="size-3.5" />{{ t('tableEditor.addIndex') }}
            </Button>
          </div>
        </TabsContent>

        <!-- Options Tab -->
        <TabsContent value="options" class="flex-1 min-h-0 mt-0 overflow-auto px-6 pb-2">
          <div class="space-y-4 py-2 max-w-sm">
              <div v-if="isMysql" class="space-y-1.5">
                <Label class="text-xs">{{ t('tableEditor.engine') }}</Label>
                <Select v-model="tableEngine">
                  <SelectTrigger class="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="InnoDB">InnoDB</SelectItem>
                    <SelectItem value="MyISAM">MyISAM</SelectItem>
                    <SelectItem value="MEMORY">MEMORY</SelectItem>
                    <SelectItem value="ARCHIVE">ARCHIVE</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div v-if="isMysql" class="space-y-1.5">
                <Label class="text-xs">{{ t('tableEditor.charset') }}</Label>
                <Input v-model="tableCharset" class="h-8 text-sm font-mono" placeholder="utf8mb4" />
              </div>
              <div v-if="isMysql" class="space-y-1.5">
                <Label class="text-xs">{{ t('tableEditor.collation') }}</Label>
                <Input v-model="tableCollation" class="h-8 text-sm font-mono" placeholder="utf8mb4_unicode_ci" />
              </div>
              <div class="space-y-1.5">
                <Label class="text-xs">{{ t('tableEditor.tableComment') }}</Label>
                <textarea
                  v-model="tableComment"
                  rows="3"
                  class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
                  :placeholder="t('tableEditor.tableComment')"
                />
              </div>
            </div>
        </TabsContent>
      </Tabs>

      <!-- SQL Preview -->
      <div v-if="showSqlPreview && generatedSql" class="mx-6 mb-3 shrink-0">
        <Separator class="mb-3" />
        <div class="flex items-center gap-2 mb-1.5">
          <Code class="size-3.5 text-muted-foreground" />
          <span class="text-xs font-medium text-muted-foreground">{{ t('tableEditor.sqlPreview') }}</span>
        </div>
        <div class="h-28 rounded-md border bg-muted/50 overflow-auto">
          <pre class="p-3 text-xs font-mono text-foreground whitespace-pre-wrap break-all">{{ generatedSql }}</pre>
        </div>
      </div>

      <Separator class="shrink-0" />

      <DialogFooter class="px-6 py-3 shrink-0">
        <Button variant="outline" size="sm" :disabled="loading || executing" @click="open = false">
          {{ t('common.cancel') }}
        </Button>
        <Button variant="outline" size="sm" :disabled="loading || executing" @click="previewSql">
          <Loader2 v-if="loading" class="size-3.5 animate-spin" />
          <Code v-else class="size-3.5" />
          {{ t('tableEditor.previewSql') }}
        </Button>
        <Button size="sm" :disabled="loading || executing" @click="executeSql">
          <Loader2 v-if="executing" class="size-3.5 animate-spin" />
          <Play v-else class="size-3.5" />
          {{ t('tableEditor.executeSql') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
