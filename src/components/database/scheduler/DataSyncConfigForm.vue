<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Loader2,
  Database,
  CheckCheck,
  Search,
} from 'lucide-vue-next'
import { useConnectionStore } from '@/stores/connections'
import * as dbApi from '@/api/database'
import type { SyncConfig } from '@/types/data-sync'

const props = defineProps<{
  modelValue: Partial<SyncConfig>
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Partial<SyncConfig>]
}>()

const { t } = useI18n()
const connectionStore = useConnectionStore()

// 可用的数据库连接
const availableConnections = computed(() =>
  connectionStore.connectionList.filter((c) => c.record.type === 'database'),
)

// 数据库列表
const sourceDatabases = ref<string[]>([])
const targetDatabases = ref<string[]>([])
const loadingSourceDbs = ref(false)
const loadingTargetDbs = ref(false)

// 表列表
const availableTables = ref<string[]>([])
const selectedTables = ref<Set<string>>(new Set())
const loadingTables = ref(false)
const tableSearch = ref('')

// 过滤后的表
const filteredTables = computed(() => {
  const q = tableSearch.value.trim().toLowerCase()
  if (!q) return availableTables.value
  return availableTables.value.filter((t) => t.toLowerCase().includes(q))
})

// 全选状态
const allSelected = computed(() =>
  filteredTables.value.length > 0 &&
  filteredTables.value.every((t) => selectedTables.value.has(t)),
)

// 同步选项
const syncMode = ref<'full' | 'upsert'>((props.modelValue.syncMode as 'full' | 'upsert') || 'full')
const pageSize = ref(props.modelValue.pageSize ?? 5000)

// 当前选中值
const sourceConnectionId = ref(props.modelValue.sourceConnectionId ?? '')
const sourceDatabase = ref(props.modelValue.sourceDatabase ?? '')
const targetConnectionId = ref(props.modelValue.targetConnectionId ?? '')
const targetDatabase = ref(props.modelValue.targetDatabase ?? '')

// 初始化：从 modelValue 恢复状态
// 关键：loadDatabases 是 async 的，必须等数据库列表加载完后再赋值数据库，
// 否则 Select 组件中没有对应的 SelectItem，无法正确显示
watch(() => props.modelValue, async (v) => {
  let sourceDbsLoaded = false
  let targetDbsLoaded = false

  if (v.sourceConnectionId && v.sourceConnectionId !== sourceConnectionId.value) {
    sourceConnectionId.value = v.sourceConnectionId
    await loadDatabases(v.sourceConnectionId, 'source')
    sourceDbsLoaded = true
  }
  if (v.targetConnectionId && v.targetConnectionId !== targetConnectionId.value) {
    targetConnectionId.value = v.targetConnectionId
    await loadDatabases(v.targetConnectionId, 'target')
    targetDbsLoaded = true
  }
  // 数据库列表加载完后再赋值，确保 Select 能匹配到值
  if (v.sourceDatabase && (sourceDbsLoaded || sourceDatabases.value.includes(v.sourceDatabase))) {
    sourceDatabase.value = v.sourceDatabase
  }
  if (v.targetDatabase && (targetDbsLoaded || targetDatabases.value.includes(v.targetDatabase))) {
    targetDatabase.value = v.targetDatabase
  }
  if (v.syncMode) syncMode.value = v.syncMode
  if (v.pageSize) pageSize.value = v.pageSize
  if (v.tables) selectedTables.value = new Set(v.tables)
}, { immediate: true })

/** 发射更新 */
function emitUpdate() {
  emit('update:modelValue', {
    sourceConnectionId: sourceConnectionId.value,
    sourceDatabase: sourceDatabase.value,
    targetConnectionId: targetConnectionId.value,
    targetDatabase: targetDatabase.value,
    tables: Array.from(selectedTables.value),
    syncMode: syncMode.value,
    pageSize: pageSize.value,
  })
}

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
    emitUpdate()
  } catch {
    availableTables.value = []
  } finally {
    loadingTables.value = false
  }
}

// 源连接变更
function handleSourceConnectionChange(val: string | number | bigint | Record<string, unknown> | null) {
  sourceConnectionId.value = String(val ?? '')
  sourceDatabase.value = ''
  availableTables.value = []
  selectedTables.value = new Set()
  loadDatabases(String(val ?? ''), 'source')
  emitUpdate()
}

// 目标连接变更
function handleTargetConnectionChange(val: string | number | bigint | Record<string, unknown> | null) {
  targetConnectionId.value = String(val ?? '')
  targetDatabase.value = ''
  loadDatabases(String(val ?? ''), 'target')
  emitUpdate()
}

// 数据库变更
watch(sourceDatabase, () => {
  if (sourceDatabase.value) loadTables()
  emitUpdate()
})
watch(targetDatabase, () => emitUpdate())

// 选项变更
watch([syncMode, pageSize], () => emitUpdate())

/** 全选/取消全选 */
function toggleAllTables() {
  if (allSelected.value) {
    selectedTables.value = new Set()
  } else {
    selectedTables.value = new Set(availableTables.value)
  }
  emitUpdate()
}

