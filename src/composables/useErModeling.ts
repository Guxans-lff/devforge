/**
 * 可视化数据建模 — 核心 composable
 *
 * 管理建模项目的所有状态：表/列/关系的 CRUD、Undo/Redo、
 * 文件持久化以及与 Vue Flow 的数据转换。
 */

import { ref, computed } from 'vue'
import type { Node, Edge } from '@vue-flow/core'
import dagre from 'dagre'
import { writeTextFile, readTextFile } from '@/api/database'
import { dbGetTables, dbGetColumns, dbGetForeignKeys } from '@/api/database'
import type {
  ModelProject,
  ModelTable,
  ModelColumn,
  ModelRelation,
} from '@/types/er-modeling'
import { createEmptyProject, createDefaultColumn } from '@/types/er-modeling'

/** 最大撤销步数 */
const MAX_UNDO_STEPS = 50

export function useErModeling() {
  // ============ 核心状态 ============
  const project = ref<ModelProject>(createEmptyProject('未命名项目'))
  const dirty = ref(false)
  const currentFilePath = ref<string | null>(null)

  /** 当前选中的表 ID */
  const selectedTableId = ref<string | null>(null)
  /** 当前选中的表（计算属性） */
  const selectedTable = computed(() =>
    project.value.tables.find(t => t.id === selectedTableId.value) ?? null,
  )

  // ============ Undo / Redo ============
  const undoStack = ref<string[]>([])
  const redoStack = ref<string[]>([])
  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)

  /** 保存当前快照到 undo 栈 */
  function pushSnapshot() {
    const snapshot = JSON.stringify(project.value)
    undoStack.value = [...undoStack.value, snapshot].slice(-MAX_UNDO_STEPS)
    redoStack.value = []
    dirty.value = true
  }

  /** 撤销 */
  function undo() {
    if (!canUndo.value) return
    const current = JSON.stringify(project.value)
    redoStack.value = [...redoStack.value, current]
    const prev = undoStack.value[undoStack.value.length - 1]
    undoStack.value = undoStack.value.slice(0, -1)
    project.value = JSON.parse(prev!)
    dirty.value = true
  }

  /** 重做 */
  function redo() {
    if (!canRedo.value) return
    const current = JSON.stringify(project.value)
    undoStack.value = [...undoStack.value, current]
    const next = redoStack.value[redoStack.value.length - 1]
    redoStack.value = redoStack.value.slice(0, -1)
    project.value = JSON.parse(next!)
    dirty.value = true
  }

  // ============ 表 CRUD ============
  /** 添加新表 */
  function addTable(name: string, position: { x: number; y: number }): ModelTable {
    pushSnapshot()
    const id = crypto.randomUUID()
    const pkColumn: ModelColumn = {
      id: crypto.randomUUID(),
      name: 'id',
      dataType: 'BIGINT',
      nullable: false,
      isPrimaryKey: true,
      isAutoIncrement: true,
      isUnique: false,
    }
    const newTable: ModelTable = {
      id,
      name,
      position: { ...position },
      columns: [pkColumn],
      engine: 'InnoDB',
      charset: 'utf8mb4',
    }
    project.value = {
      ...project.value,
      tables: [...project.value.tables, newTable],
    }
    return newTable
  }

  /** 更新表（部分字段） */
  function updateTable(tableId: string, partial: Partial<Pick<ModelTable, 'name' | 'comment' | 'engine' | 'charset'>>) {
    pushSnapshot()
    project.value = {
      ...project.value,
      tables: project.value.tables.map(t =>
        t.id === tableId ? { ...t, ...partial } : t,
      ),
    }
  }

  /** 更新表位置（不推入 undo 栈，拖拽频繁） */
  function updateTablePosition(tableId: string, position: { x: number; y: number }) {
    project.value = {
      ...project.value,
      tables: project.value.tables.map(t =>
        t.id === tableId ? { ...t, position: { ...position } } : t,
      ),
    }
    dirty.value = true
  }

  /** 删除表（同时清理关联关系） */
  function removeTable(tableId: string) {
    pushSnapshot()
    project.value = {
      ...project.value,
      tables: project.value.tables.filter(t => t.id !== tableId),
      relations: project.value.relations.filter(
        r => r.sourceTableId !== tableId && r.targetTableId !== tableId,
      ),
    }
    if (selectedTableId.value === tableId) {
      selectedTableId.value = null
    }
  }

  // ============ 列 CRUD ============
  /** 添加列 */
  function addColumn(tableId: string, column?: Partial<ModelColumn>): ModelColumn {
    pushSnapshot()
    const id = crypto.randomUUID()
    const newCol: ModelColumn = {
      ...createDefaultColumn(id, column?.name ?? 'new_column'),
      ...column,
      id,
    }
    project.value = {
      ...project.value,
      tables: project.value.tables.map(t =>
        t.id === tableId
          ? { ...t, columns: [...t.columns, newCol] }
          : t,
      ),
    }
    return newCol
  }

  /** 更新列 */
  function updateColumn(tableId: string, columnId: string, partial: Partial<ModelColumn>) {
    pushSnapshot()
    project.value = {
      ...project.value,
      tables: project.value.tables.map(t =>
        t.id === tableId
          ? {
              ...t,
              columns: t.columns.map(c =>
                c.id === columnId ? { ...c, ...partial } : c,
              ),
            }
          : t,
      ),
    }
  }

  /** 删除列（同时清理引用该列的外键关系） */
  function removeColumn(tableId: string, columnId: string) {
    pushSnapshot()
    project.value = {
      ...project.value,
      tables: project.value.tables.map(t =>
        t.id === tableId
          ? { ...t, columns: t.columns.filter(c => c.id !== columnId) }
          : t,
      ),
      relations: project.value.relations.filter(
        r =>
          !(r.sourceTableId === tableId && r.sourceColumnId === columnId) &&
          !(r.targetTableId === tableId && r.targetColumnId === columnId),
      ),
    }
  }

  // ============ 关系 CRUD ============
  /** 添加外键关系 */
  function addRelation(relation: Omit<ModelRelation, 'id'>): ModelRelation {
    pushSnapshot()
    const newRelation: ModelRelation = { ...relation, id: crypto.randomUUID() }
    project.value = {
      ...project.value,
      relations: [...project.value.relations, newRelation],
    }
    return newRelation
  }

  /** 删除关系 */
  function removeRelation(relationId: string) {
    pushSnapshot()
    project.value = {
      ...project.value,
      relations: project.value.relations.filter(r => r.id !== relationId),
    }
  }

  // ============ 文件操作 ============
  /** 新建项目 */
  function newProject(name: string) {
    project.value = createEmptyProject(name)
    currentFilePath.value = null
    dirty.value = false
    undoStack.value = []
    redoStack.value = []
    selectedTableId.value = null
  }

  /** 保存模型到文件 */
  async function saveModel(filePath: string) {
    const content = JSON.stringify(project.value, null, 2)
    await writeTextFile(filePath, content)
    currentFilePath.value = filePath
    dirty.value = false
  }

  /** 从文件加载模型 */
  async function loadModel(filePath: string) {
    const content = await readTextFile(filePath)
    const loaded: ModelProject = JSON.parse(content)
    project.value = loaded
    currentFilePath.value = filePath
    dirty.value = false
    undoStack.value = []
    redoStack.value = []
    selectedTableId.value = null
  }

  /** 从数据库导入（逆向工程） */
  async function importFromDatabase(connectionId: string, database: string) {
    const [tables, foreignKeys] = await Promise.all([
      dbGetTables(connectionId, database),
      dbGetForeignKeys(connectionId, database),
    ])

    // 获取每个表的列信息
    const columnsMap = new Map<string, Awaited<ReturnType<typeof dbGetColumns>>>()
    await Promise.all(
      tables.map(async (t) => {
        try {
          const cols = await dbGetColumns(connectionId, database, t.name)
          columnsMap.set(t.name, cols)
        } catch {
          columnsMap.set(t.name, [])
        }
      }),
    )

    // 表名 → 生成的表 ID 映射
    const tableIdMap = new Map<string, string>()
    // 列名 → 生成的列 ID 映射（key = `tableName.columnName`）
    const columnIdMap = new Map<string, string>()

    const modelTables: ModelTable[] = tables.map((t, idx) => {
      const tid = crypto.randomUUID()
      tableIdMap.set(t.name, tid)
      const cols = columnsMap.get(t.name) ?? []
      const modelCols: ModelColumn[] = cols.map(c => {
        const cid = crypto.randomUUID()
        columnIdMap.set(`${t.name}.${c.name}`, cid)
        return {
          id: cid,
          name: c.name,
          dataType: c.dataType.replace(/\(.*\)/, '').toUpperCase(),
          length: extractLength(c.dataType),
          nullable: c.nullable,
          defaultValue: c.defaultValue ?? undefined,
          isPrimaryKey: c.isPrimaryKey,
          isAutoIncrement: false, // 数据库 API 不返回此信息，默认 false
          isUnique: false,
          comment: c.comment ?? undefined,
        }
      })
      return {
        id: tid,
        name: t.name,
        position: { x: (idx % 4) * 300, y: Math.floor(idx / 4) * 350 },
        columns: modelCols,
        comment: t.comment ?? undefined,
        engine: 'InnoDB',
        charset: 'utf8mb4',
      }
    })

    const modelRelations: ModelRelation[] = (foreignKeys
      .map((fk): ModelRelation | null => {
        const sourceTableId = tableIdMap.get(fk.tableName)
        const targetTableId = tableIdMap.get(fk.referencedTableName)
        const sourceColumnId = columnIdMap.get(`${fk.tableName}.${fk.columnName}`)
        const targetColumnId = columnIdMap.get(`${fk.referencedTableName}.${fk.referencedColumnName}`)
        if (!sourceTableId || !targetTableId || !sourceColumnId || !targetColumnId) return null
        return {
          id: crypto.randomUUID(),
          sourceTableId,
          sourceColumnId,
          targetTableId,
          targetColumnId,
        }
      })
      .filter((r): r is ModelRelation => r !== null))

    pushSnapshot()
    project.value = {
      version: 1,
      name: database,
      dialect: 'mysql',
      tables: modelTables,
      relations: modelRelations,
    }
    selectedTableId.value = null
  }

  // ============ Vue Flow 数据转换 ============
  /** 转换为 Vue Flow 节点 */
  function toVueFlowNodes(): Node[] {
    return project.value.tables.map(table => ({
      id: table.id,
      type: 'erEditable',
      position: { ...table.position },
      data: {
        table,
        isSelected: selectedTableId.value === table.id,
      },
    }))
  }

  /** 转换为 Vue Flow 边 */
  function toVueFlowEdges(): Edge[] {
    return project.value.relations.map(rel => {
      const sourceTable = project.value.tables.find(t => t.id === rel.sourceTableId)
      const targetTable = project.value.tables.find(t => t.id === rel.targetTableId)
      const sourceCol = sourceTable?.columns.find(c => c.id === rel.sourceColumnId)
      const targetCol = targetTable?.columns.find(c => c.id === rel.targetColumnId)
      return {
        id: rel.id,
        source: rel.sourceTableId,
        target: rel.targetTableId,
        type: 'erRelation',
        animated: true,
        data: {
          sourceColumn: sourceCol?.name ?? '?',
          targetColumn: targetCol?.name ?? '?',
          relationLabel: `${sourceCol?.name ?? '?'} → ${targetCol?.name ?? '?'}`,
        },
      }
    })
  }

  /** Dagre 自动布局 */
  function autoLayout() {
    pushSnapshot()
    const g = new dagre.graphlib.Graph()
    g.setDefaultEdgeLabel(() => ({}))
    g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 120, marginx: 30, marginy: 30 })

    for (const table of project.value.tables) {
      const headerHeight = 36
      const columnHeight = 22
      const height = headerHeight + table.columns.length * columnHeight + 8
      g.setNode(table.id, { width: 240, height })
    }

    for (const rel of project.value.relations) {
      g.setEdge(rel.sourceTableId, rel.targetTableId)
    }

    dagre.layout(g)

    project.value = {
      ...project.value,
      tables: project.value.tables.map(table => {
        const pos = g.node(table.id)
        if (!pos) return table
        return {
          ...table,
          position: {
            x: pos.x - (pos.width ?? 240) / 2,
            y: pos.y - (pos.height ?? 100) / 2,
          },
        }
      }),
    }
  }

  return {
    // 状态
    project,
    dirty,
    currentFilePath,
    selectedTableId,
    selectedTable,
    // Undo / Redo
    canUndo,
    canRedo,
    undo,
    redo,
    // 表 CRUD
    addTable,
    updateTable,
    updateTablePosition,
    removeTable,
    // 列 CRUD
    addColumn,
    updateColumn,
    removeColumn,
    // 关系 CRUD
    addRelation,
    removeRelation,
    // 文件操作
    newProject,
    saveModel,
    loadModel,
    importFromDatabase,
    // Vue Flow 转换
    toVueFlowNodes,
    toVueFlowEdges,
    autoLayout,
  }
}

// ============ 工具函数 ============

/** 从数据类型字符串中提取长度，如 VARCHAR(255) → 255 */
function extractLength(dataType: string): number | undefined {
  const match = dataType.match(/\((\d+)\)/)
  return match ? Number(match[1]) : undefined
}
