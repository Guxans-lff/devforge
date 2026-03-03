<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, X, Loader2, Code, Play, ChevronRight, Table2, Key, FileCode, Columns3, Copy, Check, GripVertical, Link2, Search, Trash2, Zap } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { useToast } from '@/composables/useToast'
import { useConnectionStore } from '@/stores/connections'
import { generateCreateTableSql, generateAlterTableSql, executeDdl, getTableDetail, getTableDdl } from '@/api/table-editor'
import type { ColumnDefinition, IndexDefinition, TableDefinition, TableAlteration, ColumnChange, IndexChange, TableDetail, ForeignKeyDefinition } from '@/types/table-editor'

const props = defineProps<{
  connectionId: string
  database: string
  driver: string
  table?: string
}>()

const emit = defineEmits<{
  success: []
}>()

const { t } = useI18n()
const toast = useToast()
const connectionStore = useConnectionStore()
const connectionHost = computed(() => {
  const state = connectionStore.connections.get(props.connectionId)
  if (!state) return ''
  const { host, port } = state.record
  return port ? `${host}:${port}` : host
})

const isAlterMode = computed(() => !!props.table)
const activeTab = ref('columns')
const loading = ref(false)
const executing = ref(false)
const generatedSql = ref('')
const showSqlPreview = ref(false)
const metaCollapsed = ref(false)
const ddlContent = ref('')
const ddlLoading = ref(false)
const ddlCopied = ref(false)
const columnsScrollRef = ref<HTMLElement>()
const sqlCopied = ref(false)
const selectedRowIdx = ref<number | null>(null)
const showContextMenu = ref(false)
const contextMenuPos = ref({ x: 0, y: 0 })
const contextMenuIdx = ref(-1)
const indexColumnDropdown = ref<number | null>(null)
const typeDropdownIdx = ref<number | null>(null)
const typeSearchQuery = ref('')
const dragIdx = ref<number | null>(null)
const dragOverIdx = ref<number | null>(null)
const columnFilter = ref('')
const selectedRows = ref<Set<number>>(new Set())

const filteredTypes = computed(() => {
  const q = typeSearchQuery.value.toUpperCase()
  if (!q) return allTypes.value
  return allTypes.value.filter(t => t.includes(q))
})

// 字段过滤
const filteredColumnIndices = computed(() => {
  const q = columnFilter.value.toLowerCase()
  if (!q) return columns.value.map((_, i) => i)
  return columns.value.reduce<number[]>((acc, col, i) => {
    if (col.name.toLowerCase().includes(q) || col.dataType.toLowerCase().includes(q) || (col.comment ?? '').toLowerCase().includes(q)) acc.push(i)
    return acc
  }, [])
})

// 批量选择
const allSelected = computed(() => filteredColumnIndices.value.length > 0 && filteredColumnIndices.value.every(i => selectedRows.value.has(i)))

function toggleSelectAll() {
  if (allSelected.value) {
    selectedRows.value = new Set()
  } else {
    selectedRows.value = new Set(filteredColumnIndices.value)
  }
}

function toggleRowSelect(idx: number) {
  const next = new Set(selectedRows.value)
  if (next.has(idx)) next.delete(idx); else next.add(idx)
  selectedRows.value = next
}

function batchDelete() {
  if (selectedRows.value.size === 0) return
  const names = [...selectedRows.value].map(i => columns.value[i]?.name).filter(Boolean)
  if (isAlterMode.value && names.length > 0) {
    if (!confirm(`确定批量删除 ${selectedRows.value.size} 个字段？`)) return
  }
  pushHistory()
  columns.value = columns.value.filter((_, i) => !selectedRows.value.has(i))
  selectedRows.value = new Set()
  selectedRowIdx.value = null
}

// 撤销/重做历史栈
interface HistorySnapshot { columns: ColumnDefinition[]; indexes: IndexDefinition[]; foreignKeys: ForeignKeyDefinition[] }
const undoStack = ref<HistorySnapshot[]>([])
const redoStack = ref<HistorySnapshot[]>([])
const isUndoRedo = ref(false)
const MAX_HISTORY = 50

function cloneState(): HistorySnapshot {
  return {
    columns: columns.value.map(c => ({ ...c })),
    indexes: indexes.value.map(i => ({ ...i, columns: [...i.columns] })),
    foreignKeys: foreignKeys.value.map(fk => ({ ...fk, columns: [...fk.columns], refColumns: [...fk.refColumns] })),
  }
}

function pushHistory() {
  if (isUndoRedo.value) return
  undoStack.value = [...undoStack.value.slice(-(MAX_HISTORY - 1)), cloneState()]
  redoStack.value = []
}

function undo() {
  if (undoStack.value.length === 0) return
  const current = cloneState()
  const prev = undoStack.value[undoStack.value.length - 1]
  if (!prev) return
  undoStack.value = undoStack.value.slice(0, -1)
  redoStack.value = [...redoStack.value, current]
  isUndoRedo.value = true
  columns.value = prev.columns
  indexes.value = prev.indexes
  foreignKeys.value = prev.foreignKeys
  isUndoRedo.value = false
}

function redo() {
  if (redoStack.value.length === 0) return
  const current = cloneState()
  const next = redoStack.value[redoStack.value.length - 1]
  if (!next) return
  redoStack.value = redoStack.value.slice(0, -1)
  undoStack.value = [...undoStack.value, current]
  isUndoRedo.value = true
  columns.value = next.columns
  indexes.value = next.indexes
  foreignKeys.value = next.foreignKeys
  isUndoRedo.value = false
}

const tableName = ref('')
const tableEngine = ref('InnoDB')
const tableCharset = ref('utf8mb4')
const tableCollation = ref('utf8mb4_unicode_ci')
const tableComment = ref('')
const tableAutoIncrement = ref('')
const tableRowFormat = ref('DEFAULT')

// 原始表属性（用于 alter 对比）
const originalTableEngine = ref('')
const originalTableCharset = ref('')
const originalTableCollation = ref('')
const originalTableComment = ref('')

const columns = ref<ColumnDefinition[]>([])
const originalColumns = ref<ColumnDefinition[]>([])
const indexes = ref<IndexDefinition[]>([])
const originalIndexes = ref<IndexDefinition[]>([])
const foreignKeys = ref<ForeignKeyDefinition[]>([])
const originalForeignKeys = ref<ForeignKeyDefinition[]>([])

interface TriggerDefinition {
  name: string
  timing: string // BEFORE | AFTER
  event: string  // INSERT | UPDATE | DELETE
  body: string
}
const triggers = ref<TriggerDefinition[]>([])

const TRIGGER_TIMINGS = ['BEFORE', 'AFTER']
const TRIGGER_EVENTS = ['INSERT', 'UPDATE', 'DELETE']

const isMysql = computed(() => props.driver === 'mysql' || props.driver === 'mariadb')

const COMMON_TYPES = [
  'INT', 'BIGINT', 'SMALLINT', 'TINYINT', 'MEDIUMINT',
  'VARCHAR', 'CHAR', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT', 'TINYTEXT',
  'DECIMAL', 'FLOAT', 'DOUBLE', 'NUMERIC',
  'DATETIME', 'DATE', 'TIMESTAMP', 'TIME', 'YEAR',
  'BOOLEAN', 'BIT', 'JSON', 'BLOB', 'MEDIUMBLOB', 'LONGBLOB',
  'ENUM', 'SET', 'BINARY', 'VARBINARY',
]

const allTypes = computed(() => {
  const extra = columns.value
    .map(c => c.dataType.toUpperCase())
    .filter(t => t && !COMMON_TYPES.includes(t))
  return [...COMMON_TYPES, ...new Set(extra)]
})

const INDEX_TYPES = ['INDEX', 'UNIQUE', 'PRIMARY', 'FULLTEXT']

// 类型联动默认长度
const TYPE_DEFAULT_LENGTH: Record<string, string | null> = {
  VARCHAR: '255', CHAR: '1', DECIMAL: '10,2', NUMERIC: '10,2', FLOAT: null, DOUBLE: null,
  INT: '11', BIGINT: '20', SMALLINT: '6', TINYINT: '4', MEDIUMINT: '9',
  TEXT: null, MEDIUMTEXT: null, LONGTEXT: null, TINYTEXT: null,
  DATETIME: null, DATE: null, TIMESTAMP: null, TIME: null, YEAR: null,
  BOOLEAN: null, BIT: '1', JSON: null, BLOB: null, MEDIUMBLOB: null, LONGBLOB: null,
  ENUM: null, SET: null, BINARY: null, VARBINARY: '255',
}

