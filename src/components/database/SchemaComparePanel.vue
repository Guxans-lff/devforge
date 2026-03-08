<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ArrowLeftRight,
  Loader2,
  Plus,
  Minus,
  PenLine,
  ChevronRight,
  Copy,
  Check,
} from 'lucide-vue-next'
import { useConnectionStore } from '@/stores/connections'
import * as dbApi from '@/api/database'
import * as schemaCompareApi from '@/api/schema-compare'
import type { SchemaDiff } from '@/types/schema-compare'

const props = defineProps<{
  connectionId: string
  isConnected: boolean
}>()

const { t } = useI18n()
const connectionStore = useConnectionStore()

// 源和目标选择
const sourceConnectionId = ref(props.connectionId)
const sourceDatabase = ref('')
const targetConnectionId = ref('')
const targetDatabase = ref('')

// 数据库列表
const sourceDatabases = ref<string[]>([])
const targetDatabases = ref<string[]>([])
const loadingSourceDbs = ref(false)
const loadingTargetDbs = ref(false)

// 对比结果
const diffResult = ref<SchemaDiff | null>(null)
const isComparing = ref(false)
const compareError = ref<string | null>(null)

// 迁移 SQL
const migrationSql = ref('')
const isGenerating = ref(false)
const copied = ref(false)

// 展开的表
const expandedTables = ref(new Set<string>())

// 可用的数据库连接（仅数据库类型）
const availableConnections = computed(() =>
  connectionStore.connectionList.filter((c) => c.record.type === 'database'),
)

function getDriver(connectionId: string): string {
  const state = connectionStore.connections.get(connectionId)
  if (!state) return 'mysql'
  try {
    const config = JSON.parse(state.record.configJson)
    return (config.driver as string) ?? 'mysql'
  } catch {
    return 'mysql'
  }
}

async function loadDatabases(connectionId: string, target: 'source' | 'target') {
  if (!connectionId) return

  const loading = target === 'source' ? loadingSourceDbs : loadingTargetDbs
  const databases = target === 'source' ? sourceDatabases : targetDatabases

  loading.value = true
  try {
    // 连接时一并获取数据库列表（预加载），减少一次 IPC 往返
    const result = await dbApi.dbConnect(connectionId)
    if (result.databases.length > 0) {
      databases.value = result.databases.map((d) => d.name)
    } else {
      // 预加载为空时回退到手动获取
      const dbs = await dbApi.dbGetDatabases(connectionId)
      databases.value = dbs.map((d) => d.name)
    }
  } catch (e) {
    databases.value = []
  } finally {
    loading.value = false
  }
}

async function handleSourceConnectionChange(val: string) {
  sourceConnectionId.value = val
  sourceDatabase.value = ''
  diffResult.value = null
  migrationSql.value = ''
  await loadDatabases(val, 'source')
}

async function handleTargetConnectionChange(val: string) {
  targetConnectionId.value = val
  targetDatabase.value = ''
  diffResult.value = null
  migrationSql.value = ''
  await loadDatabases(val, 'target')
}

function handleSourceDbChange(val: string) {
  sourceDatabase.value = val
  diffResult.value = null
  migrationSql.value = ''
}

function handleTargetDbChange(val: string) {
  targetDatabase.value = val
  diffResult.value = null
  migrationSql.value = ''
}

// 交换源和目标
function swapSourceTarget() {
  const tmpConnId = sourceConnectionId.value
  const tmpDb = sourceDatabase.value
  const tmpDbs = sourceDatabases.value

  sourceConnectionId.value = targetConnectionId.value
  sourceDatabase.value = targetDatabase.value
  sourceDatabases.value = targetDatabases.value

  targetConnectionId.value = tmpConnId
  targetDatabase.value = tmpDb
  targetDatabases.value = tmpDbs

  diffResult.value = null
  migrationSql.value = ''
}

const canCompare = computed(
  () =>
    sourceConnectionId.value &&
    sourceDatabase.value &&
    targetConnectionId.value &&
    targetDatabase.value &&
    !isComparing.value,
)

async function handleCompare() {
  if (!canCompare.value) return

  isComparing.value = true
  compareError.value = null
  diffResult.value = null
  migrationSql.value = ''
  expandedTables.value = new Set()

  try {
    const result = await schemaCompareApi.schemaCompare(
      sourceConnectionId.value,
      sourceDatabase.value,
      targetConnectionId.value,
      targetDatabase.value,
    )
    diffResult.value = result
  } catch (e) {
    compareError.value = String(e)
  } finally {
    isComparing.value = false
  }
}

