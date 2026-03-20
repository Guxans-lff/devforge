<script setup lang="ts">
import { ref, computed, watch } from 'vue'
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
import { Checkbox } from '@/components/ui/checkbox'
import Progress from '@/components/ui/progress.vue'
import {
  ArrowRight,
  Loader2,
  Eye,
  Play,
  Save,
  Database,
  Table2,
  CheckCheck,
  AlertCircle,
  ArrowLeftRight,
  RefreshCcw,
} from 'lucide-vue-next'
import { useConnectionStore } from '@/stores/connections'
import { useDataSync } from '@/composables/useDataSync'
import { useNotification } from '@/composables/useNotification'
import * as dbApi from '@/api/database'
import type { SyncConfig } from '@/types/data-sync'

const props = defineProps<{
  /** 当前连接 ID（用于预填源连接） */
  connectionId: string
  /** 连接是否可用 */
  isConnected: boolean
}>()

const emit = defineEmits<{
  /** 保存为定时任务 */
  saveAsScheduledTask: [config: SyncConfig]
}>()

const { t } = useI18n()
const connectionStore = useConnectionStore()
const notification = useNotification()
const {
  previewing,
  preview,
  previewError,
  syncing,
  progress,
  syncResult,
  syncError,
  previewSync,
  executeSync,
  reset,
} = useDataSync()

// ===== 源和目标选择 =====
const sourceConnectionId = ref(props.connectionId)
const sourceDatabase = ref('')
const targetConnectionId = ref('')
const targetDatabase = ref('')

// 数据库列表
const sourceDatabases = ref<string[]>([])
const targetDatabases = ref<string[]>([])
const loadingSourceDbs = ref(false)
const loadingTargetDbs = ref(false)

// 表列表
const availableTables = ref<string[]>([])
const selectedTables = ref<Set<string>>(new Set())
const loadingTables = ref(false)

// 同步选项
const syncMode = ref<'full' | 'upsert'>('full')
const pageSize = ref(5000)

// 可用的数据库连接（仅数据库类型）
const availableConnections = computed(() =>
  connectionStore.connectionList.filter((c) => c.record.type === 'database'),
)

/** 构建同步配置 */
const syncConfig = computed<SyncConfig | null>(() => {
  if (
    !sourceConnectionId.value ||
    !sourceDatabase.value ||
    !targetConnectionId.value ||
    !targetDatabase.value ||
    selectedTables.value.size === 0
  ) {
    return null
  }
  return {
    sourceConnectionId: sourceConnectionId.value,
    sourceDatabase: sourceDatabase.value,
    targetConnectionId: targetConnectionId.value,
    targetDatabase: targetDatabase.value,
    tables: Array.from(selectedTables.value),
    syncMode: syncMode.value,
    pageSize: pageSize.value,
  }
})

/** 是否可以预览 */
const canPreview = computed(() => syncConfig.value !== null && !previewing.value && !syncing.value)

/** 是否可以执行 */
const canExecute = computed(() => syncConfig.value !== null && preview.value.length > 0 && !syncing.value)

/** 进度百分比 */
const progressPercent = computed(() => {
  const p = progress.value
  if (!p || p.totalRows === 0) return 0
  // 综合：表级 + 行级
  const tableProgress = p.tableIndex / p.tableCount
  const rowProgress = p.totalRows > 0 ? p.syncedRows / p.totalRows : 0
  const perTableWeight = 1 / p.tableCount
  return Math.round((tableProgress + rowProgress * perTableWeight) * 100)
})

/** 加载数据库列表 */
async function loadDatabases(connectionId: string, target: 'source' | 'target') {
  if (!connectionId) return

  const loading = target === 'source' ? loadingSourceDbs : loadingTargetDbs
  const databases = target === 'source' ? sourceDatabases : targetDatabases

  loading.value = true
  try {
    const result = await dbApi.dbConnect(connectionId)
    if (result.databases.length > 0) {
      databases.value = result.databases.map((d) => d.name)
    } else {
      const dbs = await dbApi.dbGetDatabases(connectionId)
      databases.value = dbs.map((d) => d.name)
    }
  } catch {
    databases.value = []
  } finally {
    loading.value = false
  }
}