// 不需要长度的类型
const NO_LENGTH_TYPES = new Set([
  'TEXT', 'MEDIUMTEXT', 'LONGTEXT', 'TINYTEXT',
  'BLOB', 'MEDIUMBLOB', 'LONGBLOB',
  'JSON', 'BOOLEAN', 'DATE', 'YEAR',
])

// 变更追踪
function getColumnChangeType(col: ColumnDefinition, idx: number): 'add' | 'modify' | null {
  if (!isAlterMode.value) return null
  const orig = originalColumns.value.find(c => c.name === col.name)
  if (!orig) return 'add'
  if (JSON.stringify(orig) !== JSON.stringify(col)) return 'modify'
  return null
}

function isDeletedColumn(origName: string): boolean {
  return !columns.value.find(c => c.name === origName)
}

// 变更统计
const changeStats = computed(() => {
  if (!isAlterMode.value) return { added: columns.value.length, modified: 0, deleted: 0 }
  let added = 0, modified = 0, deleted = 0
  for (const col of columns.value) {
    const orig = originalColumns.value.find(c => c.name === col.name)
    if (!orig) added++
    else if (JSON.stringify(orig) !== JSON.stringify(col)) modified++
  }
  for (const orig of originalColumns.value) {
    if (!columns.value.find(c => c.name === orig.name)) deleted++
  }
  return { added, modified, deleted }
})

const hasChanges = computed(() => {
  if (!isAlterMode.value) return columns.value.length > 0
  const { added, modified, deleted } = changeStats.value
  return added > 0 || modified > 0 || deleted > 0
    || indexes.value.length !== originalIndexes.value.length
    || JSON.stringify(indexes.value) !== JSON.stringify(originalIndexes.value)
    || tableName.value !== props.table
    || tableEngine.value !== originalTableEngine.value
    || tableCharset.value !== originalTableCharset.value
    || tableComment.value !== originalTableComment.value
})

// 校验
const validationErrors = computed(() => {
  const errors: { row: number; field: string; message: string }[] = []
  const names = new Set<string>()
  columns.value.forEach((col, idx) => {
    if (!col.name.trim()) errors.push({ row: idx, field: 'name', message: '字段名不能为空' })
    else if (names.has(col.name.toLowerCase())) errors.push({ row: idx, field: 'name', message: '字段名重复' })
    names.add(col.name.toLowerCase())
    if (!col.dataType) errors.push({ row: idx, field: 'dataType', message: '类型不能为空' })
  })
  return errors
})

function hasError(idx: number, field: string): boolean {
  return validationErrors.value.some(e => e.row === idx && e.field === field)
}

function getError(idx: number, field: string): string {
  return validationErrors.value.find(e => e.row === idx && e.field === field)?.message ?? ''
}

function newColumn(): ColumnDefinition {
  return {
    name: '', dataType: 'VARCHAR', length: '255', nullable: true,
    isPrimaryKey: false, autoIncrement: false, defaultValue: null, onUpdate: null, comment: null,
  }
}

function newIndex(): IndexDefinition {
  return { name: '', columns: [], indexType: 'INDEX' }
}

function addColumn() {
  pushHistory()
  columns.value = [...columns.value, newColumn()]
  nextTick(() => {
    if (columnsScrollRef.value) {
      columnsScrollRef.value.scrollTop = columnsScrollRef.value.scrollHeight
      const rows = columnsScrollRef.value.querySelectorAll('tbody tr')
      const lastRow = rows[rows.length - 1]
      const nameInput = lastRow?.querySelector('input') as HTMLInputElement | null
      nameInput?.focus()
    }
  })
}
function removeColumn(idx: number) { pushHistory(); columns.value = columns.value.filter((_, i) => i !== idx) }
function addIndex() { pushHistory(); indexes.value = [...indexes.value, newIndex()] }
function removeIndex(idx: number) { pushHistory(); indexes.value = indexes.value.filter((_, i) => i !== idx) }

const FK_ACTIONS = ['NO ACTION', 'CASCADE', 'SET NULL', 'RESTRICT']

function newForeignKey(): ForeignKeyDefinition {
  return { name: '', columns: [], refTable: '', refColumns: [], onDelete: 'NO ACTION', onUpdate: 'NO ACTION' }
}
function addForeignKey() { pushHistory(); foreignKeys.value = [...foreignKeys.value, newForeignKey()] }
function removeForeignKey(idx: number) { pushHistory(); foreignKeys.value = foreignKeys.value.filter((_, i) => i !== idx) }
function updateForeignKey(idx: number, field: keyof ForeignKeyDefinition, value: unknown) {
  pushHistory()
  foreignKeys.value = foreignKeys.value.map((fk, i) => {
    if (i !== idx) return fk
    const updated = { ...fk, [field]: value }
    // 自动生成外键名
    if ((field === 'columns' || field === 'refTable') && (!fk.name || fk.name === generateFkName(fk))) {
      updated.name = generateFkName(updated)
    }
    return updated
  })
}

function generateFkName(fk: ForeignKeyDefinition): string {
  const tbl = tableName.value || 'table'
  const cols = fk.columns.length > 0 ? fk.columns.join('_') : ''
  return cols ? `fk_${tbl}_${cols}` : ''
}

function newTrigger(): TriggerDefinition {
  return { name: '', timing: 'BEFORE', event: 'INSERT', body: '' }
}
function addTrigger() { pushHistory(); triggers.value = [...triggers.value, newTrigger()] }
function removeTrigger(idx: number) { pushHistory(); triggers.value = triggers.value.filter((_, i) => i !== idx) }
function updateTrigger(idx: number, field: keyof TriggerDefinition, value: string) {
  pushHistory()
  triggers.value = triggers.value.map((t, i) => i === idx ? { ...t, [field]: value } : t)
}

function updateColumn(idx: number, field: keyof ColumnDefinition, value: unknown) {
  pushHistory()
  columns.value = columns.value.map((col, i) => {
    if (i !== idx) return col
    const updated = { ...col, [field]: value }
    // 类型联动默认长度
    if (field === 'dataType') {
      const type = (value as string).toUpperCase()
      if (type in TYPE_DEFAULT_LENGTH) updated.length = TYPE_DEFAULT_LENGTH[type] ?? null
    }
    // 主键联动非空
    if (field === 'isPrimaryKey' && value === true) updated.nullable = false
    // 自增联动主键+非空
    if (field === 'autoIncrement' && value === true) {
      updated.isPrimaryKey = true
      updated.nullable = false
    }
    return updated
  })
  // 主键联动索引
  if (field === 'isPrimaryKey') syncPrimaryKeyIndex()
}

function syncPrimaryKeyIndex() {
  const pkCols = columns.value.filter(c => c.isPrimaryKey).map(c => c.name).filter(Boolean)
  const existingPkIdx = indexes.value.findIndex(i => i.indexType === 'PRIMARY')
  if (pkCols.length > 0) {
    if (existingPkIdx >= 0) {
      indexes.value = indexes.value.map((ix, i) => i === existingPkIdx ? { ...ix, columns: pkCols } : ix)
    } else {
      indexes.value = [...indexes.value, { name: 'PRIMARY', columns: pkCols, indexType: 'PRIMARY' }]
    }
  } else if (existingPkIdx >= 0) {
    indexes.value = indexes.value.filter((_, i) => i !== existingPkIdx)
  }
}

// 复制行 Ctrl+D
function duplicateColumn(idx: number) {
  pushHistory()
  const src = columns.value[idx]
  if (!src) return
  const copy = { ...src, name: src.name ? `${src.name}_copy` : '' }
  columns.value = [...columns.value.slice(0, idx + 1), copy, ...columns.value.slice(idx + 1)]
  selectedRowIdx.value = idx + 1
}

// 删除行（已有字段需确认）
function deleteSelectedColumn() {
  const idx = selectedRowIdx.value
  if (idx === null || idx < 0 || idx >= columns.value.length) return
  const col = columns.value[idx]
  if (!col) return
  if (isAlterMode.value && originalColumns.value.find(c => c.name === col.name)) {
    if (!confirm(`确定删除字段「${col.name}」？此操作将在保存时执行 DROP COLUMN`)) return
  }
  removeColumn(idx)
  selectedRowIdx.value = Math.min(idx, columns.value.length - 1)
  if (columns.value.length === 0) selectedRowIdx.value = null
}

// 行上下移动 Alt+↑/↓
function moveColumn(idx: number, direction: -1 | 1) {
  const target = idx + direction
  if (target < 0 || target >= columns.value.length) return
  pushHistory()
  const arr = [...columns.value]
  ;[arr[idx], arr[target]] = [arr[target], arr[idx]]
  columns.value = arr
  selectedRowIdx.value = target
}

