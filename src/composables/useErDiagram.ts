import { ref, computed } from 'vue'
import type { Node, Edge } from '@vue-flow/core'
import dagre from 'dagre'
import { dbGetSchemaBundle } from '@/api/database'
import { buildAllColumnsCacheKey, buildForeignKeysCacheKey, buildTablesCacheKey, fetchWithCache, setCache, warmColumnMetadataCache } from '@/composables/useMetadataCache'
import type { ErTableNodeData, ErEdgeData, ErLayoutOptions } from '@/types/er-diagram'
import type { ColumnInfo } from '@/types/database'

/** ER 图 composable */
export function useErDiagram(connectionId: string, database: string) {
  const nodes = ref<Node<ErTableNodeData>[]>([])
  const edges = ref<Edge<ErEdgeData>[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const searchQuery = ref('')

  /** 布局选项 */
  const layoutOptions = ref<ErLayoutOptions>({
    direction: 'TB',
    nodeSpacing: 60,
    rankSpacing: 100,
  })

  /** 搜索匹配的节点高亮 */
  const highlightedNodes = computed(() => {
    if (!searchQuery.value.trim()) return new Set<string>()
    const q = searchQuery.value.toLowerCase()
    return new Set(
      nodes.value
        .filter(n => n.data?.tableName.toLowerCase().includes(q))
        .map(n => n.id),
    )
  })

  /** 加载 ER 图数据 */
  async function loadDiagram() {
    loading.value = true
    error.value = null
    try {
      // 并行获取表和外键
      const { data: bundle } = await fetchWithCache(
        `${connectionId}:${database}:schemaBundle`,
        () => dbGetSchemaBundle(connectionId, database),
      )
      const tables = bundle.tables
      const foreignKeys = bundle.foreignKeys
      const allColumns = bundle.allColumns
      setCache(buildTablesCacheKey(connectionId, database), tables)
      setCache(buildForeignKeysCacheKey(connectionId, database), foreignKeys)
      setCache(buildAllColumnsCacheKey(connectionId, database), allColumns)
      warmColumnMetadataCache(connectionId, database, allColumns)

      // 获取每个表的列信息
      const columnsMap = new Map<string, ColumnInfo[]>(Object.entries(allColumns))

      // 构建节点
      const newNodes: Node<ErTableNodeData>[] = tables.map((table) => ({
        id: table.name,
        type: 'erTable',
        position: { x: 0, y: 0 }, // 后面会被 dagre 覆盖
        data: {
          tableName: table.name,
          database,
          columns: columnsMap.get(table.name) ?? [],
          comment: table.comment ?? undefined,
          highlighted: false,
        },
      }))

      // 构建边（外键关系）
      const newEdges: Edge<ErEdgeData>[] = foreignKeys.map((fk) => ({
        id: `fk-${fk.tableName}-${fk.columnName}-${fk.referencedTableName}-${fk.referencedColumnName}`,
        source: fk.tableName,
        target: fk.referencedTableName,
        type: 'erRelation',
        animated: true,
        data: {
          sourceColumn: fk.columnName,
          targetColumn: fk.referencedColumnName,
          relationLabel: `${fk.columnName} → ${fk.referencedColumnName}`,
        },
      }))

      nodes.value = newNodes
      edges.value = newEdges

      // 自动布局
      applyLayout()
    } catch (e) {
      error.value = String(e)
    } finally {
      loading.value = false
    }
  }

  /** 使用 Dagre 自动布局 */
  function applyLayout() {
    const g = new dagre.graphlib.Graph()
    g.setDefaultEdgeLabel(() => ({}))
    g.setGraph({
      rankdir: layoutOptions.value.direction,
      nodesep: layoutOptions.value.nodeSpacing,
      ranksep: layoutOptions.value.rankSpacing,
      marginx: 30,
      marginy: 30,
    })

    // 设置节点大小（根据列数动态计算高度）
    for (const node of nodes.value) {
      const columnCount = node.data?.columns.length ?? 0
      const headerHeight = 36
      const columnHeight = 22
      const height = headerHeight + columnCount * columnHeight + 8
      const width = 240
      g.setNode(node.id, { width, height })
    }

    // 设置边
    for (const edge of edges.value) {
      g.setEdge(edge.source, edge.target)
    }

    dagre.layout(g)

    // 更新节点位置
    nodes.value = nodes.value.map(node => {
      const nodeWithPosition = g.node(node.id)
      if (!nodeWithPosition) return node
      return {
        ...node,
        position: {
          x: nodeWithPosition.x - (nodeWithPosition.width ?? 240) / 2,
          y: nodeWithPosition.y - (nodeWithPosition.height ?? 100) / 2,
        },
      }
    })
  }

  /** 切换布局方向 */
  function toggleDirection() {
    layoutOptions.value = {
      ...layoutOptions.value,
      direction: layoutOptions.value.direction === 'TB' ? 'LR' : 'TB',
    }
    applyLayout()
  }

  return {
    nodes,
    edges,
    loading,
    error,
    searchQuery,
    layoutOptions,
    highlightedNodes,
    loadDiagram,
    applyLayout,
    toggleDirection,
  }
}
