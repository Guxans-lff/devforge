import { invokeCommand } from '@/api/base'
import type { TableDefinition, TableAlteration, DdlResult, TableDetail } from '@/types/table-editor'

export function generateCreateTableSql(definition: TableDefinition, driver: string): Promise<DdlResult> {
  return invokeCommand('generate_create_table_sql', { definition, driver })
}

export function generateAlterTableSql(alteration: TableAlteration, driver: string): Promise<DdlResult> {
  return invokeCommand('generate_alter_table_sql', { alteration, driver })
}

export function executeDdl(connectionId: string, sql: string): Promise<boolean> {
  return invokeCommand('execute_ddl', { connectionId, sql })
}

export function getTableDetail(connectionId: string, database: string, table: string): Promise<TableDetail> {
  return invokeCommand('get_table_detail', { connectionId, database, table })
}

export function getTableDdl(connectionId: string, database: string, table: string): Promise<string> {
  return invokeCommand('get_table_ddl', { connectionId, database, table })
}
