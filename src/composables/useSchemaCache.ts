import { ref } from 'vue'
import type { SchemaCache, DatabaseSchema, TableSchema, DatabaseTreeNode } from '@/types/database'
import { dbGetForeignKeys, dbGetAllColumns } from '@/api/database'
import { warmColumnMetadataCache } from '@/composables/useMetadataCache'
import { createLogger } from '@/utils/logger'

export function useSchemaCache(
  treeNodesGetter: () => DatabaseTreeNode[] | undefined,
  connectionIdGetter?: () => string | undefined,
) {
  const log = createLogger('schema.cache')
  const schemaCache = ref<SchemaCache | null>(null)
  const isLoadingSchema = ref(false)
  const currentDatabase = ref<string | null>(null)
  const preloadedDatabases = new Set<string>()
  const columnPreloadInflight = new Map<string, Promise<void>>()
  const loadedForeignKeyDatabases = new Set<string>()
  const foreignKeyInflight = new Map<string, Promise<void>>()

  let schemaCacheTimer: ReturnType<typeof setTimeout> | null = null

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

      if (existingDb) {
        for (const [tableName, tableSchema] of existingDb.tables) {
          if (!tables.has(tableName)) {
            tables.set(tableName, tableSchema)
          }
        }
      }

      const dbSchema: DatabaseSchema = { tables }
      if (existingDb?.foreignKeys) {
        dbSchema.foreignKeys = existingDb.foreignKeys
      }

      databases.set(dbName, dbSchema)
    }

    return { databases }
  }

  async function preloadColumns(database: string) {
    const connectionId = connectionIdGetter?.()
    if (!connectionId) return

    const inflightKey = `${connectionId}:${database}`
    if (preloadedDatabases.has(inflightKey)) return
    const existingTask = columnPreloadInflight.get(inflightKey)
    if (existingTask) return existingTask

    const task = (async () => {
      const allColumns = await dbGetAllColumns(connectionId, database)
      const cache = schemaCache.value
      if (!cache) {
        log.warn('schemaCache_missing_preload_columns')
        return
      }

      const dbSchema = cache.databases.get(database)
      if (!dbSchema) {
        log.warn('database_missing_preload_columns', { database })
        return
      }

      warmColumnMetadataCache(connectionId, database, allColumns)
      for (const [tableName, columns] of Object.entries(allColumns)) {
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
          if (existing.columns.length === 0) {
            dbSchema.tables.set(tableName, {
              ...existing,
              columns: mappedColumns,
            })
          }
        } else {
          dbSchema.tables.set(tableName, {
            columns: mappedColumns,
            tableType: 'TABLE',
            comment: null,
          })
        }
      }

      preloadedDatabases.add(inflightKey)
      schemaCache.value = { databases: new Map(cache.databases) }
    })()

    columnPreloadInflight.set(inflightKey, task)
    try {
      await task
    } catch (e) {
      log.warn('preload_columns_failed', { database }, e)
    } finally {
      columnPreloadInflight.delete(inflightKey)
    }
  }

  async function loadForeignKeysForDatabase(cache: SchemaCache, database: string) {
    const connectionId = connectionIdGetter?.()
    if (!connectionId) return

    const inflightKey = `${connectionId}:${database}`
    if (loadedForeignKeyDatabases.has(inflightKey)) return
    if (!cache.databases.has(database)) return
    const existingTask = foreignKeyInflight.get(inflightKey)
    if (existingTask) return existingTask

    const task = (async () => {
      try {
        const fks = await dbGetForeignKeys(connectionId, database)
        const latestCache = schemaCache.value
        const latestDbSchema = latestCache?.databases.get(database)
        if (!latestCache || !latestDbSchema) return
        latestDbSchema.foreignKeys = fks
        loadedForeignKeyDatabases.add(inflightKey)
        schemaCache.value = { databases: new Map(latestCache.databases) }
      } catch (e) {
        log.warn('load_foreign_keys_failed', { database }, e)
      }
    })()

    foreignKeyInflight.set(inflightKey, task)
    try {
      await task
    } finally {
      foreignKeyInflight.delete(inflightKey)
    }
  }

  function refreshSchemaCache() {
    if (schemaCacheTimer) clearTimeout(schemaCacheTimer)
    isLoadingSchema.value = true
    schemaCacheTimer = setTimeout(async () => {
      const nodes = treeNodesGetter()
      if (!nodes) {
        isLoadingSchema.value = false
        return
      }

      const cache = buildSchemaCache(nodes)
      schemaCache.value = cache
      isLoadingSchema.value = false

      const db = currentDatabase.value
      const tasks: Promise<void>[] = []
      if (db) {
        tasks.push(loadForeignKeysForDatabase(cache, db))
        tasks.push(preloadColumns(db))
      }
      await Promise.all(tasks)
    }, 300)
  }

  function handleDatabaseSwitch(newDatabase: string) {
    if (newDatabase === currentDatabase.value) return
    currentDatabase.value = newDatabase
    refreshSchemaCache()
  }

  function clearSchemaCache() {
    schemaCache.value = null
    isLoadingSchema.value = false
    currentDatabase.value = null
    preloadedDatabases.clear()
    columnPreloadInflight.clear()
    loadedForeignKeyDatabases.clear()
    foreignKeyInflight.clear()
    if (schemaCacheTimer) {
      clearTimeout(schemaCacheTimer)
      schemaCacheTimer = null
    }
  }

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
