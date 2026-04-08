import { ref, computed } from 'vue'
import type { Node, Edge } from '@vue-flow/core'
import dagre from 'dagre'
import type { ColumnInfo, ForeignKeyRelation } from '@/types/database'
import type {
  SqlBuilderState,
  SqlBuilderTable,
  SqlJoin,
  SqlCondition,
  SqlOrderBy,
  SqlBuilderNodeData,
  SqlBuilderEdgeData,
  JoinType,
  SqlOperator,
} from '@/types/sql-builder'

/** 可视化 SQL Builder composable */
export function useSqlBuilder() {
  /** 实例级 ID 计数器 */
  let idCounter = 0
  function uid(prefix: string) {
    return `${prefix}-${++idCounter}`
  }

  const state = ref<SqlBuilderState>({
    tables: [],
    joins: [],
    conditions: [],
    orderBy: [],
    limit: null,
    distinct: false,
  })

  /** 别名计数器 */
  let aliasCounter = 0

  function nextAlias(): string {
    aliasCounter++
    return `t${aliasCounter}`
  }

  // ── 表操作 ──────────────────────────────────────────────────────

  /** 添加表到画布 */
  function addTable(tableName: string, columns: ColumnInfo[], _position?: { x: number; y: number }): string {
    // 检查是否已添加
    if (state.value.tables.some(t => t.tableName === tableName)) {
      return state.value.tables.find(t => t.tableName === tableName)!.id
    }
    const id = uid('table')
    const alias = nextAlias()
    const table: SqlBuilderTable = {
      id,
      tableName,
      alias,
      columns,
      selectedColumns: [],
    }
    state.value = {
      ...state.value,
      tables: [...state.value.tables, table],
    }
    return id
  }

  /** 移除表及其关联的 JOIN、条件、排序 */
  function removeTable(nodeId: string) {
    const table = state.value.tables.find(t => t.id === nodeId)
    if (!table) return
    state.value = {
      ...state.value,
      tables: state.value.tables.filter(t => t.id !== nodeId),
      joins: state.value.joins.filter(j => j.sourceTable !== nodeId && j.targetTable !== nodeId),
      conditions: state.value.conditions.filter(c => c.tableAlias !== table.alias),
      orderBy: state.value.orderBy.filter(o => o.tableAlias !== table.alias),
    }
  }

  // ── 列操作 ──────────────────────────────────────────────────────

  /** 切换列选中状态 */
  function toggleColumn(nodeId: string, columnName: string) {
    state.value = {
      ...state.value,
      tables: state.value.tables.map(t => {
        if (t.id !== nodeId) return t
        const selected = t.selectedColumns.includes(columnName)
          ? t.selectedColumns.filter(c => c !== columnName)
          : [...t.selectedColumns, columnName]
        return { ...t, selectedColumns: selected }
      }),
    }
  }

  /** 全选列 */
  function selectAllColumns(nodeId: string) {
    state.value = {
      ...state.value,
      tables: state.value.tables.map(t => {
        if (t.id !== nodeId) return t
        return { ...t, selectedColumns: t.columns.map(c => c.name) }
      }),
    }
  }

  /** 取消全选 */
  function deselectAllColumns(nodeId: string) {
    state.value = {
      ...state.value,
      tables: state.value.tables.map(t => {
        if (t.id !== nodeId) return t
        return { ...t, selectedColumns: [] }
      }),
    }
  }

  // ── JOIN 操作 ────────────────────────────────────────────────────

  /** 手动添加 JOIN */
  function addJoin(sourceTable: string, sourceColumn: string, targetTable: string, targetColumn: string, joinType: JoinType = 'INNER'): string {
    // 避免重复
    const exists = state.value.joins.some(
      j => j.sourceTable === sourceTable && j.sourceColumn === sourceColumn
        && j.targetTable === targetTable && j.targetColumn === targetColumn,
    )
    if (exists) return ''
    const id = uid('join')
    const join: SqlJoin = { id, sourceTable, sourceColumn, targetTable, targetColumn, joinType }
    state.value = { ...state.value, joins: [...state.value.joins, join] }
    return id
  }

  /** 根据外键自动检测 JOIN */
  function autoDetectJoins(foreignKeys: ForeignKeyRelation[]) {
    const tableNameToId = new Map<string, string>()
    for (const t of state.value.tables) {
      tableNameToId.set(t.tableName, t.id)
    }

    for (const fk of foreignKeys) {
      const sourceId = tableNameToId.get(fk.tableName)
      const targetId = tableNameToId.get(fk.referencedTableName)
      if (sourceId && targetId) {
        addJoin(sourceId, fk.columnName, targetId, fk.referencedColumnName, 'INNER')
      }
    }
  }

  /** 修改 JOIN 类型 */
  function updateJoinType(joinId: string, joinType: JoinType) {
    state.value = {
      ...state.value,
      joins: state.value.joins.map(j =>
        j.id === joinId ? { ...j, joinType } : j,
      ),
    }
  }

  /** 删除 JOIN */
  function removeJoin(joinId: string) {
    state.value = {
      ...state.value,
      joins: state.value.joins.filter(j => j.id !== joinId),
    }
  }

  // ── WHERE 条件 ──────────────────────────────────────────────────

  function addCondition(): string {
    const id = uid('cond')
    const firstTable = state.value.tables[0]
    const cond: SqlCondition = {
      id,
      tableAlias: firstTable?.alias ?? '',
      column: firstTable?.columns[0]?.name ?? '',
      operator: '=' as SqlOperator,
      value: '',
      logic: 'AND',
    }
    state.value = { ...state.value, conditions: [...state.value.conditions, cond] }
    return id
  }

  function updateCondition(condId: string, partial: Partial<SqlCondition>) {
    state.value = {
      ...state.value,
      conditions: state.value.conditions.map(c =>
        c.id === condId ? { ...c, ...partial } : c,
      ),
    }
  }

  function removeCondition(condId: string) {
    state.value = {
      ...state.value,
      conditions: state.value.conditions.filter(c => c.id !== condId),
    }
  }

  // ── ORDER BY ────────────────────────────────────────────────────

  function addOrderBy(): string {
    const id = uid('order')
    const firstTable = state.value.tables[0]
    const ob: SqlOrderBy = {
      id,
      tableAlias: firstTable?.alias ?? '',
      column: firstTable?.columns[0]?.name ?? '',
      direction: 'ASC',
    }
    state.value = { ...state.value, orderBy: [...state.value.orderBy, ob] }
    return id
  }

  function updateOrderBy(obId: string, partial: Partial<SqlOrderBy>) {
    state.value = {
      ...state.value,
      orderBy: state.value.orderBy.map(o =>
        o.id === obId ? { ...o, ...partial } : o,
      ),
    }
  }

  function removeOrderBy(obId: string) {
    state.value = {
      ...state.value,
      orderBy: state.value.orderBy.filter(o => o.id !== obId),
    }
  }

  // ── LIMIT / DISTINCT ───────────────────────────────────────────

  function setLimit(limit: number | null) {
    state.value = { ...state.value, limit }
  }

  function setDistinct(distinct: boolean) {
    state.value = { ...state.value, distinct }
  }

  // ── SQL 生成 ───────────────────────────────────────────────────

  const generatedSql = computed(() => generateSql())

  function generateSql(): string {
    const { tables, joins, conditions, orderBy, limit, distinct } = state.value
    if (tables.length === 0) return ''

    // SELECT 子句
    const selectCols: string[] = []
    for (const t of tables) {
      if (t.selectedColumns.length === 0) {
        selectCols.push(`${t.alias}.*`)
      } else {
        for (const col of t.selectedColumns) {
          selectCols.push(`${t.alias}.${col}`)
        }
      }
    }
    if (selectCols.length === 0) return ''

    const distinctStr = distinct ? 'DISTINCT ' : ''
    let sql = `SELECT ${distinctStr}${selectCols.join(', ')}`

    // FROM 子句（第一个表）
    const baseTable = tables[0]
    if (!baseTable) return ''
    sql += `\nFROM ${baseTable.tableName} ${baseTable.alias}`

    // JOIN 子句
    // 构建 nodeId -> table 映射
    const idToTable = new Map<string, SqlBuilderTable>()
    for (const t of tables) idToTable.set(t.id, t)

    // 已经出现在 FROM/JOIN 中的表
    const joined = new Set<string>([baseTable.id])

    for (const join of joins) {
      // 确定哪一边是新加入的表
      let joinTarget: SqlBuilderTable | undefined
      let joinSource: SqlBuilderTable | undefined
      let srcCol: string
      let tgtCol: string

      if (joined.has(join.sourceTable) && !joined.has(join.targetTable)) {
        joinSource = idToTable.get(join.sourceTable)
        joinTarget = idToTable.get(join.targetTable)
        srcCol = join.sourceColumn
        tgtCol = join.targetColumn
      } else if (joined.has(join.targetTable) && !joined.has(join.sourceTable)) {
        joinSource = idToTable.get(join.targetTable)
        joinTarget = idToTable.get(join.sourceTable)
        srcCol = join.targetColumn
        tgtCol = join.sourceColumn
      } else if (joined.has(join.sourceTable) && joined.has(join.targetTable)) {
        // 两边都已 join，附加 ON 条件
        const s = idToTable.get(join.sourceTable)
        const t = idToTable.get(join.targetTable)
        if (s && t) {
          // 在最后一个 JOIN 后面追加 AND 条件不太好，先跳过
          // 这种情况在简单场景很少出现
        }
        continue
      } else {
        continue
      }

      if (!joinSource || !joinTarget) continue
      joined.add(joinTarget.id)

      const joinTypeStr = join.joinType === 'FULL' ? 'FULL OUTER' : join.joinType
      sql += `\n${joinTypeStr} JOIN ${joinTarget.tableName} ${joinTarget.alias}`
      sql += ` ON ${joinSource.alias}.${srcCol} = ${joinTarget.alias}.${tgtCol}`
    }

    // 没有 JOIN 的额外表用逗号连接（隐式交叉连接）
    for (const t of tables) {
      if (!joined.has(t.id)) {
        sql += `, ${t.tableName} ${t.alias}`
      }
    }

    // WHERE 子句
    const validConditions = conditions.filter(c => c.tableAlias && c.column)
    if (validConditions.length > 0) {
      /** 转义单引号，防止生成无效 SQL */
      const esc = (v: string) => v.replace(/'/g, "''")
      const parts = validConditions.map((c, i) => {
        let expr: string
        if (c.operator === 'IS NULL') {
          expr = `${c.tableAlias}.${c.column} IS NULL`
        } else if (c.operator === 'IS NOT NULL') {
          expr = `${c.tableAlias}.${c.column} IS NOT NULL`
        } else if (c.operator === 'IN') {
          expr = `${c.tableAlias}.${c.column} IN (${c.value})`
        } else if (c.operator === 'LIKE') {
          expr = `${c.tableAlias}.${c.column} LIKE '${esc(c.value)}'`
        } else {
          // 判断值是否为数字
          const isNum = c.value !== '' && !isNaN(Number(c.value))
          const val = isNum ? c.value : `'${esc(c.value)}'`
          expr = `${c.tableAlias}.${c.column} ${c.operator} ${val}`
        }
        return i === 0 ? expr : `${c.logic} ${expr}`
      })
      sql += `\nWHERE ${parts.join('\n  ')}`
    }

    // ORDER BY 子句
    const validOrderBy = orderBy.filter(o => o.tableAlias && o.column)
    if (validOrderBy.length > 0) {
      const parts = validOrderBy.map(o => `${o.tableAlias}.${o.column} ${o.direction}`)
      sql += `\nORDER BY ${parts.join(', ')}`
    }

    // LIMIT
    if (limit !== null && limit > 0) {
      sql += `\nLIMIT ${limit}`
    }

    return sql
  }

  // ── Vue Flow 转换 ──────────────────────────────────────────────

  function toVueFlowNodes(): Node<SqlBuilderNodeData>[] {
    return state.value.tables.map((t, _i) => ({
      id: t.id,
      type: 'sqlBuilderTable',
      position: { x: 0, y: 0 }, // dagre 会覆盖
      data: {
        tableName: t.tableName,
        alias: t.alias,
        columns: t.columns,
        selectedColumns: t.selectedColumns,
      },
    }))
  }

  function toVueFlowEdges(): Edge<SqlBuilderEdgeData>[] {
    return state.value.joins.map(j => ({
      id: j.id,
      source: j.sourceTable,
      target: j.targetTable,
      type: 'sqlBuilderJoin',
      animated: true,
      data: {
        sourceColumn: j.sourceColumn,
        targetColumn: j.targetColumn,
        joinType: j.joinType,
      },
    }))
  }

  /** Dagre 自动布局 */
  function autoLayout(nodes: Node<SqlBuilderNodeData>[]): Node<SqlBuilderNodeData>[] {
    if (nodes.length === 0) return nodes

    const g = new dagre.graphlib.Graph()
    g.setDefaultEdgeLabel(() => ({}))
    g.setGraph({
      rankdir: 'LR',
      nodesep: 60,
      ranksep: 120,
      marginx: 30,
      marginy: 30,
    })

    for (const node of nodes) {
      const colCount = node.data?.columns.length ?? 0
      const height = 40 + Math.min(colCount, 15) * 26 + 8
      g.setNode(node.id, { width: 260, height })
    }

    for (const join of state.value.joins) {
      g.setEdge(join.sourceTable, join.targetTable)
    }

    dagre.layout(g)

    return nodes.map(node => {
      const pos = g.node(node.id)
      if (!pos) return node
      return {
        ...node,
        position: {
          x: pos.x - (pos.width ?? 260) / 2,
          y: pos.y - (pos.height ?? 100) / 2,
        },
      }
    })
  }

  /** 清空所有 */
  function reset() {
    state.value = {
      tables: [],
      joins: [],
      conditions: [],
      orderBy: [],
      limit: null,
      distinct: false,
    }
    aliasCounter = 0
    idCounter = 0
  }

  /** 获取所有表的 alias + columns（供条件/排序选择器用） */
  const allColumns = computed(() => {
    const result: { alias: string; tableName: string; column: string }[] = []
    for (const t of state.value.tables) {
      for (const c of t.columns) {
        result.push({ alias: t.alias, tableName: t.tableName, column: c.name })
      }
    }
    return result
  })

  /** 已添加的表名集合 */
  const addedTableNames = computed(() =>
    new Set(state.value.tables.map(t => t.tableName)),
  )

  return {
    state,
    generatedSql,
    allColumns,
    addedTableNames,
    // 表操作
    addTable,
    removeTable,
    // 列操作
    toggleColumn,
    selectAllColumns,
    deselectAllColumns,
    // JOIN
    addJoin,
    autoDetectJoins,
    updateJoinType,
    removeJoin,
    // 条件
    addCondition,
    updateCondition,
    removeCondition,
    // 排序
    addOrderBy,
    updateOrderBy,
    removeOrderBy,
    // 其他
    setLimit,
    setDistinct,
    generateSql,
    toVueFlowNodes,
    toVueFlowEdges,
    autoLayout,
    reset,
  }
}
