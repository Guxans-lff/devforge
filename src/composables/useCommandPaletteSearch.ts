import { ref, computed, watch } from 'vue'
import { useSchemaRegistryStore, type SchemaSearchResult } from '@/stores/schema-registry'
import { useWorkspaceStore } from '@/stores/workspace'
import { useCommandPaletteStore, type CommandItem } from '@/stores/command-palette'
import { listQueryHistory, type QueryHistoryRecord } from '@/api/query-history'

/** 搜索前缀类型 */
type SearchPrefix = '@' | '.' | ':' | '#' | null

/** 解析搜索输入的前缀和查询词 */
function parseSearchInput(input: string): { prefix: SearchPrefix; query: string } {
  if (!input) return { prefix: null, query: '' }
  const firstChar = input[0]
  if (firstChar === '@' || firstChar === '.' || firstChar === ':' || firstChar === '#') {
    return { prefix: firstChar as SearchPrefix, query: input.slice(1).trim() }
  }
  return { prefix: null, query: input }
}

/**
 * 命令面板搜索增强
 * 支持前缀搜索：@ 表/视图、. 列名、: 查询历史、# 连接
 */
export function useCommandPaletteSearch() {
  const schemaRegistry = useSchemaRegistryStore()
  const workspaceStore = useWorkspaceStore()
  const commandPaletteStore = useCommandPaletteStore()

  /** 当前搜索输入 */
  const searchInput = ref('')
  /** 解析后的前缀 */
  const parsedPrefix = computed(() => parseSearchInput(searchInput.value).prefix)
  /** 解析后的查询词 */
  const parsedQuery = computed(() => parseSearchInput(searchInput.value).query)

  /** 查询历史缓存 */
  const historyResults = ref<QueryHistoryRecord[]>([])

  /** 监听前缀为 : 时加载查询历史 */
  watch([parsedPrefix, parsedQuery], async ([prefix, query]) => {
    if (prefix === ':') {
      try {
        historyResults.value = await listQueryHistory({
          searchText: query || null,
          limit: 15,
          offset: 0,
        })
      } catch {
        historyResults.value = []
      }
    } else {
      historyResults.value = []
    }
  })

  /** 获取当前活跃连接 ID */
  function getActiveConnectionId(): string | null {
    const activeTab = workspaceStore.tabs.find(t => t.id === workspaceStore.activeTabId)
    return activeTab?.connectionId ?? null
  }

  /** Schema 搜索结果转换为 CommandItem（当前连接优先排序） */
  function schemaToCommands(results: SchemaSearchResult[], type: 'table' | 'column'): CommandItem[] {
    const activeConnId = getActiveConnectionId()
    const sorted = [...results].sort((a, b) => {
      // 当前连接优先
      if (a.connectionId === activeConnId && b.connectionId !== activeConnId) return -1
      if (b.connectionId === activeConnId && a.connectionId !== activeConnId) return 1
      return 0
    })

    return sorted.map(r => ({
      id: type === 'table'
        ? `schema-${r.connectionId}-${r.databaseName}-${r.tableName}`
        : `col-${r.connectionId}-${r.databaseName}-${r.tableName}-${r.columnName}`,
      label: type === 'table' ? r.tableName : `${r.tableName}.${r.columnName}`,
      description: type === 'table'
        ? `${r.connectionName} / ${r.databaseName}`
        : `${r.columnType ?? ''} · ${r.connectionName} / ${r.databaseName}`,
      icon: type === 'table' ? 'Table2' : 'Columns3',
      category: 'schema' as any,
      keywords: [],
      action: () => {
        // 切换到对应连接并生成 SELECT 语句
        const tabId = `database-${r.connectionId}`
        workspaceStore.addTab({
          id: tabId,
          type: 'database',
          title: r.connectionName,
          connectionId: r.connectionId,
          closable: true,
        })
        commandPaletteStore.close()
      },
    }))
  }

  /** 查询历史转换为 CommandItem */
  function historyToCommands(records: QueryHistoryRecord[]): CommandItem[] {
    return records.map(r => ({
      id: `history-${r.id}`,
      label: r.sqlText.slice(0, 80),
      description: `${r.connectionName ?? ''} · ${new Date(r.executedAt).toLocaleString()}`,
      icon: 'Clock',
      category: 'history' as any,
      keywords: [],
      action: () => {
        // 插入 SQL 到当前活跃的查询面板
        window.dispatchEvent(new CustomEvent('devforge:insert-sql', { detail: r.sqlText }))
        commandPaletteStore.close()
      },
    }))
  }

  /** 连接搜索结果 */
  function connectionToCommands(query: string): CommandItem[] {
    if (!query) return commandPaletteStore.connectionCommands
    const q = query.toLowerCase()
    return commandPaletteStore.connectionCommands.filter(c =>
      c.label.toLowerCase().includes(q) ||
      (c.description ?? '').toLowerCase().includes(q),
    )
  }

  /** 根据前缀获取搜索结果 */
  const prefixResults = computed<CommandItem[]>(() => {
    const prefix = parsedPrefix.value
    const query = parsedQuery.value

    if (!prefix) return []

    switch (prefix) {
      case '@': {
        if (!query) return []
        return schemaToCommands(schemaRegistry.searchTables(query), 'table')
      }
      case '.': {
        if (!query) return []
        return schemaToCommands(schemaRegistry.searchColumns(query), 'column')
      }
      case ':': {
        return historyToCommands(historyResults.value)
      }
      case '#': {
        return connectionToCommands(query)
      }
      default:
        return []
    }
  })

  /** 是否处于前缀搜索模式 */
  const isPrefixMode = computed(() => parsedPrefix.value !== null)

  return {
    searchInput,
    parsedPrefix,
    parsedQuery,
    prefixResults,
    isPrefixMode,
  }
}
