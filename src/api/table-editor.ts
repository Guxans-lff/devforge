import { invoke } from '@tauri-apps/api/core'
import type { TableDefinition, TableAlteration, DdlResult, TableDetail } from '@/types/table-editor'

export function generateCreateTableSql(definition: TableDefinition, driver: string): Promise<DdlResult> {
  return invoke('generate_create_table_sql', { definition, driver })
}

export function generateAlterTableSql(alteration: TableAlteration, driver: string): Promise<DdlResult> {
  return invoke('generate_alter_table_sql', { alteration, driver })
}

export function executeDdl(connectionId: string, sql: string): Promise<boolean> {
  return invoke('execute_ddl', { connectionId, sql })
}

export function getTableDetail(connectionId: string, database: string, table: string): Promise<TableDetail> {
  return invoke('get_table_detail', { connectionId, database, table })
}