// 拖拽排序（自定义 mouse 实现，避免 HTML5 DnD 在 table 中的兼容问题）
function onGripMouseDown(e: MouseEvent, idx: number) {
  e.preventDefault()
  dragIdx.value = idx
  const startY = e.clientY
  const rows = columnsScrollRef.value?.querySelectorAll('tbody tr') as NodeListOf<HTMLElement> | undefined
  if (!rows) return
  const rowHeight = rows.length > 0 ? rows[0].offsetHeight : 28

  const onMouseMove = (ev: MouseEvent) => {
    const delta = ev.clientY - startY
    const offset = Math.round(delta / rowHeight)
    const target = Math.max(0, Math.min(columns.value.length - 1, idx + offset))
    dragOverIdx.value = target
  }

  const onMouseUp = () => {
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
    const target = dragOverIdx.value
    if (target !== null && target !== idx) {
      pushHistory()
      const arr = [...columns.value]
      const [moved] = arr.splice(idx, 1)
      arr.splice(target, 0, moved)
      columns.value = arr
      selectedRowIdx.value = target
    }
    dragIdx.value = null
    dragOverIdx.value = null
  }

  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}

// 字段模板
const FIELD_TEMPLATES = [
  { label: '主键 ID', col: { name: 'id', dataType: 'BIGINT', length: '20', nullable: false, isPrimaryKey: true, autoIncrement: true, defaultValue: null, onUpdate: null, comment: '主键' } },
  { label: '创建时间', col: { name: 'created_at', dataType: 'DATETIME', length: null, nullable: false, isPrimaryKey: false, autoIncrement: false, defaultValue: 'CURRENT_TIMESTAMP', onUpdate: null, comment: '创建时间' } },
  { label: '更新时间', col: { name: 'updated_at', dataType: 'DATETIME', length: null, nullable: false, isPrimaryKey: false, autoIncrement: false, defaultValue: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP', comment: '更新时间' } },
  { label: '软删除', col: { name: 'deleted', dataType: 'BIT', length: '1', nullable: false, isPrimaryKey: false, autoIncrement: false, defaultValue: '0', onUpdate: null, comment: '是否删除' } },
  { label: '创建人', col: { name: 'creator', dataType: 'VARCHAR', length: '64', nullable: true, isPrimaryKey: false, autoIncrement: false, defaultValue: null, onUpdate: null, comment: '创建人' } },
  { label: '更新人', col: { name: 'updater', dataType: 'VARCHAR', length: '64', nullable: true, isPrimaryKey: false, autoIncrement: false, defaultValue: null, onUpdate: null, comment: '更新人' } },
  { label: '租户 ID', col: { name: 'tenant_id', dataType: 'BIGINT', length: '20', nullable: false, isPrimaryKey: false, autoIncrement: false, defaultValue: '0', onUpdate: null, comment: '租户编号' } },
] as const

function insertTemplate(tpl: typeof FIELD_TEMPLATES[number]) {
  const col = { ...tpl.col } as ColumnDefinition
  // 避免重名
  if (columns.value.find(c => c.name === col.name)) {
    toast.warning(`字段「${col.name}」已存在`)
    return
  }
  pushHistory()
  columns.value = [...columns.value, col]
  if (col.isPrimaryKey) syncPrimaryKeyIndex()
  nextTick(() => {
    if (columnsScrollRef.value) columnsScrollRef.value.scrollTop = columnsScrollRef.value.scrollHeight
  })
}

// 右键菜单
function onColumnContextMenu(e: MouseEvent, idx: number) {
  e.preventDefault()
  contextMenuIdx.value = idx
  selectedRowIdx.value = idx
  contextMenuPos.value = { x: e.clientX, y: e.clientY }
  showContextMenu.value = true
}

function closeContextMenu() { showContextMenu.value = false }

function contextInsertAbove() {
  const idx = contextMenuIdx.value
  columns.value = [...columns.value.slice(0, idx), newColumn(), ...columns.value.slice(idx)]
  selectedRowIdx.value = idx
  closeContextMenu()
}

function contextInsertBelow() {
  const idx = contextMenuIdx.value
  columns.value = [...columns.value.slice(0, idx + 1), newColumn(), ...columns.value.slice(idx + 1)]
  selectedRowIdx.value = idx + 1
  closeContextMenu()
}

function contextDuplicate() {
  duplicateColumn(contextMenuIdx.value)
  closeContextMenu()
}

function contextDelete() {
  selectedRowIdx.value = contextMenuIdx.value
  deleteSelectedColumn()
  closeContextMenu()
}

function contextTogglePK() {
  const col = columns.value[idx]
  if (!col) {
    closeContextMenu()
    return
  }
  updateColumn(idx, 'isPrimaryKey', !col.isPrimaryKey)
  closeContextMenu()
}

function contextCopyName() {
  const name = columns.value[contextMenuIdx.value]?.name
  if (name) navigator.clipboard.writeText(name)
  closeContextMenu()
}

async function showDdlInfo() {
  if (!props.table) { toast.info('当前为新建表模式，暂无 DDL 信息'); return }
  activeTab.value = 'ddl'
  ddlLoading.value = true
  try {
    ddlContent.value = await getTableDdl(props.connectionId, props.database, props.table)
  } catch (e) { toast.error(String(e)); activeTab.value = 'columns' }
  finally { ddlLoading.value = false }
}

async function copyToClipboard(text: string, flag: 'ddl' | 'sql') {
  try {
    await navigator.clipboard.writeText(text)
    if (flag === 'ddl') { ddlCopied.value = true; setTimeout(() => ddlCopied.value = false, 2000) }
    else { sqlCopied.value = true; setTimeout(() => sqlCopied.value = false, 2000) }
  } catch { toast.error('复制失败') }
}

// SQL 语法高亮（简单正则着色）
function highlightSql(sql: string): string {
  if (!sql) return ''
  // 先转义 HTML
  let escaped = sql.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  // 用占位符保护字符串字面量
  const strings: string[] = []
  escaped = escaped.replace(/'[^']*'/g, (m) => { strings.push(m); return `__STR${strings.length - 1}__` })
  // 高亮关键字（先用占位符）
  const kwSpans: string[] = []
  escaped = escaped.replace(/\b(CREATE|TABLE|ALTER|ADD|MODIFY|DROP|COLUMN|INDEX|PRIMARY|KEY|UNIQUE|FOREIGN|REFERENCES|NOT|NULL|DEFAULT|AUTO_INCREMENT|ON|UPDATE|DELETE|CASCADE|SET|ENGINE|CHARSET|COLLATE|COMMENT|IF|EXISTS|INT|BIGINT|VARCHAR|CHAR|TEXT|DECIMAL|DATETIME|TIMESTAMP|DATE|BOOLEAN|JSON|BLOB|ENUM|FLOAT|DOUBLE|AFTER|FIRST|CONSTRAINT|FULLTEXT|USING|BTREE|HASH|TINYINT|SMALLINT|MEDIUMINT|MEDIUMTEXT|LONGTEXT|VARBINARY|BINARY|BIT|YEAR|TIME|NUMERIC|UNSIGNED|CHARACTER)\b/gi,
    (m) => { kwSpans.push(m); return `__KW${kwSpans.length - 1}__` })
  // 高亮数字（现在安全了，没有 HTML 标签干扰）
  escaped = escaped.replace(/\b(\d+)\b/g, '<span class="text-amber-400">$1</span>')
  // 还原关键字
  escaped = escaped.replace(/__KW(\d+)__/g, (_, i) => `<span class="text-blue-400">${kwSpans[Number(i)]}</span>`)
  // 还原字符串字面量
  escaped = escaped.replace(/__STR(\d+)__/g, (_, i) => `<span class="text-green-400">${strings[Number(i)]}</span>`)
  return escaped
}

// 键盘快捷键
function handleKeydown(e: KeyboardEvent) {
  // 关闭右键菜单 / 索引列下拉 / 类型下拉
  if (e.key === 'Escape') { showContextMenu.value = false; indexColumnDropdown.value = null; typeDropdownIdx.value = null; return }
  // Ctrl+S 保存
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault(); e.stopPropagation()
    if (!loading.value && !executing.value) handleExecuteSql()
    return
  }
  // Ctrl+Z 撤销 / Ctrl+Shift+Z 重做
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    e.preventDefault(); e.stopPropagation()
    if (e.shiftKey) redo(); else undo()
    return
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
    e.preventDefault(); e.stopPropagation()
    redo()
    return
  }
  // 以下快捷键仅在字段 Tab 生效
  if (activeTab.value !== 'columns') return
  const idx = selectedRowIdx.value
  // Ctrl+D 复制行
  if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
    e.preventDefault()
    if (idx !== null) duplicateColumn(idx)
    return
  }
  // Delete 删除行（非输入框内）
  if (e.key === 'Delete' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
    e.preventDefault()
    deleteSelectedColumn()
    return
  }
  // Alt+↑ 上移
  if (e.altKey && e.key === 'ArrowUp') {
    e.preventDefault()
    if (idx !== null) moveColumn(idx, -1)
    return
  }
  // Alt+↓ 下移
  if (e.altKey && e.key === 'ArrowDown') {
    e.preventDefault()
    if (idx !== null) moveColumn(idx, 1)
    return
  }
  // ↑/↓ 选择行（非输入框内）
  if (!e.ctrlKey && !e.altKey && !e.metaKey && !(e.target instanceof HTMLInputElement)) {
    if (e.key === 'ArrowUp' && idx !== null && idx > 0) {
      e.preventDefault(); selectedRowIdx.value = idx - 1; return
    }
    if (e.key === 'ArrowDown' && idx !== null && idx < columns.value.length - 1) {
      e.preventDefault(); selectedRowIdx.value = idx + 1; return
    }
  }
}

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown, true)
})

