<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { open } from '@tauri-apps/plugin-dialog'
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
  FolderOpen,
  CheckCheck,
  Search,
} from 'lucide-vue-next'
import { useConnectionStore } from '@/stores/connections'
import * as dbApi from '@/api/database'
import type { BackupConfig } from '@/types/scheduler'

const props = defineProps<{
  modelValue: Partial<BackupConfig>
  connectionId: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Partial<BackupConfig>]
}>()

const { t } = useI18n()
const connectionStore = useConnectionStore()

// 可用的数据库连接
const availableConnections = computed(() =>
  connectionStore.connectionList.filter((c) => c.record.type === 'database'),
)

// 当前选中值
const connectionId = ref(props.modelValue.connectionId ?? props.connectionId)
const database = ref(props.modelValue.database ?? '')
const includeStructure = ref(props.modelValue.includeStructure ?? true)
const includeData = ref(props.modelValue.includeData ?? true)
const outputDir = ref(props.modelValue.outputDir ?? '')

// 数据库和表列表
const databases = ref<string[]>([])
const loadingDbs = ref(false)
const availableTables = ref<string[]>([])
const selectedTables = ref<Set<string>>(new Set(props.modelValue.tables ?? []))
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

// 初始化加载数据库列表
watch(() => props.modelValue, (v) => {
  if (v.connectionId && v.connectionId !== connectionId.value) {
    connectionId.value = v.connectionId
    loadDatabases(v.connectionId)
  }
  if (v.database) database.value = v.database
  if (v.includeStructure !== undefined) includeStructure.value = v.includeStructure
  if (v.includeData !== undefined) includeData.value = v.includeData
  if (v.outputDir) outputDir.value = v.outputDir
  if (v.tables) selectedTables.value = new Set(v.tables)
}, { immediate: true })

// 初始加载
if (connectionId.value) loadDatabases(connectionId.value)

/** 发射更新 */
function emitUpdate() {
  emit('update:modelValue', {
    connectionId: connectionId.value,
    database: database.value,
    tables: Array.from(selectedTables.value),
    includeStructure: includeStructure.value,
    includeData: includeData.value,
    outputDir: outputDir.value,
  })
}

/** 加载数据库列表 */
async function loadDatabases(connId: string) {
  if (!connId) return
  loadingDbs.value = true
  try {
    const result = await dbApi.dbConnect(connId)
    if (result.databases.length > 0) {
      databases.value = result.databases.map((d) => d.name)
    } else {
      const dbs = await dbApi.dbGetDatabases(connId)
      databases.value = dbs.map((d) => d.name)
    }
  } catch {
    databases.value = []
  } finally {
    loadingDbs.value = false
  }
}

/** 加载表列表 */
async function loadTables() {
  if (!connectionId.value || !database.value) {
    availableTables.value = []
    return
  }
  loadingTables.value = true
  try {
    const tables = await dbApi.dbGetTables(connectionId.value, database.value)
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

// 连接变更
function handleConnectionChange(val: string | number | bigint | Record<string, unknown> | null) {
  connectionId.value = String(val ?? '')
  database.value = ''
  availableTables.value = []
  selectedTables.value = new Set()
  loadDatabases(String(val ?? ''))
  emitUpdate()
}

// 数据库变更
watch(database, () => {
  if (database.value) loadTables()
  emitUpdate()
})

// 选项变更
watch([includeStructure, includeData], () => emitUpdate())

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

/** 选择输出目录 */
async function browseOutputDir() {
  const selected = await open({ directory: true, multiple: false })
  if (selected) {
    outputDir.value = selected as string
    emitUpdate()
  }
}
</script>

<template>
  <div class="space-y-3">
    <!-- 连接和数据库 -->
    <div class="grid grid-cols-2 gap-3">
      <div class="space-y-1.5">
        <span class="text-[10px] font-medium text-muted-foreground">{{ t('scheduler.selectConnection') }}</span>
        <Select :model-value="connectionId" @update:model-value="handleConnectionChange">
          <SelectTrigger class="h-7 text-xs">
            <SelectValue :placeholder="t('scheduler.selectConnection')" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="conn in availableConnections" :key="conn.record.id" :value="conn.record.id">
              {{ conn.record.name }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div class="space-y-1.5">
        <span class="text-[10px] font-medium text-muted-foreground">{{ t('scheduler.selectDatabase') }}</span>
        <Select v-model="database">
          <SelectTrigger class="h-7 text-xs" :disabled="databases.length === 0">
            <Loader2 v-if="loadingDbs" class="h-3 w-3 animate-spin mr-1" />
            <SelectValue :placeholder="t('scheduler.selectDatabase')" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="db in databases" :key="db" :value="db">{{ db }}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>

    <!-- 表选择 -->
    <div v-if="database" class="space-y-1.5">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          {{ t('scheduler.selectTables') }}
          <Badge v-if="selectedTables.size > 0" variant="secondary" class="text-[10px] h-4 px-1">
            {{ selectedTables.size }}/{{ availableTables.length }}
          </Badge>
          <span v-if="selectedTables.size === 0 && availableTables.length > 0" class="normal-case text-muted-foreground/60">
            ({{ t('scheduler.allTables') }})
          </span>
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

    <!-- 备份选项 -->
    <div class="flex items-center gap-4">
      <label class="flex items-center gap-2 text-[10px] cursor-pointer">
        <input
          type="checkbox"
          :checked="includeStructure"
          class="size-3.5 rounded border-muted-foreground/40 accent-primary"
          @change="includeStructure = ($event.target as HTMLInputElement).checked; emitUpdate()"
        />
        {{ t('scheduler.includeStructure') }}
      </label>
      <label class="flex items-center gap-2 text-[10px] cursor-pointer">
        <input
          type="checkbox"
          :checked="includeData"
          class="size-3.5 rounded border-muted-foreground/40 accent-primary"
          @change="includeData = ($event.target as HTMLInputElement).checked; emitUpdate()"
        />
        {{ t('scheduler.includeData') }}
      </label>
    </div>

    <!-- 输出目录 -->
    <div class="space-y-1.5">
      <span class="text-[10px] font-medium text-muted-foreground">{{ t('scheduler.outputDir') }}</span>
      <div class="flex items-center gap-1.5">
        <Input
          :model-value="outputDir"
          class="h-7 text-xs flex-1 font-mono"
          :placeholder="t('scheduler.outputDirPlaceholder')"
          @update:model-value="(v) => { outputDir = v as string; emitUpdate() }"
        />
        <Button variant="outline" size="sm" class="h-7 text-xs shrink-0 px-2" @click="browseOutputDir">
          <FolderOpen class="h-3 w-3 mr-1" />
          {{ t('scheduler.browse') }}
        </Button>
      </div>
    </div>
  </div>
</template>
