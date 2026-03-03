import { invoke } from '@tauri-apps/api/core'
import type { SchemaDiff } from '@/types/schema-compare'

export function schemaCompare(
  sourceConnectionId: string,
  sourceDatabase: string,
  targetConnectionId: string,
  targetDatabase: string,
): Promise<SchemaDiff> {
  return invoke('schema_compare', {
    sourceConnectionId,
    sourceDatabase,
    targetConnectionId,
    targetDatabase,
  })
}

export function generateMigrationSql(
  diff: SchemaDiff,
  driver: string,
  sourceConnectionId: string,
  sourceDatabase: string,
  targetDatabase: string,
): Promise<string> {
  return invoke('generate_migration_sql', {
    diff,
    driver,
    sourceConnectionId,
    sourceDatabase,
    targetDatabase,
  })
}
