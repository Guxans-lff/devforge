import { defineStore } from 'pinia'
import { shallowRef, type Ref } from 'vue'
import type { SchemaCache } from '@/types/database'

/** 跨连接搜索结果 */
export interface SchemaSearchResult {
  connectionId: string
  connectionName: string
  databaseName: string
  tableName: string
  /** 列名（仅列搜索时有值） */
  columnName?: string
  /** 列类型（仅列搜索时有值） */
  columnType?: string
}

/** 注册的 Schema 信息 */
interface RegisteredSchema {
  connectionId: string
  connectionName: string
  cacheRef: Ref<SchemaCache | null>
}

/**
 * 全局 Schema 注册表
 * 复用各连接的 SchemaCache 数据，支持跨连接模糊搜索表名/列名
 */
export const useSchemaRegistryStore = defineStore('schema-registry', () => {
  const registries = shallowRef<Map<string, RegisteredSchema>>(new Map())

  /** 注册一个连接的 SchemaCache */
  function registerSchema(connectionId: string, connectionName: string, cacheRef: Ref<SchemaCache | null>) {
    registries.value.set(connectionId, { connectionId, connectionName, cacheRef })
  }

  /** 注销一个连接的 SchemaCache */
  function unregisterSchema(connectionId: string) {
    registries.value.delete(connectionId)
  }

  /** 跨连接模糊搜索表名 */
  function searchTables(query: string, limit = 20): SchemaSearchResult[] {
    const q = query.toLowerCase()
    const results: SchemaSearchResult[] = []

    for (const reg of registries.value.values()) {
      const cache = reg.cacheRef.value
      if (!cache) continue

      for (const [dbName, dbSchema] of cache.databases) {
        for (const [tableName] of dbSchema.tables) {
          if (tableName.toLowerCase().includes(q)) {
            results.push({
              connectionId: reg.connectionId,
              connectionName: reg.connectionName,
              databaseName: dbName,
              tableName,
            })
            if (results.length >= limit) return results
          }
        }
      }
    }
    return results
  }

  /** 跨连接模糊搜索列名 */
  function searchColumns(query: string, limit = 20): SchemaSearchResult[] {
    const q = query.toLowerCase()
    const results: SchemaSearchResult[] = []

    for (const reg of registries.value.values()) {
      const cache = reg.cacheRef.value
      if (!cache) continue

      for (const [dbName, dbSchema] of cache.databases) {
        for (const [tableName, tableSchema] of dbSchema.tables) {
          for (const col of tableSchema.columns) {
            if (col.name.toLowerCase().includes(q)) {
              results.push({
                connectionId: reg.connectionId,
                connectionName: reg.connectionName,
                databaseName: dbName,
                tableName,
                columnName: col.name,
                columnType: col.dataType,
              })
              if (results.length >= limit) return results
            }
          }
        }
      }
    }
    return results
  }

  return {
    registries,
    registerSchema,
    unregisterSchema,
    searchTables,
    searchColumns,
  }
})
