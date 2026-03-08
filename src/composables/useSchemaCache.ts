import { ref, watch, type Ref } from 'vue'
import type { SchemaCache, DatabaseSchema, TableSchema, DatabaseTreeNode } from '@/types/database'

/**
 * Schema 缓存管理 composable
 * 负责从 ObjectTree 数据构建 SchemaCache，管理加载状态，
 * 并在数据库切换时自动刷新缓存。
 *
 * @param treeNodesGetter - 获取当前 ObjectTree 节点数据的函数
 * @returns schemaCache、isLoadingSchema 状态及刷新方法
 */
export function useSchemaCache(treeNodesGetter: () => DatabaseTreeNode[] | undefined) {
  /** Schema 缓存数据 */
  const schemaCache = ref<SchemaCache | null>(null)
  /** 是否正在加载 Schema */
  const isLoadingSchema = ref(false)
  /** 当前活跃的数据库名称（用于检测切换） */
  const currentDatabase = ref<string | null>(null)

  /** 防抖定时器 */
  let schemaCacheTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * 从 ObjectTree 节点数据构建 SchemaCache
   * 遍历数据库节点及其子节点，提取表名、列信息、注释等元数据
   */
  function buildSchemaCache(nodes: DatabaseTreeNode[]): SchemaCache {
    const databases = new Map<string, DatabaseSchema>()

    for (const dbNode of nodes) {
      if (dbNode.type !== 'database' || !dbNode.meta?.database) continue

      const tables = new Map<string, TableSchema>()

      if (dbNode.children) {
        for (const tblNode of dbNode.children) {
          if (!tblNode.meta?.table) continue

          const columns = tblNode.children?.filter(c => c.type === 'column').map(c => ({
            name: c.label,
            dataType: c.meta?.dataType ?? '',
            nullable: c.meta?.nullable ?? true,
            defaultValue: null,
            isPrimaryKey: c.meta?.isPrimaryKey ?? false,
            comment: c.meta?.comment ?? null,
          })) ?? []

          tables.set(tblNode.meta.table, {
            columns,
            tableType: tblNode.type === 'view' ? 'VIEW' : 'TABLE',
            comment: tblNode.meta?.comment ?? null,
          })
        }
      }

      databases.set(dbNode.meta.database, { tables })
    }

    return { databases }
  }

  /**
   * 触发 Schema 缓存刷新（带 300ms 防抖）
   * 在 ObjectTree 数据变更时调用
   */
  function refreshSchemaCache() {
    if (schemaCacheTimer) clearTimeout(schemaCacheTimer)
    isLoadingSchema.value = true
    schemaCacheTimer = setTimeout(() => {
      const nodes = treeNodesGetter()
      if (nodes) {
        schemaCache.value = buildSchemaCache(nodes)
      }
      isLoadingSchema.value = false
    }, 300)
  }

  /**
   * 数据库切换时刷新 Schema 缓存
   * 先清空旧缓存，标记加载状态，再重新构建
   */
  function handleDatabaseSwitch(newDatabase: string) {
    if (newDatabase === currentDatabase.value) return
    currentDatabase.value = newDatabase
    // 清空旧缓存，触发加载状态提示
    schemaCache.value = null
    refreshSchemaCache()
  }

  /** 清空 Schema 缓存（断开连接时调用） */
  function clearSchemaCache() {
    schemaCache.value = null
    isLoadingSchema.value = false
    currentDatabase.value = null
    if (schemaCacheTimer) {
      clearTimeout(schemaCacheTimer)
      schemaCacheTimer = null
    }
  }

  /** 清理定时器（组件卸载时调用） */
  function dispose() {
    if (schemaCacheTimer) {
      clearTimeout(schemaCacheTimer)
      schemaCacheTimer = null
    }
  }

  return {
    schemaCache,
    isLoadingSchema,
    currentDatabase,
    refreshSchemaCache,
    handleDatabaseSwitch,
    clearSchemaCache,
    dispose,
  }
}