function updateIndex(idx: number, field: keyof IndexDefinition, value: unknown) {
  pushHistory()
  indexes.value = indexes.value.map((ix, i) => {
    if (i !== idx) return ix
    const updated = { ...ix, [field]: value }
    // 类型变更时自动更新名称
    if (field === 'indexType') {
      const shouldAutoName = !ix.name || ix.name === generateIndexName(ix.indexType, ix.columns)
      if (shouldAutoName) updated.name = generateIndexName(value as string, ix.columns)
    }
    return updated
  })
}

function updateIndexColumns(idx: number, value: string) {
  updateIndex(idx, 'columns', value.split(',').map(s => s.trim()).filter(Boolean))
}

// 索引列多选
const columnNames = computed(() => columns.value.map(c => c.name).filter(Boolean))

function toggleIndexColumn(idxIdx: number, colName: string) {
  const ix = indexes.value[idxIdx]
  if (!ix) return
  pushHistory()
  const cols = ix.columns.includes(colName)
    ? ix.columns.filter(c => c !== colName)
    : [...ix.columns, colName]
  const autoName = generateIndexName(ix.indexType, cols)
  const shouldAutoName = !ix.name || ix.name === generateIndexName(ix.indexType, ix.columns)
  indexes.value = indexes.value.map((item, i) => i === idxIdx ? { ...item, columns: cols, ...(shouldAutoName ? { name: autoName } : {}) } : item)
}

function generateIndexName(indexType: string, cols: string[]): string {
  if (indexType === 'PRIMARY') return 'PRIMARY'
  const tbl = tableName.value || 'table'
  const prefix = indexType === 'UNIQUE' ? 'uk' : indexType === 'FULLTEXT' ? 'ft' : 'idx'
  const colPart = cols.length > 0 ? cols.join('_') : ''
  return colPart ? `${prefix}_${tbl}_${colPart}` : ''
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
    originalTableEngine.value = tableEngine.value
    originalTableCharset.value = tableCharset.value
    originalTableCollation.value = tableCollation.value
    originalTableComment.value = tableComment.value
    columns.value = detail.columns.map(c => {
      let dataType = c.dataType ?? ''
      let length = c.length ?? null
      if (!length && dataType) {
        const m = dataType.match(/^(\w+)\((.+)\)$/)
        if (m && m[1] && m[2]) { dataType = m[1].toUpperCase(); length = m[2] }
      }
      if (dataType) dataType = dataType.toUpperCase()
      return { ...c, dataType, length, isPrimaryKey: c.isPrimaryKey ?? false, onUpdate: c.onUpdate ?? null }
    })
    originalColumns.value = columns.value.map(c => ({ ...c }))
    indexes.value = detail.indexes.map(i => ({ ...i }))
    originalIndexes.value = detail.indexes.map(i => ({ ...i }))
    foreignKeys.value = (detail.foreignKeys ?? []).map(fk => ({ ...fk, columns: [...fk.columns], refColumns: [...fk.refColumns] }))
    originalForeignKeys.value = foreignKeys.value.map(fk => ({ ...fk, columns: [...fk.columns], refColumns: [...fk.refColumns] }))
  } catch (e) { toast.error(String(e)) }
  finally { loading.value = false }
}

function buildTableDefinition(): TableDefinition {
  return {
    name: tableName.value, database: props.database, columns: columns.value, indexes: indexes.value,
    foreignKeys: foreignKeys.value, engine: isMysql.value ? tableEngine.value : null,
    charset: isMysql.value ? tableCharset.value : null, collation: isMysql.value ? tableCollation.value : null,
    comment: tableComment.value || null,
  }
}

function buildTableAlteration(): TableAlteration {
  const columnChanges: ColumnChange[] = []
  for (const col of columns.value) {
    const orig = originalColumns.value.find(c => c.name === col.name)
    if (!orig) columnChanges.push({ changeType: 'add', column: col, oldName: null, afterColumn: null })
    else if (JSON.stringify(orig) !== JSON.stringify(col))
      columnChanges.push({ changeType: 'modify', column: col, oldName: col.name, afterColumn: null })
  }
  for (const orig of originalColumns.value) {
    if (!columns.value.find(c => c.name === orig.name))
      columnChanges.push({ changeType: 'drop', column: orig, oldName: orig.name, afterColumn: null })
  }
  const indexChanges: IndexChange[] = []
  for (const ix of indexes.value) {
    if (!originalIndexes.value.find(i => i.name === ix.name))
      indexChanges.push({ changeType: 'add', index: ix })
  }
  for (const orig of originalIndexes.value) {
    if (!indexes.value.find(i => i.name === orig.name))
      indexChanges.push({ changeType: 'drop', index: orig })
  }
  return {
    database: props.database, table: props.table!, columnChanges, indexChanges,
    newName: tableName.value !== props.table ? tableName.value : null,
    newComment: tableComment.value !== originalTableComment.value ? (tableComment.value || null) : null,
    newEngine: isMysql.value && tableEngine.value !== originalTableEngine.value ? tableEngine.value : null,
    newCharset: isMysql.value && tableCharset.value !== originalTableCharset.value ? tableCharset.value : null,
  }
}

async function previewSql() {
  if (columns.value.length === 0) { toast.warning(t('tableEditor.noColumns')); return }
  if (!tableName.value.trim()) { toast.warning('请输入表名'); return }
  if (isAlterMode.value && !hasChanges.value) { toast.info('没有变更'); return }
  loading.value = true
  try {
    const result = isAlterMode.value
      ? await generateAlterTableSql(buildTableAlteration(), props.driver)
      : await generateCreateTableSql(buildTableDefinition(), props.driver)
    if (!result.sql?.trim()) { toast.info('没有需要执行的变更'); return }
    generatedSql.value = result.sql
    showSqlPreview.value = true
  } catch (e) { toast.error(String(e)); console.error('[previewSql]', e) }
  finally { loading.value = false }
}

async function handleExecuteSql() {
  if (!generatedSql.value) { await previewSql(); if (!generatedSql.value) return }
  executing.value = true
  try {
    await executeDdl(props.connectionId, generatedSql.value)
    toast.success(isAlterMode.value ? t('tableEditor.alterTable') : t('tableEditor.createTable'))
    emit('success')
  } catch (e) { toast.error(String(e)) }
  finally { executing.value = false }
}

function openTypeDropdown(idx: number) {
  typeDropdownIdx.value = typeDropdownIdx.value === idx ? null : idx
  typeSearchQuery.value = ''
  if (typeDropdownIdx.value !== null) {
    nextTick(() => {
      const el = document.querySelector('.type-search-input') as HTMLInputElement
      if (el) el.focus()
    })
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown, true)
  if (isAlterMode.value) { loadTableDetail() }
  else {
    tableName.value = ''; tableEngine.value = 'InnoDB'; tableCharset.value = 'utf8mb4'
    tableCollation.value = 'utf8mb4_unicode_ci'; tableComment.value = ''
    columns.value = [newColumn()]; indexes.value = []; foreignKeys.value = []
    originalColumns.value = []; originalIndexes.value = []; originalForeignKeys.value = []
  }
})
</script>