/** 加载源数据库的表列表 */
async function loadTables() {
  if (!sourceConnectionId.value || !sourceDatabase.value) {
    availableTables.value = []
    return
  }

  loadingTables.value = true
  try {
    const tables = await dbApi.dbGetTables(sourceConnectionId.value, sourceDatabase.value)
    availableTables.value = tables.map((t) => t.name)
    // 默认全选
    selectedTables.value = new Set(availableTables.value)
  } catch {
    availableTables.value = []
  } finally {
    loadingTables.value = false
  }
}

// 源连接变更时加载数据库列表
async function handleSourceConnectionChange(val: string | number | bigint | Record<string, unknown> | null) {
  const strVal = String(val ?? '')
  sourceConnectionId.value = strVal
  sourceDatabase.value = ''
  availableTables.value = []
  selectedTables.value = new Set()
  reset()
  await loadDatabases(strVal, 'source')
}

// 目标连接变更时加载数据库列表
async function handleTargetConnectionChange(val: string | number | bigint | Record<string, unknown> | null) {
  const strVal = String(val ?? '')
  targetConnectionId.value = strVal
  targetDatabase.value = ''
  reset()
  await loadDatabases(strVal, 'target')
}

// 源数据库变更时加载表列表
watch(() => sourceDatabase.value, () => {
  if (sourceDatabase.value) {
    reset()
    loadTables()
  }
})

/** 全选/取消全选表 */
function toggleAllTables() {
  if (selectedTables.value.size === availableTables.value.length) {
    selectedTables.value = new Set()
  } else {
    selectedTables.value = new Set(availableTables.value)
  }
}

/** 切换单张表选中状态 */
function toggleTable(table: string) {
  const next = new Set(selectedTables.value)
  if (next.has(table)) {
    next.delete(table)
  } else {
    next.add(table)
  }
  selectedTables.value = next
}

/** 执行预览 */
async function handlePreview() {
  if (!syncConfig.value) return
  try {
    await previewSync(syncConfig.value)
  } catch (e: unknown) {
    notification.error(t('dataSync.previewFailed'), e instanceof Error ? e.message : String(e), true)
  }
}

/** 执行同步 */
async function handleExecute() {
  if (!syncConfig.value) return
  try {
    const result = await executeSync(syncConfig.value)
    notification.success(t('dataSync.syncSuccess'), result, 5000)
  } catch (e: unknown) {
    notification.error(t('dataSync.syncFailed'), e instanceof Error ? e.message : String(e), true)
  }
}

/** 保存为定时任务 */
function handleSaveAsTask() {
  if (!syncConfig.value) return
  emit('saveAsScheduledTask', syncConfig.value)
}

