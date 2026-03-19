import { ref } from 'vue'
import type { SchemaCache, DatabaseSchema, TableSchema, DatabaseTreeNode, ColumnInfo } from '@/types/database'
import { dbGetForeignKeys, dbGetAllColumns } from '@/api/database'
import { setCache } from '@/composables/useMetadataCache'

/**
 * Schema 缓存管理 composable
 * 负责从 ObjectTree 数据构建 SchemaCache，管理加载状态，
 * 并在数据库切换时自动刷新缓存。
 *
 * 两层数据来源：
 * 1. ObjectTree 节点（表名、已展开表的列信息）
 * 2. 批量预加载（连接/切换数据库时主动加载所有表的列信息）
 *
 * 外键数据异步追加，不阻塞首次可用。
 */
export function useSchemaCache(
  treeNodesGetter: () => DatabaseTreeNode[] | undefined,
  connectionIdGetter?: () => string | undefined,
) {
  /** Schema 缓存数据 */
  const schemaCache = ref<SchemaCache | null>(null)
  /** 是否正在加载 Schema */
  const isLoadingSchema = ref(false)
  /** 当前活跃的数据库名称（用于检测切换） */
  const currentDatabase = ref<string | null>(null)
  /** 已预加载列信息的数据库集合 */
  const preloadedDatabases = new Set<string>()

  /** 防抖定时器 */
  let schemaCacheTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * 从 ObjectTree 节点数据构建 SchemaCache
   * 遍历数据库节点及其子节点，提取表名、列信息、注释等元数据。
   * 合并策略：ObjectTree 节点有列数据时优先使用，否则保留已有缓存（预加载数据）。
   */
  function buildSchemaCache(nodes: DatabaseTreeNode[]): SchemaCache {
    const existingCache = schemaCache.value
    const databases = new Map<string, DatabaseSchema>()

    for (const dbNode of nodes) {
      if (dbNode.type !== 'database' || !dbNode.meta?.database) continue

      const dbName = dbNode.meta.database
      const existingDb = existingCache?.databases.get(dbName)
      const tables = new Map<string, TableSchema>()

      if (dbNode.children) {
        for (const tblNode of dbNode.children) {
          if (!tblNode.meta?.table) continue

          const tableName = tblNode.meta.table
          const treeColumns = tblNode.children?.filter(c => c.type === 'column').map(c => ({
            name: c.label,
            dataType: c.meta?.dataType ?? '',
            nullable: c.meta?.nullable ?? true,
            defaultValue: null,
            isPrimaryKey: c.meta?.isPrimaryKey ?? false,
            comment: c.meta?.comment ?? null,
          })) ?? []

          // 合并策略：ObjectTree 展开了有列数据 → 用最新的；否则保留已有缓存（预加载数据）
          const existingTable = existingDb?.tables.get(tableName)
          const columns = treeColumns.length > 0
            ? treeColumns
            : (existingTable?.columns ?? [])

          tables.set(tableName, {
            columns,
            tableType: tblNode.type === 'view' ? 'VIEW' : 'TABLE',
            comment: tblNode.meta?.comment ?? null,
          })
        }
      }

      // 保留预加载时创建但 ObjectTree 中不存在的表（如未展开数据库文件夹时预加载的表）
      if (existingDb) {
        for (const [tableName, tableSchema] of existingDb.tables) {
          if (!tables.has(tableName)) {
            tables.set(tableName, tableSchema)
          }
        }
      }

      // 保留已加载的外键数据
      const dbSchema: DatabaseSchema = { tables }
      if (existingDb?.foreignKeys) {
        dbSchema.foreignKeys = existingDb.foreignKeys
      }

      databases.set(dbName, dbSchema)
    }

    return { databases }
  }

  /**
   * 批量预加载指定数据库的所有表列信息
   * 直接注入到 SchemaCache 中，不依赖 ObjectTree 展开
   */
  async function preloadColumns(database: string) {
    const connectionId = connectionIdGetter?.()
    if (!connectionId || preloadedDatabases.has(database)) return

    // 批量预加载列信息
    try {
      const allColumns = await dbGetAllColumns(connectionId, database)
      const cache = schemaCache.value
      if (!cache) {
        console.warn(`[SchemaCache] 预加载时 schemaCache 为空`)
        return
      }

      const dbSchema = cache.databases.get(database)
      if (!dbSchema) {
        console.warn(`[SchemaCache] 预加载时找不到数据库: ${database}`)
        return
      }

      // 将批量查询结果注入每个表的列信息
      for (const [tableName, columns] of Object.entries(allColumns)) {
        // 同时写入 MetadataCache，ObjectTree 展开表时直接命中不再请求
        const metaCacheKey = `${connectionId}:${database}:${tableName}:columns`
        setCache(metaCacheKey, columns)

        const mappedColumns = columns.map(c => ({
          name: c.name,
          dataType: c.dataType,
          nullable: c.nullable,
          defaultValue: c.defaultValue ?? null,
          isPrimaryKey: c.isPrimaryKey,
          comment: c.comment ?? null,
        }))

        const existing = dbSchema.tables.get(tableName)
        if (existing) {
          // 仅当表尚无列数据时注入（避免覆盖 ObjectTree 已展开的更精确数据）
          if (existing.columns.length === 0) {
            // 创建新的 TableSchema 对象，不直接修改原对象
            dbSchema.tables.set(tableName, {
              ...existing,
              columns: mappedColumns,
            })
          }
        } else {
          // 表可能未在 ObjectTree 中（如还未展开数据库文件夹），直接创建
          dbSchema.tables.set(tableName, {
            columns: mappedColumns,
            tableType: 'TABLE',
            comment: null,
          })
        }
      }

      preloadedDatabases.add(database)
      // 触发响应式更新
      schemaCache.value = { databases: new Map(cache.databases) }
    } catch (e) {
      console.warn(`[SchemaCache] 预加载列信息失败 [${database}]:`, e)
    }
  }

  /**
   * 异步加载外键数据并追加到 SchemaCache 中
   * 加载失败时静默降级，不影响基础补全功能
   */
  async function loadForeignKeys(cache: SchemaCache) {
    const connectionId = connectionIdGetter?.()
    if (!connectionId) return

    for (const [dbName, dbSchema] of cache.databases) {
      try {
        const fks = await dbGetForeignKeys(connectionId, dbName)
        dbSchema.foreignKeys = fks
      } catch (e) {
        console.warn(`加载外键数据失败 [${dbName}]:`, e)
      }
    }

    // 触发响应式更新
    schemaCache.value = { databases: new Map(cache.databases) }
  }

  /**
   * 触发 Schema 缓存刷新（带 300ms 防抖）
   * 在 ObjectTree 数据变更时调用
   */
  function refreshSchemaCache() {
    if (schemaCacheTimer) clearTimeout(schemaCacheTimer)
    isLoadingSchema.value = true
    schemaCacheTimer = setTimeout(async () => {
      const nodes = treeNodesGetter()
      if (nodes) {
        const cache = buildSchemaCache(nodes)
        // 先让 Schema 立即可用（无外键），再异步追加外键和列信息
        schemaCache.value = cache
        isLoadingSchema.value = false

        // 并行执行：预加载当前数据库列信息 + 加载外键
        const db = currentDatabase.value
        const tasks: Promise<void>[] = [loadForeignKeys(cache)]
        if (db) tasks.push(preloadColumns(db))
        await Promise.all(tasks)
      } else {
        isLoadingSchema.value = false
      }
    }, 300)
  }

  /**
   * 数据库切换时刷新 Schema 缓存
   * 不清空已有缓存（合并策略会保留），仅标记加载状态并重新构建
   */
  function handleDatabaseSwitch(newDatabase: string) {
    if (newDatabase === currentDatabase.value) return
    currentDatabase.value = newDatabase
    // 切换数据库时需要为新数据库预加载列信息
    preloadedDatabases.delete(newDatabase)
    refreshSchemaCache()
  }

  /** 清空 Schema 缓存（断开连接时调用） */
  function clearSchemaCache() {
    schemaCache.value = null
    isLoadingSchema.value = false
    currentDatabase.value = null
    preloadedDatabases.clear()
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
    preloadColumns,
    dispose,
  }
}
