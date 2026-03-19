<script setup lang="ts">
/**
 * 多格式数据导出对话框
 *
 * 支持 CSV/JSON/SQL/Excel/Markdown 五种格式导出，
 * 根据选择的格式动态显示对应配置项，
 * 通过 Tauri 后端执行导出并监听进度事件。
 */
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { listen } from '@tauri-apps/api/event'
import { save } from '@tauri-apps/plugin-dialog'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import Progress from '@/components/ui/progress.vue'
import { FileDown, FolderOpen, Loader2 } from 'lucide-vue-next'
import { dbExportData } from '@/api/database'
import { useNotification } from '@/composables/useNotification'
import type { ExportFormat, ExportProgress } from '@/types/export'

// ===== Props & Emits =====

const props = defineProps<{
  /** 对话框是否打开 */
  open: boolean
  /** 数据库连接 ID */
  connectionId: string
  /** 导出数据来源 */
  source: {
    type: 'query' | 'table'
    sql?: string
    database: string
    table?: string
  }
  /** 预览数据（可选，用于底部预览区） */
  previewColumns?: string[]
  previewRows?: unknown[][]
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  /** 导出完成事件 */
  exported: [result: { rowCount: number; fileSize: number }]
}>()

const notification = useNotification()

// ===== 表单状态 =====

/** 导出格式 */
const format = ref<ExportFormat>('csv')
/** 导出文件路径 */
const filePath = ref('')
/** 是否正在导出 */
const isExporting = ref(false)
/** 导出进度 */
const exportProgress = ref<ExportProgress | null>(null)

// CSV 选项
const csvDelimiter = ref(',')
const csvQuoteChar = ref('"')
const csvIncludeHeader = ref(true)

// SQL 选项
const sqlTableName = ref('')
const sqlIncludeCreate = ref(false)
const sqlBatchSize = ref(1000)

// ===== 格式配置 =====

/** 支持的导出格式列表 */
const formatOptions: { value: ExportFormat; label: string; ext: string }[] = [
  { value: 'csv', label: 'CSV', ext: 'csv' },
  { value: 'json', label: 'JSON', ext: 'json' },
  { value: 'sql', label: 'SQL INSERT', ext: 'sql' },
  { value: 'excel', label: 'Excel (.xlsx)', ext: 'xlsx' },
  { value: 'markdown', label: 'Markdown', ext: 'md' },
]

/** 当前格式对应的文件扩展名 */
const currentExt = computed(() => {
  return formatOptions.find(f => f.value === format.value)?.ext ?? 'csv'
})

/** CSV 分隔符选项 */
const delimiterOptions = [
  { value: ',', label: '逗号 (,)' },
  { value: '\t', label: '制表符 (Tab)' },
  { value: ';', label: '分号 (;)' },
]

// ===== 文件路径选择 =====

/** 打开文件保存对话框选择导出路径 */
async function selectFilePath() {
  const defaultName = props.source.type === 'table'
    ? `${props.source.table}.${currentExt.value}`
    : `export.${currentExt.value}`

  // 根据格式构建文件过滤器
  const filterMap: Record<string, { name: string; extensions: string[] }[]> = {
    csv: [{ name: 'CSV 文件', extensions: ['csv'] }],
    json: [{ name: 'JSON 文件', extensions: ['json'] }],
    sql: [{ name: 'SQL 文件', extensions: ['sql'] }],
    excel: [{ name: 'Excel 文件', extensions: ['xlsx'] }],
    markdown: [{ name: 'Markdown 文件', extensions: ['md'] }],
  }

  const path = await save({
    defaultPath: defaultName,
    filters: filterMap[format.value] ?? [],
  })

  if (path) {
    filePath.value = path
  }
}

// ===== 导出进度事件监听 =====

let unlistenProgress: (() => void) | null = null

/** 开始监听导出进度事件 */
async function startListeningProgress() {
  // 先清理旧的监听器
  stopListeningProgress()
  unlistenProgress = await listen<ExportProgress>('export-progress', (event) => {
    exportProgress.value = event.payload
  })
}

/** 停止监听导出进度事件 */
function stopListeningProgress() {
  if (unlistenProgress) {
    unlistenProgress()
    unlistenProgress = null
  }
}

onBeforeUnmount(() => {
  stopListeningProgress()
})

// ===== 格式化文件大小 =====