// 初始化：预填源连接
loadDatabases(props.connectionId, 'source')
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 标题栏 -->
    <div class="flex items-center gap-2 border-b border-border/30 px-4 py-2">
      <ArrowLeftRight class="h-4 w-4 text-primary" />
      <span class="text-sm font-medium">{{ t('dataSync.title') }}</span>
    </div>

    <ScrollArea class="flex-1">
      <div class="p-4 space-y-5 max-w-4xl">
        <!-- 源和目标配置区域 -->
        <div class="grid grid-cols-2 gap-6">
          <!-- 源 -->
          <div class="space-y-3">
            <div class="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              <Database class="h-3.5 w-3.5 text-emerald-500" />
              {{ t('dataSync.source') }}
            </div>

            <!-- 源连接选择 -->
            <Select :model-value="sourceConnectionId" @update:model-value="handleSourceConnectionChange">
              <SelectTrigger class="h-8 text-xs">
                <SelectValue :placeholder="t('dataSync.selectConnection')" />
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

            <!-- 源数据库选择 -->
            <Select v-model="sourceDatabase">
              <SelectTrigger class="h-8 text-xs" :disabled="sourceDatabases.length === 0">
                <Loader2 v-if="loadingSourceDbs" class="h-3 w-3 animate-spin mr-1" />
                <SelectValue :placeholder="t('dataSync.selectDatabase')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="db in sourceDatabases" :key="db" :value="db">
                  {{ db }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <!-- 目标 -->
          <div class="space-y-3">
            <div class="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              <Database class="h-3.5 w-3.5 text-sky-500" />
              {{ t('dataSync.target') }}
            </div>

            <!-- 目标连接选择 -->
            <Select :model-value="targetConnectionId" @update:model-value="handleTargetConnectionChange">
              <SelectTrigger class="h-8 text-xs">
                <SelectValue :placeholder="t('dataSync.selectConnection')" />
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

            <!-- 目标数据库选择 -->
            <Select v-model="targetDatabase">
              <SelectTrigger class="h-8 text-xs" :disabled="targetDatabases.length === 0">
                <Loader2 v-if="loadingTargetDbs" class="h-3 w-3 animate-spin mr-1" />
                <SelectValue :placeholder="t('dataSync.selectDatabase')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="db in targetDatabases" :key="db" :value="db">
                  {{ db }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <!-- 表选择 -->
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              <Table2 class="h-3.5 w-3.5" />
              {{ t('dataSync.tables') }}
              <Badge v-if="selectedTables.size > 0" variant="secondary" class="text-[10px] h-4 px-1.5">
                {{ selectedTables.size }}/{{ availableTables.length }}
              </Badge>
            </div>
            <Button
              v-if="availableTables.length > 0"
              variant="ghost"
              size="sm"
              class="h-6 text-[10px]"
              @click="toggleAllTables"
            >
              <CheckCheck class="h-3 w-3 mr-1" />
              {{ selectedTables.size === availableTables.length ? t('dataSync.deselectAll') : t('dataSync.selectAll') }}
            </Button>
          </div>

          <div v-if="loadingTables" class="flex items-center gap-2 py-4 text-xs text-muted-foreground">
            <Loader2 class="h-4 w-4 animate-spin" />
            {{ t('common.loading') }}
          </div>

          <div v-else-if="availableTables.length === 0 && sourceDatabase" class="py-4 text-center text-xs text-muted-foreground">
            {{ t('dataSync.noTables') }}
          </div>

          <div v-else-if="!sourceDatabase" class="py-4 text-center text-xs text-muted-foreground">
            {{ t('dataSync.selectSourceFirst') }}
          </div>

          <div v-else class="grid grid-cols-3 gap-1 max-h-40 overflow-y-auto rounded-md border border-border/30 p-2">
            <label
              v-for="table in availableTables"
              :key="table"
              class="flex items-center gap-1.5 rounded px-1.5 py-1 text-xs cursor-pointer hover:bg-accent/50 transition-colors"
            >
              <Checkbox
                :checked="selectedTables.has(table)"
                @update:checked="toggleTable(table)"
              />
              <span class="truncate">{{ table }}</span>
            </label>
          </div>
        </div>

        <!-- 同步选项 -->
        <div class="flex items-center gap-4">
          <div class="flex items-center gap-2 text-xs">
            <span class="text-muted-foreground">{{ t('dataSync.syncMode') }}:</span>
            <Select v-model="syncMode">
              <SelectTrigger class="h-7 w-36 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full">{{ t('dataSync.modeFull') }}</SelectItem>
                <SelectItem value="upsert">{{ t('dataSync.modeUpsert') }}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div class="flex items-center gap-2 text-xs">
            <span class="text-muted-foreground">{{ t('dataSync.pageSize') }}:</span>
            <Select :model-value="String(pageSize)" @update:model-value="(v) => pageSize = Number(v)">
              <SelectTrigger class="h-7 w-24 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1000">1,000</SelectItem>
                <SelectItem value="5000">5,000</SelectItem>
                <SelectItem value="10000">10,000</SelectItem>
                <SelectItem value="50000">50,000</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            :disabled="!canPreview"
            @click="handlePreview"
          >
            <Loader2 v-if="previewing" class="h-3.5 w-3.5 animate-spin mr-1" />
            <Eye v-else class="h-3.5 w-3.5 mr-1" />
            {{ t('dataSync.preview') }}
          </Button>

          <Button
            size="sm"
            :disabled="!canExecute"
            @click="handleExecute"
          >
            <Loader2 v-if="syncing" class="h-3.5 w-3.5 animate-spin mr-1" />
            <Play v-else class="h-3.5 w-3.5 mr-1" />
            {{ t('dataSync.execute') }}
          </Button>

          <Button
            size="sm"
            variant="outline"
            :disabled="!syncConfig"
            @click="handleSaveAsTask"
          >
            <Save class="h-3.5 w-3.5 mr-1" />
            {{ t('dataSync.saveAsTask') }}
          </Button>

          <Button
            v-if="preview.length > 0 || syncResult || syncError"
            size="sm"
            variant="ghost"
            @click="reset"
          >
            <RefreshCcw class="h-3.5 w-3.5 mr-1" />
            {{ t('dataSync.reset') }}
          </Button>
        </div>

        <!-- 预览结果 -->
        <div v-if="previewError" class="rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <div class="flex items-center gap-2 text-xs text-destructive">
            <AlertCircle class="h-4 w-4 shrink-0" />
            {{ previewError }}
          </div>
        </div>

        <div v-if="preview.length > 0" class="space-y-2">
          <div class="text-xs font-medium text-muted-foreground">
            {{ t('dataSync.previewResult') }} ({{ preview.length }} {{ t('dataSync.tablesCount') }})
          </div>
          <div class="rounded-md border border-border/30 overflow-hidden">
            <table class="w-full text-xs">
              <thead>
                <tr class="border-b border-border/30 bg-muted/30">
                  <th class="text-left px-3 py-1.5 font-medium">{{ t('dataSync.tableName') }}</th>
                  <th class="text-right px-3 py-1.5 font-medium">{{ t('dataSync.sourceRows') }}</th>
                  <th class="text-center px-3 py-1.5 font-medium">
                    <ArrowRight class="h-3 w-3 inline" />
                  </th>
                  <th class="text-right px-3 py-1.5 font-medium">{{ t('dataSync.targetRows') }}</th>
                  <th class="text-left px-3 py-1.5 font-medium">{{ t('dataSync.primaryKeys') }}</th>
                  <th class="text-right px-3 py-1.5 font-medium">{{ t('dataSync.columnsCount') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="p in preview"
                  :key="p.table"
                  class="border-b border-border/10 hover:bg-accent/30 transition-colors"
                >
                  <td class="px-3 py-1.5 font-mono">{{ p.table }}</td>
                  <td class="px-3 py-1.5 text-right tabular-nums">{{ p.sourceRows.toLocaleString() }}</td>
                  <td class="px-3 py-1.5 text-center text-muted-foreground">
                    <ArrowRight class="h-3 w-3 inline" />
                  </td>
                  <td class="px-3 py-1.5 text-right tabular-nums">{{ p.targetRows.toLocaleString() }}</td>
                  <td class="px-3 py-1.5">
                    <Badge v-for="pk in p.primaryKeys" :key="pk" variant="outline" class="text-[10px] h-4 px-1 mr-0.5">
                      {{ pk }}
                    </Badge>
                    <span v-if="p.primaryKeys.length === 0" class="text-muted-foreground italic">-</span>
                  </td>
                  <td class="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                    {{ p.columns.length }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 同步进度 -->
        <div v-if="syncing && progress" class="space-y-3 rounded-md border border-primary/20 bg-primary/5 p-4">
          <div class="flex items-center justify-between text-xs">
            <div class="flex items-center gap-2">
              <Loader2 class="h-4 w-4 animate-spin text-primary" />
              <span class="font-medium">{{ t('dataSync.syncing') }}</span>
            </div>
            <span class="text-muted-foreground tabular-nums">
              {{ progress.tableIndex + 1 }}/{{ progress.tableCount }}
            </span>
          </div>

          <Progress :model-value="progressPercent" />

          <div class="flex items-center justify-between text-[10px] text-muted-foreground">
            <span class="font-mono">{{ progress.table }}</span>
            <span>{{ progress.stage }}</span>
            <span class="tabular-nums">
              {{ progress.syncedRows.toLocaleString() }} / {{ progress.totalRows.toLocaleString() }}
            </span>
          </div>
        </div>

        <!-- 同步完成 -->
        <div v-if="syncResult" class="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3">
          <div class="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
            <CheckCheck class="h-4 w-4 shrink-0" />
            {{ syncResult }}
          </div>
        </div>

        <!-- 同步错误 -->
        <div v-if="syncError" class="rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <div class="flex items-center gap-2 text-xs text-destructive">
            <AlertCircle class="h-4 w-4 shrink-0" />
            {{ syncError }}
          </div>
        </div>
      </div>
    </ScrollArea>
  </div>
</template>