<template>
  <div class="absolute inset-0 flex flex-col overflow-hidden bg-background" @click="indexColumnDropdown = null; typeDropdownIdx = null">
    <!-- Header bar -->
    <div class="flex items-center gap-2 border-b border-border px-2.5 py-1.5 shrink-0 bg-muted/30">
      <div class="flex items-center gap-1.5 text-xs font-medium text-foreground/80">
        <Table2 class="size-3.5 text-primary/70" />
        <span v-if="connectionHost" class="text-muted-foreground/60 font-mono">{{ connectionHost }}</span>
        <span v-if="connectionHost" class="text-muted-foreground/40">/</span>
        <span v-if="isAlterMode" class="font-mono">{{ props.database }}.{{ tableName }}</span>
        <span v-else class="text-muted-foreground italic">新建表</span>
      </div>
      <div class="flex-1" />
      <Button variant="ghost" size="sm" class="h-6 text-[11px] gap-1 text-muted-foreground" :disabled="loading || executing" @click="previewSql">
        <Code class="size-3" />预览
      </Button>
      <div class="w-px h-4 bg-border" />
      <Button size="sm" class="h-6 text-[11px] gap-1" :disabled="loading || executing || (!hasChanges && isAlterMode) || validationErrors.length > 0" @click="handleExecuteSql">
        <Loader2 v-if="executing" class="size-3 animate-spin" />
        <Play v-else class="size-3" />
        {{ isAlterMode ? '保存修改' : '创建表' }}
      </Button>
    </div>

    <!-- Collapsible metadata -->
    <div class="border-b border-border shrink-0">
      <button class="flex items-center gap-1.5 w-full px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground/80 transition-colors" @click="metaCollapsed = !metaCollapsed">
        <ChevronRight class="size-3 transition-transform" :class="{ 'rotate-90': !metaCollapsed }" />
        <span class="font-medium">表属性</span>
      </button>
      <div v-show="!metaCollapsed" class="grid grid-cols-3 gap-x-3 gap-y-1.5 px-2.5 pb-2 text-xs">
        <div class="flex items-center gap-1.5">
          <span class="text-muted-foreground/70 w-10 shrink-0 text-right text-[11px]">表名</span>
          <Input v-model="tableName" class="h-5 text-xs flex-1 font-mono" />
        </div>
        <div class="flex items-center gap-1.5">
          <span class="text-muted-foreground/70 w-10 shrink-0 text-right text-[11px]">引擎</span>
          <Select v-if="isMysql" v-model="tableEngine">
            <SelectTrigger class="h-5 text-xs flex-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="InnoDB">InnoDB</SelectItem>
              <SelectItem value="MyISAM">MyISAM</SelectItem>
              <SelectItem value="MEMORY">MEMORY</SelectItem>
            </SelectContent>
          </Select>
          <span v-else class="text-xs text-muted-foreground/50">-</span>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="text-muted-foreground/70 w-10 shrink-0 text-right text-[11px]">字符集</span>
          <Input v-if="isMysql" v-model="tableCharset" class="h-5 text-xs flex-1 font-mono" />
          <span v-else class="text-xs text-muted-foreground/50">-</span>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="text-muted-foreground/70 w-10 shrink-0 text-right text-[11px]">排序</span>
          <Input v-if="isMysql" v-model="tableCollation" class="h-5 text-xs flex-1 font-mono" />
          <span v-else class="text-xs text-muted-foreground/50">-</span>
        </div>
        <div class="flex items-center gap-1.5 col-span-2">
          <span class="text-muted-foreground/70 w-10 shrink-0 text-right text-[11px]">注释</span>
          <Input v-model="tableComment" class="h-5 text-xs flex-1" />
        </div>
        <div v-if="isMysql" class="flex items-center gap-1.5">
          <span class="text-muted-foreground/70 w-10 shrink-0 text-right text-[11px]">自增</span>
          <Input v-model="tableAutoIncrement" class="h-5 text-xs flex-1 font-mono" placeholder="1" />
        </div>
        <div v-if="isMysql" class="flex items-center gap-1.5">
          <span class="text-muted-foreground/70 w-10 shrink-0 text-right text-[11px]">行格式</span>
          <Select v-model="tableRowFormat">
            <SelectTrigger class="h-5 text-xs flex-1"><SelectValue placeholder="默认" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="DEFAULT" class="text-xs">默认</SelectItem>
              <SelectItem value="DYNAMIC" class="text-xs">DYNAMIC</SelectItem>
              <SelectItem value="COMPACT" class="text-xs">COMPACT</SelectItem>
              <SelectItem value="REDUNDANT" class="text-xs">REDUNDANT</SelectItem>
              <SelectItem value="COMPRESSED" class="text-xs">COMPRESSED</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>

    <!-- Tab bar -->
    <div class="flex items-center border-b border-border shrink-0 px-1 bg-muted/10">
      <button
        v-for="tab in [{k:'columns',l:'字段',icon: Columns3},{k:'indexes',l:'索引',icon: Key},{k:'foreignKeys',l:'外键',icon: Link2},{k:'triggers',l:'触发器',icon: Zap},{k:'ddl',l:'DDL',icon: FileCode}]"
        :key="tab.k"
        class="relative flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium transition-colors"
        :class="activeTab === tab.k ? 'text-foreground' : 'text-muted-foreground hover:text-foreground/70'"
        @click="tab.k === 'ddl' ? showDdlInfo() : (activeTab = tab.k)"
      >
        <component :is="tab.icon" class="size-3" />
        {{ tab.l }}
        <span v-if="tab.k === 'columns'" class="text-muted-foreground/50 ml-0.5">({{ columns.length }})</span>
        <span v-if="tab.k === 'indexes'" class="text-muted-foreground/50 ml-0.5">({{ indexes.length }})</span>
        <span v-if="tab.k === 'foreignKeys'" class="text-muted-foreground/50 ml-0.5">({{ foreignKeys.length }})</span>
        <span v-if="tab.k === 'triggers'" class="text-muted-foreground/50 ml-0.5">({{ triggers.length }})</span>
        <span v-if="activeTab === tab.k" class="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-full" />
      </button>
      <div class="flex-1" />
      <template v-if="activeTab === 'columns'">
        <div class="relative">
          <Search class="absolute left-1.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground/50" />
          <input v-model="columnFilter" class="h-6 w-28 pl-5 pr-1.5 text-[11px] bg-transparent border border-border/60 rounded focus:border-primary/50 focus:outline-none focus:w-40 transition-all" placeholder="搜索字段..." />
        </div>
        <Button v-if="selectedRows.size > 0" variant="ghost" size="sm" class="h-6 text-[11px] gap-1 px-2 text-destructive hover:text-destructive" @click="batchDelete">
          <Trash2 class="size-3" />删除 ({{ selectedRows.size }})
        </Button>
        <Select @update:model-value="(v) => { const tpl = FIELD_TEMPLATES.find(t => t.label === (v as string)); if (tpl) insertTemplate(tpl) }">
          <SelectTrigger class="h-6 text-[11px] w-auto gap-1 px-2 border-dashed text-muted-foreground">
            <span>模板</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="tpl in FIELD_TEMPLATES" :key="tpl.label" :value="tpl.label" class="text-xs">{{ tpl.label }}</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" class="h-6 text-[11px] gap-1 px-2" @click="addColumn()">
          <Plus class="size-3" />添加字段
        </Button>
      </template>
      <Button v-else-if="activeTab === 'indexes'" variant="outline" size="sm" class="h-6 text-[11px] gap-1 px-2" @click="addIndex()">
        <Plus class="size-3" />添加索引
      </Button>
      <Button v-else-if="activeTab === 'foreignKeys'" variant="outline" size="sm" class="h-6 text-[11px] gap-1 px-2" @click="addForeignKey()">
        <Plus class="size-3" />添加外键
      </Button>
      <Button v-else-if="activeTab === 'triggers'" variant="outline" size="sm" class="h-6 text-[11px] gap-1 px-2" @click="addTrigger()">
        <Plus class="size-3" />添加触发器
      </Button>
    </div>

    <!-- Content -->
    <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
      <!-- Columns tab -->
      <div v-if="activeTab === 'columns'" class="flex flex-col flex-1 min-h-0">
        <div v-if="loading" class="flex flex-1 items-center justify-center">
          <Loader2 class="size-5 animate-spin text-muted-foreground" />
        </div>
        <div v-else ref="columnsScrollRef" class="flex-1 min-h-0 overflow-auto">
          <table class="w-full border-collapse text-xs">
            <thead class="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
              <tr class="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">
                <th class="border-b border-border px-1 py-1.5 w-10 text-center">
                  <label class="inline-flex items-center justify-center size-3.5 rounded border cursor-pointer transition-colors" :class="allSelected ? 'bg-primary border-primary text-primary-foreground' : 'border-border hover:border-foreground/30'">
                    <input type="checkbox" :checked="allSelected" class="sr-only" @change="toggleSelectAll" />
                    <span v-if="allSelected" class="text-[8px] font-bold leading-none">✓</span>
                  </label>
                </th>
                <th class="border-b border-border px-2 py-1.5 min-w-[130px]">名称</th>
                <th class="border-b border-border px-2 py-1.5 min-w-[120px]">类型</th>
                <th class="border-b border-border px-2 py-1.5 w-16 text-center">长度</th>
                <th class="border-b border-border px-2 py-1.5 w-10 text-center">主键</th>
                <th class="border-b border-border px-2 py-1.5 w-10 text-center">非空</th>
                <th class="border-b border-border px-2 py-1.5 w-10 text-center">自增</th>
                <th class="border-b border-border px-2 py-1.5 min-w-[90px]">默认值</th>
                <th v-if="isMysql" class="border-b border-border px-2 py-1.5 min-w-[90px]">更新时</th>
                <th class="border-b border-border px-2 py-1.5 min-w-[130px]">注释</th>
                <th class="border-b border-border px-2 py-1.5 w-7" />
              </tr>
            </thead>
            <tbody>
              <tr v-if="filteredColumnIndices.length === 0">
                <td :colspan="isMysql ? 11 : 10" class="text-center text-muted-foreground/60 py-8 text-xs">{{ columns.length === 0 ? '暂无字段，点击上方「添加」按钮' : '无匹配字段' }}</td>
              </tr>
              <tr
                v-for="idx in filteredColumnIndices" :key="idx"
                class="group transition-colors relative cursor-pointer"
                :class="[
                  selectedRowIdx === idx ? 'bg-primary/5 ring-1 ring-inset ring-primary/20' : (idx % 2 === 0 ? 'bg-transparent' : 'bg-muted/20'),
                  getColumnChangeType(columns[idx] as ColumnDefinition, idx) === 'add' ? 'border-l-2 border-l-green-500' : '',
                  getColumnChangeType(columns[idx] as ColumnDefinition, idx) === 'modify' ? 'border-l-2 border-l-orange-500' : '',
                  dragOverIdx === idx && dragIdx !== idx ? 'ring-1 ring-inset ring-primary/40' : '',
                  dragIdx === idx ? 'opacity-40' : '',
                ]"
                @click="selectedRowIdx = idx"
                @contextmenu="onColumnContextMenu($event, idx)"
              >
                <td class="border-b border-border/50 px-0.5 py-0.5 text-center">
                  <div class="flex items-center justify-center gap-0.5">
                    <label class="inline-flex items-center justify-center size-3.5 rounded border cursor-pointer transition-colors shrink-0" :class="selectedRows.has(idx) ? 'bg-primary border-primary text-primary-foreground' : 'border-border/60 hover:border-foreground/30'" @click.stop>
                      <input type="checkbox" :checked="selectedRows.has(idx)" class="sr-only" @change="toggleRowSelect(idx)" />
                      <span v-if="selectedRows.has(idx)" class="text-[8px] font-bold leading-none">✓</span>
                    </label>
                    <GripVertical class="size-3 text-muted-foreground/30 group-hover:text-muted-foreground/60 cursor-grab active:cursor-grabbing" @mousedown="onGripMouseDown($event, idx)" />
                  </div>
                </td>
                <td class="border-b border-border/50 p-0.5">
                  <input :value="columns[idx]?.name" class="w-full h-6 px-1.5 text-xs font-mono bg-transparent border rounded focus:border-primary/50 focus:outline-none focus:bg-background hover:border-border/60" :class="hasError(idx, 'name') ? 'border-red-500/60' : 'border-transparent'" :title="getError(idx, 'name')" @input="updateColumn(idx, 'name', ($event.target as HTMLInputElement).value)" />
                </td>
                <td class="border-b border-border/50 p-0.5 relative">
                  <button
                    class="w-full h-6 px-1.5 text-xs font-mono bg-transparent border border-transparent rounded hover:border-border/60 focus:border-primary/50 focus:outline-none text-left truncate"
                    :class="[hasError(idx, 'dataType') ? 'border-red-500/60' : '', !columns[idx]?.dataType ? 'text-muted-foreground/40' : '']"
                    @click.stop="openTypeDropdown(idx)"
                  >
                    {{ columns[idx]?.dataType || '选择类型' }}
                  </button>
                  <div v-if="typeDropdownIdx === idx" class="absolute left-0 top-7 z-30 bg-popover border border-border rounded-md shadow-lg min-w-[160px] max-h-56 flex flex-col" @click.stop>
                    <div class="p-1 border-b border-border">
                      <input
                        v-model="typeSearchQuery"
                        class="type-search-input w-full h-6 px-2 text-xs font-mono bg-background border border-border rounded focus:border-primary/50 focus:outline-none"
                        placeholder="搜索类型..."
                        @keydown.enter.prevent="filteredTypes.length > 0 && (updateColumn(idx, 'dataType', filteredTypes[0]), typeDropdownIdx = null)"
                        @keydown.escape="typeDropdownIdx = null"
                      />
                    </div>
                    <div class="overflow-auto flex-1 py-1">
                      <button
                        v-for="type in filteredTypes" :key="type"
                        class="w-full px-3 py-1 text-left text-xs font-mono hover:bg-accent"
                        :class="columns[idx]?.dataType === type ? 'bg-accent/50 text-primary' : ''"
                        @click="updateColumn(idx, 'dataType', type); typeDropdownIdx = null"
                      >
                        {{ type }}
                      </button>
                      <div v-if="filteredTypes.length === 0" class="px-3 py-2 text-xs text-muted-foreground/60">无匹配类型</div>
                    </div>
                  </div>
                </td>
                <td class="border-b border-border/50 p-0.5">
                  <input :value="columns[idx].length ?? ''" :disabled="NO_LENGTH_TYPES.has(columns[idx].dataType.toUpperCase())" class="w-full h-6 px-1 text-xs font-mono bg-transparent border border-transparent rounded focus:border-primary/50 focus:outline-none focus:bg-background hover:border-border/60 text-center disabled:opacity-30 disabled:cursor-not-allowed" :placeholder="NO_LENGTH_TYPES.has(columns[idx].dataType.toUpperCase()) ? '' : '-'" @input="updateColumn(idx, 'length', ($event.target as HTMLInputElement).value || null)" />
                </td>
                <td class="border-b border-border/50 px-1 py-0.5 text-center">
                  <label class="inline-flex items-center justify-center size-4 rounded border cursor-pointer transition-colors" :class="columns[idx].isPrimaryKey ? 'bg-primary border-primary text-primary-foreground' : 'border-border hover:border-foreground/30'">
                    <input type="checkbox" :checked="columns[idx].isPrimaryKey" class="sr-only" @change="updateColumn(idx, 'isPrimaryKey', ($event.target as HTMLInputElement).checked)" />
                    <Key v-if="columns[idx].isPrimaryKey" class="size-2.5" />
                  </label>
                </td>
                <td class="border-b border-border/50 px-1 py-0.5 text-center">
                  <label class="inline-flex items-center justify-center size-4 rounded border cursor-pointer transition-colors" :class="!columns[idx].nullable ? 'bg-orange-500/80 border-orange-500/80 text-white' : 'border-border hover:border-foreground/30'">
                    <input type="checkbox" :checked="!columns[idx].nullable" class="sr-only" @change="updateColumn(idx, 'nullable', !($event.target as HTMLInputElement).checked)" />
                    <span v-if="!columns[idx].nullable" class="text-[9px] font-bold leading-none">!</span>
                  </label>
                </td>
                <td class="border-b border-border/50 px-1 py-0.5 text-center">
                  <label class="inline-flex items-center justify-center size-4 rounded border cursor-pointer transition-colors" :class="columns[idx].autoIncrement ? 'bg-blue-500/80 border-blue-500/80 text-white' : 'border-border hover:border-foreground/30'">
                    <input type="checkbox" :checked="columns[idx].autoIncrement" class="sr-only" @change="updateColumn(idx, 'autoIncrement', ($event.target as HTMLInputElement).checked)" />
                    <span v-if="columns[idx].autoIncrement" class="text-[9px] font-bold leading-none">+</span>
                  </label>
                </td>
                <td class="border-b border-border/50 p-0.5">
                  <input :value="columns[idx].defaultValue ?? ''" class="w-full h-6 px-1.5 text-xs font-mono bg-transparent border border-transparent rounded focus:border-primary/50 focus:outline-none focus:bg-background hover:border-border/60" placeholder="NULL" @input="updateColumn(idx, 'defaultValue', ($event.target as HTMLInputElement).value || null)" />
                </td>
                <td v-if="isMysql" class="border-b border-border/50 p-0.5">
                  <input :value="columns[idx].onUpdate ?? ''" class="w-full h-6 px-1.5 text-xs font-mono bg-transparent border border-transparent rounded focus:border-primary/50 focus:outline-none focus:bg-background hover:border-border/60 text-muted-foreground" placeholder="-" @input="updateColumn(idx, 'onUpdate', ($event.target as HTMLInputElement).value || null)" />
                </td>
                <td class="border-b border-border/50 p-0.5">
                  <input :value="columns[idx].comment ?? ''" class="w-full h-6 px-1.5 text-xs bg-transparent border border-transparent rounded focus:border-primary/50 focus:outline-none focus:bg-background hover:border-border/60 text-muted-foreground" placeholder="-" @input="updateColumn(idx, 'comment', ($event.target as HTMLInputElement).value || null)" />
                </td>
                <td class="border-b border-border/50 px-0.5 py-0.5 text-center">
                  <button class="size-5 inline-flex items-center justify-center rounded opacity-0 group-hover:opacity-100 text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-all" @click="removeColumn(idx)">
                    <X class="size-3" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Indexes tab -->
      <div v-if="activeTab === 'indexes'" class="flex flex-col flex-1 min-h-0">
        <div v-if="loading" class="flex flex-1 items-center justify-center">
          <Loader2 class="size-5 animate-spin text-muted-foreground" />
        </div>
        <div v-else class="flex-1 min-h-0 overflow-auto">
          <table class="w-full border-collapse text-xs">
            <thead class="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
              <tr class="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">
                <th class="border-b border-border px-2 py-1.5 w-7 text-center">#</th>
                <th class="border-b border-border px-2 py-1.5 min-w-[160px]">名称</th>
                <th class="border-b border-border px-2 py-1.5 min-w-[120px]">类型</th>
                <th class="border-b border-border px-2 py-1.5 min-w-[220px]">列</th>
                <th class="border-b border-border px-2 py-1.5 w-7" />
              </tr>
            </thead>
            <tbody>
              <tr v-if="indexes.length === 0">
                <td colspan="5" class="text-center text-muted-foreground/60 py-8 text-xs">暂无索引，点击上方「添加」按钮</td>
              </tr>
              <tr
                v-for="(ix, idx) in indexes" :key="idx"
                class="group transition-colors"
                :class="idx % 2 === 0 ? 'bg-transparent' : 'bg-muted/20'"
              >
                <td class="border-b border-border/50 px-2 py-0.5 text-center text-[10px] text-muted-foreground/40 tabular-nums">{{ idx + 1 }}</td>
                <td class="border-b border-border/50 p-0.5">
                  <input :value="ix.name" class="w-full h-6 px-1.5 text-xs font-mono bg-transparent border border-transparent rounded focus:border-primary/50 focus:outline-none focus:bg-background hover:border-border/60" @input="updateIndex(idx, 'name', ($event.target as HTMLInputElement).value)" />
                </td>
                <td class="border-b border-border/50 p-0.5">
                  <Select :model-value="ix.indexType" @update:model-value="updateIndex(idx, 'indexType', $event)">
                    <SelectTrigger class="h-6 text-xs font-mono border-transparent hover:border-border/60 focus:border-primary/50">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem v-for="t in INDEX_TYPES" :key="t" :value="t" class="text-xs font-mono">{{ t }}</SelectItem>
                    </SelectContent>
                  </Select>
                </td>
                <td class="border-b border-border/50 p-0.5 relative">
                  <button
                    class="w-full h-6 px-1.5 text-xs font-mono bg-transparent border border-transparent rounded hover:border-border/60 focus:border-primary/50 focus:outline-none text-left truncate"
                    :class="ix.columns.length === 0 ? 'text-muted-foreground/40' : ''"
                    @click="indexColumnDropdown = indexColumnDropdown === idx ? null : idx"
                  >
                    {{ ix.columns.length > 0 ? ix.columns.join(', ') : '选择列...' }}
                  </button>
                  <div v-if="indexColumnDropdown === idx" class="absolute left-0 top-7 z-30 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[180px] max-h-48 overflow-auto">
                    <div v-if="columnNames.length === 0" class="px-3 py-2 text-xs text-muted-foreground/60">暂无可用字段</div>
                    <button
                      v-for="cn in columnNames" :key="cn"
                      class="w-full px-3 py-1 text-left text-xs font-mono hover:bg-accent flex items-center gap-2"
                      @click.stop="toggleIndexColumn(idx, cn)"
                    >
                      <span class="size-3.5 border rounded flex items-center justify-center shrink-0" :class="ix.columns.includes(cn) ? 'bg-primary border-primary text-primary-foreground' : 'border-border'">
                        <span v-if="ix.columns.includes(cn)" class="text-[10px]">✓</span>
                      </span>
                      {{ cn }}
                    </button>
                  </div>
                </td>
                <td class="border-b border-border/50 px-0.5 py-0.5 text-center">
                  <button class="size-5 inline-flex items-center justify-center rounded opacity-0 group-hover:opacity-100 text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-all" @click="removeIndex(idx)">
                    <X class="size-3" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Foreign Keys tab -->
      <div v-if="activeTab === 'foreignKeys'" class="flex flex-col flex-1 min-h-0">
        <div class="flex-1 min-h-0 overflow-auto">
          <table class="w-full border-collapse text-xs">
            <thead class="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
              <tr class="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">
                <th class="border-b border-border px-2 py-1.5 w-7 text-center">#</th>
                <th class="border-b border-border px-2 py-1.5 min-w-[140px]">名称</th>
                <th class="border-b border-border px-2 py-1.5 min-w-[140px]">本表列</th>
                <th class="border-b border-border px-2 py-1.5 min-w-[120px]">引用表</th>
                <th class="border-b border-border px-2 py-1.5 min-w-[120px]">引用列</th>
                <th class="border-b border-border px-2 py-1.5 w-24">ON DELETE</th>
                <th class="border-b border-border px-2 py-1.5 w-24">ON UPDATE</th>
                <th class="border-b border-border px-2 py-1.5 w-7" />
              </tr>
            </thead>
            <tbody>
              <tr v-if="foreignKeys.length === 0">
                <td colspan="8" class="text-center text-muted-foreground/60 py-8 text-xs">暂无外键，点击上方「添加」按钮</td>
              </tr>
              <tr
                v-for="(fk, idx) in foreignKeys" :key="idx"
                class="group transition-colors"
                :class="idx % 2 === 0 ? 'bg-transparent' : 'bg-muted/20'"
              >
                <td class="border-b border-border/50 px-2 py-0.5 text-center text-[10px] text-muted-foreground/40 tabular-nums">{{ idx + 1 }}</td>
                <td class="border-b border-border/50 p-0.5">
                  <input :value="fk.name" class="w-full h-6 px-1.5 text-xs font-mono bg-transparent border border-transparent rounded focus:border-primary/50 focus:outline-none focus:bg-background hover:border-border/60" @input="updateForeignKey(idx, 'name', ($event.target as HTMLInputElement).value)" />
                </td>
                <td class="border-b border-border/50 p-0.5">
                  <input :value="fk.columns.join(', ')" class="w-full h-6 px-1.5 text-xs font-mono bg-transparent border border-transparent rounded focus:border-primary/50 focus:outline-none focus:bg-background hover:border-border/60" placeholder="col1, col2" @input="updateForeignKey(idx, 'columns', ($event.target as HTMLInputElement).value.split(',').map((s: string) => s.trim()).filter(Boolean))" />
                </td>
                <td class="border-b border-border/50 p-0.5">
                  <input :value="fk.refTable" class="w-full h-6 px-1.5 text-xs font-mono bg-transparent border border-transparent rounded focus:border-primary/50 focus:outline-none focus:bg-background hover:border-border/60" placeholder="表名" @input="updateForeignKey(idx, 'refTable', ($event.target as HTMLInputElement).value)" />
                </td>
                <td class="border-b border-border/50 p-0.5">
                  <input :value="fk.refColumns.join(', ')" class="w-full h-6 px-1.5 text-xs font-mono bg-transparent border border-transparent rounded focus:border-primary/50 focus:outline-none focus:bg-background hover:border-border/60" placeholder="col1" @input="updateForeignKey(idx, 'refColumns', ($event.target as HTMLInputElement).value.split(',').map((s: string) => s.trim()).filter(Boolean))" />
                </td>
                <td class="border-b border-border/50 p-0.5">
                  <Select :model-value="fk.onDelete ?? 'NO ACTION'" @update:model-value="updateForeignKey(idx, 'onDelete', $event)">
                    <SelectTrigger class="h-6 text-xs font-mono border-transparent hover:border-border/60 focus:border-primary/50"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem v-for="a in FK_ACTIONS" :key="a" :value="a" class="text-xs font-mono">{{ a }}</SelectItem>
                    </SelectContent>
                  </Select>
                </td>
                <td class="border-b border-border/50 p-0.5">
                  <Select :model-value="fk.onUpdate ?? 'NO ACTION'" @update:model-value="updateForeignKey(idx, 'onUpdate', $event)">
                    <SelectTrigger class="h-6 text-xs font-mono border-transparent hover:border-border/60 focus:border-primary/50"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem v-for="a in FK_ACTIONS" :key="a" :value="a" class="text-xs font-mono">{{ a }}</SelectItem>
                    </SelectContent>
                  </Select>
                </td>
                <td class="border-b border-border/50 px-0.5 py-0.5 text-center">
                  <button class="size-5 inline-flex items-center justify-center rounded opacity-0 group-hover:opacity-100 text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-all" @click="removeForeignKey(idx)">
                    <X class="size-3" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Triggers tab -->
      <div v-if="activeTab === 'triggers'" class="flex flex-col flex-1 min-h-0">
        <div class="flex-1 min-h-0 overflow-auto">
          <div v-if="triggers.length === 0" class="flex flex-1 items-center justify-center py-8 text-xs text-muted-foreground/60">
            暂无触发器，点击上方「添加」按钮
          </div>
          <div v-for="(trig, idx) in triggers" :key="idx" class="border-b border-border p-2.5 space-y-1.5">
            <div class="flex items-center gap-2">
              <span class="text-[10px] text-muted-foreground/40 w-4 text-right">{{ idx + 1 }}</span>
              <input :value="trig.name" class="h-6 w-40 px-1.5 text-xs font-mono bg-transparent border border-border/60 rounded focus:border-primary/50 focus:outline-none" placeholder="触发器名称" @input="updateTrigger(idx, 'name', ($event.target as HTMLInputElement).value)" />
              <Select :model-value="trig.timing" @update:model-value="updateTrigger(idx, 'timing', $event)">
                <SelectTrigger class="h-6 w-24 text-xs font-mono"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="t in TRIGGER_TIMINGS" :key="t" :value="t" class="text-xs font-mono">{{ t }}</SelectItem>
                </SelectContent>
              </Select>
              <Select :model-value="trig.event" @update:model-value="updateTrigger(idx, 'event', $event)">
                <SelectTrigger class="h-6 w-24 text-xs font-mono"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="ev in TRIGGER_EVENTS" :key="ev" :value="ev" class="text-xs font-mono">{{ ev }}</SelectItem>
                </SelectContent>
              </Select>
              <div class="flex-1" />
              <button class="size-5 inline-flex items-center justify-center rounded text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-all" @click="removeTrigger(idx)">
                <X class="size-3" />
              </button>
            </div>
            <textarea :value="trig.body" class="w-full min-h-[60px] px-2 py-1.5 text-xs font-mono bg-muted/20 border border-border/60 rounded focus:border-primary/50 focus:outline-none resize-y" placeholder="BEGIN&#10;  -- 触发器逻辑&#10;END" @input="updateTrigger(idx, 'body', ($event.target as HTMLTextAreaElement).value)" />
          </div>
        </div>
      </div>

      <!-- DDL tab -->
      <div v-if="activeTab === 'ddl'" class="flex flex-col flex-1 min-h-0">
        <div v-if="ddlLoading" class="flex flex-1 items-center justify-center">
          <Loader2 class="size-5 animate-spin text-muted-foreground" />
        </div>
        <div v-else-if="ddlContent" class="flex-1 min-h-0 overflow-auto">
          <div class="flex items-center justify-end px-2.5 py-1 border-b border-border bg-muted/10">
            <button class="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground" @click="copyToClipboard(ddlContent, 'ddl')">
              <Check v-if="ddlCopied" class="size-3 text-green-500" />
              <Copy v-else class="size-3" />
              {{ ddlCopied ? '已复制' : '复制' }}
            </button>
          </div>
          <!-- eslint-disable-next-line vue/no-v-html -->
          <pre class="px-3 py-2 text-xs font-mono leading-relaxed" v-html="highlightSql(ddlContent)" />
        </div>
        <div v-else class="flex flex-1 items-center justify-center text-xs text-muted-foreground/60">
          暂无 DDL 信息
        </div>
      </div>
    </div>
    <div v-if="showSqlPreview && generatedSql" class="border-t border-border shrink-0">
      <div class="flex items-center gap-1.5 px-2.5 py-1">
        <Code class="size-3 text-primary/60" />
        <span class="text-[11px] text-muted-foreground font-medium flex-1">SQL 预览</span>
        <button class="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground mr-2" @click="copyToClipboard(generatedSql, 'sql')">
          <Check v-if="sqlCopied" class="size-3 text-green-500" />
          <Copy v-else class="size-3" />
          {{ sqlCopied ? '已复制' : '复制' }}
        </button>
        <button class="text-[11px] text-muted-foreground hover:text-foreground" @click="showSqlPreview = false">
          <X class="size-3" />
        </button>
      </div>
      <div class="max-h-28 overflow-auto border-t border-border bg-muted/10">
        <!-- eslint-disable-next-line vue/no-v-html -->
        <pre class="px-2.5 py-1.5 text-xs font-mono leading-relaxed" v-html="highlightSql(generatedSql)" />
      </div>
    </div>

    <!-- Status bar -->
    <div class="flex items-center gap-3 border-t border-border shrink-0 px-2.5 py-0.5 bg-muted/20 text-[10px] text-muted-foreground">
      <span>字段 {{ columns.length }}</span>
      <span>索引 {{ indexes.length }}</span>
      <span>外键 {{ foreignKeys.length }}</span>
      <template v-if="isAlterMode && hasChanges">
        <span class="w-px h-3 bg-border" />
        <span v-if="changeStats.added" class="text-green-500">+{{ changeStats.added }}</span>
        <span v-if="changeStats.modified" class="text-orange-500">~{{ changeStats.modified }}</span>
        <span v-if="changeStats.deleted" class="text-red-500">-{{ changeStats.deleted }}</span>
      </template>
      <template v-if="validationErrors.length > 0">
        <span class="w-px h-3 bg-border" />
        <span class="text-red-500">{{ validationErrors.length }} 个错误</span>
      </template>
      <div class="flex-1" />
      <span class="text-muted-foreground/50">Ctrl+S 保存 · Ctrl+Z 撤销 · Ctrl+D 复制 · Alt+↑↓ 移动</span>
    </div>

    <!-- Context menu -->
    <Teleport to="body">
      <div v-if="showContextMenu" class="fixed inset-0 z-50" @click="closeContextMenu" @contextmenu.prevent="closeContextMenu">
        <div class="fixed bg-popover border border-border rounded-md shadow-lg py-1 min-w-[160px] text-xs" :style="{ left: contextMenuPos.x + 'px', top: contextMenuPos.y + 'px' }">
          <button class="w-full px-3 py-1.5 text-left hover:bg-accent flex items-center gap-2" @click="contextInsertAbove">
            <span class="text-muted-foreground w-4">↑</span>上方插入字段
          </button>
          <button class="w-full px-3 py-1.5 text-left hover:bg-accent flex items-center gap-2" @click="contextInsertBelow">
            <span class="text-muted-foreground w-4">↓</span>下方插入字段
          </button>
          <div class="h-px bg-border my-1" />
          <button class="w-full px-3 py-1.5 text-left hover:bg-accent flex items-center gap-2" @click="contextDuplicate">
            <span class="text-muted-foreground w-4 text-[10px]">D</span>复制字段
            <span class="ml-auto text-muted-foreground/50 text-[10px]">Ctrl+D</span>
          </button>
          <button class="w-full px-3 py-1.5 text-left hover:bg-accent flex items-center gap-2 text-destructive" @click="contextDelete">
            <span class="w-4 text-[10px]">×</span>删除字段
            <span class="ml-auto text-muted-foreground/50 text-[10px]">Del</span>
          </button>
          <div class="h-px bg-border my-1" />
          <button class="w-full px-3 py-1.5 text-left hover:bg-accent flex items-center gap-2" @click="contextTogglePK">
            <Key class="size-3 text-muted-foreground" />{{ columns[contextMenuIdx]?.isPrimaryKey ? '取消主键' : '设为主键' }}
          </button>
          <button class="w-full px-3 py-1.5 text-left hover:bg-accent flex items-center gap-2" @click="contextCopyName">
            <Copy class="size-3 text-muted-foreground" />复制字段名
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>