/** 将字节数格式化为可读字符串 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

// ===== 导出预览 =====

const PREVIEW_MAX_ROWS = 5

/** 生成预览文本（基于当前格式和前 N 行数据） */
const previewText = computed(() => {
  const cols = props.previewColumns
  const rows = props.previewRows
  if (!cols?.length || !rows?.length) return ''

  const previewRows = rows.slice(0, PREVIEW_MAX_ROWS)
  const fmt = format.value

  if (fmt === 'csv') {
    const delim = csvDelimiter.value
    const q = csvQuoteChar.value
    const escape = (v: unknown) => {
      const s = v == null ? '' : String(v)
      return s.includes(delim) || s.includes(q) || s.includes('\n')
        ? `${q}${s.replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), q + q)}${q}`
        : s
    }
    const lines: string[] = []
    if (csvIncludeHeader.value) lines.push(cols.map(escape).join(delim))
    for (const row of previewRows) lines.push(row.map(escape).join(delim))
    return lines.join('\n')
  }

  if (fmt === 'json') {
    const arr = previewRows.map(row =>
      Object.fromEntries(cols.map((c, i) => [c, row[i] ?? null]))
    )
    return JSON.stringify(arr, null, 2)
  }

  if (fmt === 'sql') {
    const tbl = sqlTableName.value || props.source.table || 'exported_table'
    const colList = cols.map(c => `\`${c}\``).join(', ')
    return previewRows.map(row => {
      const vals = row.map(v => v == null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`)
      return `INSERT INTO \`${tbl}\` (${colList}) VALUES (${vals.join(', ')});`
    }).join('\n')
  }

  if (fmt === 'markdown') {
    const header = '| ' + cols.join(' | ') + ' |'
    const sep = '| ' + cols.map(() => '---').join(' | ') + ' |'
    const body = previewRows.map(row =>
      '| ' + row.map(v => v == null ? '' : String(v)).join(' | ') + ' |'
    )
    return [header, sep, ...body].join('\n')
  }

  if (fmt === 'excel') {
    // Excel 无法在纯文本中预览，用 CSV 替代
    const lines: string[] = [cols.join('\t')]
    for (const row of previewRows) lines.push(row.map(v => v == null ? '' : String(v)).join('\t'))
    return lines.join('\n') + '\n\n(Excel 预览以制表符分隔展示)'
  }

  return ''
})

// ===== 执行导出 =====

/** 执行数据导出 */
async function handleExport() {
  if (!filePath.value) {
    notification.warning('请选择导出文件路径')
    return
  }

  isExporting.value = true
  exportProgress.value = null

  // 开始监听进度
  await startListeningProgress()

  try {
    // 构建数据来源参数（后端使用 PascalCase 枚举变体）
    const source = props.source.type === 'query'
      ? { Query: { sql: props.source.sql ?? '', database: props.source.database } }
      : { Table: { database: props.source.database, table: props.source.table ?? '' } }

    // 构建格式选项
    const options: Record<string, unknown> = {}
    if (format.value === 'csv') {
      options.csvDelimiter = csvDelimiter.value
      options.csvQuoteChar = csvQuoteChar.value
      options.csvIncludeHeader = csvIncludeHeader.value
    } else if (format.value === 'sql') {
      options.sqlTableName = sqlTableName.value || props.source.table || 'exported_table'
      options.sqlIncludeCreate = sqlIncludeCreate.value
      options.sqlBatchSize = sqlBatchSize.value
    }

    const result = await dbExportData(props.connectionId, {
      source,
      format: format.value,
      filePath: filePath.value,
      options,
    })

    if (result.success) {
      // 导出成功通知
      notification.success(
        '导出完成',
        `共导出 ${result.rowCount.toLocaleString()} 行，文件大小 ${formatFileSize(result.fileSize)}`,
        5000,
      )
      emit('exported', { rowCount: result.rowCount, fileSize: result.fileSize })
      emit('update:open', false)
    } else {
      notification.error('导出失败', result.error ?? '未知错误')
    }
  } catch (e) {
    notification.error('导出失败', String(e))
  } finally {
    isExporting.value = false
    exportProgress.value = null
    stopListeningProgress()
  }
}

// ===== 对话框打开时重置状态 =====

watch(() => props.open, (open) => {
  if (open) {
    // 重置进度和导出状态
    isExporting.value = false
    exportProgress.value = null
    filePath.value = ''
    // SQL 格式默认表名
    sqlTableName.value = props.source.table ?? ''
  } else {
    stopListeningProgress()
  }
})
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-[480px]">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <FileDown class="h-5 w-5" />
          数据导出
        </DialogTitle>
        <DialogDescription>
          {{ source.type === 'table' ? `导出表 ${source.table}` : '导出查询结果' }}
        </DialogDescription>
      </DialogHeader>

      <div class="grid gap-4 py-2">
        <!-- 导出格式选择 -->
        <div class="grid grid-cols-4 items-center gap-4">
          <Label class="text-right text-sm">格式</Label>
          <div class="col-span-3">
            <Select v-model="format" :disabled="isExporting">
              <SelectTrigger class="w-full">
                <SelectValue placeholder="选择导出格式" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="opt in formatOptions"
                  :key="opt.value"
                  :value="opt.value"
                >
                  {{ opt.label }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <!-- 文件路径选择 -->
        <div class="grid grid-cols-4 items-center gap-4">
          <Label class="text-right text-sm">路径</Label>
          <div class="col-span-3 flex gap-2">
            <Input
              v-model="filePath"
              :disabled="isExporting"
              placeholder="选择导出文件路径..."
              class="flex-1 text-xs"
              readonly
            />
            <Button
              variant="outline"
              size="sm"
              :disabled="isExporting"
              @click="selectFilePath"
            >
              <FolderOpen class="h-4 w-4" />
            </Button>
          </div>
        </div>

        <!-- CSV 格式选项 -->
        <template v-if="format === 'csv'">
          <div class="grid grid-cols-4 items-center gap-4">
            <Label class="text-right text-sm">分隔符</Label>
            <div class="col-span-3">
              <Select v-model="csvDelimiter" :disabled="isExporting">
                <SelectTrigger class="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="opt in delimiterOptions"
                    :key="opt.value"
                    :value="opt.value"
                  >
                    {{ opt.label }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div class="grid grid-cols-4 items-center gap-4">
            <Label class="text-right text-sm">限定符</Label>
            <div class="col-span-3">
              <Input
                v-model="csvQuoteChar"
                :disabled="isExporting"
                class="w-20"
                maxlength="1"
              />
            </div>
          </div>
          <div class="grid grid-cols-4 items-center gap-4">
            <Label class="text-right text-sm">列标题</Label>
            <div class="col-span-3">
              <label class="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  v-model="csvIncludeHeader"
                  type="checkbox"
                  :disabled="isExporting"
                  class="rounded border-border"
                />
                包含列标题行
              </label>
            </div>
          </div>
        </template>

        <!-- SQL 格式选项 -->
        <template v-if="format === 'sql'">
          <div class="grid grid-cols-4 items-center gap-4">
            <Label class="text-right text-sm">表名</Label>
            <div class="col-span-3">
              <Input
                v-model="sqlTableName"
                :disabled="isExporting"
                :placeholder="source.table || 'exported_table'"
              />
            </div>
          </div>
          <div class="grid grid-cols-4 items-center gap-4">
            <Label class="text-right text-sm">建表语句</Label>
            <div class="col-span-3">
              <label class="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  v-model="sqlIncludeCreate"
                  type="checkbox"
                  :disabled="isExporting"
                  class="rounded border-border"
                />
                包含 CREATE TABLE 语句
              </label>
            </div>
          </div>
          <div class="grid grid-cols-4 items-center gap-4">
            <Label class="text-right text-sm">批量大小</Label>
            <div class="col-span-3">
              <Input
                v-model.number="sqlBatchSize"
                :disabled="isExporting"
                type="number"
                :min="1"
                :max="10000"
                class="w-28"
              />
              <span class="ml-2 text-xs text-muted-foreground">行/批</span>
            </div>
          </div>
        </template>

        <!-- JSON / Excel / Markdown 无额外选项 -->
        <div
          v-if="format === 'json' || format === 'excel' || format === 'markdown'"
          class="grid grid-cols-4 items-center gap-4"
        >
          <div class="col-start-2 col-span-3 text-xs text-muted-foreground">
            {{ format === 'json' ? 'JSON 数组格式，无额外配置项' :
               format === 'excel' ? 'Excel (.xlsx) 格式，自动包含列标题' :
               'Markdown 表格格式，无额外配置项' }}
          </div>
        </div>

        <!-- 导出进度条 -->
        <div v-if="isExporting && exportProgress" class="grid grid-cols-4 items-center gap-4">
          <Label class="text-right text-sm">进度</Label>
          <div class="col-span-3 space-y-1">
            <Progress :model-value="exportProgress.percentage" />
            <p class="text-xs text-muted-foreground">
              {{ exportProgress.current.toLocaleString() }} / {{ exportProgress.total.toLocaleString() }} 行
              ({{ exportProgress.percentage }}%)
            </p>
          </div>
        </div>

        <!-- 导出预览 -->
        <div v-if="previewText && !isExporting" class="grid grid-cols-4 gap-4">
          <Label class="text-right text-sm pt-2">预览</Label>
          <div class="col-span-3">
            <div class="max-h-[180px] overflow-auto rounded-lg border border-border/30 bg-muted/10 p-3">
              <pre class="text-[10px] font-mono text-foreground/70 whitespace-pre-wrap break-all leading-relaxed">{{ previewText }}</pre>
            </div>
            <p class="mt-1 text-[10px] text-muted-foreground/40">
              显示前 {{ PREVIEW_MAX_ROWS }} 行预览
            </p>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          :disabled="isExporting"
          @click="emit('update:open', false)"
        >
          取消
        </Button>
        <Button
          :disabled="isExporting || !filePath"
          @click="handleExport"
        >
          <Loader2 v-if="isExporting" class="mr-2 h-4 w-4 animate-spin" />
          <FileDown v-else class="mr-2 h-4 w-4" />
          {{ isExporting ? '导出中...' : '开始导出' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
