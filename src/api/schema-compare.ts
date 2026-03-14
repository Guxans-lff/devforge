import { invokeCommand } from '@/api/base'
import type { SchemaDiff } from '@/types/schema-compare'

export function schemaCompare(
  sourceConnectionId: string,
  sourceDatabase: string,
  targetConnectionId: string,
  targetDatabase: string,
): Promise<SchemaDiff> {
  return invokeCommand('schema_compare', {
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
  return invokeCommand('generate_migration_sql', {
    diff,
    driver,
    sourceConnectionId,
    sourceDatabase,
    targetDatabase,
  })
}