async function handleGenerateSql() {
  const diff = filteredDiff.value
  if (!diff) return

  isGenerating.value = true
  try {
    const driver = getDriver(targetConnectionId.value)
    const sql = await schemaCompareApi.generateMigrationSql(
      diff,
      driver,
      sourceConnectionId.value,
      sourceDatabase.value,
      targetDatabase.value,
    )
    migrationSql.value = sql
  } catch (e) {
    migrationSql.value = `-- Error: ${String(e)}`
  } finally {
    isGenerating.value = false
  }
}

async function handleCopySql() {
  if (!migrationSql.value) return
  try {
    await navigator.clipboard.writeText(migrationSql.value)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch {
    // 静默处理
  }
}

function toggleTable(name: string) {
  const next = new Set(expandedTables.value)
  if (next.has(name)) {
    next.delete(name)
  } else {
    next.add(name)
  }
  expandedTables.value = next
}

// 统计摘要
// 对比目的：将目标同步到源
// tablesOnlyInSource = 源端有目标端没有 → 需要在目标端新增
// tablesOnlyInTarget = 目标端有源端没有 → 目标端多余需删除
const summary = computed(() => {
  if (!diffResult.value) return null
  const { tablesOnlyInSource, tablesOnlyInTarget, tableDiffs } = diffResult.value
  return {
    added: tablesOnlyInSource.length,
    removed: tablesOnlyInTarget.length,
    modified: tableDiffs.length,
    total: tablesOnlyInSource.length + tablesOnlyInTarget.length + tableDiffs.length,
  }
})

// 过滤类型: 'all' | 'added' | 'removed' | 'modified'
type DiffFilter = 'all' | 'added' | 'removed' | 'modified'
const activeFilter = ref<DiffFilter>('all')

function toggleFilter(filter: DiffFilter) {
  activeFilter.value = activeFilter.value === filter ? 'all' : filter
  migrationSql.value = ''
}

const filteredDiff = computed(() => {
  if (!diffResult.value) return null
  const f = activeFilter.value
  return {
    // added = 源端有目标端没有 → 需新增
    tablesOnlyInSource: f === 'all' || f === 'added' ? diffResult.value.tablesOnlyInSource : [],
    // removed = 目标端有源端没有 → 需删除
    tablesOnlyInTarget: f === 'all' || f === 'removed' ? diffResult.value.tablesOnlyInTarget : [],
    tableDiffs: f === 'all' || f === 'modified' ? diffResult.value.tableDiffs : [],
  }
})

// 初始化：加载当前连接的数据库
loadDatabases(props.connectionId, 'source')
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 顶部选择区域 -->
    <div class="border-b border-border px-4 py-3">
      <div class="flex items-center gap-3">
        <!-- 源 -->
        <div class="flex flex-1 items-center gap-2">
          <span class="text-xs font-medium text-muted-foreground whitespace-nowrap">{{ t('schemaCompare.source') }}</span>
          <Select :model-value="sourceConnectionId" @update:model-value="handleSourceConnectionChange($event as string)">
            <SelectTrigger class="h-7 text-xs flex-1">
              <SelectValue :placeholder="t('schemaCompare.selectConnection')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="conn in availableConnections"
                :key="conn.record.id"
                :value="conn.record.id"
              >
                {{ conn.record.name }}
              </SelectItem>
            </SelectContent>
          </Select>
          <Select :model-value="sourceDatabase" @update:model-value="handleSourceDbChange($event as string)">
            <SelectTrigger class="h-7 text-xs flex-1" :disabled="loadingSourceDbs || sourceDatabases.length === 0">
              <SelectValue :placeholder="loadingSourceDbs ? t('common.loading') : t('schemaCompare.selectDatabase')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="db in sourceDatabases" :key="db" :value="db">
                {{ db }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <!-- 交换按钮 -->
        <Button variant="ghost" size="sm" class="h-7 w-7 p-0 shrink-0" @click="swapSourceTarget">
          <ArrowLeftRight class="h-3.5 w-3.5" />
        </Button>

        <!-- 目标 -->
        <div class="flex flex-1 items-center gap-2">
          <span class="text-xs font-medium text-muted-foreground whitespace-nowrap">{{ t('schemaCompare.target') }}</span>
          <Select :model-value="targetConnectionId" @update:model-value="handleTargetConnectionChange($event as string)">
            <SelectTrigger class="h-7 text-xs flex-1">
              <SelectValue :placeholder="t('schemaCompare.selectConnection')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="conn in availableConnections"
                :key="conn.record.id"
                :value="conn.record.id"
              >
                {{ conn.record.name }}
              </SelectItem>
            </SelectContent>
          </Select>
          <Select :model-value="targetDatabase" @update:model-value="handleTargetDbChange($event as string)">
            <SelectTrigger class="h-7 text-xs flex-1" :disabled="loadingTargetDbs || targetDatabases.length === 0">
              <SelectValue :placeholder="loadingTargetDbs ? t('common.loading') : t('schemaCompare.selectDatabase')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="db in targetDatabases" :key="db" :value="db">
                {{ db }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <!-- 对比按钮 -->
        <Button
          size="sm"
          class="h-7 gap-1 text-xs shrink-0"
          :disabled="!canCompare"
          @click="handleCompare"
        >
          <Loader2 v-if="isComparing" class="h-3 w-3 animate-spin" />
          {{ t('schemaCompare.compare') }}
        </Button>
      </div>
    </div>

    <!-- 结果区域 -->
    <div class="flex-1 min-h-0 flex flex-col">
      <!-- 错误 -->
      <div v-if="compareError" class="p-4 text-sm text-destructive">
        {{ compareError }}
      </div>

      <!-- 对比中 -->
      <div v-else-if="isComparing" class="flex-1 flex items-center justify-center text-sm text-muted-foreground gap-2">
        <Loader2 class="h-4 w-4 animate-spin" />
        {{ t('schemaCompare.comparing') }}
      </div>

      <!-- 无结果提示 -->
      <div v-else-if="!diffResult" class="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        {{ t('schemaCompare.hint') }}
      </div>

      <!-- 无差异 -->
      <div v-else-if="summary && summary.total === 0" class="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        {{ t('schemaCompare.noDifferences') }}
      </div>

      <!-- 差异列表 -->
      <template v-else-if="diffResult && summary">
        <!-- 摘要栏 -->
        <div class="flex items-center gap-2 border-b border-border px-4 py-2">
          <span class="text-xs text-muted-foreground">{{ t('schemaCompare.summary') }}:</span>
          <button
            v-if="summary.added > 0"
            class="inline-flex items-center gap-1 rounded-md px-1.5 h-5 text-[10px] font-medium transition-colors"
            :class="activeFilter === 'added'
              ? 'bg-emerald-600 text-white ring-1 ring-emerald-400'
              : 'bg-emerald-600/20 text-emerald-600 hover:bg-emerald-600/30'"
            @click="toggleFilter('added')"
          >
            <Plus class="h-2.5 w-2.5" />
            {{ summary.added }} {{ t('schemaCompare.added') }}
          </button>
          <button
            v-if="summary.removed > 0"
            class="inline-flex items-center gap-1 rounded-md px-1.5 h-5 text-[10px] font-medium transition-colors"
            :class="activeFilter === 'removed'
              ? 'bg-destructive text-destructive-foreground ring-1 ring-destructive/60'
              : 'bg-destructive/20 text-destructive hover:bg-destructive/30'"
            @click="toggleFilter('removed')"
          >
            <Minus class="h-2.5 w-2.5" />
            {{ summary.removed }} {{ t('schemaCompare.removed') }}
          </button>
          <button
            v-if="summary.modified > 0"
            class="inline-flex items-center gap-1 rounded-md px-1.5 h-5 text-[10px] font-medium transition-colors"
            :class="activeFilter === 'modified'
              ? 'bg-amber-500 text-white ring-1 ring-amber-400'
              : 'bg-amber-500/20 text-amber-600 hover:bg-amber-500/30'"
            @click="toggleFilter('modified')"
          >
            <PenLine class="h-2.5 w-2.5" />
            {{ summary.modified }} {{ t('schemaCompare.modified') }}
          </button>
          <div class="flex-1" />
          <Button
            variant="outline"
            size="sm"
            class="h-6 gap-1 text-[11px]"
            :disabled="isGenerating"
            @click="handleGenerateSql"
          >
            <Loader2 v-if="isGenerating" class="h-3 w-3 animate-spin" />
            {{ t('schemaCompare.generateSql') }}
          </Button>
        </div>

        <!-- Diff 列表 + SQL 预览 -->
        <div class="flex-1 min-h-0 flex">
          <!-- 左侧：差异列表 -->
          <ScrollArea class="flex-1 min-h-0 border-r border-border">
            <div class="p-2">
              <!-- 仅在源端的表（目标端需新增） -->
              <div v-for="table in filteredDiff?.tablesOnlyInSource" :key="`add-${table}`" class="flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-muted/50">
                <Plus class="h-3 w-3 text-emerald-500 shrink-0" />
                <span class="font-mono">{{ table }}</span>
                <Badge variant="default" class="ml-auto bg-emerald-600 text-[10px] h-4">{{ t('schemaCompare.onlyInSource') }}</Badge>
              </div>

              <!-- 仅在目标端的表（目标端多余） -->
              <div v-for="table in filteredDiff?.tablesOnlyInTarget" :key="`rm-${table}`" class="flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-muted/50">
                <Minus class="h-3 w-3 text-destructive shrink-0" />
                <span class="font-mono">{{ table }}</span>
                <Badge variant="destructive" class="ml-auto text-[10px] h-4">{{ t('schemaCompare.onlyInTarget') }}</Badge>
              </div>

              <!-- 有差异的表 -->
              <div v-for="td in filteredDiff?.tableDiffs" :key="`diff-${td.tableName}`">
                <button
                  class="flex w-full items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-muted/50"
                  @click="toggleTable(td.tableName)"
                >
                  <ChevronRight
                    class="h-3 w-3 shrink-0 transition-transform"
                    :class="{ 'rotate-90': expandedTables.has(td.tableName) }"
                  />
                  <PenLine class="h-3 w-3 text-amber-500 shrink-0" />
                  <span class="font-mono">{{ td.tableName }}</span>
                  <span class="ml-auto text-[10px] text-muted-foreground">
                    {{ td.columnsAdded.length + td.columnsRemoved.length + td.columnsModified.length }} {{ t('schemaCompare.changes') }}
                  </span>
                </button>

                <!-- 展开详情 -->
                <div v-if="expandedTables.has(td.tableName)" class="ml-6 mb-1 border-l border-border pl-3">
                  <!-- 新增列 -->
                  <div v-for="col in td.columnsAdded" :key="`col-add-${col.name}`" class="flex items-center gap-2 py-1 text-[11px]">
                    <Plus class="h-2.5 w-2.5 text-emerald-500 shrink-0" />
                    <span class="font-mono text-emerald-600">{{ col.name }}</span>
                    <span class="text-muted-foreground">{{ col.dataType }}</span>
                  </div>
                  <!-- 删除列 -->
                  <div v-for="col in td.columnsRemoved" :key="`col-rm-${col.name}`" class="flex items-center gap-2 py-1 text-[11px]">
                    <Minus class="h-2.5 w-2.5 text-destructive shrink-0" />
                    <span class="font-mono text-destructive line-through">{{ col.name }}</span>
                    <span class="text-muted-foreground">{{ col.dataType }}</span>
                  </div>
                  <!-- 修改列 -->
                  <div v-for="mod in td.columnsModified" :key="`col-mod-${mod.columnName}`" class="py-1 text-[11px]">
                    <div class="flex items-center gap-2">
                      <PenLine class="h-2.5 w-2.5 text-amber-500 shrink-0" />
                      <span class="font-mono text-amber-600">{{ mod.columnName }}</span>
                    </div>
                    <div v-for="(change, i) in mod.changes" :key="i" class="ml-5 text-[10px] text-muted-foreground">
                      {{ change }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </ScrollArea>

          <!-- 右侧：迁移 SQL 预览 -->
          <div v-if="migrationSql" class="flex-1 flex flex-col min-w-0 min-h-0">
            <div class="flex items-center gap-2 border-b border-border px-3 py-1.5 shrink-0">
              <span class="text-xs font-medium">{{ t('schemaCompare.migrationSql') }}</span>
              <div class="flex-1" />
              <Button variant="ghost" size="sm" class="h-5 gap-1 text-[10px]" @click="handleCopySql">
                <Check v-if="copied" class="h-3 w-3 text-emerald-500" />
                <Copy v-else class="h-3 w-3" />
                {{ copied ? t('common.copied') : t('common.copy') }}
              </Button>
            </div>
            <ScrollArea class="flex-1 min-h-0">
              <pre class="p-3 text-[11px] font-mono whitespace-pre-wrap break-all text-foreground">{{ migrationSql }}</pre>
            </ScrollArea>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
