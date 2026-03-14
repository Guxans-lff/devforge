import { invokeCommand } from '@/api/base'

export function dbBackupDatabase(
  connectionId: string,
  database: string,
  tables: string[],
  includeStructure: boolean,
  includeData: boolean,
  outputPath: string,
): Promise<void> {
  return invokeCommand('db_backup_database', {
    connectionId,
    database,
    tables,
    includeStructure,
    includeData,
    outputPath,
  })
}

export function dbRestoreDatabase(
  connectionId: string,
  database: string,
  filePath: string,
): Promise<void> {
  return invokeCommand('db_restore_database', {
    connectionId,
    database,
    filePath,
  })
}
