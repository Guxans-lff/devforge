/**
 * 表编辑器核心业务逻辑 composable
 * 从 TableEditorPanel.vue 提取，负责表结构的 CRUD、撤销/重做、SQL 生成等
 */
import { ref, shallowRef, computed, onBeforeUnmount, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from '@/composables/useToast'
import { useConnectionStore } from '@/stores/connections'
import {
  generateCreateTableSql, generateAlterTableSql,
  executeDdl, getTableDetail, getTableDdl,
} from '@/api/table-editor'
import type {
  ColumnDefinition, IndexDefinition, TableDefinition,
  TableAlteration, ColumnChange, IndexChange, TableDetail,
  ForeignKeyDefinition,
} from '@/types/table-editor'
import type { HistorySnapshot, TriggerDefinition, FieldTemplate } from '@/types/table-editor-constants'
import {
  COMMON_TYPES, TYPE_DEFAULT_LENGTH, INDEX_TYPES, FK_ACTIONS,
  TRIGGER_TIMINGS, TRIGGER_EVENTS, FIELD_TEMPLATES, MAX_HISTORY,
  highlightSql, MYSQL_RESERVED_KEYWORDS,
} from '@/types/table-editor-constants'
import { parseBackendError } from '@/types/error'

/** composable 输入参数 */
export interface UseTableEditorOptions {
  connectionId: Ref<string>
  database: Ref<string>
  driver: Ref<string>
  table: Ref<string | undefined>
  /** DOM 引用：字段列表滚动容器（用于滚动到底部和拖拽计算行高） */
  columnsScrollRef: Ref<HTMLElement | undefined>
  /** 执行成功后的回调（替代 emit('success')） */
  onSuccess: () => void
}

export function useTableEditor(options: UseTableEditorOptions) {
  const { connectionId, database, driver, table, columnsScrollRef, onSuccess } = options
  const { t } = useI18n()
  const toast = useToast()
  const connectionStore = useConnectionStore()

  // — 浅对比辅助函数（替代 JSON.stringify 对比，性能更好）—
  function columnsEqual(a: ColumnDefinition, b: ColumnDefinition): boolean {
    return a.name === b.name && a.dataType === b.dataType && a.length === b.length
      && a.nullable === b.nullable && a.isPrimaryKey === b.isPrimaryKey
      && a.autoIncrement === b.autoIncrement && a.defaultValue === b.defaultValue
      && a.onUpdate === b.onUpdate && a.comment === b.comment
  }
  function indexesEqual(a: IndexDefinition, b: IndexDefinition): boolean {
    return a.name === b.name && a.indexType === b.indexType
      && a.columns.length === b.columns.length && a.columns.every((c, i) => c === b.columns[i])
  }

  /** 提取错误信息（兼容 Error 和 BackendError） */
  function extractErrorMessage(e: unknown): string {
    return e instanceof Error ? e.message : parseBackendError(e).message
  }

  // — 连接信息 —
  const connectionHost = computed(() => {
    const state = connectionStore.connections.get(connectionId.value)
    if (!state) return ''
    const { host, port } = state.record
    return port ? `${host}:${port}` : host
  })
  const isMysql = computed(() => driver.value === 'mysql' || driver.value === 'mariadb')

  // — 模式 & UI 状态 —
  const isAlterMode = computed(() => !!table.value)
  const activeTab = ref('columns')
  const loading = ref(false)
  const executing = ref(false)
  const generatedSql = ref('')
  const showSqlPreview = ref(false)
  const metaCollapsed = ref(false)
  const ddlContent = ref('')
  const ddlLoading = ref(false)
  const ddlCopied = ref(false)
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

  // — 表属性 —
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

  // — 数据集合（shallowRef：不需要深度响应，全量替换触发更新） —
  const columns = shallowRef<ColumnDefinition[]>([])
  const originalColumns = shallowRef<ColumnDefinition[]>([])
  const indexes = shallowRef<IndexDefinition[]>([])
  const originalIndexes = shallowRef<IndexDefinition[]>([])
  const foreignKeys = shallowRef<ForeignKeyDefinition[]>([])
  const originalForeignKeys = shallowRef<ForeignKeyDefinition[]>([])
  const triggers = shallowRef<TriggerDefinition[]>([])

  // — 撤销/重做 —
  const undoStack = shallowRef<HistorySnapshot[]>([])
  const redoStack = shallowRef<HistorySnapshot[]>([])
  const isUndoRedo = ref(false)

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

  // — 类型 computed —
  const allTypes = computed(() => {
    const extra = columns.value
      .map(c => c.dataType.toUpperCase())
      .filter(t => t && !(COMMON_TYPES as readonly string[]).includes(t))
    return [...COMMON_TYPES, ...new Set(extra)]
  })
  const filteredTypes = computed(() => {
    const q = typeSearchQuery.value.toUpperCase()
    return q ? allTypes.value.filter(t => t.includes(q)) : allTypes.value
  })

  // — 字段过滤 & 选择 —
  const filteredColumnIndices = computed(() => {
    const q = columnFilter.value.toLowerCase()
    if (!q) return columns.value.map((_, i) => i)
    return columns.value.reduce<number[]>((acc, col, i) => {
      if (col.name.toLowerCase().includes(q) || col.dataType.toLowerCase().includes(q) || (col.comment ?? '').toLowerCase().includes(q)) acc.push(i)
      return acc
    }, [])
  })
  const allSelected = computed(() =>
    filteredColumnIndices.value.length > 0 && filteredColumnIndices.value.every(i => selectedRows.value.has(i)),
  )
  const columnNames = computed(() => columns.value.map(c => c.name).filter(Boolean))

  function toggleSelectAll() {
    selectedRows.value = allSelected.value ? new Set() : new Set(filteredColumnIndices.value)
  }
  function toggleRowSelect(idx: number) {
    const next = new Set(selectedRows.value)
    if (next.has(idx)) next.delete(idx); else next.add(idx)
    selectedRows.value = next
  }

  // — 变更追踪 —
  const changeStats = computed(() => {
    if (!isAlterMode.value) return { added: columns.value.length, modified: 0, deleted: 0 }
    let added = 0, modified = 0, deleted = 0
    for (const col of columns.value) {
      const orig = originalColumns.value.find(c => c.name === col.name)
      if (!orig) added++
      else if (!columnsEqual(orig, col)) modified++
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
      || indexes.value.some((ix, i) => !indexesEqual(ix, originalIndexes.value[i]!))
      || tableName.value !== table.value
      || tableEngine.value !== originalTableEngine.value
      || tableCharset.value !== originalTableCharset.value
      || tableComment.value !== originalTableComment.value
  })

  // — 校验 —
  const validationErrors = computed(() => {
    const errors: { row: number; field: string; message: string }[] = []
    const names = new Set<string>()
    columns.value.forEach((col, idx) => {
      if (!col.name.trim()) errors.push({ row: idx, field: 'name', message: t('tableEditor.validationNameRequired') })
      else if (names.has(col.name.toLowerCase())) errors.push({ row: idx, field: 'name', message: t('tableEditor.validationNameDuplicate') })
      else if (MYSQL_RESERVED_KEYWORDS.has(col.name.toUpperCase())) errors.push({ row: idx, field: 'name', message: t('tableEditor.validationReservedKeyword') })
      names.add(col.name.toLowerCase())
      if (!col.dataType) errors.push({ row: idx, field: 'dataType', message: t('tableEditor.validationTypeRequired') })
    })
    return errors
  })
  function hasError(idx: number, field: string): boolean {
    return validationErrors.value.some(e => e.row === idx && e.field === field)
  }
  function getError(idx: number, field: string): string {
    return validationErrors.value.find(e => e.row === idx && e.field === field)?.message ?? ''
  }

  // — 工厂函数 —
  function newColumn(): ColumnDefinition {
    return { name: '', dataType: 'VARCHAR', length: '255', nullable: true, isPrimaryKey: false, autoIncrement: false, defaultValue: null, onUpdate: null, comment: null }
  }
  function newIndex(): IndexDefinition { return { name: '', columns: [], indexType: 'INDEX' } }
  function newForeignKey(): ForeignKeyDefinition { return { name: '', columns: [], refTable: '', refColumns: [], onDelete: 'NO ACTION', onUpdate: 'NO ACTION' } }
  function newTrigger(): TriggerDefinition { return { name: '', timing: 'BEFORE', event: 'INSERT', body: '' } }

  // — 主键索引同步 —
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

  // — 列操作 —
  /** @returns 新增列的索引（滚动/聚焦由调用方处理） */
  function addColumn(): number {
    pushHistory()
    columns.value = [...columns.value, newColumn()]
    return columns.value.length - 1
  }
  function removeColumn(idx: number) { pushHistory(); columns.value = columns.value.filter((_, i) => i !== idx) }

  /** 更新列属性，含类型联动（默认长度、主键→非空、自增→主键） */
  function updateColumn(idx: number, field: keyof ColumnDefinition, value: unknown) {
    pushHistory()
    columns.value = columns.value.map((col, i) => {
      if (i !== idx) return col
      const updated = { ...col, [field]: value }
      if (field === 'dataType') {
        const type = (value as string).toUpperCase()
        if (type in TYPE_DEFAULT_LENGTH) updated.length = TYPE_DEFAULT_LENGTH[type] ?? null
      }
      if (field === 'isPrimaryKey' && value === true) updated.nullable = false
      if (field === 'autoIncrement' && value === true) { updated.isPrimaryKey = true; updated.nullable = false }
      return updated
    })
    if (field === 'isPrimaryKey') syncPrimaryKeyIndex()
  }
  function duplicateColumn(idx: number) {
    pushHistory()
    const src = columns.value[idx]
    if (!src) return
    const copy = { ...src, name: src.name ? `${src.name}_copy` : '' }
    columns.value = [...columns.value.slice(0, idx + 1), copy, ...columns.value.slice(idx + 1)]
    selectedRowIdx.value = idx + 1
  }
  function deleteSelectedColumn() {
    const idx = selectedRowIdx.value
    if (idx === null || idx < 0 || idx >= columns.value.length) return
    const col = columns.value[idx]
    if (!col) return
    if (isAlterMode.value && originalColumns.value.find(c => c.name === col.name)) {
      if (!confirm(t('tableEditor.confirmDropColumn', { name: col.name }))) return
    }
    removeColumn(idx)
    selectedRowIdx.value = Math.min(idx, columns.value.length - 1)
    if (columns.value.length === 0) selectedRowIdx.value = null
  }
  function moveColumn(idx: number, direction: -1 | 1) {
    const target = idx + direction
    if (target < 0 || target >= columns.value.length) return
    pushHistory()
    const arr = [...columns.value]
    ;[arr[idx], arr[target]] = [arr[target]!, arr[idx]!]
    columns.value = arr
    selectedRowIdx.value = target
  }
  function batchDelete() {
    if (selectedRows.value.size === 0) return
    const names = [...selectedRows.value].map(i => columns.value[i]?.name).filter(Boolean)
    if (isAlterMode.value && names.length > 0) {
      if (!confirm(t('tableEditor.confirmBatchDelete', { count: selectedRows.value.size }))) return
    }
    pushHistory()
    columns.value = columns.value.filter((_, i) => !selectedRows.value.has(i))
    selectedRows.value = new Set()
    selectedRowIdx.value = null
  }

  // — 索引操作 —
  function addIndex() { pushHistory(); indexes.value = [...indexes.value, newIndex()] }
  function removeIndex(idx: number) { pushHistory(); indexes.value = indexes.value.filter((_, i) => i !== idx) }
  function generateIndexName(indexType: string, cols: string[]): string {
    if (indexType === 'PRIMARY') return 'PRIMARY'
    const tbl = tableName.value || 'table'
    const prefix = indexType === 'UNIQUE' ? 'uk' : indexType === 'FULLTEXT' ? 'ft' : 'idx'
    const colPart = cols.length > 0 ? cols.join('_') : ''
    return colPart ? `${prefix}_${tbl}_${colPart}` : ''
  }
  function updateIndex(idx: number, field: keyof IndexDefinition, value: unknown) {
    pushHistory()
    indexes.value = indexes.value.map((ix, i) => {
      if (i !== idx) return ix
      const updated = { ...ix, [field]: value }
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
  function toggleIndexColumn(idxIdx: number, colName: string) {
    const ix = indexes.value[idxIdx]
    if (!ix) return
    pushHistory()
    const cols = ix.columns.includes(colName) ? ix.columns.filter(c => c !== colName) : [...ix.columns, colName]
    const autoName = generateIndexName(ix.indexType, cols)
    const shouldAutoName = !ix.name || ix.name === generateIndexName(ix.indexType, ix.columns)
    indexes.value = indexes.value.map((item, i) =>
      i === idxIdx ? { ...item, columns: cols, ...(shouldAutoName ? { name: autoName } : {}) } : item,
    )
  }

  // — 外键操作 —
  function addForeignKey() { pushHistory(); foreignKeys.value = [...foreignKeys.value, newForeignKey()] }
  function removeForeignKey(idx: number) { pushHistory(); foreignKeys.value = foreignKeys.value.filter((_, i) => i !== idx) }
  function generateFkName(fk: ForeignKeyDefinition): string {
    const tbl = tableName.value || 'table'
    const cols = fk.columns.length > 0 ? fk.columns.join('_') : ''
    return cols ? `fk_${tbl}_${cols}` : ''
  }
  function updateForeignKey(idx: number, field: keyof ForeignKeyDefinition, value: unknown) {
    pushHistory()
    foreignKeys.value = foreignKeys.value.map((fk, i) => {
      if (i !== idx) return fk
      const updated = { ...fk, [field]: value }
      if ((field === 'columns' || field === 'refTable') && (!fk.name || fk.name === generateFkName(fk))) {
        updated.name = generateFkName(updated)
      }
      return updated
    })
  }

  // — 触发器操作 —
  function addTrigger() { pushHistory(); triggers.value = [...triggers.value, newTrigger()] }
  function removeTrigger(idx: number) { pushHistory(); triggers.value = triggers.value.filter((_, i) => i !== idx) }
  function updateTrigger(idx: number, field: keyof TriggerDefinition, value: string) {
    pushHistory()
    triggers.value = triggers.value.map((t, i) => i === idx ? { ...t, [field]: value } : t)
  }

  // — 字段模板 —
  /** 插入预置字段模板，返回 true 表示成功（调用方负责滚动） */
  function insertTemplate(tpl: FieldTemplate): boolean {
    const col = { ...tpl.col } as ColumnDefinition
    if (columns.value.find(c => c.name === col.name)) { toast.warning(t('tableEditor.fieldAlreadyExists', { name: col.name })); return false }
    pushHistory()
    columns.value = [...columns.value, col]
    if (col.isPrimaryKey) syncPrimaryKeyIndex()
    return true
  }

  // — 右键菜单 —
  function onColumnContextMenu(e: MouseEvent, idx: number) {
    e.preventDefault()
    contextMenuIdx.value = idx; selectedRowIdx.value = idx
    contextMenuPos.value = { x: e.clientX, y: e.clientY }
    showContextMenu.value = true
  }
  function closeContextMenu() { showContextMenu.value = false }
  function contextInsertAbove() {
    const idx = contextMenuIdx.value; pushHistory()
    columns.value = [...columns.value.slice(0, idx), newColumn(), ...columns.value.slice(idx)]
    selectedRowIdx.value = idx; closeContextMenu()
  }
  function contextInsertBelow() {
    const idx = contextMenuIdx.value; pushHistory()
    columns.value = [...columns.value.slice(0, idx + 1), newColumn(), ...columns.value.slice(idx + 1)]
    selectedRowIdx.value = idx + 1; closeContextMenu()
  }
  function contextDuplicate() { duplicateColumn(contextMenuIdx.value); closeContextMenu() }
  function contextDelete() { selectedRowIdx.value = contextMenuIdx.value; deleteSelectedColumn(); closeContextMenu() }
  /** 切换主键（修复 bug：原代码使用了未定义的 idx，改为 contextMenuIdx.value） */
  function contextTogglePK() {
    const col = columns.value[contextMenuIdx.value]
    if (!col) { closeContextMenu(); return }
    updateColumn(contextMenuIdx.value, 'isPrimaryKey', !col.isPrimaryKey); closeContextMenu()
  }
  function contextCopyName() {
    const name = columns.value[contextMenuIdx.value]?.name
    if (name) {
      navigator.clipboard.writeText(name)
        .then(() => toast.success(t('common.copied')))
        .catch(() => toast.error(t('tableEditor.copyFailed')))
    }
    closeContextMenu()
  }
  /** 复制字段的 ADD COLUMN DDL 语句 */
  function contextCopyDdl() {
    const col = columns.value[contextMenuIdx.value]
    if (!col) { closeContextMenu(); return }
    const parts: string[] = [`ALTER TABLE \`${tableName.value}\` ADD COLUMN \`${col.name}\``]
    // 拆分类型和修饰符（UNSIGNED, ZEROFILL），确保 TYPE(length) UNSIGNED 顺序正确
    const typeUpper = col.dataType.toUpperCase()
    const modifiers = ['UNSIGNED', 'ZEROFILL'].filter(m => typeUpper.includes(m))
    const baseType = typeUpper.replace(/\s*(UNSIGNED|ZEROFILL)\s*/g, '').trim()
    if (col.length) {
      parts.push(`${baseType}(${col.length})`)
    } else {
      parts.push(baseType)
    }
    if (modifiers.length > 0) parts.push(modifiers.join(' '))
    // NOT NULL / NULL
    parts.push(col.nullable ? 'NULL' : 'NOT NULL')
    // 默认值
    if (col.defaultValue !== null && col.defaultValue !== '') {
      const val = col.defaultValue
      // 函数/表达式类的默认值不加引号
      if (/^(CURRENT_TIMESTAMP|NULL|TRUE|FALSE|\d+(\.\d+)?)$/i.test(val) || val.startsWith('(')) {
        parts.push(`DEFAULT ${val}`)
      } else {
        parts.push(`DEFAULT '${val.replace(/'/g, "''")}'`)
      }
    }
    // ON UPDATE
    if (col.onUpdate) {
      parts.push(`ON UPDATE ${col.onUpdate}`)
    }
    // 自增
    if (col.autoIncrement) {
      parts.push('AUTO_INCREMENT')
    }
    // 注释
    if (col.comment) {
      parts.push(`COMMENT '${col.comment.replace(/'/g, "''")}'`)
    }
    navigator.clipboard.writeText(parts.join(' ') + ';')
      .then(() => toast.success(t('common.copied')))
      .catch(() => toast.error(t('tableEditor.copyFailed')))
    closeContextMenu()
  }

  // — 拖拽排序（自定义 mouse 实现，避免 HTML5 DnD 在 table 中的兼容问题）—
  function onGripMouseDown(e: MouseEvent, idx: number) {
    e.preventDefault(); dragIdx.value = idx
    const startY = e.clientY
    const rows = columnsScrollRef.value?.querySelectorAll('tbody tr') as NodeListOf<HTMLElement> | undefined
    if (!rows) return
    const rowHeight = rows.length > 0 ? rows[0]!.offsetHeight : 28
    const onMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientY - startY
      const offset = Math.round(delta / rowHeight)
      dragOverIdx.value = Math.max(0, Math.min(columns.value.length - 1, idx + offset))
    }
    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      const target = dragOverIdx.value
      if (target !== null && target !== idx) {
        pushHistory()
        const arr = [...columns.value]; const [moved] = arr.splice(idx, 1); arr.splice(target, 0, moved!)
        columns.value = arr; selectedRowIdx.value = target
      }
      dragIdx.value = null; dragOverIdx.value = null
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  // — DDL & SQL —
  const copiedTimers = new Set<ReturnType<typeof setTimeout>>()
  async function showDdlInfo() {
    if (!table.value) { toast.info(t('tableEditor.newTableNoDdl')); return }
    activeTab.value = 'ddl'; ddlLoading.value = true
    try { ddlContent.value = await getTableDdl(connectionId.value, database.value, table.value) }
    catch (e) { toast.error(extractErrorMessage(e)); activeTab.value = 'columns' }
    finally { ddlLoading.value = false }
  }
  async function copyToClipboard(text: string, flag: 'ddl' | 'sql') {
    try {
      await navigator.clipboard.writeText(text)
      if (flag === 'ddl') { ddlCopied.value = true } else { sqlCopied.value = true }
      const timer = setTimeout(() => {
        if (flag === 'ddl') { ddlCopied.value = false } else { sqlCopied.value = false }
        copiedTimers.delete(timer)
      }, 2000)
      copiedTimers.add(timer)
    } catch { toast.error(t('tableEditor.copyFailed')) }
  }

  // 清理定时器
  try { onBeforeUnmount(() => { copiedTimers.forEach(clearTimeout); copiedTimers.clear() }) } catch { /* 非组件上下文 */ }
  function buildTableDefinition(): TableDefinition {
    return {
      name: tableName.value, database: database.value, columns: columns.value, indexes: indexes.value,
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
      else if (!columnsEqual(orig, col))
        columnChanges.push({ changeType: 'modify', column: col, oldName: col.name, afterColumn: null })
    }
    for (const orig of originalColumns.value) {
      if (!columns.value.find(c => c.name === orig.name))
        columnChanges.push({ changeType: 'drop', column: orig, oldName: orig.name, afterColumn: null })
    }
    const indexChanges: IndexChange[] = []
    for (const ix of indexes.value) {
      if (!originalIndexes.value.find(i => i.name === ix.name)) indexChanges.push({ changeType: 'add', index: ix })
    }
    for (const orig of originalIndexes.value) {
      if (!indexes.value.find(i => i.name === orig.name)) indexChanges.push({ changeType: 'drop', index: orig })
    }
    return {
      database: database.value, table: table.value!, columnChanges, indexChanges,
      newName: tableName.value !== table.value ? tableName.value : null,
      newComment: tableComment.value !== originalTableComment.value ? (tableComment.value || null) : null,
      newEngine: isMysql.value && tableEngine.value !== originalTableEngine.value ? tableEngine.value : null,
      newCharset: isMysql.value && tableCharset.value !== originalTableCharset.value ? tableCharset.value : null,
    }
  }
  async function previewSql() {
    if (columns.value.length === 0) { toast.warning(t('tableEditor.noColumns')); return }
    if (!tableName.value.trim()) { toast.warning(t('tableEditor.enterTableName')); return }
    // alter 模式无变更：直接跳转 DDL tab 查看当前表结构
    if (isAlterMode.value && !hasChanges.value) { showDdlInfo(); return }
    loading.value = true
    try {
      const result = isAlterMode.value
        ? await generateAlterTableSql(buildTableAlteration(), driver.value)
        : await generateCreateTableSql(buildTableDefinition(), driver.value)
      if (!result.sql?.trim()) { toast.info(t('tableEditor.noExecutableChanges')); return }
      generatedSql.value = result.sql; showSqlPreview.value = true
    } catch (e) { toast.error(extractErrorMessage(e)) }
    finally { loading.value = false }
  }
  async function handleExecuteSql() {
    if (!generatedSql.value) { await previewSql(); if (!generatedSql.value) return }
    executing.value = true
    try {
      await executeDdl(connectionId.value, generatedSql.value)
      toast.success(isAlterMode.value ? t('tableEditor.alterTable') : t('tableEditor.createTable'))
      onSuccess()
    } catch (e) { toast.error(extractErrorMessage(e)) }
    finally { executing.value = false }
  }
  function openTypeDropdown(idx: number) {
    typeDropdownIdx.value = typeDropdownIdx.value === idx ? null : idx
    typeSearchQuery.value = ''
  }

  // — 键盘快捷键（需在组件中通过 addEventListener 注册）—
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') { showContextMenu.value = false; indexColumnDropdown.value = null; typeDropdownIdx.value = null; return }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault(); e.stopPropagation()
      if (!loading.value && !executing.value) handleExecuteSql()
      return
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault(); e.stopPropagation(); if (e.shiftKey) redo(); else undo(); return
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); e.stopPropagation(); redo(); return }
    if (activeTab.value !== 'columns') return
    const idx = selectedRowIdx.value
    if ((e.ctrlKey || e.metaKey) && e.key === 'd') { e.preventDefault(); if (idx !== null) duplicateColumn(idx); return }
    if (e.key === 'Delete' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
      e.preventDefault(); deleteSelectedColumn(); return
    }
    if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); if (idx !== null) moveColumn(idx, -1); return }
    if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); if (idx !== null) moveColumn(idx, 1); return }
    if (!e.ctrlKey && !e.altKey && !e.metaKey && !(e.target instanceof HTMLInputElement)) {
      if (e.key === 'ArrowUp' && idx !== null && idx > 0) { e.preventDefault(); selectedRowIdx.value = idx - 1; return }
      if (e.key === 'ArrowDown' && idx !== null && idx < columns.value.length - 1) { e.preventDefault(); selectedRowIdx.value = idx + 1; return }
    }
  }

  // — 数据加载 —
  async function loadTableDetail() {
    if (!isAlterMode.value || !table.value) return
    loading.value = true
    try {
      const detail: TableDetail = await getTableDetail(connectionId.value, database.value, table.value)
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
    } catch (e) { toast.error(extractErrorMessage(e)) }
    finally { loading.value = false }
  }
  function initCreateMode() {
    tableName.value = ''; tableEngine.value = 'InnoDB'; tableCharset.value = 'utf8mb4'
    tableCollation.value = 'utf8mb4_unicode_ci'; tableComment.value = ''
    columns.value = [newColumn()]; indexes.value = []; foreignKeys.value = []
    originalColumns.value = []; originalIndexes.value = []; originalForeignKeys.value = []
  }

  return {
    // 常量（重导出方便模板直接使用）
    COMMON_TYPES, TYPE_DEFAULT_LENGTH, INDEX_TYPES, FK_ACTIONS, TRIGGER_TIMINGS, TRIGGER_EVENTS, FIELD_TEMPLATES,
    // 连接信息
    connectionHost, isMysql,
    // 模式 & UI 状态
    isAlterMode, activeTab, loading, executing, generatedSql, showSqlPreview, metaCollapsed,
    ddlContent, ddlLoading, ddlCopied, sqlCopied,
    selectedRowIdx, showContextMenu, contextMenuPos, contextMenuIdx,
    indexColumnDropdown, typeDropdownIdx, typeSearchQuery,
    dragIdx, dragOverIdx, columnFilter, selectedRows,
    // 表属性
    tableName, tableEngine, tableCharset, tableCollation, tableComment, tableAutoIncrement, tableRowFormat,
    // 数据集合
    columns, originalColumns, indexes, originalIndexes, foreignKeys, originalForeignKeys, triggers,
    // 撤销/重做
    undoStack, redoStack, undo, redo, pushHistory,
    // computed
    allTypes, filteredTypes, filteredColumnIndices, allSelected, columnNames, changeStats, hasChanges, validationErrors,
    // 校验
    hasError, getError,
    // 列操作
    addColumn, removeColumn, updateColumn, duplicateColumn, deleteSelectedColumn, moveColumn, batchDelete,
    // 选择
    toggleSelectAll, toggleRowSelect,
    // 索引操作
    addIndex, removeIndex, updateIndex, updateIndexColumns, toggleIndexColumn,
    // 外键操作
    addForeignKey, removeForeignKey, updateForeignKey,
    // 触发器操作
    addTrigger, removeTrigger, updateTrigger,
    // 字段模板
    insertTemplate,
    // 右键菜单
    onColumnContextMenu, closeContextMenu, contextInsertAbove, contextInsertBelow,
    contextDuplicate, contextDelete, contextTogglePK, contextCopyName, contextCopyDdl,
    // 拖拽
    onGripMouseDown,
    // DDL & SQL
    showDdlInfo, previewSql, handleExecuteSql, copyToClipboard, highlightSql, buildTableDefinition, buildTableAlteration,
    // 其他
    openTypeDropdown, handleKeydown, loadTableDetail, initCreateMode,
  }
}