/** 切换单张表 */
function toggleTable(table: string) {
  const next = new Set(selectedTables.value)
  if (next.has(table)) {
    next.delete(table)
  } else {
    next.add(table)
  }
  selectedTables.value = next
  emitUpdate()
}
</script>

<template>
  <div class="space-y-3">
    <!-- 源和目标 -->
    <div class="grid grid-cols-2 gap-3">
      <!-- 源 -->
      <div class="space-y-1.5">
        <div class="flex items-center gap-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          <Database class="h-3 w-3 text-df-success" />
          {{ t('scheduler.source') }}
        </div>
        <Select :model-value="sourceConnectionId" @update:model-value="handleSourceConnectionChange">
          <SelectTrigger class="h-7 text-xs">
            <SelectValue :placeholder="t('scheduler.selectConnection')" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="conn in availableConnections" :key="conn.record.id" :value="conn.record.id">
              {{ conn.record.name }}
            </SelectItem>
          </SelectContent>
        </Select>
        <Select v-model="sourceDatabase">
          <SelectTrigger class="h-7 text-xs" :disabled="sourceDatabases.length === 0">
            <Loader2 v-if="loadingSourceDbs" class="h-3 w-3 animate-spin mr-1" />
            <SelectValue :placeholder="t('scheduler.selectDatabase')" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="db in sourceDatabases" :key="db" :value="db">{{ db }}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <!-- 目标 -->
      <div class="space-y-1.5">
        <div class="flex items-center gap-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          <Database class="h-3 w-3 text-primary" />
          {{ t('scheduler.target') }}
        </div>
        <Select :model-value="targetConnectionId" @update:model-value="handleTargetConnectionChange">
          <SelectTrigger class="h-7 text-xs">
            <SelectValue :placeholder="t('scheduler.selectConnection')" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="conn in availableConnections" :key="conn.record.id" :value="conn.record.id">
              {{ conn.record.name }}
            </SelectItem>
          </SelectContent>
        </Select>
        <Select v-model="targetDatabase">
          <SelectTrigger class="h-7 text-xs" :disabled="targetDatabases.length === 0">
            <Loader2 v-if="loadingTargetDbs" class="h-3 w-3 animate-spin mr-1" />
            <SelectValue :placeholder="t('scheduler.selectDatabase')" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="db in targetDatabases" :key="db" :value="db">{{ db }}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>

    <!-- 表选择 -->
    <div v-if="sourceDatabase" class="space-y-1.5">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          {{ t('scheduler.selectTables') }}
          <Badge v-if="selectedTables.size > 0" variant="secondary" class="text-[10px] h-4 px-1">
            {{ selectedTables.size }}/{{ availableTables.length }}
          </Badge>
        </div>
        <Button v-if="availableTables.length > 0" variant="ghost" size="sm" class="h-5 text-[10px] px-1.5" @click="toggleAllTables">
          <CheckCheck class="h-2.5 w-2.5 mr-0.5" />
          {{ allSelected ? t('dataSync.deselectAll') : t('dataSync.selectAll') }}
        </Button>
      </div>

      <div v-if="loadingTables" class="flex items-center gap-1 py-2 text-[10px] text-muted-foreground">
        <Loader2 class="h-3 w-3 animate-spin" />
        {{ t('common.loading') }}
      </div>

      <template v-else-if="availableTables.length > 0">
        <!-- 搜索框（表较多时显示） -->
        <div v-if="availableTables.length > 10" class="relative">
          <Search class="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input v-model="tableSearch" class="h-6 text-[10px] pl-7" placeholder="搜索表..." />
        </div>

        <div class="max-h-32 overflow-y-auto rounded-md border border-border/30 p-1.5 space-y-0.5">
          <label
            v-for="table in filteredTables"
            :key="table"
            class="flex items-center gap-2 rounded px-2 py-1 text-[10px] cursor-pointer hover:bg-muted/50 transition-colors"
          >
            <input
              type="checkbox"
              :checked="selectedTables.has(table)"
              class="size-3.5 rounded border-muted-foreground/40 accent-primary"
              @change="toggleTable(table)"
            />
            <span class="truncate">{{ table }}</span>
          </label>
        </div>
      </template>
    </div>

    <!-- 同步选项 -->
    <div class="flex items-center gap-3">
      <div class="flex items-center gap-1.5 text-[10px]">
        <span class="text-muted-foreground">{{ t('scheduler.syncMode') }}:</span>
        <Select v-model="syncMode" @update:model-value="emitUpdate">
          <SelectTrigger class="h-6 w-28 text-[10px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="full">{{ t('scheduler.modeFull') }}</SelectItem>
            <SelectItem value="upsert">{{ t('scheduler.modeUpsert') }}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div class="flex items-center gap-1.5 text-[10px]">
        <span class="text-muted-foreground">{{ t('scheduler.pageSize') }}:</span>
        <Select :model-value="String(pageSize)" @update:model-value="(v) => { pageSize = Number(v); emitUpdate() }">
          <SelectTrigger class="h-6 w-20 text-[10px]">
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
  </div>
</template>
